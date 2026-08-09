import Foundation
import Capacitor
import MapKit
import CoreLocation
import AVFoundation
import UIKit

// TradeDesk turn-by-turn drive, the native half.
//
// WHY THIS EXISTS. Apple hands off navigation to the Maps app for apps that do
// not have their own ("if your app doesn't have its own turn-by-turn navigation
// services, you can ask Maps to provide the information for you", Apple's
// Location Awareness guide). We are building our own, because leaving the app
// mid-route is where a field CRM loses the drive: the arrival, the miles, the
// customer's ETA text and the job all live here, not in Maps.
//
// MKDirections is what makes it possible. It returns an MKRoute carrying the
// polyline, the expected travel time, and MKRoute.Step objects whose
// `instructions` are the actual turn-by-turn text ("Turn right onto Main St").
// There are no per-app request limits, and registering as a routing app is only
// needed to publish directions to OTHER apps, which we are not doing.
//
// What Apple does NOT ship is the navigation experience: following camera,
// which step you are on, the voice. That is this file plus js/drive.js.
//
// DUMB ON PURPOSE (CLAUDE.md 3.2). This plugin renders, follows, and reports.
// It does not decide anything: when to announce, what counts as off route, what
// the customer is told, and when a drive is finished are all JS calls, so they
// stay tunable forever without another 15-minute macOS build.
//
//   start({lat,lng,label})     draw the route and start following
//   stop()                     tear the whole thing down
//   speak({text})              say this, right now
//   recalculate({lat,lng})     rebuild the route from where we are now
//
//   navEvent {type:'progress'} ~1Hz: eta, remaining, step text, step distance,
//                              metres off the line, and the driver's fix
//   navEvent {type:'arrived'}  inside the arrival radius JS asked for
//   navEvent {type:'route'}    a route (re)computed
//   navEvent {type:'cancelled'} the driver tapped End
//   navEvent {type:'error'}    no route, or location refused

@objc(TdNavPlugin)
public class TdNavPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TdNavPlugin"
    public let jsName = "TdNav"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recalculate", returnType: CAPPluginReturnPromise)
    ]

    private var navVC: TdNavViewController?

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": true])
    }

    @objc func start(_ call: CAPPluginCall) {
        guard let lat = num(call.getValue("lat")), let lng = num(call.getValue("lng")) else {
            call.reject("start needs lat and lng")
            return
        }
        let label = call.getString("label") ?? "Destination"
        DispatchQueue.main.async {
            if self.navVC != nil { self.teardown() }
            let vc = TdNavViewController()
            vc.destination = CLLocationCoordinate2D(latitude: lat, longitude: lng)
            vc.destinationLabel = label
            vc.onEvent = { [weak self] ev in self?.notifyListeners("navEvent", data: ev) }
            vc.modalPresentationStyle = .fullScreen
            self.navVC = vc
            self.bridge?.viewController?.present(vc, animated: true) {
                call.resolve(["started": true])
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.teardown()
            call.resolve(["stopped": true])
        }
    }

    @objc func speak(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? ""
        DispatchQueue.main.async {
            self.navVC?.say(text)
            call.resolve(["spoken": !text.isEmpty])
        }
    }

    @objc func recalculate(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let lat = self.num(call.getValue("lat")), let lng = self.num(call.getValue("lng")) {
                self.navVC?.destination = CLLocationCoordinate2D(latitude: lat, longitude: lng)
            }
            self.navVC?.buildRoute()
            call.resolve(["recalculating": self.navVC != nil])
        }
    }

    private func teardown() {
        guard let vc = navVC else { return }
        navVC = nil
        vc.shutdown()
        vc.dismiss(animated: true)
    }

    private func num(_ v: Any?) -> Double? {
        if let d = v as? Double { return d }
        if let i = v as? Int { return Double(i) }
        if let n = v as? NSNumber { return n.doubleValue }
        if let s = v as? String { return Double(s) }
        return nil
    }
}

// MARK: - The drive screen

class TdNavViewController: UIViewController {
    var destination = CLLocationCoordinate2D(latitude: 0, longitude: 0)
    var destinationLabel = "Destination"
    var onEvent: (([String: Any]) -> Void)?

    private let map = MKMapView()
    private let mgr = CLLocationManager()
    private let synth = AVSpeechSynthesizer()
    private let banner = UIView()
    private let stepLabel = UILabel()
    private let stepDistanceLabel = UILabel()
    private let etaLabel = UILabel()
    private let endButton = UIButton(type: .system)

