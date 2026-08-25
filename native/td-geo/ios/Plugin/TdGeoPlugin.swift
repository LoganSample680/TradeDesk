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
        CAPPluginMethod(name: "locationPermStatus", returnType: CAPPluginReturnPromise)
    ]

    private var locationManager: CLLocationManager?
    private let bufferKey = "td_geo_fix_buffer"
    private let bufferCap = 600
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
    // NOT reported: whether Location Services is on device-wide. That would be
    // a genuinely useful distinction (a global toggle nowhere near this app
    // looks identical to somebody denying TradeDesk), but the only API for it
    // is deprecated in iOS 17 and blocks the main thread, and iOS already
    // reports .denied in that case. A warning-generating call for a nuance we
    // can live without is a bad trade.
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
        var out: [String: Any] = [
            "status": status,
            // Deliberately NOT folded into status: a user can be `always` and
            // reduced, which is granted and useless at the same time.
            "accuracy": m.accuracyAuthorization == .fullAccuracy ? "full" : "reduced",
            "precise": m.accuracyAuthorization == .fullAccuracy
        ]
        call.resolve(out)
    }

    @objc func stopAll(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let m = self.mgr()
            self.endBurst()
            m.stopMonitoringSignificantLocationChanges()
            m.stopMonitoringVisits()
            for r in m.monitoredRegions { m.stopMonitoring(for: r) }
            m.stopUpdatingLocation()
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
