import Foundation
import Capacitor
import Speech
import AVFoundation

// TradeDesk voice notes, the thin native half.
//
// ON-DEVICE by force: requiresOnDeviceRecognition = true. That is the whole
// point for this app, a contractor is in a basement, a crawlspace, or forty
// miles out with one bar. Apple's server path would fail exactly where the
// note is most needed, and it would ship jobsite audio off the phone. This
// way it costs nothing, needs no signal, and the audio never leaves.
//
// Partial results stream to JS as they are recognised so the text appears
// while the user is still talking; a note that only shows up after you stop
// feels broken even when it is fast.
//
// Dumb by design (CLAUDE.md 3.2): start, stop, report. WHERE the mic lives
// and what happens to the text are JS decisions (js/voice.js).
@objc(TdVoicePlugin)
public class TdVoicePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TdVoicePlugin"
    public let jsName = "TdVoice"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private let engine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var latest = ""

    @objc func available(_ call: CAPPluginCall) {
        let speech = SFSpeechRecognizer.authorizationStatus()
        let mic = AVAudioSession.sharedInstance().recordPermission
        let rec = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer()
        var status = "ask"
        if speech == .denied || speech == .restricted || mic == .denied { status = "denied" }
        else if speech == .authorized && mic == .granted { status = "granted" }
        call.resolve([
            "status": status,
            // supportsOnDeviceRecognition is the gate that decides whether this
            // works with no signal. A device without it is not worth a mic
            // button that silently needs a network.
            "onDevice": rec?.supportsOnDeviceRecognition ?? false,
            "available": rec?.isAvailable ?? false
        ])
    }

    @objc func request(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { speech in
            AVAudioSession.sharedInstance().requestRecordPermission { mic in
                call.resolve(["granted": speech == .authorized && mic])
            }
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
            call.reject("speech not authorized"); return
        }
        DispatchQueue.main.async {
            self.stopEngine()
            self.latest = ""
            let rec = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer()
            guard let rec = rec, rec.isAvailable else { call.reject("recognizer unavailable"); return }
            self.recognizer = rec

            let req = SFSpeechAudioBufferRecognitionRequest()
            req.shouldReportPartialResults = true
            if rec.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
            self.request = req

            do {
                let session = AVAudioSession.sharedInstance()
                // .record with .duckOthers: a note dictated in the truck must
                // not fight the radio or a navigation prompt.
                try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
                try session.setActive(true, options: .notifyOthersOnDeactivation)
            } catch {
                call.reject("audio session: \(error.localizedDescription)"); return
            }

            let input = self.engine.inputNode
            let format = input.outputFormat(forBus: 0)
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                req.append(buffer)
            }
            self.engine.prepare()
            do { try self.engine.start() }
            catch { call.reject("mic: \(error.localizedDescription)"); return }

            self.task = rec.recognitionTask(with: req) { [weak self] result, error in
                guard let self = self else { return }
                if let result = result {
                    self.latest = result.bestTranscription.formattedString
                    self.notifyListeners("partial", data: ["text": self.latest, "final": result.isFinal])
                }
                if error != nil || (result?.isFinal ?? false) {
                    self.stopEngine()
                }
            }
            call.resolve(["started": true])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // Give the recogniser a beat to flush the last words before the
            // text is read: cutting at the instant of release loses the tail
            // of the sentence, which is usually the part that mattered.
            self.request?.endAudio()
            self.engine.inputNode.removeTap(onBus: 0)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                let text = self.latest
                self.stopEngine()
                call.resolve(["text": text])
            }
        }
    }

    private func stopEngine() {
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        task?.cancel(); task = nil
        request = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