    private var route: MKRoute?
    private var steps: [MKRoute.Step] = []
    private var stepIndex = 0
    private var routePoints: [CLLocationCoordinate2D] = []
    private var lastEmit = Date(timeIntervalSince1970: 0)
    private var done = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        map.frame = view.bounds
        map.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        map.showsUserLocation = true
        map.showsTraffic = true
        map.delegate = self
        // The tilted, heading-up camera IS the driving view. Without it this is
        // a map with a line on it, which is not what somebody behind a wheel can
        // use at a glance.
        map.userTrackingMode = .followWithHeading
        view.addSubview(map)

        buildChrome()

        mgr.delegate = self
        mgr.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        mgr.distanceFilter = 5
        // Navigation is the one time full GPS all the way through is correct:
        // the driver asked for it and the screen is on in front of them.
        mgr.requestWhenInUseAuthorization()
        mgr.startUpdatingLocation()
        mgr.startUpdatingHeading()
        UIApplication.shared.isIdleTimerDisabled = true

        // Ducking rather than interrupting: a turn instruction should talk over
        // the radio for a second and hand it straight back.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .voicePrompt,
                                                         options: [.duckOthers, .mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)

        buildRoute()
    }

    private func buildChrome() {
        banner.backgroundColor = UIColor.systemBackground.withAlphaComponent(0.94)
        banner.layer.cornerRadius = 16
        banner.layer.shadowColor = UIColor.black.cgColor
        banner.layer.shadowOpacity = 0.14
        banner.layer.shadowRadius = 12
        banner.layer.shadowOffset = CGSize(width: 0, height: 4)
        banner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(banner)

        stepDistanceLabel.font = .systemFont(ofSize: 26, weight: .heavy)
        stepDistanceLabel.textColor = .label
        stepLabel.font = .systemFont(ofSize: 15, weight: .semibold)
        stepLabel.textColor = .secondaryLabel
        stepLabel.numberOfLines = 2
        for l in [stepDistanceLabel, stepLabel] {
            l.translatesAutoresizingMaskIntoConstraints = false
            banner.addSubview(l)
        }

        etaLabel.font = .systemFont(ofSize: 15, weight: .bold)
        etaLabel.textColor = .label
        etaLabel.textAlignment = .center
        etaLabel.backgroundColor = UIColor.systemBackground.withAlphaComponent(0.94)
        etaLabel.layer.cornerRadius = 14
        etaLabel.layer.masksToBounds = true
        etaLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(etaLabel)

        endButton.setTitle("End", for: .normal)
        endButton.titleLabel?.font = .systemFont(ofSize: 15, weight: .bold)
        endButton.setTitleColor(.white, for: .normal)
        endButton.backgroundColor = UIColor.systemRed
        endButton.layer.cornerRadius = 14
        endButton.translatesAutoresizingMaskIntoConstraints = false
        endButton.addTarget(self, action: #selector(endTapped), for: .touchUpInside)
        view.addSubview(endButton)

        let g = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            banner.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 12),
            banner.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -12),
            banner.topAnchor.constraint(equalTo: g.topAnchor, constant: 10),

            stepDistanceLabel.leadingAnchor.constraint(equalTo: banner.leadingAnchor, constant: 16),
            stepDistanceLabel.topAnchor.constraint(equalTo: banner.topAnchor, constant: 12),
            stepDistanceLabel.trailingAnchor.constraint(equalTo: banner.trailingAnchor, constant: -16),

            stepLabel.leadingAnchor.constraint(equalTo: banner.leadingAnchor, constant: 16),
            stepLabel.trailingAnchor.constraint(equalTo: banner.trailingAnchor, constant: -16),
            stepLabel.topAnchor.constraint(equalTo: stepDistanceLabel.bottomAnchor, constant: 2),
            stepLabel.bottomAnchor.constraint(equalTo: banner.bottomAnchor, constant: -12),

            etaLabel.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 12),
            etaLabel.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -12),
            etaLabel.heightAnchor.constraint(equalToConstant: 48),

            endButton.leadingAnchor.constraint(equalTo: etaLabel.trailingAnchor, constant: 10),
            endButton.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -12),
            endButton.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -12),
            endButton.heightAnchor.constraint(equalToConstant: 48),
            endButton.widthAnchor.constraint(equalToConstant: 88),
        ])

        stepDistanceLabel.text = "Starting"
        stepLabel.text = "Finding the route to \(destinationLabel)"
        etaLabel.text = "..."
    }

    @objc private func endTapped() {
        emit(["type": "cancelled"])
        shutdown()
        dismiss(animated: true)
    }

    // MARK: Route

    func buildRoute() {
        guard let here = mgr.location?.coordinate ?? map.userLocation.location?.coordinate else {
            // No fix yet. The first location update calls back in here.
            return
        }
        let req = MKDirections.Request()
        req.source = MKMapItem(placemark: MKPlacemark(coordinate: here))
        req.destination = MKMapItem(placemark: MKPlacemark(coordinate: destination))
        req.transportType = .automobile
        req.requestsAlternateRoutes = false
        MKDirections(request: req).calculate { [weak self] resp, err in
            guard let self = self else { return }
            guard let r = resp?.routes.first else {
                self.emit(["type": "error", "message": err?.localizedDescription ?? "no route"])
                self.stepLabel.text = "Could not find a route. Check the address."
                return
            }
            self.applyRoute(r)
        }
    }

    private func applyRoute(_ r: MKRoute) {
        route = r
        steps = r.steps
        stepIndex = 0
        routePoints = r.polyline.coordinates
        map.removeOverlays(map.overlays)
        map.addOverlay(r.polyline, level: .aboveRoads)
        map.removeAnnotations(map.annotations.filter { !($0 is MKUserLocation) })
        let pin = MKPointAnnotation()
        pin.coordinate = destination
        pin.title = destinationLabel
        map.addAnnotation(pin)
        emit(["type": "route",
              "seconds": r.expectedTravelTime,
              "meters": r.distance,
              "steps": r.steps.map { ["text": $0.instructions, "meters": $0.distance] }])
        advanceStepUI(distanceToStep: nil)
    }

    // MARK: Following

    private func onFix(_ loc: CLLocation) {
        if done { return }
        if route == nil { buildRoute(); return }

        let here = loc.coordinate
        let offMeters = distanceToRoute(here)
        let remaining = remainingMeters(from: here)
        let toDest = CLLocation(latitude: destination.latitude, longitude: destination.longitude)
            .distance(from: loc)

        // Which step are we on: the first one whose maneuver point is still
        // ahead of us. Cheap, and it self-corrects on every fix rather than
        // trusting a counter that can drift past a missed turn.
        var idx = stepIndex
        while idx < steps.count - 1 {
            let sp = steps[idx].polyline.coordinates.last ?? here
            let d = CLLocation(latitude: sp.latitude, longitude: sp.longitude).distance(from: loc)
            if d < 25 { idx += 1 } else { break }
        }
        stepIndex = idx
        let stepMeters = steps.indices.contains(idx)
            ? (steps[idx].polyline.coordinates.last.map {
                CLLocation(latitude: $0.latitude, longitude: $0.longitude).distance(from: loc) } ?? 0)
            : 0
        advanceStepUI(distanceToStep: stepMeters)

        let speed = max(loc.speed, 0)
        let eta = etaSeconds(remaining: remaining, speed: speed)
        etaLabel.text = etaText(seconds: eta, meters: remaining)

        // Throttled to about 1Hz: JS decides announcements and arrival from
        // this stream, and a burst of fixes should not become a burst of work.
        if Date().timeIntervalSince(lastEmit) >= 1.0 {
            lastEmit = Date()
            emit(["type": "progress",
                  "lat": here.latitude, "lng": here.longitude,
                  "speed": speed,
                  "etaSeconds": eta,
                  "remainingMeters": remaining,
                  "toDestinationMeters": toDest,
                  "offRouteMeters": offMeters,
                  "stepIndex": idx,
                  "stepText": steps.indices.contains(idx) ? steps[idx].instructions : "",
                  "stepMeters": stepMeters])
        }
    }

    private func advanceStepUI(distanceToStep: Double?) {
        guard steps.indices.contains(stepIndex) else { return }
        let s = steps[stepIndex]
        stepLabel.text = s.instructions.isEmpty ? "Continue to \(destinationLabel)" : s.instructions
        if let d = distanceToStep {
            stepDistanceLabel.text = shortDistance(d)
        } else {
            stepDistanceLabel.text = shortDistance(s.distance)
        }
    }

    // Straight-line metres from the driver to the nearest point on the drawn
    // route. JS decides what counts as off route, this only measures.
    private func distanceToRoute(_ c: CLLocationCoordinate2D) -> Double {
        guard !routePoints.isEmpty else { return 0 }
        let me = CLLocation(latitude: c.latitude, longitude: c.longitude)
        var best = Double.greatestFiniteMagnitude
        for p in routePoints {
            let d = CLLocation(latitude: p.latitude, longitude: p.longitude).distance(from: me)
            if d < best { best = d }
        }
        return best
    }

    private func remainingMeters(from c: CLLocationCoordinate2D) -> Double {
        guard !routePoints.isEmpty else { return 0 }
        let me = CLLocation(latitude: c.latitude, longitude: c.longitude)
        var nearest = 0, best = Double.greatestFiniteMagnitude
        for (i, p) in routePoints.enumerated() {
            let d = CLLocation(latitude: p.latitude, longitude: p.longitude).distance(from: me)
            if d < best { best = d; nearest = i }
        }
        var total = best
        var i = nearest
        while i < routePoints.count - 1 {
            let a = CLLocation(latitude: routePoints[i].latitude, longitude: routePoints[i].longitude)
            let b = CLLocation(latitude: routePoints[i + 1].latitude, longitude: routePoints[i + 1].longitude)
            total += b.distance(from: a)
            i += 1
        }
        return total
    }

    // The route's own expected travel time is the honest baseline; current
    // speed only refines it once the truck is actually moving.
    private func etaSeconds(remaining: Double, speed: Double) -> Double {
        guard let r = route, r.distance > 0 else { return 0 }
        let base = r.expectedTravelTime * (remaining / r.distance)
        if speed > 2 {
            let live = remaining / speed
            return (base + live) / 2
        }
        return base
    }

    private func etaText(seconds: Double, meters: Double) -> String {
        let mins = max(1, Int((seconds / 60).rounded()))
        let arrive = Date().addingTimeInterval(seconds)
        let f = DateFormatter()
        f.dateFormat = "h:mm"
        return "\(mins) min  ·  \(shortDistance(meters))  ·  \(f.string(from: arrive))"
    }

    private func shortDistance(_ meters: Double) -> String {
        let feet = meters * 3.28084
        if feet < 1000 { return "\(Int((feet / 10).rounded()) * 10) ft" }
        let miles = meters / 1609.34
        return miles < 10 ? String(format: "%.1f mi", miles) : "\(Int(miles.rounded())) mi"
    }

    // MARK: Voice

    func say(_ text: String) {
        guard !text.isEmpty else { return }
        let u = AVSpeechUtterance(string: text)
        u.rate = AVSpeechUtteranceDefaultSpeechRate
        u.voice = AVSpeechSynthesisVoice(language: Locale.current.identifier)
            ?? AVSpeechSynthesisVoice(language: "en-US")
        synth.speak(u)
    }

    func shutdown() {
        done = true
        mgr.stopUpdatingLocation()
        mgr.stopUpdatingHeading()
        synth.stopSpeaking(at: .immediate)
        UIApplication.shared.isIdleTimerDisabled = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func emit(_ ev: [String: Any]) {
        var e = ev
        e["ts"] = Date().timeIntervalSince1970 * 1000
        onEvent?(e)
    }
}

extension TdNavViewController: CLLocationManagerDelegate {
    func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        guard let l = locs.last else { return }
        onFix(l)
    }
    func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {
        emit(["type": "error", "message": error.localizedDescription])
    }
}

extension TdNavViewController: MKMapViewDelegate {
    func mapView(_ mv: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
        guard let line = overlay as? MKPolyline else { return MKOverlayRenderer(overlay: overlay) }
        let r = MKPolylineRenderer(polyline: line)
        r.strokeColor = UIColor.systemBlue
        r.lineWidth = 8
        r.lineCap = .round
        return r
    }
}

// MKPolyline hands back its points through a C buffer; this is the usual
// Swift-side unwrap of it.
extension MKPolyline {
    var coordinates: [CLLocationCoordinate2D] {
        var out = [CLLocationCoordinate2D](repeating: kCLLocationCoordinate2DInvalid,
                                           count: pointCount)
        getCoordinates(&out, range: NSRange(location: 0, length: pointCount))
        return out
    }
}
