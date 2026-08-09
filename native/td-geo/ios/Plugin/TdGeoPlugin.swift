import Foundation
import Capacitor
import CoreLocation

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
        CAPPluginMethod(name: "drainBuffer", returnType: CAPPluginReturnPromise)
    ]

    private var locationManager: CLLocationManager?
    private let bufferKey = "td_geo_fix_buffer"
    private let bufferCap = 600

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

    @objc func stopAll(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let m = self.mgr()
            m.stopMonitoringSignificantLocationChanges()
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
        record(event(type: "regionExit", loc: manager.location, regionId: region.identifier))
    }

    public func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        record(event(type: "regionEnter", loc: manager.location, regionId: region.identifier))
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        record(event(type: "fix", loc: loc, regionId: nil))
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Region-monitoring failures are non-fatal; significant-change keeps watch.
    }
}
