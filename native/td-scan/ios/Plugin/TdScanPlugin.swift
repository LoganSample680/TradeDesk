import Foundation
import Capacitor
import UIKit
import CoreLocation
#if canImport(RoomPlan)
import RoomPlan
import ARKit
#endif

// TradeDesk room scanner, the thin native half of scan-to-estimate.
//
// One fullscreen native modal hosts Apple's RoomCaptureView with a minimal
// overlay: photo shutter, a room-label chip that cycles labels JS passed in,
// Done Room (finishes the current room, keeps the shared ARSession alive so
// the next room lands in the same coordinate space), and Finish / Cancel.
//
// Everything captured returns to JS as JSON when the modal closes:
//   { rooms: [<CapturedRoom JSON>], labels: ["Kitchen", ...],
//     photos: [{path, cam:[16 floats], room:<index>}], headingDeg: <number> }
// JS owns all math, drawing, and business rules (CLAUDE.md 3.2): wall footage,
// floor plans, outlet spacing, load calcs, and the client-hub product are all
// web-side, tunable forever without another build.
@objc(TdScanPlugin)
public class TdScanPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TdScanPlugin"
    public let jsName = "TdScan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startScan", returnType: CAPPluginReturnPromise)
    ]

    @objc func isSupported(_ call: CAPPluginCall) {
        #if canImport(RoomPlan)
        if #available(iOS 17.0, *) {
            call.resolve(["supported": RoomCaptureSession.isSupported])
            return
        }
        #endif
        call.resolve(["supported": false])
    }

    @objc func startScan(_ call: CAPPluginCall) {
        #if canImport(RoomPlan)
        if #available(iOS 17.0, *) {
            guard RoomCaptureSession.isSupported else {
                call.reject("LiDAR not available on this device")
                return
            }
            let labels = (call.getArray("labels") as? [String]) ?? ["Room"]
            call.keepAlive = true
            DispatchQueue.main.async {
                let vc = TdScanViewController()
                vc.labels = labels
                vc.modalPresentationStyle = .fullScreen
                vc.onDone = { [weak self] result in
                    if let r = result { call.resolve(r) }
                    else { call.reject("cancelled") }
                    self?.bridge?.releaseCall(call)
                }
                self.bridge?.viewController?.present(vc, animated: true)
            }
            return
        }
        #endif
        call.reject("Requires iOS 17 and a LiDAR iPhone")
    }
}

#if canImport(RoomPlan)
@available(iOS 17.0, *)
class TdScanViewController: UIViewController, RoomCaptureSessionDelegate {
    var labels: [String] = ["Room"]
    var onDone: (([String: Any]?) -> Void)?

    private var arSession = ARSession()
    private var captureView: RoomCaptureView!
    private let builder = RoomBuilder(options: [.beautifyObjects])
    private var rooms: [CapturedRoom] = []
    private var roomLabels: [String] = []
    private var photos: [[String: Any]] = []
    private var labelIndex = 0
    private var finishing = false
    private var headingDeg: Double = -1
    private let locMgr = CLLocationManager()

