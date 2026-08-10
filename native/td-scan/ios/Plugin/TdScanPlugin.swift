import Foundation
import Capacitor
import UIKit
import CoreLocation
import QuickLook
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
//     stories: [1, 1, 2, ...], photos: [{path, cam:[16 floats], room:<index>}],
//     headingDeg: <number>, usdz: <path, when export succeeded> }
// The Floor chip stamps each room with the floor the user SAID they were on
// (deterministic, unlike RoomPlan's own story field, which is unreliable in
// merged captures); the USDZ is the whole capture exported parametric, the
// file viewUsdz() hands to Quick Look for the 3D/AR walkaround.
// JS owns all math, drawing, and business rules (CLAUDE.md 3.2): wall footage,
// floor plans, outlet spacing, load calcs, and the client-hub product are all
// web-side, tunable forever without another build.
@objc(TdScanPlugin)
public class TdScanPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TdScanPlugin"
    public let jsName = "TdScan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "viewUsdz", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFile", returnType: CAPPluginReturnPromise)
    ]
    private var usdzPreview: TdUsdzPreview?

    // Chunked file reader: the photo mesh (PLY) is megabytes, and the bridge
    // moves strings, so JS pulls it in 1 MB base64 slices. Dumb by design:
    // bytes in a range, nothing else.
    @objc func readFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else { call.reject("no path"); return }
        let offset = call.getInt("offset") ?? 0
        let length = call.getInt("length") ?? 1_048_576
        DispatchQueue.global(qos: .userInitiated).async {
            guard let fh = FileHandle(forReadingAtPath: path) else {
                call.reject("no such file"); return
            }
            let size = (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? Int) ?? 0
            fh.seek(toFileOffset: UInt64(max(0, offset)))
            let data = fh.readData(ofLength: length)
            fh.closeFile()
            call.resolve(["b64": data.base64EncodedString(), "size": size ?? 0])
        }
    }

    // Quick Look on a USDZ gives the free native 3D orbit + AR placement.
    // Dumb by design: present a file, nothing else. The Safari rel="ar"
    // anchor trick does not work inside WKWebView (WebKit bug 239135), so
    // this tiny method is the only way the shell gets AR.
    @objc func viewUsdz(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), FileManager.default.fileExists(atPath: path) else {
            call.reject("no such file")
            return
        }
        DispatchQueue.main.async {
            let ql = QLPreviewController()
            let ds = TdUsdzPreview(url: URL(fileURLWithPath: path))
            self.usdzPreview = ds
            ql.dataSource = ds
            self.bridge?.viewController?.present(ql, animated: true)
            call.resolve()
        }
    }

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
                // Adding to an existing scan: the saved ARWorldMap puts the
                // new rooms in the SAME coordinate space once the phone
                // relocalizes, so the plans line up instead of stacking.
                vc.resumeWorldMapPath = call.getString("worldMap")
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

// Retained by the plugin while Quick Look is up; QLPreviewController keeps
// only a weak reference to its data source.
class TdUsdzPreview: NSObject, QLPreviewControllerDataSource {
    let url: URL
    init(url: URL) { self.url = url }
    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
}

#if canImport(RoomPlan)
// One keyframe of the walk: where the camera stood, how it projected, and the
// small sensor-space JPEG it wrote. Shared by the capture VC and the baker.
@available(iOS 17.0, *)
struct TdKeyframe {
    let path: String
    let inv: simd_float4x4    // world → camera
    let cam: [Double]         // camera → world, column-major, for JS
    let fx: Float, fy: Float, cx: Float, cy: Float
    let w: Float, h: Float    // saved pixel size, projection normalizes by it
    let camPos: simd_float3
    let camFwd: simd_float3
}

@available(iOS 17.0, *)
class TdScanViewController: UIViewController, RoomCaptureSessionDelegate {
    var labels: [String] = ["Room"]
    var onDone: (([String: Any]?) -> Void)?
    var resumeWorldMapPath: String?

    private var arSession = ARSession()
    private var captureView: RoomCaptureView!
    private let builder = RoomBuilder(options: [.beautifyObjects])
    private var rooms: [CapturedRoom] = []
    private var roomLabels: [String] = []
    private var roomStories: [Int] = []
    private var photos: [[String: Any]] = []
    private var currentStory = 1
    private var finishing = false
    private var discarding = false
    private var headingDeg: Double = -1
    private var lastGeomCount = 0
    private let locMgr = CLLocationManager()
    private let tickGen = UIImpactFeedbackGenerator(style: .light)

