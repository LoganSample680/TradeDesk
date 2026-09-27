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
//
// ONE SESSION AT A TIME, BY NUMBER (2026-09-27). Every start is a new
// generation. A recognition task that was replaced still calls back after it
// is cancelled (with an error, or a late final), and before this it ran
// stopEngine on the NEW session and cut the man off mid-sentence. Now every
// callback carries the generation it was started under and anything that is
// not the current one is dropped on the floor.
//
// And when the current task really ends (final result, error, the one minute
// limit), the plugin says so once: an "ended" event with the words and the
// generation. It never restarts itself: whether to listen again is a JS
// decision (js/voice.js), so it can change without a build.
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
    let sessions = TdVoiceSessions()

    // The request, configured. Split out so the settings are testable without
    // a microphone: partials on, punctuation on where the OS has it (iOS 16),
    // on-device when the recogniser can.
    static func makeRequest(onDevice: Bool) -> SFSpeechAudioBufferRecognitionRequest {
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if onDevice { req.requiresOnDeviceRecognition = true }
        if #available(iOS 16, *) { req.addsPunctuation = true }
        return req
    }

    // What the "ended" event carries. Static and pure for the same reason.
    static func endedPayload(text: String, gen: Int, reason: String) -> [String: Any] {
        return ["text": text, "gen": gen, "reason": reason]
    }

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
            "available": rec?.isAvailable ?? false,
            // What this build reports. js/voice.js reads "ended" here to know
            // it can restart on the event instead of guessing from silence.
            "events": ["partial", "ended"]
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
            // The new generation first, so the old task's cancel callback
            // (fired by stopEngine below) is already stale when it lands.
            let gen = self.sessions.begin()
            self.stopEngine()
            self.latest = ""
            let rec = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer()
            guard let rec = rec, rec.isAvailable else { call.reject("recognizer unavailable"); return }
            self.recognizer = rec

            let req = TdVoicePlugin.makeRequest(onDevice: rec.supportsOnDeviceRecognition)
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
                let text = result?.bestTranscription.formattedString
                let isFinal = result?.isFinal ?? false
                let failed = error != nil
                // Hopped to main so it is ordered with start and stop, which
                // is where the generation moves.
                DispatchQueue.main.async {
                    guard let self = self, self.sessions.isCurrent(gen) else { return }
                    if let text = text {
                        self.latest = text
                        self.notifyListeners("partial", data: ["text": text, "final": isFinal, "gen": gen])
                    }
                    if failed || isFinal {
                        if self.sessions.claimEnd(gen) {
                            self.notifyListeners("ended", data: TdVoicePlugin.endedPayload(
                                text: self.latest, gen: gen, reason: failed ? "error" : "final"))
                        }
                        self.stopEngine()
                    }
                }
            }
            call.resolve(["started": true, "gen": gen])
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
                // Nothing from this task is reported after a stop.
                self.sessions.invalidate()
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

// The generation book. Pure, main-queue only, and separate from the plugin so
// the rule (only the current session speaks, and it says "ended" once) is
// tested without a microphone or a permission prompt.
final class TdVoiceSessions {
    private(set) var current = 0
    private var lastEnded = 0

    // A new session. Everything numbered before it is stale from now on.
    @discardableResult
    func begin() -> Int { current += 1; return current }

    // No session is current (a stop): late callbacks from the last one drop.
    func invalidate() { current += 1 }

    func isCurrent(_ gen: Int) -> Bool { return gen > 0 && gen == current }

    // True exactly once, and only for the current session.
    func claimEnd(_ gen: Int) -> Bool {
        guard isCurrent(gen), gen > lastEnded else { return false }
        lastEnded = gen
        return true
    }
}
