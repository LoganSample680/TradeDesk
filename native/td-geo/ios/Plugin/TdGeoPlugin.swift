import Foundation
import Capacitor
import CoreLocation
import CoreMotion
import UIKit

// TradeDesk battery-aware geofence engine.
//
// Two modes, mirroring MileIQ-style trackers:
//   PARKED  : GPS fully off. CoreLocation region monitoring (geofence hardware)
//             plus significant-location-change watch for departure. Near-zero
//             battery, no blue arrow pinned in the Dynamic Island.
//   (moving): the JS layer runs its normal continuous watcher; this plugin is
//             idle until the app parks again.
//
// Every native event is appended to a UserDefaults buffer BEFORE being emitted
// as a listener event, so fixes that arrive while the WebView is suspended or
// dead replay into the fence machine on the next boot via drainBuffer().
@objc(TdGeoPlugin)
public class TdGeoPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
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
        CAPPluginMethod(name: "requestPreciseTemp", returnType: CAPPluginReturnPromise)
    ]

    private var locationManager: CLLocationManager?
    private let bufferKey = "td_geo_fix_buffer"
    private let bufferCap = 600
    // What JS last armed, persisted so a system relaunch can restore it.
    // {mode:"parked"|"events", visits:Bool}. Cleared by stopAll.
    private let armedKey = "td_geo_armed"

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
        let d = UserDefaults.standard
        guard let armed = d.dictionary(forKey: armedKey) else { return }
        countWake("relaunch")
        let visits = (armed["visits"] as? Bool) == true
        DispatchQueue.main.async {
            let m = self.mgr()
            m.startMonitoringSignificantLocationChanges()
            if visits { m.startMonitoringVisits() }
        }
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
        mgr().stopUpdatingLocation()
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

    private func record(_ ev: [String: Any]) {
        let d = UserDefaults.standard
        var buf = (d.array(forKey: bufferKey) as? [[String: Any]]) ?? []
        buf.append(ev)
        if buf.count > bufferCap { buf.removeFirst(buf.count - bufferCap) }
        d.set(buf, forKey: bufferKey)
        notifyListeners("geoEvent", data: ev)
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

    // MARK: - CLLocationManagerDelegate

    public func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        countWake("regionExit")
        record(event(type: "regionExit", loc: manager.location, regionId: region.identifier))
    }

    public func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        countWake("regionEnter")
        record(event(type: "regionEnter", loc: manager.location, regionId: region.identifier))
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        if burstStartedAt == nil { countWake("slc") }
        record(event(type: "fix", loc: loc, regionId: nil))
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
