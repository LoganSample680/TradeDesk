import Foundation
import Capacitor
import CoreLocation
import CoreMotion
import UIKit

// TradeDesk battery-aware geofence engine.
//
// Three states, mirroring MileIQ-style trackers:
//   PARKED  : GPS fully off. CoreLocation region monitoring (geofence hardware)
//             plus significant-location-change watch for departure. Near-zero
//             battery, no blue arrow pinned in the Dynamic Island.
//   BURST   : a few seconds of kCLLocationAccuracyBest on demand, then dark
//             again. What stamps a boundary at the kerb instead of half a mile
//             down the road (burstFix).
//   DRIVE   : the window (setSampling, owner 2026-09-01). Best accuracy at a
//             30m filter, opened by JS when the motion coprocessor flips to
//             automotive or a relaunched app sees a fence exit, closed when
//             the leg closes, and capped in Swift so it can never outlive the
//             drive it was opened for. This is the only state that produces a
//             breadcrumb dense enough to draw a route from.
//
// Between all three the radio is OFF by default. Nothing here holds a standing
// location session any more: the heartbeat's keepalive is opt-in and JS leaves
// it off (see heartbeatKeepalive), which is what takes the blue arrow down
// between drives.
//
// Every native event is appended to a UserDefaults buffer BEFORE being emitted
// as a listener event, so fixes that arrive while the WebView is suspended or
// dead replay into the fence machine on the next boot via drainBuffer().
@objc(TdGeoPlugin)
public class TdGeoPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate, URLSessionTaskDelegate {
    public let identifier = "TdGeoPlugin"
    public let jsName = "TdGeo"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startParked", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainBuffer", returnType: CAPPluginReturnPromise),
        // Build #13: the event-driven engine under evaluation.
        CAPPluginMethod(name: "startEvents", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "burstFix", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "motionSince", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stats", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "motionPermStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "locationPermStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPreciseTemp", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configureFlush", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startHeartbeat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopHeartbeat", returnType: CAPPluginReturnPromise),
        // Build #44: the drive window. Dense sampling on demand, capped in
        // Swift so JS can never leave the radio on all night.
        CAPPluginMethod(name: "setSampling", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "samplingState", returnType: CAPPluginReturnPromise)
    ]

    private var locationManager: CLLocationManager?
    private let bufferKey = "td_geo_fix_buffer"
    private let bufferCap = 600
    // What JS last armed, persisted so a system relaunch can restore it.
    // {mode:"parked"|"events", visits:Bool}. Cleared by stopAll.
    private let armedKey = "td_geo_armed"
    // The heartbeat's own persisted state ({intervalMs, ttlMs, startedAtMs}).
    // Without it a force-quit or OS kill silently ends the 30-minute beat for
    // the rest of the shift (owner report 2026-08-27: a whole morning at a job
    // with zero heartbeat events), because heartbeatOn only lived in memory
    // and load() restored everything EXCEPT the beat.
    private let hbKey = "td_geo_hb"
    // ── Real-time flush (owner 2026-08-27) ──────────────────────────────────
    // Config JS hands over via configureFlush: {url, userId, deviceId, key}.
    // The key is the per-device geo_flush_keys secret, NOT a Supabase token:
    // a token refresh from here would rotate the JS client's session away.
    private let flushCfgKey = "td_geo_flush_cfg"
    // Capture-ts watermark: events with ts <= this have been acknowledged by
    // the server. Never advanced on send, only on a 2xx, so a lost response
    // re-sends the tail and the server's dedupe index absorbs the overlap.
    private let flushMarkKey = "td_geo_flush_ts"
    // How far the motion BACKFILL has already reached. Separate from the flush
    // mark: the flush mark moves when bytes leave the device, this moves when
    // history has been read off the coprocessor, and a wake must never re-emit
    // transitions it already pulled.
    private let motionMarkKey = "td_geo_motion_hist_ts"
    // taskIdentifier -> the batch's max ts, persisted so a delegate callback
    // arriving after a relaunch can still advance the watermark.
    private let flushInflightKey = "td_geo_flush_inflight"
    private var flushPending = false
    // ── Shift heartbeat + motion stream (owner 2026-08-27) ──────────────────
    // The heartbeat holds a LOW-POWER location session (3km accuracy, huge
    // distance filter, so effectively no fixes and no meaningful radio) whose
    // only job is keeping this process alive in the background so a timer can
    // prove liveness every intervalMs. JS decides when a shift starts and
    // ends and passes every number; ttlMs is the self-destruct so a phone
    // left at the shop over a weekend stops proving anything by itself.
    private var lifecycleObserversOn = false
    private var heartbeatTimer: Timer?
    private var heartbeatOn = false
    private var heartbeatStartedAt: Date?
    private var heartbeatTtlMs: Double = 0
    // ── THE KEEPALIVE IS NOW OPT-IN, AND OFF BY DEFAULT (owner 2026-09-01) ───
    // "right now when tradedesk backgrounds I see the blue navigation arrow,
    // that's old continuous engine." That arrow is not the drive engine and
    // never was: iOS pins the status-bar location indicator for ANY background
    // location session, however coarse, and the heartbeat held one every
    // waking minute of a shift purely to keep this process resident.
    //
    // What the session was supposed to buy is residency, and the evidence that
    // it delivered any is thin. On 2026-08-31 the owner backgrounded a phone
    // mid-shift and delivery stopped dead: the backgrounding event itself took
    // 1028 seconds to arrive, the drive home's motion edges 888 and 703 (see
    // scheduleFlush below). Whether the beat was armed at that exact minute is
    // NOT established, so this is not proof the keepalive does nothing. What it
    // does establish is that the app was suspended in the field with this
    // design in place, which is the thing a keepalive exists to prevent.
    //
    // And the liveness it was reaching for has a cheaper owner now: the
    // 30-minute silent push (supabase/functions/push-geo-ping) already wakes a
    // backgrounded app and records a fix, which is both the confirmer for the
    // drive window and the shift-liveness signal. Apple will not deliver those
    // to a FORCE-QUIT app, so that case still rests on the region and
    // significant-change wake net, exactly as it did before.
    //
    // So JS decides, per the dumb-native rule, and it decides `false` today.
    // Flipping it back on is one JS argument and a UAT roll (§3.2), never a
    // rebuild, which is exactly the property that makes it safe to default off.
    private var heartbeatKeepalive = false
    // ── The drive window (owner 2026-09-01) ─────────────────────────────────
    // Dense sampling is a WINDOW, not a mode of life. JS opens it when the
    // motion coprocessor flips to automotive or a relaunched app sees a fence
    // exit, and closes it when the leg closes. Persisted, so a relaunch
    // mid-drive resumes the window instead of losing the route, and so the cap
    // below can be judged from the ORIGINAL start however many times iOS
    // restarts this process.
    //
    // {mode:"drive", startedAtMs, maxMs, filter}. Absent means coarse.
    private let samplingKey = "td_geo_sampling"
    private var samplingCapTimer: Timer?
    // When the CURRENT process started paying for the drive window. Separate
    // from startedAtMs above: that one anchors the cap across relaunches, this
    // one only ever measures radio seconds this process is responsible for, so
    // a relaunch cannot bill the same minutes twice.
    private var driveRadioStartedAt: Date?
    // THE SAFETY CAP. JS closes the window; if JS never gets to (app killed
    // mid-drive, a bug, a close that never arrives), this is what puts the
    // radio back on its own. A phone stuck at kCLLocationAccuracyBest all
    // night is the worst outcome this whole feature can produce, so the
    // fallback lives here, in the layer that cannot be reasoned out of running.
    private static let samplingCapFloorMs: Double = 60_000        // 1 minute
    private static let samplingCapCeilingMs: Double = 4 * 3600_000 // 4 hours
    private static let samplingCapDefaultMs: Double = 90 * 60_000  // 90 minutes
    // 30 m. GPS delivers at most 1 Hz, so at 60 mph (27 m/s) a filter below
    // ~27 m stops being the limiter and only adds stationary jitter; at 25 mph
    // in town 30 m is a fix every 2.7 s, which traces a corner honestly. 50 m
    // undersamples a cloverleaf. Clamped, never trusted raw from the bridge.
    private static let driveFilterDefaultM: Double = 30
    // ── ONE FLIP, ONE ID, ONE ROW (owner rule 2026-08-31) ────────────────────
    // In memory this was wiped every time the stream was re-armed, and it is
    // re-armed from three places (boot, relaunch, resume). Each re-arm made
    // the next sample of an UNCHANGED state look like a fresh transition, so
    // one departure was reported four times: his 1:19pm pull-out fired
    // automotive at 18:19:10.215, 18:20:35.529, .747 and .788.
    //
    // That is the whole duplicate-row problem. The leg key is derived from the
    // start millisecond, so with four candidate instants the phone keyed off
    // .747 and the server off .529, and one drive became two rows with two
    // distances and two clocks. Owner: "we should only write one, ever ...
    // one ID that runs through the journey per core motion flip."
    //
    // So the memory is durable, and each genuine flip mints an id ONCE, here,
    // at the only place that can see the flip first. Everything downstream
    // carries that id instead of recomputing one from a timestamp, which is
    // what made two writers able to disagree at all.
    private let lastMotionKindKey = "td_geo_last_motion_kind"
    private var lastMotionKind: String {
        get { UserDefaults.standard.string(forKey: lastMotionKindKey) ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: lastMotionKindKey) }
    }
    // Short, opaque, and unique per flip. Not derived from anything, because
    // anything derived can be derived differently by the other writer.
    private func newFlipId() -> String {
        // String(...) around the prefix: Substring does not concatenate with a
        // String literal and this has to compile on the macOS runner, not here.
        return "f" + String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(16))
    }

    // THE WAKE HANDLER. iOS relaunches even a force-quit app, silently and in
    // the background, when a monitored region trips, a visit closes, or the
    // phone moves significantly, and delivers the event ONLY to a
    // CLLocationManager that exists with a delegate at that moment. Creating
    // the manager lazily on the first JS call meant a wake with nobody
    // listening: the event that caused the relaunch evaporated, and a
    // force-closed app stayed dark until somebody opened it. Recreating the
    // manager here, at every launch of any kind, is what makes tracking
    // survive a force close, the same mechanism every consumer tracker runs
    // on. Monitored regions persist system-side across relaunches;
    // significant-change and visit monitoring do not, so they are re-armed
    // from the persisted flag. Still dumb (CLAUDE.md 3.2): this replays the
    // configuration JS last asked for, it decides nothing.
    override public func load() {
        // Lifecycle + silent-push observers register on EVERY launch, before
        // the armed guard: whether the app is open, backgrounded, or being
        // torn down is exactly the record the owner asked for (2026-08-27,
        // "need a way to track if it's open, backgrounded or force closed"),
        // and a silent push has to be heard even on a launch that has nothing
        // to re-arm. Recording itself still gates on armed (see
        // lifecycleEvent), so an account with tracking off writes nothing.
        if !lifecycleObserversOn {
            lifecycleObserversOn = true
            let nc = NotificationCenter.default
            nc.addObserver(self, selector: #selector(appActive), name: UIApplication.didBecomeActiveNotification, object: nil)
            nc.addObserver(self, selector: #selector(appBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
            nc.addObserver(self, selector: #selector(appTerminate), name: UIApplication.willTerminateNotification, object: nil)
            nc.addObserver(self, selector: #selector(silentPush(_:)), name: Notification.Name("TdSilentPush"), object: nil)
        }
        let d = UserDefaults.standard
        guard let armed = d.dictionary(forKey: armedKey) else { return }
        countWake("relaunch")
        // The relaunch is itself a lifecycle fact: after a force close or an
        // OS kill this row is the first sign of life, and the gap behind it
        // is exactly how long the app was dead. record() persists to
        // UserDefaults synchronously, so even a launch iOS cuts short keeps it.
        record(["type": "app-relaunch", "ts": Double(Date().timeIntervalSince1970 * 1000)])
        let visits = (armed["visits"] as? Bool) == true
        DispatchQueue.main.async {
            let m = self.mgr()
            m.startMonitoringSignificantLocationChanges()
            if visits { m.startMonitoringVisits() }
            // AND THE MOTION STREAM. It was armed only from startParked and
            // startEvents, which run when JS asks, so after a force-quit wake
            // the phone resumed fences and the heartbeat but stayed deaf to
            // motion until somebody opened the app. Every boundary the day is
            // measured on (still -> onFoot -> automotive) was therefore missed
            // for exactly the stretch the app was dead, which is the stretch
            // that matters most. The coprocessor's own history still holds it
            // (queryActivityStarting, up to ~7 days) so nothing is lost
            // permanently, but live it went quiet, and a wake that re-arms
            // everything else and not this is half a recovery.
            self.startMotionStream()
            // The event that woke us is (or is about to be) in the buffer;
            // this relaunch window is the moment to get it to the server.
            self.scheduleFlush()
            // Restore the shift heartbeat across the kill. The ttl is judged
            // from the ORIGINAL start, so a phone left at the shop still goes
            // quiet on schedule however many times iOS relaunches the app.
            if let hb = d.dictionary(forKey: self.hbKey),
               let ivRaw = hb["intervalMs"] as? Double,
               let ttlRaw = hb["ttlMs"] as? Double,
               let t0 = hb["startedAtMs"] as? Double {
                // Same clamps as startHeartbeat: stored state is ours, but a
                // corrupt default must never become a 1ms timer.
                let iv = min(max(ivRaw, 60000), 3600000)
                let ttl = min(max(ttlRaw, iv), 86400000)
                if Date().timeIntervalSince1970 * 1000 - t0 > ttl {
                    d.removeObject(forKey: self.hbKey)
                } else {
                    self.heartbeatOn = true
                    // Missing on a dict written by an older build, and false is
                    // the right reading of that: the arrow stays down until JS
                    // asks for it again.
                    self.heartbeatKeepalive = (hb["keepalive"] as? Bool) ?? false
                    self.heartbeatStartedAt = Date(timeIntervalSince1970: t0 / 1000)
                    self.heartbeatTtlMs = ttl
                    if self.heartbeatKeepalive && self.burstStartedAt == nil {
                        m.desiredAccuracy = kCLLocationAccuracyThreeKilometers
                        m.distanceFilter = 99999
                        m.startUpdatingLocation()
                    }
                    self.heartbeatTimer = Timer.scheduledTimer(withTimeInterval: iv / 1000, repeats: true) { [weak self] _ in
                        self?.heartbeatTick()
                    }
                }
            }
            // ── A DRIVE THAT OUTLIVED THE PROCESS ────────────────────────────
            // A region wake mid-leg relaunches this app with no memory, and the
            // route is exactly the thing that would be lost. The window comes
            // back, but the CAP is judged from the ORIGINAL start, so a phone
            // that keeps being relaunched can never keep re-buying itself a
            // fresh 90 minutes of Best accuracy. Expired means expired, and
            // this restore is also the thing that cleans it up.
            self.restoreSamplingWindow()
        }
    }

    // Split out of load() so a relaunch and a JS-driven re-check reach the same
    // code, and so the tests can drive it without a real app launch.
    private func restoreSamplingWindow() {
        // Timer.scheduledTimer needs a run loop, and this is reachable from a
        // test seam and (through load()) from whatever thread iOS relaunched
        // us on. Bounce rather than assume.
        if !Thread.isMainThread {
            DispatchQueue.main.async { self.restoreSamplingWindow() }
            return
        }
        let d = UserDefaults.standard
        guard let st = d.dictionary(forKey: samplingKey),
              (st["mode"] as? String) == "drive" else { return }
        let started = num(st["startedAtMs"]) ?? 0
        let maxMs = min(max(num(st["maxMs"]) ?? TdGeoPlugin.samplingCapDefaultMs,
                            TdGeoPlugin.samplingCapFloorMs), TdGeoPlugin.samplingCapCeilingMs)
        let filter = min(max(num(st["filter"]) ?? TdGeoPlugin.driveFilterDefaultM, 5), 200)
        let left = started + maxMs - Date().timeIntervalSince1970 * 1000
        if left <= 0 {
            // endDriveSampling would bill radio time this process never spent;
            // clear it and put the receiver where the baseline wants it.
            d.removeObject(forKey: samplingKey)
            samplingCapTimer?.invalidate()
            samplingCapTimer = nil
            countWake("drive-off-expired")
            record(["type": "sampling", "mode": "coarse", "reason": "expired",
                    "ts": Double(Date().timeIntervalSince1970 * 1000)])
            restoreBaselineRadio()
            return
        }
        driveRadioStartedAt = Date()
        countWake("drive-resume")
        if burstStartedAt == nil {
            let m = mgr()
            m.desiredAccuracy = kCLLocationAccuracyBest
            m.distanceFilter = filter
            m.startUpdatingLocation()
        }
        armSamplingCap(left)
    }
    // ── Radio-time accounting ────────────────────────────────────────────────
    // Battery cost from location is almost entirely "how many seconds was the
    // GPS receiver powered", and that IS attributable per engine even when two
    // engines run at once (owner question 2026-08-09: you cannot split a single
    // battery reading between them). Persisted, because the day being measured
    // spans app kills.
    private let gpsMsKey = "td_geo_gps_on_ms"
    private let wakesKey = "td_geo_wakes"
    private var burstTimer: Timer?
    private var burstStartedAt: Date?
    private let motionMgr = CMMotionActivityManager()

    private func addGpsMs(_ ms: Double) {
        let d = UserDefaults.standard
        d.set(d.double(forKey: gpsMsKey) + ms, forKey: gpsMsKey)
    }
    private func countWake(_ kind: String) {
        let d = UserDefaults.standard
        var w = (d.dictionary(forKey: wakesKey) as? [String: Int]) ?? [:]
        w[kind] = (w[kind] ?? 0) + 1
        d.set(w, forKey: wakesKey)
    }

    private func mgr() -> CLLocationManager {
        if let m = locationManager { return m }
        let m = CLLocationManager()
        m.delegate = self
        m.allowsBackgroundLocationUpdates = true
        m.pausesLocationUpdatesAutomatically = false
        locationManager = m
        return m
    }

    private func num(_ v: Any?) -> Double? {
        if let n = v as? NSNumber { return n.doubleValue }
        if let d = v as? Double { return d }
        if let i = v as? Int { return Double(i) }
        return nil
    }

    // startParked({regions:[{id,lat,lng,radius}]})
    // radius in meters; iOS region monitoring is only reliable up to ~400m.
    @objc func startParked(_ call: CAPPluginCall) {
        let regions = (call.getArray("regions") as? [JSObject]) ?? []
        DispatchQueue.main.async {
            let m = self.mgr()
            m.stopUpdatingLocation()
            for r in m.monitoredRegions { m.stopMonitoring(for: r) }
            var armed = 0
            for r in regions {
                if armed >= 18 { break }
                guard let id = r["id"] as? String,
                      let lat = self.num(r["lat"]),
                      let lng = self.num(r["lng"]) else { continue }
                var radius = self.num(r["radius"]) ?? 200
                if radius > 400 { radius = 400 }
                if radius < 50 { radius = 50 }
                let region = CLCircularRegion(
                    center: CLLocationCoordinate2D(latitude: lat, longitude: lng),
                    radius: radius, identifier: id)
                region.notifyOnExit = true
                region.notifyOnEntry = true
                m.startMonitoring(for: region)
                armed += 1
            }
            m.startMonitoringSignificantLocationChanges()
            self.startMotionStream()
            UserDefaults.standard.set(["mode": "parked", "visits": false], forKey: self.armedKey)
            call.resolve(["armed": armed])
        }
    }

    // startEvents({regions:[...]}) : the Home Assistant shaped baseline.
    // Regions + significant-change + VISIT monitoring, and no continuous GPS at
    // all, so nothing pins the Dynamic Island. Visits are the piece that makes
    // exact timing possible without the radio: iOS reports arrivalDate and
    // departureDate for places it detected on its own, after the fact, from
    // data it was already collecting.
    @objc func startEvents(_ call: CAPPluginCall) {
        let regions = (call.getArray("regions") as? [JSObject]) ?? []
        DispatchQueue.main.async {
            let m = self.mgr()
            m.stopUpdatingLocation()
            for r in m.monitoredRegions { m.stopMonitoring(for: r) }
            var armed = 0
            for r in regions {
                if armed >= 18 { break }
                guard let id = r["id"] as? String,
                      let lat = self.num(r["lat"]),
                      let lng = self.num(r["lng"]) else { continue }
                var radius = self.num(r["radius"]) ?? 200
                if radius > 400 { radius = 400 }
                if radius < 50 { radius = 50 }
                let region = CLCircularRegion(
                    center: CLLocationCoordinate2D(latitude: lat, longitude: lng),
                    radius: radius, identifier: id)
                region.notifyOnExit = true
                region.notifyOnEntry = true
                m.startMonitoring(for: region)
                armed += 1
            }
            m.startMonitoringSignificantLocationChanges()
            m.startMonitoringVisits()
            self.startMotionStream()
            UserDefaults.standard.set(["mode": "events", "visits": true], forKey: self.armedKey)
            call.resolve(["armed": armed, "visits": true])
        }
    }

    // burstFix({seconds}) : precise coordinates on demand, then straight back
    // to dark. Seconds of radio time are counted so the two engines can be
    // compared on the only number that actually drives battery.
    @objc func burstFix(_ call: CAPPluginCall) {
        let secs = min(max(self.num(call.getValue("seconds")) ?? 12, 3), 60)
        DispatchQueue.main.async {
            let m = self.mgr()
            if self.burstStartedAt == nil {
                self.burstStartedAt = Date()
                m.desiredAccuracy = kCLLocationAccuracyBest
                m.startUpdatingLocation()
                self.countWake("burst")
            }
            self.burstTimer?.invalidate()
            self.burstTimer = Timer.scheduledTimer(withTimeInterval: secs, repeats: false) { [weak self] _ in
                self?.endBurst()
            }
            call.resolve(["seconds": secs])
        }
    }

    private func endBurst() {
        guard let started = burstStartedAt else { return }
        addGpsMs(Date().timeIntervalSince(started) * 1000)
        burstStartedAt = nil
        burstTimer?.invalidate()
        burstTimer = nil
        // A DRIVE WINDOW OUTRANKS THE BASELINE. The burst borrowed a receiver
        // the window already owns, so handing it back to coarse (or worse,
        // stopping it) would silently end the dense sampling in the middle of
        // a leg: the motion boundary that opens a drive fires a burst at the
        // same instant, so this is the common path, not an edge case.
        if driveSamplingOn() {
            let m = mgr()
            let filter = driveFilterM()
            m.desiredAccuracy = kCLLocationAccuracyBest
            m.distanceFilter = filter
            m.startUpdatingLocation()
            return
        }
        restoreBaselineRadio()
    }

    // MARK: - The drive window (owner 2026-09-01)

    // setSampling({mode, maxMs, distanceFilter}) : raw capability, nothing more.
    //
    //   mode "drive"  : kCLLocationAccuracyBest at a tight distance filter, the
    //                   dense breadcrumb a route can actually be drawn from.
    //   mode anything : back to the coarse keepalive, or dark when nothing
    //                   else wants the radio.
    //
    // WHAT THIS DELIBERATELY DOES NOT DECIDE (CLAUDE.md 3.2): when a drive
    // begins, what counts as the end of one, how long to wait after the wheels
    // stop, or whether a particular motion transition is worth the radio. All
    // of that is js/geo-track.js and stays tunable through a UAT roll. This
    // layer knows two things: how to turn the receiver up, and how to turn it
    // back down by itself if nobody tells it to.
    //
    // Idempotent on purpose. JS re-asserts the window whenever it sees more
    // driving, which is what refreshes the cap; a re-assert must never restart
    // the radio clock (that would under-bill) or stack a second timer.
    @objc func setSampling(_ call: CAPPluginCall) {
        let mode = (call.getString("mode") ?? "coarse").lowercased()
        guard mode == "drive" else {
            DispatchQueue.main.async {
                self.endDriveSampling(reason: call.getString("reason") ?? "js")
                // 0.0, never a bare 0. In a [String: Any] a bare integer literal infers
                // as Int, so the bridge and any reader asking for a Double gets nil
                // instead of zero. The drive branch below passes a real Double, which
                // is exactly why only this path failed (native-tests, 2026-09-01,
                // testSamplingState_reportsCoarseWhenNothingIsArmed).
                call.resolve(["mode": "coarse", "remainingMs": 0.0])
            }
            return
        }
        let maxMs = min(max(self.num(call.getValue("maxMs")) ?? TdGeoPlugin.samplingCapDefaultMs,
                            TdGeoPlugin.samplingCapFloorMs), TdGeoPlugin.samplingCapCeilingMs)
        let filter = min(max(self.num(call.getValue("distanceFilter")) ?? TdGeoPlugin.driveFilterDefaultM, 5), 200)
        DispatchQueue.main.async {
            let d = UserDefaults.standard
            let already = self.driveSamplingOn()
            // The cap is refreshed from NOW on every re-assert, which is the
            // whole point of JS re-asserting: a drive that is still happening
            // keeps buying itself more window, a drive that stopped does not.
            d.set(["mode": "drive",
                   "startedAtMs": Date().timeIntervalSince1970 * 1000,
                   "maxMs": maxMs,
                   "filter": filter], forKey: self.samplingKey)
            if !already {
                self.driveRadioStartedAt = Date()
                self.countWake("drive-on")
                // On the tape like everything else, so the server can see the
                // window open and close and nobody has to trust a comment.
                self.record(["type": "sampling", "mode": "drive",
                             "ts": Double(Date().timeIntervalSince1970 * 1000)])
            }
            let m = self.mgr()
            // A burst already owns the receiver at Best accuracy; leave it, and
            // endBurst will hand over to the window rather than going dark.
            if self.burstStartedAt == nil {
                m.desiredAccuracy = kCLLocationAccuracyBest
                m.distanceFilter = filter
                m.startUpdatingLocation()
            }
            self.armSamplingCap(maxMs)
            call.resolve(["mode": "drive", "maxMs": maxMs, "remainingMs": maxMs, "distanceFilter": filter])
        }
    }

    // samplingState() : what the radio is actually doing, for a JS layer that
    // has just been relaunched and has no memory of what it asked for.
    @objc func samplingState(_ call: CAPPluginCall) {
        let d = UserDefaults.standard
        let st = d.dictionary(forKey: samplingKey)
        guard let st = st, (st["mode"] as? String) == "drive" else {
            // 0.0, never a bare 0: see the note above.
            call.resolve(["mode": "coarse", "remainingMs": 0.0])
            return
        }
        let started = num(st["startedAtMs"]) ?? 0
        let maxMs = num(st["maxMs"]) ?? TdGeoPlugin.samplingCapDefaultMs
        let left = max(0, started + maxMs - Date().timeIntervalSince1970 * 1000)
        call.resolve(["mode": "drive", "maxMs": maxMs, "remainingMs": left,
                      "distanceFilter": num(st["filter"]) ?? TdGeoPlugin.driveFilterDefaultM])
    }

    private func armSamplingCap(_ ms: Double) {
        samplingCapTimer?.invalidate()
        samplingCapTimer = Timer.scheduledTimer(withTimeInterval: max(ms, 1000) / 1000, repeats: false) { [weak self] _ in
            self?.endDriveSampling(reason: "cap")
        }
    }

    // The one way out of the drive window, whoever asks: JS, the cap, stopAll,
    // or a relaunch that finds an expired window waiting for it.
    private func endDriveSampling(reason: String) {
        if !Thread.isMainThread {
            DispatchQueue.main.async { self.endDriveSampling(reason: reason) }
            return
        }
        samplingCapTimer?.invalidate()
        samplingCapTimer = nil
        let d = UserDefaults.standard
        let was = driveSamplingOn()
        d.removeObject(forKey: samplingKey)
        if let started = driveRadioStartedAt {
            addGpsMs(Date().timeIntervalSince(started) * 1000)
            driveRadioStartedAt = nil
        }
        guard was else { return }
        countWake("drive-off-" + reason)
        record(["type": "sampling", "mode": "coarse", "reason": reason,
                "ts": Double(Date().timeIntervalSince1970 * 1000)])
        restoreBaselineRadio()
    }

    // Whatever the radio should be doing when no drive window and no burst is
    // holding it. ONE place, because three call sites used to each decide it
    // for themselves and the burst's answer disagreed with the heartbeat's.
    private func restoreBaselineRadio() {
        guard burstStartedAt == nil else { return }
        let m = mgr()
        if heartbeatOn && heartbeatKeepalive {
            m.desiredAccuracy = kCLLocationAccuracyThreeKilometers
            m.distanceFilter = 99999
            m.startUpdatingLocation()
        } else {
            m.stopUpdatingLocation()
        }
    }

    // Written out rather than chained: `dict?["k"] as? String` on an
    // Optional dictionary is a DOUBLE optional, and the same shape passed to
    // num() below silently returned nil and fell through to a default. One
    // explicit unwrap, four call sites, no surprises.
    private func driveSamplingOn() -> Bool {
        guard let st = UserDefaults.standard.dictionary(forKey: samplingKey) else { return false }
        return (st["mode"] as? String) == "drive"
    }

    private func driveFilterM() -> Double {
        guard let st = UserDefaults.standard.dictionary(forKey: samplingKey),
              let f = num(st["filter"]) else { return TdGeoPlugin.driveFilterDefaultM }
        return min(max(f, 5), 200)
    }

    // motionSince({sinceMs}) : the motion coprocessor's own history. It has
    // been logging automotive/walking/stationary all along at no cost to us,
    // so a geofence exit that fires late can still be stamped with the moment
    // driving actually began.
    @objc func motionSince(_ call: CAPPluginCall) {
        guard CMMotionActivityManager.isActivityAvailable() else {
            call.resolve(["available": false, "transitions": []])
            return
        }
        let sinceMs = self.num(call.getValue("sinceMs")) ?? (Date().timeIntervalSince1970 * 1000 - 6 * 3600 * 1000)
        let from = Date(timeIntervalSince1970: sinceMs / 1000)
        motionMgr.queryActivityStarting(from: from, to: Date(), to: OperationQueue.main) { acts, _ in
            var out: [[String: Any]] = []
            var last = ""
            for a in acts ?? [] {
                let kind = a.automotive ? "driving" : (a.cycling ? "cycling"
                          : ((a.walking || a.running) ? "onFoot" : (a.stationary ? "still" : "unknown")))
                if kind == "unknown" || kind == last { continue }
                // Low-confidence samples flip constantly; a transition that
                // stamps a payroll record has to be one the phone is sure of.
                if a.confidence == .low { continue }
                last = kind
                out.append(["kind": kind, "ts": Double(a.startDate.timeIntervalSince1970 * 1000)])
            }
            call.resolve(["available": true, "transitions": out])
        }
    }

    // stats() : radio seconds, wake counts, and the battery reading, so the
    // comparison screen can show both engines side by side. Passing reset
    // clears the counters for the next measurement window.
    @objc func stats(_ call: CAPPluginCall) {
        let d = UserDefaults.standard
        DispatchQueue.main.async {
            UIDevice.current.isBatteryMonitoringEnabled = true
            let lvl = UIDevice.current.batteryLevel
            let st = UIDevice.current.batteryState
            var live = d.double(forKey: self.gpsMsKey)
            if let started = self.burstStartedAt { live += Date().timeIntervalSince(started) * 1000 }
            let out: [String: Any] = [
                "gpsOnMs": live,
                "wakes": (d.dictionary(forKey: self.wakesKey) as? [String: Int]) ?? [:],
                "batteryLevel": lvl >= 0 ? Double(lvl) : -1,
                "charging": (st == .charging || st == .full),
                "monitoredRegions": self.mgr().monitoredRegions.count,
                "motionAvailable": CMMotionActivityManager.isActivityAvailable()
            ]
            if call.getBool("reset") == true {
                d.set(0.0, forKey: self.gpsMsKey)
                d.set([String: Int](), forKey: self.wakesKey)
            }
            call.resolve(out)
        }
    }

    // Once a permission is actually denied, iOS will never show the system
    // prompt again from script, the only fix is Settings. This jumps
    // straight to OUR app's Settings page (not the Settings app's home
    // screen), the same UIApplication.openSettingsURLString every App
    // Store app uses for this. Raw capability only, per "keep native
    // dumb": which permission is denied and what copy to show is a JS/UI
    // decision (js/dashboard.js), this just opens the door.
    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else {
                call.resolve(["opened": false])
                return
            }
            UIApplication.shared.open(url, options: [:]) { ok in
                call.resolve(["opened": ok])
            }
        }
    }

    // CMMotionActivityManager has no separate "request permission" API the
    // way CLLocationManager does: the FIRST call to queryActivityStarting
    // (motionSince, below) is what triggers the system prompt when the
    // status is .notDetermined. This method only READS the current status,
    // so the JS onboarding checklist can show the right copy/CTA before
    // deciding whether to fire that first query or route to Settings.
    @objc func motionPermStatus(_ call: CAPPluginCall) {
        let status: String
        switch CMMotionActivityManager.authorizationStatus() {
        case .notDetermined: status = "prompt"
        case .restricted: status = "restricted"
        case .denied: status = "denied"
        case .authorized: status = "granted"
        @unknown default: status = "prompt"
        }
        call.resolve(["status": status, "available": CMMotionActivityManager.isActivityAvailable()])
    }

    // locationPermStatus() : what iOS ACTUALLY granted, in iOS's own vocabulary.
    //
    // Owner, 2026-08-25: "shouldn't location and motion say always, while using
    // app or declined in alliance with how iOS saves and asks for permissions?"
    // Yes, and until now nothing here could answer it. The JS layer inferred a
    // web-shaped granted/denied/prompt from whether the watcher was delivering,
    // which collapses the single distinction this app lives or dies on:
    //
    //   whenInUse : works only while the app is on screen. No background pings,
    //               no region wakes, no drive logged from a pocket. Reads as
    //               "granted" everywhere and silently tracks nothing.
    //   always    : the only state where this product does its job.
    //
    // ACCURACY IS THE SECOND AXIS, and it is just as fatal. Since iOS 14 a user
    // can grant Always and still switch Precise Location off, which downgrades
    // fixes to reducedAccuracy: kilometres, against fences measured in hundreds
    // of feet. Geofencing is simply dead in that state with nothing anywhere
    // saying why, so it is reported alongside rather than buried.
    //
    // DEVICE-WIDE LOCATION SERVICES IS THE THIRD AXIS, and it is reported now.
    // An earlier note here claimed the only API for it was "deprecated in iOS
    // 17". That was wrong, and the correction matters because the nuance it
    // waved away is the exact silent failure this app keeps hitting:
    //
    //   CLLocationManager.locationServicesEnabled() is NOT deprecated. What
    //   Apple added (Xcode 14.1 onward) is a runtime warning when it is called
    //   ON THE MAIN THREAD, because it is a synchronous cross-process lookup
    //   that blocks the caller and has been seen to hang outright. The fix for
    //   the warning is to move the call off the main thread, which is what the
    //   dispatch below does, not to stop asking the question.
    //
    // Why the question has to be asked at all: the per-app grant and the global
    // switch are INDEPENDENT. Turning off Settings > Privacy & Security >
    // Location Services leaves authorizationStatus reporting .authorizedAlways
    // untouched, so without this the app reports "always" to the server while
    // not a single fix will ever arrive, which is precisely the shape of a live
    // account showing always and zero pings. Waiting for a .denied delegate
    // error instead is inference, and inference is what put the wrong answer in
    // the database in the first place.
    //
    // What iOS 18 added, and why it is not used here: CLServiceSession exposes
    // a diagnostics async sequence carrying authorizationDeniedGlobally ("the
    // session will be suspended while the user has disabled Location Services
    // system-wide") plus fullAccuracyDenied, alwaysAuthorizationDenied,
    // insufficientlyInUse and serviceSessionRequired. It is push-based, so no
    // blocking, and it is strictly richer. Two reasons it is not the answer
    // today: it is iOS 18 and up while this ships at a 15.0 deployment target,
    // and constructing a session takes an authorization requirement, so on a
    // notDetermined device a plain status query would raise a permission
    // prompt. The call below answers the same question on every version we
    // ship to, with no prompt and no side effect.
    //
    // Raw capability only, per the keep-native-dumb rule: this reports what iOS
    // says and decides nothing. Every threshold and consequence stays in JS.
    @objc func locationPermStatus(_ call: CAPPluginCall) {
        let m = self.mgr()
        let status: String
        switch m.authorizationStatus {
        case .notDetermined:       status = "notdetermined"
        case .restricted:          status = "restricted"
        case .denied:              status = "denied"
        case .authorizedWhenInUse: status = "wheninuse"
        case .authorizedAlways:    status = "always"
        @unknown default:          status = "notdetermined"
        }
        let out: [String: Any] = [
            "status": status,
            // Deliberately NOT folded into status: a user can be `always` and
            // reduced, which is granted and useless at the same time.
            "accuracy": m.accuracyAuthorization == .fullAccuracy ? "full" : "reduced",
            "precise": m.accuracyAuthorization == .fullAccuracy
        ]
        // Off the main thread, always, for the reason in the note above. The
        // whole method resolves from here so servicesEnabled is never absent
        // from a successful answer: a caller that has to guess whether a key
        // is missing or false is back to inferring.
        DispatchQueue.global(qos: .userInitiated).async {
            var out2 = out
            out2["servicesEnabled"] = CLLocationManager.locationServicesEnabled()
            call.resolve(out2)
        }
    }

    // requestPreciseTemp({purposeKey}) : ask a reduced-accuracy user for
    // Precise Location, without sending them to Settings.
    //
    // Owner rule 2026-08-26: "we need the tightest location services upfront at
    // all times, never can default to approximates." Reduced accuracy is about
    // a mile wide, so a 600ft job fence can never fire and a job arrival never
    // registers. locationPermStatus can already SEE that state; this is the one
    // API that can do anything about it from inside the app.
    //
    // THIS GRANT IS SESSION-SCOPED. iOS drops it when the app is relaunched, so
    // it is a way to make today work, never the permanent fix. The permanent
    // fix is Settings > TradeDesk > Location > Precise Location, and the copy
    // in JS has to say so. `temporary` travels in the answer for exactly that
    // reason: a caller that cannot tell a lapsing grant from a permanent one
    // will tick its checklist off and stop asking.
    //
    // NSLocationTemporaryUsageDescriptionDictionary IS LOAD-BEARING. Without an
    // entry in Info.plist under the purpose key passed here, iOS does nothing
    // at all: no dialog, no error a user can see, the completion just comes
    // back with the accuracy unchanged. It is patched in by
    // .github/workflows/ios-beta.yml alongside the other usage strings.
    //
    // Raw capability only, per keep-native-dumb: this asks and reports what iOS
    // said. Whether to ask, what to say afterwards, and what a temporary grant
    // means to the setup checklist are all JS decisions (js/geo-track.js,
    // js/dashboard.js).
    @objc func requestPreciseTemp(_ call: CAPPluginCall) {
        // Defaulted rather than required: a bridge call with no options, or
        // with junk in place of the key, must still get a real answer instead
        // of a rejection, the same contract locationPermStatus carries.
        let key = call.getString("purposeKey") ?? "JobSiteAccuracy"
        // Below iOS 14 there is no reduced accuracy to upgrade FROM: every fix
        // is already full accuracy, so "unsupported" here means "nothing to
        // ask for", not "this phone cannot be precise". Reported as both, so a
        // JS caller never reads the absence of the API as a broken handset.
        guard #available(iOS 14.0, *) else {
            call.resolve([
                "supported": false, "asked": false, "temporary": false,
                "accuracy": "full", "precise": true, "reason": "os"
            ])
            return
        }
        DispatchQueue.main.async {
            let m = self.mgr()
            let auth = m.authorizationStatus
            // Nothing to upgrade: already precise. Answering without asking
            // keeps this idempotent, so a JS retry loop can never spend a
            // dialog it did not need.
            if m.accuracyAuthorization == .fullAccuracy {
                call.resolve([
                    "supported": true, "asked": false, "temporary": false,
                    "accuracy": "full", "precise": true, "reason": "alreadyfull"
                ])
                return
            }
            // No authorization at all yet (or a hard denial) means the accuracy
            // question is not the one in the way, and iOS will not raise this
            // dialog on top of a missing or refused grant. Say so plainly so JS
            // routes to the ask, or to Settings, instead of waiting on a
            // completion handler that may never arrive.
            if auth != .authorizedAlways && auth != .authorizedWhenInUse {
                call.resolve([
                    "supported": true, "asked": false, "temporary": false,
                    "accuracy": "reduced", "precise": false, "reason": "unauthorized"
                ])
                return
            }
            m.requestTemporaryFullAccuracyAuthorization(withPurposeKey: key) { error in
                let full = m.accuracyAuthorization == .fullAccuracy
                var out: [String: Any] = [
                    "supported": true,
                    "asked": true,
                    // True ONLY when this call is what produced the full
                    // accuracy, which is the bit that lapses on relaunch.
                    "temporary": full,
                    "accuracy": full ? "full" : "reduced",
                    "precise": full,
                    "reason": full ? "granted" : "declined"
                ]
                // Carried, never thrown: the missing-plist-key failure arrives
                // here and is otherwise completely silent, so the one place it
                // can be seen has to hand it back rather than swallow it.
                if let e = error { out["error"] = e.localizedDescription }
                call.resolve(out)
            }
        }
    }

    @objc func stopAll(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let m = self.mgr()
            self.endBurst()
            self.endDriveSampling(reason: "stopAll")
            self.hbStop()
            self.motionMgr.stopActivityUpdates()
            m.stopMonitoringSignificantLocationChanges()
            m.stopMonitoringVisits()
            for r in m.monitoredRegions { m.stopMonitoring(for: r) }
            m.stopUpdatingLocation()
            UserDefaults.standard.removeObject(forKey: self.armedKey)
            call.resolve()
        }
    }

    // Returns and clears every buffered event, oldest first.
    @objc func drainBuffer(_ call: CAPPluginCall) {
        let d = UserDefaults.standard
        let fixes = (d.array(forKey: bufferKey) as? [[String: Any]]) ?? []
        d.removeObject(forKey: bufferKey)
        call.resolve(["fixes": fixes])
    }

    // Test seam. record() stays private (nothing outside this file has any
    // business appending to the buffer); TdNativeTests needs one door in to
    // assert the ROW SHAPE that ingest-geo reads, which is the actual
    // contract between the phone and the server.
    #if DEBUG
    func recordForTest(_ ev: [String: Any]) { record(ev) }
    // The backfill is driven by a CoreLocation delegate callback the simulator
    // will not fire on demand, so the tests reach it the same way the region
    // wake does. Named ForTest so it is obvious this is not a shipping entry
    // point; TdNativeTests is a DEBUG-configuration target (§3.3).
    func backfillMotionHistoryForTest() { backfillMotionHistory() }
    var motionMarkKeyForTest: String { motionMarkKey }
    static var backfillFreshMsForTest: Double { backfillFreshMs }
    // The urgent lane, reachable without backgrounding a simulator. What the
    // tests can assert is that it survives being called from any queue, with
    // no config, with an empty buffer, and repeatedly, since it now runs on
    // every region crossing and every backgrounding rather than once in a
    // while behind a debounce.
    func flushUrgentlyForTest() { flushUrgently() }
    func scheduleFlushForTest() { scheduleFlush() }
    func newFlipIdForTest() -> String { newFlipId() }
    // The drive window's cap fires on a Timer measured in minutes; the tests
    // reach the same exit the cap does, and the same relaunch restore load()
    // runs, without waiting for either.
    var samplingKeyForTest: String { samplingKey }
    func driveSamplingOnForTest() -> Bool { driveSamplingOn() }
    func expireSamplingCapForTest() { endDriveSampling(reason: "cap") }
    func restoreSamplingWindowForTest() { restoreSamplingWindow() }
    var heartbeatKeepaliveForTest: Bool { heartbeatKeepalive }
    static var samplingCapCeilingMsForTest: Double { samplingCapCeilingMs }
    static var samplingCapFloorMsForTest: Double { samplingCapFloorMs }
    static var driveFilterDefaultMForTest: Double { driveFilterDefaultM }
    var lastMotionKindKeyForTest: String { lastMotionKindKey }
    var flushCfgKeyForTest: String { flushCfgKey }
    var flushMarkKeyForTest: String { flushMarkKey }
    var bufferKeyForTest: String { bufferKey }
    #endif

    private func record(_ ev: [String: Any]) {
        let d = UserDefaults.standard
        var buf = (d.array(forKey: bufferKey) as? [[String: Any]]) ?? []
        buf.append(ev)
        if buf.count > bufferCap { buf.removeFirst(buf.count - bufferCap) }
        d.set(buf, forKey: bufferKey)
        notifyListeners("geoEvent", data: ev)
        scheduleFlush()
    }

    private func event(type: String, loc: CLLocation?, regionId: String?) -> [String: Any] {
        var ev: [String: Any] = [
            "type": type,
            "ts": Double(Date().timeIntervalSince1970 * 1000)
        ]
        if let l = loc {
            ev["lat"] = l.coordinate.latitude
            ev["lng"] = l.coordinate.longitude
            ev["acc"] = l.horizontalAccuracy
            ev["speed"] = l.speed
        }
        if let rid = regionId { ev["regionId"] = rid }
        return ev
    }

    // MARK: - App lifecycle + silent push (owner 2026-08-27)

    // Open / backgrounded / force-closed, as data. active and background are
    // direct observations; a force close is INFERRED (iOS gives a suspended
    // app no death callback): the next app-relaunch row marks the rebirth and
    // the silence before it is the kill. All of it rides the existing buffer
    // and flush lane, so it lands in geo_events like every other event and
    // reporting is a SQL query, not a new table.
    private func trackingArmed() -> Bool {
        UserDefaults.standard.dictionary(forKey: armedKey) != nil
    }
    private func lifecycleEvent(_ t: String) {
        guard trackingArmed() else { return }
        countWake(t)
        record(["type": t, "ts": Double(Date().timeIntervalSince1970 * 1000)])
    }
    @objc private func appActive() { lifecycleEvent("app-active") }
    @objc private func appBackground() {
        lifecycleEvent("app-background")
        // Backgrounding is the last reliable moment to get the buffer out
        // before iOS decides this process's fate, so it is spent NOW rather
        // than 1.5 seconds from now on a queue that is about to stop running.
        flushUrgently()
    }
    @objc private func appTerminate() { lifecycleEvent("app-terminate") }

    // A server cron nudges every registered phone with a content-available
    // push (supabase/functions/push-geo-ping); the AppDelegate forwards it
    // here as TdSilentPush. The point is a liveness fix from a BACKGROUNDED
    // app between organic wakes. Apple does not deliver these to a force-quit
    // app, so the region/SLC wake net stays the only net for that case.
    @objc private func silentPush(_ note: Notification) {
        guard trackingArmed() else { return }
        countWake("push-ping")
        var ev: [String: Any] = [
            "type": "push-ping",
            "ts": Double(Date().timeIntervalSince1970 * 1000)
        ]
        let m = mgr()
        if let l = m.location {
            ev["lat"] = l.coordinate.latitude
            ev["lng"] = l.coordinate.longitude
            ev["acc"] = l.horizontalAccuracy
        }
        // record() persists and schedules the flush; the AppDelegate holds
        // the completion handler open long enough for the upload to start.
        record(ev)
    }

    // MARK: - Shift heartbeat + motion stream (owner 2026-08-27)

    // startHeartbeat({intervalMs, ttlMs}) : prove this phone is alive every
    // intervalMs while a shift is on. Holds a 3km-accuracy, huge-filter
    // location session purely to keep the process running in the background;
    // each tick records a heartbeat event (which the flush lane then posts).
    // Re-asserting startUpdatingLocation every tick self-heals whatever a
    // burst or the OS did to the session in between. All numbers come from
    // JS; ttlMs self-stops a heartbeat nobody turned off.
    @objc func startHeartbeat(_ call: CAPPluginCall) {
        let intervalMs = min(max(self.num(call.getValue("intervalMs")) ?? 1800000, 60000), 3600000)
        let ttlMs = min(max(self.num(call.getValue("ttlMs")) ?? 43200000, intervalMs), 86400000)
        // Default FALSE. See heartbeatKeepalive above: holding a background
        // location session purely to stay resident is what pins the blue arrow
        // between drives, and the app's own logs say it was not buying the
        // residency it cost. JS asks for it explicitly or it does not happen.
        let keepalive = call.getBool("keepalive") ?? false
        DispatchQueue.main.async {
            self.heartbeatTimer?.invalidate()
            self.heartbeatOn = true
            self.heartbeatKeepalive = keepalive
            self.heartbeatStartedAt = Date()
            self.heartbeatTtlMs = ttlMs
            UserDefaults.standard.set([
                "intervalMs": intervalMs, "ttlMs": ttlMs, "keepalive": keepalive,
                "startedAtMs": Date().timeIntervalSince1970 * 1000
            ], forKey: self.hbKey)
            // The radio is only ever touched for a keepalive that was asked
            // for, and never over the top of a burst or an open drive window,
            // both of which want it far more precise than 3km.
            if keepalive && self.burstStartedAt == nil && !self.driveSamplingOn() {
                let m = self.mgr()
                m.desiredAccuracy = kCLLocationAccuracyThreeKilometers
                m.distanceFilter = 99999
                m.startUpdatingLocation()
            }
            self.heartbeatTimer = Timer.scheduledTimer(withTimeInterval: intervalMs / 1000, repeats: true) { [weak self] _ in
                self?.heartbeatTick()
            }
            call.resolve(["on": true, "intervalMs": intervalMs, "ttlMs": ttlMs, "keepalive": keepalive])
        }
    }

    @objc func stopHeartbeat(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.hbStop()
            call.resolve(["on": false])
        }
    }

    private func hbStop() {
        heartbeatTimer?.invalidate()
        heartbeatTimer = nil
        heartbeatOn = false
        heartbeatKeepalive = false
        heartbeatStartedAt = nil
        UserDefaults.standard.removeObject(forKey: hbKey)
        // Only release the radio if nothing else still owns it. A drive window
        // is the case this used to get wrong: ending a shift mid-leg would
        // have cut the route short.
        if burstStartedAt == nil && !driveSamplingOn() { mgr().stopUpdatingLocation() }
    }

    private func heartbeatTick() {
        if let started = heartbeatStartedAt,
           Date().timeIntervalSince(started) * 1000 > heartbeatTtlMs {
            hbStop()
            return
        }
        let m = mgr()
        // Re-assert the low-power session only when a keepalive was asked for,
        // and never on top of a burst or an open drive window: this tick used
        // to stamp 3km/99999 over a Best-accuracy drive every 30 minutes and
        // silently flatten the middle of a long route.
        if heartbeatKeepalive && burstStartedAt == nil && !driveSamplingOn() {
            m.desiredAccuracy = kCLLocationAccuracyThreeKilometers
            m.distanceFilter = 99999
            m.startUpdatingLocation()   // idempotent; re-arms a session the OS shed
        }
        var ev: [String: Any] = [
            "type": "heartbeat",
            "ts": Double(Date().timeIntervalSince1970 * 1000)
        ]
        if let l = m.location {
            ev["lat"] = l.coordinate.latitude
            ev["lng"] = l.coordinate.longitude
            ev["acc"] = l.horizontalAccuracy
        }
        countWake("heartbeat")
        record(ev)
    }

    // The motion coprocessor's LIVE stream, on only while a fence set is
    // armed. Emits a buffered event per activity transition; JS decides what
    // a transition means (a burst, nothing). Consecutive same-kind reports
    // are deduped here only because they are literally the same fact.
    private func startMotionStream() {
        guard CMMotionActivityManager.isActivityAvailable() else { return }
        // iOS TERMINATES a process that touches CoreMotion without this plist
        // key: no error, no callback, a straight kill (it took the whole
        // native test suite down mid-run, 2026-08-27). The shipped app always
        // has the key (ios-beta.yml); this guard is for any host that lacks
        // it, where silently not streaming beats crashing the process.
        guard Bundle.main.object(forInfoDictionaryKey: "NSMotionUsageDescription") != nil else { return }
        // Deliberately NOT reset. See lastMotionKind above: wiping it here is
        // what turned one state change into one event per re-arm.
        motionMgr.startActivityUpdates(to: .main) { [weak self] act in
            guard let self = self, let a = act else { return }
            if a.confidence == .low { return }
            let kind = a.automotive ? "automotive"
                : a.cycling ? "cycling"
                : a.running ? "running"
                : a.walking ? "walking"
                : a.stationary ? "still" : ""
            if kind.isEmpty || kind == self.lastMotionKind { return }
            let prev = self.lastMotionKind
            self.lastMotionKind = kind
            // THE TRANSITION IS THE PING (owner 2026-08-29). Every state
            // change is a boundary the day is measured on: still -> onFoot is
            // a load-out starting, onFoot -> automotive is a departure,
            // automotive -> onFoot is an arrival. A boundary with no position
            // is only half a fact, and until now every motion row landed with
            // lat/lon null, so the geofence could never say WHERE the change
            // happened and the whole tape was unusable server-side.
            //
            // Last-known first so the event is never fixless, then a short
            // burst so the NEXT event carries something fresh. Which
            // transitions deserve a burst is JS's call (geo-track.js
            // _geoTdEvent), per the dumb-native rule; the plugin only
            // attaches what it already has and reports the edge it saw.
            var ev: [String: Any] = [
                "type": "motion",
                "ts": Double(Date().timeIntervalSince1970 * 1000),
                "kind": kind,
                "prevKind": prev,
                // The id for this flip and everything it goes on to produce.
                "flipId": self.newFlipId()
            ]
            if let l = self.mgr().location {
                ev["lat"] = l.coordinate.latitude
                ev["lng"] = l.coordinate.longitude
                ev["acc"] = l.horizontalAccuracy
                ev["fixAgeMs"] = Date().timeIntervalSince(l.timestamp) * 1000
            }
            self.countWake("motion-" + kind)
            self.record(ev)
        }
    }

    // MARK: - Real-time flush (owner 2026-08-27: rows land force-closed)

    // configureFlush({url, userId, deviceId, key}) : JS hands over the
    // ingest-geo endpoint and this device's flush key. Dumb by design
    // (CLAUDE.md 3.2): what to send, where, and how it is authorized are all
    // decided in JS and on the server; this layer only moves bytes.
    @objc func configureFlush(_ call: CAPPluginCall) {
        guard let url = call.getString("url"), !url.isEmpty,
              let userId = call.getString("userId"), !userId.isEmpty,
              let deviceId = call.getString("deviceId"), !deviceId.isEmpty,
              let key = call.getString("key"), !key.isEmpty else {
            call.reject("url, userId, deviceId and key are all required")
            return
        }
        UserDefaults.standard.set(
            ["url": url, "userId": userId, "deviceId": deviceId, "key": key],
            forKey: flushCfgKey)
        call.resolve(["configured": true])
        scheduleFlush()
    }

    // Background URLSession: the OS finishes the upload even if this process
    // is suspended mid-transfer, which is the entire guarantee. Lazy so an
    // app that never configures the flush never creates the session.
    private lazy var flushSession: URLSession = {
        let cfg = URLSessionConfiguration.background(withIdentifier: "td.geo.flush")
        cfg.isDiscretionary = false
        cfg.sessionSendsLaunchEvents = true
        return URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    }()

    // Debounced so one wake's burst of events becomes one POST.
    //
    // FOREGROUND ONLY, and that qualifier is the whole fix. A backgrounded app
    // is suspended within milliseconds, and a suspended process does not run
    // its main queue, so this timer simply never fires. Measured on the
    // owner's phone 2026-08-31: every event delivered in 2 to 3 seconds while
    // the app was open, then he backgrounded it at 12:21:35 and delivery
    // stopped dead. The backgrounding event itself took 1028 seconds to
    // arrive, the drive home's motion edges 888 and 703, the fence exit 703,
    // the arrival at the shop 321, and not one of them moved until he brought
    // the app back to the foreground. His words: "these updates aren't coming
    // through live anymore, had to force close reopen, can't have that."
    //
    // Region crossings DO wake the app, and iOS gives that wake real runtime,
    // so the events were recorded on time. They were recorded and then sat in
    // UserDefaults behind a timer that had no process left to fire on.
    private func scheduleFlush() {
        // UIApplication is main-thread only, and record() is called from
        // CoreLocation and CoreMotion callbacks that are not guaranteed to be
        // on it. Bounce rather than read the state off whatever queue we
        // happen to be on.
        if !Thread.isMainThread {
            DispatchQueue.main.async { self.scheduleFlush() }
            return
        }
        if UIApplication.shared.applicationState != .active { flushUrgently(); return }
        if flushPending { return }
        flushPending = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            self.flushPending = false
            self.flushNow()
        }
    }

    // No timer, and an expiring background-task assertion held across the
    // handover so iOS cannot suspend the process between building the payload
    // and nsurlsessiond taking ownership of it. Everything that happens while
    // backgrounded comes through here: the moment of backgrounding, every
    // region crossing, every wake.
    private func flushUrgently() {
        if !Thread.isMainThread {
            DispatchQueue.main.async { self.flushUrgently() }
            return
        }
        flushPending = false
        var bg = UIBackgroundTaskIdentifier.invalid
        bg = UIApplication.shared.beginBackgroundTask(withName: "td.geo.flush") {
            if bg != .invalid { UIApplication.shared.endBackgroundTask(bg); bg = .invalid }
        }
        flushNow()
        // Deliberately not immediate: the upload task is handed to the system
        // asynchronously, and ending the assertion in the same run loop turn
        // can suspend the process before that handover completes.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
            if bg != .invalid { UIApplication.shared.endBackgroundTask(bg); bg = .invalid }
        }
    }

    private func flushNow() {
        let d = UserDefaults.standard
        guard let cfg = d.dictionary(forKey: flushCfgKey) as? [String: String],
              let urlStr = cfg["url"], let target = URL(string: urlStr),
              let userId = cfg["userId"], let deviceId = cfg["deviceId"], let key = cfg["key"] else { return }
        let mark = d.double(forKey: flushMarkKey)
        let buf = (d.array(forKey: bufferKey) as? [[String: Any]]) ?? []
        let fresh = buf.filter { (num($0["ts"]) ?? 0) > mark }
        if fresh.isEmpty { return }
        let batch = Array(fresh.prefix(400))
        let maxTs = batch.compactMap { num($0["ts"]) }.max() ?? mark
        let payload: [String: Any] = [
            "user_id": userId, "device_id": deviceId, "key": key, "events": batch
        ]
        guard JSONSerialization.isValidJSONObject(payload),
              let body = try? JSONSerialization.data(withJSONObject: payload) else { return }
        // Background upload tasks require a file, not a data body.
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("td-geo-flush-\(Int(maxTs)).json")
        do { try body.write(to: tmp) } catch { return }
        var req = URLRequest(url: target)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let task = flushSession.uploadTask(with: req, fromFile: tmp)
        var inflight = (d.dictionary(forKey: flushInflightKey) as? [String: Double]) ?? [:]
        inflight[String(task.taskIdentifier)] = maxTs
        d.set(inflight, forKey: flushInflightKey)
        task.resume()
        countWake("flushSent")
    }

    // Watermark advances ONLY on a server 2xx. Anything else leaves the tail
    // in place for the next wake to re-send; the server dedupes the overlap.
    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let d = UserDefaults.standard
        var inflight = (d.dictionary(forKey: flushInflightKey) as? [String: Double]) ?? [:]
        let tid = String(task.taskIdentifier)
        guard let maxTs = inflight[tid] else { return }
        inflight.removeValue(forKey: tid)
        d.set(inflight, forKey: flushInflightKey)
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        if error == nil && status >= 200 && status < 300 {
            if maxTs > d.double(forKey: flushMarkKey) { d.set(maxTs, forKey: flushMarkKey) }
            countWake("flushOk")
        } else {
            countWake("flushFail")
        }
    }

    // ── THE WAKE IS FOR THE TAPE, SO PULL THE TAPE ──────────────────────────
    // Region monitoring is the ONE location service Apple will relaunch a
    // force-quit app for. That relaunch was already happening and doing
    // nothing with itself: the delegate recorded the crossing and stopped, and
    // the motion history the wake existed to collect was never read, because
    // motionSince() is JS-callable and on a cold launch there is no JS yet.
    //
    // Not a decision, which is what §3.2 reserves for JS: this reads a buffer
    // the OS already filled and hands it over unaltered. What a transition
    // MEANS is still decided in js/geo-track.js and ingest-geo.
    //
    // NO COORDINATE on a backfilled transition, deliberately. CoreMotion
    // history is times and kinds only; there is no location in it and iOS
    // keeps no queryable location history to pair it with. Stamping the wake
    // fix onto an hours-old transition would claim it happened here, which is
    // a lie that reads exactly like a fact. The one exception is a transition
    // inside `freshMs` of the wake, where the fix genuinely does describe it.
    private static let backfillFreshMs: Double = 90_000
    private func backfillMotionHistory() {
        guard CMMotionActivityManager.isActivityAvailable() else { return }
        guard Bundle.main.object(forInfoDictionaryKey: "NSMotionUsageDescription") != nil else { return }
        let d = UserDefaults.standard
        let nowMs = Date().timeIntervalSince1970 * 1000
        // The coprocessor keeps about seven days. Never reach further than it
        // holds, and never re-read what a previous wake already pulled.
        let floorMs = nowMs - 7 * 24 * 3600 * 1000
        let mark = max(d.double(forKey: motionMarkKey), floorMs)
        let from = Date(timeIntervalSince1970: mark / 1000)
        guard from < Date() else { return }
        let wakeLoc = mgr().location
        motionMgr.queryActivityStarting(from: from, to: Date(), to: .main) { [weak self] acts, _ in
            guard let self = self else { return }
            var last = ""
            var newest = mark
            for a in acts ?? [] {
                if a.confidence == .low { continue }
                // The LIVE stream's vocabulary, not the history query's older
                // one. Two spellings for one fact is how the server ended up
                // able to see that a transition happened and never what it was.
                let kind = a.automotive ? "automotive"
                    : a.cycling ? "cycling"
                    : a.running ? "running"
                    : a.walking ? "walking"
                    : a.stationary ? "still" : ""
                if kind.isEmpty || kind == last { continue }
                last = kind
                let ts = a.startDate.timeIntervalSince1970 * 1000
                if ts <= mark { continue }
                if ts > newest { newest = ts }
                // A recovered flip gets an id exactly like a live one: it is
                // the same fact, arriving late, and whatever leg it goes on to
                // open must be keyed the same way on both sides.
                var ev: [String: Any] = ["type": "motion", "ts": ts, "kind": kind,
                                         "hist": true, "flipId": self.newFlipId()]
                if let l = wakeLoc, nowMs - ts <= TdGeoPlugin.backfillFreshMs {
                    ev["lat"] = l.coordinate.latitude
                    ev["lng"] = l.coordinate.longitude
                    ev["acc"] = l.horizontalAccuracy
                }
                self.record(ev)
            }
            if newest > mark { d.set(newest, forKey: self.motionMarkKey) }
        }
    }

    // MARK: - CLLocationManagerDelegate

    // A crossing is the event the whole engine is built on, and the wake it
    // arrives on is the only runtime this process is going to get. Both the
    // crossing and whatever the backfill just recovered go out on it.
    public func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        countWake("regionExit")
        record(event(type: "regionExit", loc: manager.location, regionId: region.identifier))
        backfillMotionHistory()
        flushUrgently()
    }

    public func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        countWake("regionEnter")
        record(event(type: "regionEnter", loc: manager.location, regionId: region.identifier))
        backfillMotionHistory()
        flushUrgently()
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        let drive = driveSamplingOn()
        if burstStartedAt == nil { countWake(drive ? "drive-fix" : "slc") }
        var ev = event(type: "fix", loc: loc, regionId: nil)
        // The one bit JS cannot infer: a 3km significant-change wake and a
        // 30m drive-window breadcrumb arrive as the same "fix" and mean very
        // different things to a route. Reported, never acted on here.
        if drive { ev["drive"] = true }
        record(ev)
    }

    // A VISIT is the whole point of the new engine: iOS hands back the arrival
    // and departure it detected itself, with real timestamps, after the fact.
    // distantPast/distantFuture mean "not known yet", so they travel as null
    // rather than as a date nobody should trust.
    public func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
        countWake("visit")
        var ev: [String: Any] = [
            "type": "visit",
            "ts": Double(Date().timeIntervalSince1970 * 1000),
            "lat": visit.coordinate.latitude,
            "lng": visit.coordinate.longitude,
            "acc": visit.horizontalAccuracy
        ]
        if visit.arrivalDate != Date.distantPast {
            ev["arrivalTs"] = Double(visit.arrivalDate.timeIntervalSince1970 * 1000)
        }
        if visit.departureDate != Date.distantFuture {
            ev["departureTs"] = Double(visit.departureDate.timeIntervalSince1970 * 1000)
        }
        record(ev)
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Region-monitoring failures are non-fatal; significant-change keeps watch.
    }
}