    private let chip = UIButton(type: .system)
    private let doneRoomBtn = UIButton(type: .system)
    private let finishBtn = UIButton(type: .system)
    private let cancelBtn = UIButton(type: .system)
    private let shutterBtn = UIButton(type: .system)
    private let hint = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        // One compass read anchors the plan to north; JS rotates the drawing.
        locMgr.delegate = nil
        if CLLocationManager.headingAvailable() { locMgr.startUpdatingHeading() }
        startRoom()
        buildOverlay()
        // Grab the heading shortly after start; one sample is plenty.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            guard let self = self else { return }
            if let h = self.locMgr.heading { self.headingDeg = h.trueHeading >= 0 ? h.trueHeading : h.magneticHeading }
            self.locMgr.stopUpdatingHeading()
        }
    }

    private func startRoom() {
        captureView?.removeFromSuperview()
        captureView = RoomCaptureView(frame: view.bounds, arSession: arSession)
        captureView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        captureView.captureSession.delegate = self
        view.insertSubview(captureView, at: 0)
        captureView.captureSession.run(configuration: RoomCaptureSession.Configuration())
    }

    private func styled(_ b: UIButton, _ title: String, bg: UIColor, fg: UIColor = .white) {
        b.setTitle(title, for: .normal)
        b.setTitleColor(fg, for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 15, weight: .bold)
        b.backgroundColor = bg
        b.layer.cornerRadius = 22
        b.contentEdgeInsets = UIEdgeInsets(top: 12, left: 18, bottom: 12, right: 18)
        b.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(b)
    }

    private func buildOverlay() {
        roomLabels = []
        labelIndex = 0
        styled(chip, labels.first ?? "Room", bg: UIColor(white: 0, alpha: 0.55))
        styled(cancelBtn, "Cancel", bg: UIColor(white: 0, alpha: 0.55))
        styled(doneRoomBtn, "Done room", bg: UIColor(red: 0.09, green: 0.37, blue: 0.65, alpha: 1))
        styled(finishBtn, "Finish", bg: UIColor(red: 0.13, green: 0.55, blue: 0.28, alpha: 1))
        styled(shutterBtn, "📷", bg: UIColor(white: 0, alpha: 0.55))
        shutterBtn.titleLabel?.font = .systemFont(ofSize: 24)

        hint.text = "Walk the room edges. Tap the label to name this room."
        hint.textColor = .white
        hint.font = .systemFont(ofSize: 12, weight: .medium)
        hint.textAlignment = .center
        hint.numberOfLines = 2
        hint.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(hint)

        chip.addTarget(self, action: #selector(cycleLabel), for: .touchUpInside)
        cancelBtn.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        doneRoomBtn.addTarget(self, action: #selector(doneRoomTapped), for: .touchUpInside)
        finishBtn.addTarget(self, action: #selector(finishTapped), for: .touchUpInside)
        shutterBtn.addTarget(self, action: #selector(shutterTapped), for: .touchUpInside)

        let g = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            cancelBtn.topAnchor.constraint(equalTo: g.topAnchor, constant: 10),
            cancelBtn.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 14),
            chip.topAnchor.constraint(equalTo: g.topAnchor, constant: 10),
            chip.centerXAnchor.constraint(equalTo: g.centerXAnchor),
            hint.topAnchor.constraint(equalTo: chip.bottomAnchor, constant: 8),
            hint.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 20),
            hint.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -20),
            shutterBtn.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -18),
            shutterBtn.centerXAnchor.constraint(equalTo: g.centerXAnchor),
            doneRoomBtn.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -18),
            doneRoomBtn.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 14),
            finishBtn.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -18),
            finishBtn.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -14),
        ])
    }

    @objc private func cycleLabel() {
        labelIndex = (labelIndex + 1) % max(labels.count, 1)
        chip.setTitle(labels[labelIndex], for: .normal)
    }

    @objc private func shutterTapped() {
        guard let frame = arSession.currentFrame else { return }
        let img = CIImage(cvPixelBuffer: frame.capturedImage)
        let ctx = CIContext()
        guard let cg = ctx.createCGImage(img, from: img.extent) else { return }
        // The raw buffer is sensor-oriented (landscape); rotate to portrait so
        // the photo reads the way the user held the phone.
        let ui = UIImage(cgImage: cg, scale: 1, orientation: .right)
        guard let jpg = ui.jpegData(compressionQuality: 0.72) else { return }
        let name = "td_scan_\(Int(Date().timeIntervalSince1970 * 1000)).jpg"
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = dir.appendingPathComponent(name)
        do { try jpg.write(to: url) } catch { return }
        let t = frame.camera.transform
        var cam: [Double] = []
        for c in 0..<4 { for r in 0..<4 { cam.append(Double(t[c][r])) } }
        photos.append(["path": url.path, "cam": cam, "room": rooms.count])
        // A quick flash so the tap visibly took.
        let flash = UIView(frame: view.bounds)
        flash.backgroundColor = .white
        flash.alpha = 0.7
        view.addSubview(flash)
        UIView.animate(withDuration: 0.25, animations: { flash.alpha = 0 }, completion: { _ in flash.removeFromSuperview() })
    }

    @objc private func doneRoomTapped() {
        finishing = false
        captureView.captureSession.stop(pauseARSession: false)
    }

    @objc private func finishTapped() {
        finishing = true
        captureView.captureSession.stop(pauseARSession: false)
    }

    @objc private func cancelTapped() {
        captureView.captureSession.stop()
        dismiss(animated: true) { [weak self] in self?.onDone?(nil) }
    }

    // RoomCaptureSessionDelegate: the stopped session hands over raw data;
    // RoomBuilder turns it into the parametric CapturedRoom.
    public func captureSession(_ session: RoomCaptureSession, didEndWith data: CapturedRoomData, error: Error?) {
        let wasFinishing = finishing
        Task { [weak self] in
            guard let self = self else { return }
            if error == nil, let room = try? await self.builder.capturedRoom(from: data) {
                self.rooms.append(room)
                self.roomLabels.append(self.labels[self.labelIndex])
            }
            await MainActor.run {
                if wasFinishing || self.rooms.isEmpty {
                    self.deliver()
                } else {
                    // Next room rides the same ARSession, so its geometry lands
                    // in the same world space and the plans line up.
                    self.labelIndex = 0
                    self.chip.setTitle(self.labels.first ?? "Room", for: .normal)
                    self.startRoom()
                }
            }
        }
    }

    private func deliver() {
        let enc = JSONEncoder()
        var roomJson: [String] = []
        for r in rooms {
            if let d = try? enc.encode(r), let s = String(data: d, encoding: .utf8) { roomJson.append(s) }
        }
        let result: [String: Any] = [
            "rooms": roomJson,
            "labels": roomLabels,
            "photos": photos,
            "headingDeg": headingDeg
        ]
        dismiss(animated: true) { [weak self] in self?.onDone?(result) }
    }
}
#endif