    // ── Walkthrough photo capture (owner 2026-08-10) ─────────────────────────
    // NOT bake fuel: these frames are the JOB RECORD. "We need photos so we
    // can walk back through it later if we have details that we need to see
    // from actual photos." So they save at FULL sensor resolution, they are
    // never deleted, and every one carries its pose + intrinsics so JS can
    // answer "show me the real photo of THIS spot" from the plan or the 3D
    // model. The mesh bake and its textures ride the same files for free.
    // Costs the walk nothing: a half-second timer keeps a frame only when the
    // camera genuinely moved. Capability only: JS owns the walkthrough UX.
    private var keyframes: [TdKeyframe] = []
    private var kfTimer: Timer?
    private var kfBusy = false
    private var lastKfPose: simd_float4x4?
    private let kfMax = 60

    private let chip = UIButton(type: .system)
    private let floorBtn = UIButton(type: .system)
    private let redoBtn = UIButton(type: .system)
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
        // Resuming an earlier scan: preload its ARWorldMap so the session
        // relocalizes into the SAME coordinate space and the new rooms land
        // beside the old ones instead of on top of them. Verify on device
        // (build 14): RoomPlan on a custom, already-running ARSession keeps
        // tracking (the multi-room pattern rides the same behavior).
        if let p = resumeWorldMapPath,
           let data = try? Data(contentsOf: URL(fileURLWithPath: p)),
           let map = try? NSKeyedUnarchiver.unarchivedObject(ofClass: ARWorldMap.self, from: data) {
            let cfg = ARWorldTrackingConfiguration()
            cfg.initialWorldMap = map
            cfg.planeDetection = [.horizontal, .vertical]
            if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
                cfg.sceneReconstruction = .mesh
            }
            arSession.run(cfg, options: [.resetTracking, .removeExistingAnchors])
        }
        startRoom()
        buildOverlay()
        // Keyframes ride the walk on a slow tick; the pose gate keeps only
        // frames that actually add coverage, so a slow scanner is not a
        // thousand-JPEG scanner.
        kfTimer = Timer.scheduledTimer(withTimeInterval: 0.55, repeats: true) { [weak self] _ in
            self?.maybeKeyframe()
        }
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
        lastGeomCount = 0
        tickGen.prepare()
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
        styled(chip, labels.first ?? "Room", bg: UIColor(white: 0, alpha: 0.55))
        styled(floorBtn, "Floor 1", bg: UIColor(white: 0, alpha: 0.55))
        styled(cancelBtn, "Cancel", bg: UIColor(white: 0, alpha: 0.55))
        styled(redoBtn, "Redo room", bg: UIColor(white: 0, alpha: 0.55))
        redoBtn.titleLabel?.font = .systemFont(ofSize: 13, weight: .bold)
        styled(doneRoomBtn, "Done room", bg: UIColor(red: 0.09, green: 0.37, blue: 0.65, alpha: 1))
        styled(finishBtn, "Finish", bg: UIColor(red: 0.13, green: 0.55, blue: 0.28, alpha: 1))
        styled(shutterBtn, "📷", bg: UIColor(white: 0, alpha: 0.55))
        shutterBtn.titleLabel?.font = .systemFont(ofSize: 24)

        hint.text = resumeWorldMapPath != nil
            ? "Stand where you already scanned so the phone finds its place, then walk the new room."
            : "Walk the room edges. Tap the label to type this room's name. Tap Floor when you head upstairs."
        hint.textColor = .white
        hint.font = .systemFont(ofSize: 12, weight: .medium)
        hint.textAlignment = .center
        hint.numberOfLines = 2
        hint.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(hint)

        chip.addTarget(self, action: #selector(cycleLabel), for: .touchUpInside)
        redoBtn.addTarget(self, action: #selector(redoRoomTapped), for: .touchUpInside)
        floorBtn.addTarget(self, action: #selector(floorTapped), for: .touchUpInside)
        floorBtn.addGestureRecognizer(UILongPressGestureRecognizer(target: self, action: #selector(floorHeld(_:))))
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
            floorBtn.topAnchor.constraint(equalTo: g.topAnchor, constant: 10),
            floorBtn.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -14),
            hint.topAnchor.constraint(equalTo: chip.bottomAnchor, constant: 8),
            hint.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 20),
            hint.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -20),
            shutterBtn.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -18),
            shutterBtn.centerXAnchor.constraint(equalTo: g.centerXAnchor),
            doneRoomBtn.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -18),
            doneRoomBtn.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 14),
            redoBtn.bottomAnchor.constraint(equalTo: doneRoomBtn.topAnchor, constant: -10),
            redoBtn.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 14),
            finishBtn.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -18),
            finishBtn.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -14),
        ])
    }

    // TAP THE CHIP AND TYPE (owner 2026-08-10: "I want to type to name").
    //
    // It used to cycle a fixed list, and that WAS the naming mechanism, so a
    // room could only ever be called one of the words we shipped. Half of every
    // real house is "Master bath" or "Zach's office". The tap now opens a text
    // field with the current name in it, so typing over it is the fast path.
    //
    // The list survives as QUICK PICKS in the same sheet, because "Kitchen"
    // should stay one tap. It is still JS's list (CLAUDE.md 3.2): this only
    // captures what comes back, and renaming after the scan is entirely JS
    // (_scanRenameRoom), so how naming works can change without a build.
    @objc private func cycleLabel() {
        let a = UIAlertController(title: "Name this room", message: nil, preferredStyle: .alert)
        a.addTextField { tf in
            tf.text = self.chip.title(for: .normal)
            tf.placeholder = "Master bath, back bedroom..."
            tf.autocapitalizationType = .words
            tf.clearButtonMode = .whileEditing
            tf.returnKeyType = .done
        }
        a.addAction(UIAlertAction(title: "Use it", style: .default) { [weak self] _ in
            guard let self = self else { return }
            let t = (a.textFields?.first?.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !t.isEmpty else { return }          // blank is not a name
            self.chip.setTitle(t, for: .normal)
        })
        // Quick picks, capped so the sheet stays readable on a small phone.
        for l in labels.prefix(6) where l != chip.title(for: .normal) {
            a.addAction(UIAlertAction(title: l, style: .default) { [weak self] _ in
                self?.chip.setTitle(l, for: .normal)
            })
        }
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        present(a, animated: true)
    }

    // Tap = up a floor, long-press = back down. Deterministic on purpose:
    // the user SAYS which floor they are on, we never guess from stairs.
    @objc private func floorTapped() {
        currentStory = min(currentStory + 1, 9)
        floorBtn.setTitle("Floor \(currentStory)", for: .normal)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    @objc private func floorHeld(_ g: UILongPressGestureRecognizer) {
        guard g.state == .began else { return }
        currentStory = max(currentStory - 1, 1)
        floorBtn.setTitle("Floor \(currentStory)", for: .normal)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
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

    // Botched the room (walked it wrong, kid ran through, wrong room): throw
    // THIS room's geometry away and walk it again. The session stays alive so
    // already-finished rooms are untouched, and the typed name is kept: they
    // are redoing the room, not renaming it.
    @objc private func redoRoomTapped() {
        discarding = true
        finishing = false
        captureView.captureSession.stop(pauseARSession: false)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    @objc private func finishTapped() {
        finishing = true
        captureView.captureSession.stop(pauseARSession: false)
    }

    @objc private func cancelTapped() {
        kfTimer?.invalidate(); kfTimer = nil
        captureView.captureSession.stop()
        for k in keyframes { try? FileManager.default.removeItem(atPath: k.path) }
        dismiss(animated: true) { [weak self] in self?.onDone?(nil) }
    }

    // One frame when the camera has genuinely moved: >0.35 m of travel or
    // >20 degrees of turn since the last kept frame. The frame is a
    // PHOTO-QUALITY still where the hardware gives one (12 MP via
    // captureHighResolutionFrame, iOS 16+), because the record has to survive
    // being zoomed into months later and the AR video feed does not. Falls
    // back to the video frame if the still fails. One request in flight at a
    // time; each frame saves with the pose + intrinsics of the frame that was
    // actually written.
    private func maybeKeyframe() {
        guard keyframes.count < kfMax, !kfBusy, let frame = arSession.currentFrame,
              case .normal = frame.camera.trackingState else { return }
        let t = frame.camera.transform
        let pos = simd_float3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
        let fwd = -simd_float3(t.columns.2.x, t.columns.2.y, t.columns.2.z)
        if let last = lastKfPose {
            let lp = simd_float3(last.columns.3.x, last.columns.3.y, last.columns.3.z)
            let lf = -simd_float3(last.columns.2.x, last.columns.2.y, last.columns.2.z)
            if simd_distance(pos, lp) < 0.35 && simd_dot(fwd, lf) > 0.94 { return }
        }
        lastKfPose = t
        kfBusy = true
        if #available(iOS 16.0, *) {
            arSession.captureHighResolutionFrame { [weak self] hi, _ in
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    if let hi = hi { self.saveKeyframe(hi) }
                    else if let cur = self.arSession.currentFrame { self.saveKeyframe(cur) }
                    else { self.kfBusy = false }
                }
            }
        } else {
            saveKeyframe(frame)
        }
    }

    private func saveKeyframe(_ frame: ARFrame) {
        let t = frame.camera.transform
        let K = frame.camera.intrinsics
        let img = CIImage(cvPixelBuffer: frame.capturedImage)
        let pw = Float(img.extent.width), ph = Float(img.extent.height)
        let pos = simd_float3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
        let fwd = -simd_float3(t.columns.2.x, t.columns.2.y, t.columns.2.z)
        var cam: [Double] = []
        for c in 0..<4 { for r in 0..<4 { cam.append(Double(t[c][r])) } }
        let idx = keyframes.count
        DispatchQueue.global(qos: .utility).async { [weak self] in
            defer { DispatchQueue.main.async { self?.kfBusy = false } }
            guard let self = self else { return }
            let ctx = CIContext()
            guard let cg = ctx.createCGImage(img, from: img.extent),
                  let jpg = UIImage(cgImage: cg).jpegData(compressionQuality: 0.6) else { return }
            let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let url = dir.appendingPathComponent("td_walk_\(Int(Date().timeIntervalSince1970 * 1000))_\(idx).jpg")
            do { try jpg.write(to: url) } catch { return }
            DispatchQueue.main.async {
                guard self.keyframes.count < self.kfMax else { try? FileManager.default.removeItem(at: url); return }
                self.keyframes.append(TdKeyframe(
                    path: url.path, inv: simd_inverse(t), cam: cam,
                    fx: K[0][0], fy: K[1][1], cx: K[2][0], cy: K[2][1],
                    w: pw, h: ph,
                    camPos: pos, camFwd: fwd))
            }
        }
    }

    // A light haptic tick each time a wall/door/window/opening locks in:
    // feel-the-scan feedback with the phone held up. Capability only, every
    // number JS shows is still computed web-side from the final geometry.
    public func captureSession(_ session: RoomCaptureSession, didUpdate room: CapturedRoom) {
        let n = room.walls.count + room.doors.count + room.windows.count + room.openings.count
        if n > lastGeomCount {
            lastGeomCount = n
            DispatchQueue.main.async { self.tickGen.impactOccurred(); self.tickGen.prepare() }
        }
    }

    // RoomCaptureSessionDelegate: the stopped session hands over raw data;
    // RoomBuilder turns it into the parametric CapturedRoom.
    public func captureSession(_ session: RoomCaptureSession, didEndWith data: CapturedRoomData, error: Error?) {
        let wasFinishing = finishing
        let wasDiscarding = discarding
        discarding = false
        Task { [weak self] in
            guard let self = self else { return }
            if wasDiscarding {
                // Redo: nothing appended, same room again, name kept.
                await MainActor.run { self.startRoom() }
                return
            }
            if error == nil, let room = try? await self.builder.capturedRoom(from: data) {
                self.rooms.append(room)
                // The CHIP is the source of truth, not an index into the list.
                // Since the chip can now hold a typed name, reading
                // labels[labelIndex] would have silently thrown that name away
                // and filed the room under whatever the list happened to hold.
                let typed = await MainActor.run { self.chip.title(for: .normal) ?? "" }
                self.roomLabels.append(typed.isEmpty ? "Room" : typed)
                self.roomStories.append(self.currentStory)
            }
            await MainActor.run {
                if wasFinishing || self.rooms.isEmpty {
                    self.deliver()
                } else {
                    // Next room rides the same ARSession, so its geometry lands
                    // in the same world space and the plans line up.
                    self.chip.setTitle(self.labels.first ?? "Room", for: .normal)
                    self.startRoom()
                }
            }
        }
    }

    private func deliver() {
        kfTimer?.invalidate(); kfTimer = nil
        let enc = JSONEncoder()
        var roomJson: [String] = []
        for r in rooms {
            if let d = try? enc.encode(r), let s = String(data: d, encoding: .utf8) { roomJson.append(s) }
        }
        // Snapshot the raw LiDAR mesh BEFORE anything stops the session.
        let meshAnchors = (arSession.currentFrame?.anchors.compactMap { $0 as? ARMeshAnchor }) ?? []
        // The bake takes a few seconds on a big house; say so on the glass
        // instead of freezing silently.
        let hud = UILabel()
        if !meshAnchors.isEmpty && !keyframes.isEmpty {
            hud.text = "Building the photo mesh…"
            hud.textColor = .white
            hud.font = .systemFont(ofSize: 14, weight: .bold)
            hud.textAlignment = .center
            hud.backgroundColor = UIColor(white: 0, alpha: 0.72)
            hud.layer.cornerRadius = 12; hud.clipsToBounds = true
            hud.frame = CGRect(x: 40, y: view.bounds.midY - 24, width: view.bounds.width - 80, height: 48)
            view.addSubview(hud)
        }
        Task { [weak self] in
            guard let self = self else { return }
            // Parametric USDZ of the whole capture: the 3D dollhouse / AR
            // file. Rooms shared one ARSession, so StructureBuilder merges
            // them into one model; a failed export just omits the file, the
            // 2D product never depends on it.
            var usdzPath: String? = nil
            if !self.rooms.isEmpty {
                let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                let url = dir.appendingPathComponent("td_scan_\(Int(Date().timeIntervalSince1970 * 1000)).usdz")
                if let structure = try? await StructureBuilder(options: [.beautifyObjects]).capturedStructure(from: self.rooms) {
                    do { try structure.export(to: url, exportOptions: .parametric); usdzPath = url.path } catch {}
                }
                if usdzPath == nil, self.rooms.count == 1 {
                    do { try self.rooms[0].export(to: url, exportOptions: .parametric); usdzPath = url.path } catch {}
                }
            }
            // Photo mesh: weld the LiDAR anchors, bake real color from the
            // keyframes, write a vertex-color PLY (fallback tier) AND the
            // textured mesh (photoreal tier): every triangle UV-mapped into
            // the keyframe photo that saw it best, keyframe JPEGs kept as the
            // textures.
            var meshPath: String? = nil
            var texPath: String? = nil
            if !meshAnchors.isEmpty && !self.keyframes.isEmpty && !self.rooms.isEmpty {
                let kfs = self.keyframes
                let baked = await Task.detached(priority: .userInitiated) {
                    TdMeshBaker.bake(anchors: meshAnchors, keyframes: kfs)
                }.value
                meshPath = baked.ply
                texPath = baked.tdm
            }
            // Every walkthrough frame is KEPT and returned: they are the job
            // record, not disposable bake input.
            let walk: [[String: Any]] = self.keyframes.map { k in
                ["path": k.path, "cam": k.cam,
                 "fx": Double(k.fx), "fy": Double(k.fy), "cx": Double(k.cx), "cy": Double(k.cy),
                 "w": Double(k.w), "h": Double(k.h)]
            }
            // The ARWorldMap is what makes "add rooms later" possible: a
            // future session relocalizes into this map and its rooms land in
            // the same coordinate space. Saved on EVERY scan so any of them
            // can be extended.
            let worldMapPath: String? = await withCheckedContinuation { cont in
                self.arSession.getCurrentWorldMap { map, _ in
                    guard let map = map,
                          let data = try? NSKeyedArchiver.archivedData(withRootObject: map, requiringSecureCoding: true) else {
                        cont.resume(returning: nil); return
                    }
                    let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                    let url = dir.appendingPathComponent("td_map_\(Int(Date().timeIntervalSince1970 * 1000)).armap")
                    do { try data.write(to: url); cont.resume(returning: url.path) }
                    catch { cont.resume(returning: nil) }
                }
            }
            await MainActor.run {
                hud.removeFromSuperview()
                var result: [String: Any] = [
                    "rooms": roomJson,
                    "labels": self.roomLabels,
                    "stories": self.roomStories,
                    "photos": self.photos,
                    "headingDeg": self.headingDeg
                ]
                if let p = usdzPath { result["usdz"] = p }
                if let p = meshPath { result["meshPly"] = p }
                if let p = texPath { result["meshTex"] = p }
                if let p = worldMapPath { result["worldMap"] = p }
                if !walk.isEmpty { result["walk"] = walk }
                self.dismiss(animated: true) { self.onDone?(result) }
            }
        }
    }
}
#endif

// ── The mesh baker ───────────────────────────────────────────────────────────
// Welds every ARMeshAnchor into one world-space mesh, merges vertices on a
// small grid (the anchors overlap at their borders), bakes a color per vertex
// by projecting into the best-facing keyframe, and writes a binary PLY.
//
// One keyframe image lives in memory at a time: for each frame we project ALL
// vertices and keep the best-scored sample per vertex (score = how squarely
// the camera saw the point / distance squared), so the phone never holds
// sixty frames of pixels at once.
//
// Sign convention note (verify on device, build 14): ARKit camera space is
// -z forward, +y up; capturedImage pixels are landscape, origin top-left,
// +y down. Projection below maps world -> camera -> pixel accordingly.
#if canImport(RoomPlan)
@available(iOS 17.0, *)
enum TdMeshBaker {
    // Returns the vertex-color PLY, the textured TDM, and which keyframe
    // JPEGs the TDM references (those must NOT be deleted, they ARE the
    // textures).
    static func bake(anchors: [ARMeshAnchor], keyframes: [TdKeyframe]) -> (ply: String?, tdm: String?, usedImages: Set<String>) {
        // 1. Weld anchors into world-space arrays.
        var pos: [simd_float3] = [], nor: [simd_float3] = [], tris: [Int32] = []
        for a in anchors {
            let g = a.geometry
            let base = Int32(pos.count)
            let vtx = g.vertices, nrm = g.normals
            let vp = vtx.buffer.contents().advanced(by: vtx.offset)
            let np = nrm.buffer.contents().advanced(by: nrm.offset)
            let rot = simd_float3x3(columns: (
                simd_float3(a.transform.columns.0.x, a.transform.columns.0.y, a.transform.columns.0.z),
                simd_float3(a.transform.columns.1.x, a.transform.columns.1.y, a.transform.columns.1.z),
                simd_float3(a.transform.columns.2.x, a.transform.columns.2.y, a.transform.columns.2.z)))
            for i in 0..<vtx.count {
                let v = vp.advanced(by: i * vtx.stride).assumingMemoryBound(to: simd_float3.self).pointee
                let w = a.transform * simd_float4(v, 1)
                pos.append(simd_float3(w.x, w.y, w.z))
                let n = np.advanced(by: i * nrm.stride).assumingMemoryBound(to: simd_float3.self).pointee
                nor.append(simd_normalize(rot * n))
            }
            let f = g.faces
            let fp = f.buffer.contents()
            for i in 0..<(f.count * 3) {
                let idx: Int32 = f.bytesPerIndex == 2
                    ? Int32(fp.advanced(by: i * 2).assumingMemoryBound(to: UInt16.self).pointee)
                    : fp.advanced(by: i * 4).assumingMemoryBound(to: Int32.self).pointee
                tris.append(base + idx)
            }
        }
        guard !pos.isEmpty, !tris.isEmpty else { return (nil, nil, []) }
        // 2. Grid-merge duplicated border vertices; the grid follows scan
        // size, small scans keep the finest geometry the LiDAR produced.
        let grid: Float = pos.count > 800_000 ? 0.035 : (pos.count > 400_000 ? 0.025 : 0.02)
        var map: [Int64: Int32] = [:]; map.reserveCapacity(pos.count)
        var remap = [Int32](repeating: 0, count: pos.count)
        var mPos: [simd_float3] = [], mNor: [simd_float3] = []
        for i in 0..<pos.count {
            let p = pos[i]
            let kx = Int64((p.x / grid).rounded()), ky = Int64((p.y / grid).rounded()), kz = Int64((p.z / grid).rounded())
            let key = (kx &* 73_856_093) ^ (ky &* 19_349_663) ^ (kz &* 83_492_791)
            if let j = map[key] { remap[i] = j }
            else {
                let j = Int32(mPos.count)
                map[key] = j; remap[i] = j
                mPos.append(p); mNor.append(nor[i])
            }
        }
        var mTris: [Int32] = []; mTris.reserveCapacity(tris.count)
        var t = 0
        while t < tris.count {
            let a = remap[Int(tris[t])], b = remap[Int(tris[t+1])], c = remap[Int(tris[t+2])]
            if a != b && b != c && a != c { mTris.append(a); mTris.append(b); mTris.append(c) }
            t += 3
        }
        // 3. Bake: one keyframe at a time, best score wins per vertex. The
        // winning frame per vertex is remembered so exposure can be leveled
        // afterwards: auto-exposure drifts as the camera swings past windows,
        // and without leveling the textured mesh reads as patchwork.
        var best = [Float](repeating: 0, count: mPos.count)
        var bestKf = [Int32](repeating: -1, count: mPos.count)
        var col = [UInt8](repeating: 168, count: mPos.count * 3)   // unseen = flat gray
        for (kfIdx, kf) in keyframes.enumerated() {
            autoreleasepool {
                guard let ui = UIImage(contentsOfFile: kf.path), let cg = ui.cgImage else { return }
                let w = cg.width, h = cg.height
                guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8,
                                          bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
                ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
                guard let px = ctx.data else { return }
                let bytes = px.assumingMemoryBound(to: UInt8.self)
                for i in 0..<mPos.count {
                    let p = mPos[i]
                    let toCam = kf.camPos - p
                    let dist2 = simd_length_squared(toCam)
                    if dist2 < 0.04 || dist2 > 36 { continue }
                    let facing = simd_dot(mNor[i], simd_normalize(toCam))
                    if facing < 0.15 { continue }
                    let score = facing / dist2
                    if score <= best[i] { continue }
                    let c4 = kf.inv * simd_float4(p, 1)
                    let zc = -c4.z
                    if zc < 0.05 { continue }
                    let u = Int(kf.cx + kf.fx * c4.x / zc)
                    let v = Int(kf.cy - kf.fy * c4.y / zc)
                    if u < 0 || v < 0 || u >= w || v >= h { continue }
                    let o = (v * w + u) * 4
                    best[i] = score
                    bestKf[i] = Int32(kfIdx)
                    col[i*3] = bytes[o]; col[i*3+1] = bytes[o+1]; col[i*3+2] = bytes[o+2]
                }
            }
        }
        // Exposure leveling: mean luminance of each frame's winning samples
        // vs the global mean; the ratio becomes a per-chart gain the viewer
        // multiplies in. Clamped so a frame of mostly-window never nukes a
        // chart to black or white.
        var lumSum = [Double](repeating: 0, count: keyframes.count)
        var lumN = [Double](repeating: 0, count: keyframes.count)
        for i in 0..<mPos.count where bestKf[i] >= 0 {
            let l = 0.299 * Double(col[i*3]) + 0.587 * Double(col[i*3+1]) + 0.114 * Double(col[i*3+2])
            lumSum[Int(bestKf[i])] += l; lumN[Int(bestKf[i])] += 1
        }
        let gTot = lumSum.reduce(0, +), gN = lumN.reduce(0, +)
        let gMean = gN > 0 ? gTot / gN : 128
        var gains = [Double](repeating: 1, count: keyframes.count)
        for i in 0..<keyframes.count where lumN[i] > 40 {
            gains[i] = min(1.3, max(0.75, gMean / max(1, lumSum[i] / lumN[i])))
        }
        // 4. Binary little-endian PLY with vertex colors.
        var out = Data()
        out.append(("ply\nformat binary_little_endian 1.0\n" +
                    "element vertex \(mPos.count)\n" +
                    "property float x\nproperty float y\nproperty float z\n" +
                    "property uchar red\nproperty uchar green\nproperty uchar blue\n" +
                    "element face \(mTris.count / 3)\n" +
                    "property list uchar int vertex_indices\nend_header\n").data(using: .ascii)!)
        out.reserveCapacity(out.count + mPos.count * 15 + (mTris.count / 3) * 13)
        for i in 0..<mPos.count {
            var x = mPos[i].x, y = mPos[i].y, z = mPos[i].z
            withUnsafeBytes(of: &x) { out.append(contentsOf: $0) }
            withUnsafeBytes(of: &y) { out.append(contentsOf: $0) }
            withUnsafeBytes(of: &z) { out.append(contentsOf: $0) }
            out.append(col[i*3]); out.append(col[i*3+1]); out.append(col[i*3+2])
        }
        var f = 0
        while f < mTris.count {
            out.append(3)
            var a = mTris[f], b = mTris[f+1], c = mTris[f+2]
            withUnsafeBytes(of: &a) { out.append(contentsOf: $0) }
            withUnsafeBytes(of: &b) { out.append(contentsOf: $0) }
            withUnsafeBytes(of: &c) { out.append(contentsOf: $0) }
            f += 3
        }
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let stamp = Int(Date().timeIntervalSince1970 * 1000)
        let url = dir.appendingPathComponent("td_mesh_\(stamp).ply")
        var plyPath: String? = url.path
        do { try out.write(to: url) } catch { plyPath = nil }

        // 5. The photoreal tier: assign each face to the keyframe that saw it
        // best and UV-map its corners into that photo. No atlas repacking:
        // the keyframe JPEGs themselves are the textures, one draw group per
        // frame. Chart seams are visible up close; sharpness everywhere else
        // is the photo's own.
        let nFaces = mTris.count / 3
        var faceKf = [Int](repeating: -1, count: nFaces)
        var faceUv = [Float](repeating: 0, count: nFaces * 6)
        // The GPU budget: 12 MP stills make glorious textures and terrible
        // texture COUNTS, so charts draw from a spaced subset of frames
        // (>=0.6 m or >=30 degrees apart, capped at 32). The viewer also
        // downsizes each chart on load; the full files stay for the record.
        var texSet: [Int] = []
        var lastP: simd_float3? = nil, lastF: simd_float3? = nil
        for (i, kf) in keyframes.enumerated() {
            if let lp = lastP, let lf = lastF,
               simd_distance(kf.camPos, lp) < 0.6 && simd_dot(kf.camFwd, lf) > 0.866 { continue }
            texSet.append(i); lastP = kf.camPos; lastF = kf.camFwd
        }
        if texSet.count > 32 {
            let step = Double(texSet.count) / 32
            texSet = (0..<32).map { texSet[Int(Double($0) * step)] }
        }
        for f in 0..<nFaces {
            let ia = Int(mTris[f*3]), ib = Int(mTris[f*3+1]), ic = Int(mTris[f*3+2])
            let a = mPos[ia], b = mPos[ib], c = mPos[ic]
            let centroid = (a + b + c) / 3
            let fn = simd_normalize(simd_cross(b - a, c - a))
            var bestScore: Float = 0
            for ki in texSet {
                let kf = keyframes[ki]
                let toCam = kf.camPos - centroid
                let dist2 = simd_length_squared(toCam)
                if dist2 < 0.04 || dist2 > 36 { continue }
                let facing = abs(simd_dot(fn, simd_normalize(toCam)))
                if facing < 0.2 { continue }
                let score = facing / dist2
                if score <= bestScore { continue }
                var uvs = [Float](repeating: 0, count: 6)
                var ok = true
                for (vi, p) in [a, b, c].enumerated() {
                    let c4 = kf.inv * simd_float4(p, 1)
                    let zc = -c4.z
                    if zc < 0.05 { ok = false; break }
                    let u = kf.cx + kf.fx * c4.x / zc
                    let v = kf.cy - kf.fy * c4.y / zc
                    if u < 0 || v < 0 || u >= kf.w || v >= kf.h { ok = false; break }
                    uvs[vi*2] = u / kf.w
                    uvs[vi*2+1] = 1 - v / kf.h     // three.js flipY=true: v=1 is the image top
                }
                if !ok { continue }
                bestScore = score
                faceKf[f] = ki
                for i in 0..<6 { faceUv[f*6+i] = uvs[i] }
            }
        }
        // Order faces by keyframe so each texture is one contiguous group.
        var byKf: [Int: [Int]] = [:]
        for f in 0..<nFaces { byKf[faceKf[f], default: []].append(f) }
        var soup = Data(); soup.reserveCapacity(nFaces * 60)
        var groups: [[String: Any]] = []
        var cursor = 0
        var used: Set<String> = []
        let kfKeys = byKf.keys.sorted()
        for ki in kfKeys {
            let faces = byKf[ki]!
            let img = ki >= 0 ? keyframes[ki].path : ""
            if ki >= 0 { used.insert(img) }
            groups.append(["img": img, "start": cursor, "count": faces.count * 3,
                           "gain": ki >= 0 ? gains[ki] : 1.0])
            cursor += faces.count * 3
            for f in faces {
                for corner in 0..<3 {
                    var p = mPos[Int(mTris[f*3+corner])]
                    withUnsafeBytes(of: &p.x) { soup.append(contentsOf: $0) }
                    withUnsafeBytes(of: &p.y) { soup.append(contentsOf: $0) }
                    withUnsafeBytes(of: &p.z) { soup.append(contentsOf: $0) }
                    var u = ki >= 0 ? faceUv[f*6+corner*2] : 0
                    var v = ki >= 0 ? faceUv[f*6+corner*2+1] : 0
                    withUnsafeBytes(of: &u) { soup.append(contentsOf: $0) }
                    withUnsafeBytes(of: &v) { soup.append(contentsOf: $0) }
                }
            }
        }
        var tdmPath: String? = nil
        if let head = try? JSONSerialization.data(withJSONObject: [
            "v": 1, "corners": nFaces * 3, "stride": 20, "groups": groups
        ]) {
            var tdm = Data()
            tdm.append(head)
            tdm.append(0x0A)          // newline ends the JSON header
            tdm.append(soup)
            let turl = dir.appendingPathComponent("td_mesh_\(stamp).tdm")
            do { try tdm.write(to: turl); tdmPath = turl.path } catch { used = [] }
        } else { used = [] }
        return (plyPath, tdmPath, used)
    }
}
#endif
