// company-phone-call-tones-v1 (the user, 2026-11-25: 「提示语音用微信同款」): the sounds of a call, made here in code
// (no recording of anyone else's): WeChat's own tones are Tencent's, so these are our own in the same spirit —
//   dialing   the ringback every Chinese phone line plays, 450 Hz, a second on and four off (a telecom standard);
//   ringing   a soft marimba-like phrase of our own, over and over, with the phone buzzing;
//   connected a short rising pair of notes; hung up a short falling pair.
import AVFoundation
import AudioToolbox
import UIKit

@MainActor
final class CallTones {
    static let shared = CallTones()

    private var loop: AVAudioPlayer?
    private var once: AVAudioPlayer?
    private var buzz: Timer?
    private var playing = ""

    private static let rate = 44100

    func dialing() { start("dialing", Self.ringback, loops: true) }

    func ringing() {
        // Before the call is answered nothing else is using the sound: the ringtone goes out of the speaker.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        start("ringing", Self.ringtone, loops: true)
        buzz?.invalidate()
        buzz = Timer.scheduledTimer(withTimeInterval: 1.6, repeats: true) { _ in AudioServicesPlaySystemSound(kSystemSoundID_Vibrate) }
        buzz?.fire()
    }

    func connected() { stop(); play(Self.connectedTone) }

    func ended() { stop(); play(Self.endedTone) }

    func stop() {
        loop?.stop()
        loop = nil
        buzz?.invalidate()
        buzz = nil
        playing = ""
    }

    private func start(_ what: String, _ data: Data, loops: Bool) {
        if playing == what { return }
        stop()
        playing = what
        guard let p = try? AVAudioPlayer(data: data) else { return }
        p.numberOfLoops = loops ? -1 : 0
        p.volume = 0.8
        p.play()
        loop = p
    }

    private func play(_ data: Data) {
        guard let p = try? AVAudioPlayer(data: data) else { return }
        p.volume = 0.7
        p.play()
        once = p
    }

    // MARK: the sounds

    /// 450 Hz, one second on, four off, softened at its edges so it does not click.
    private static let ringback: Data = {
        var s = [Float](repeating: 0, count: rate * 5)
        tone(&s, at: 0, len: 1.0, freq: 450, amp: 0.32, attack: 0.02, release: 0.03)
        return wav(s)
    }()

    /// Our own phrase: E6 G6 C7 · G6 E6 · then a pause, as a mallet on wood (a quick strike, a short ring).
    private static let ringtone: Data = {
        var s = [Float](repeating: 0, count: Int(Double(rate) * 2.6))
        let notes: [(Double, Double)] = [(0.00, 1318.5), (0.16, 1568.0), (0.32, 2093.0), (0.56, 1568.0), (0.72, 1318.5)]
        for (t, f) in notes { mallet(&s, at: t, freq: f, amp: 0.36) }
        return wav(s)
    }()

    private static let connectedTone: Data = {
        var s = [Float](repeating: 0, count: Int(Double(rate) * 0.4))
        mallet(&s, at: 0.0, freq: 1046.5, amp: 0.3)
        mallet(&s, at: 0.11, freq: 1568.0, amp: 0.3)
        return wav(s)
    }()

    private static let endedTone: Data = {
        var s = [Float](repeating: 0, count: Int(Double(rate) * 0.5))
        mallet(&s, at: 0.0, freq: 1174.7, amp: 0.3)
        mallet(&s, at: 0.13, freq: 784.0, amp: 0.3)
        return wav(s)
    }()

    private static func tone(_ s: inout [Float], at t0: Double, len: Double, freq: Double, amp: Float, attack: Double, release: Double) {
        let start = Int(t0 * Double(rate)), n = Int(len * Double(rate))
        for i in 0..<n where start + i < s.count {
            let t = Double(i) / Double(rate)
            let env = min(1, t / attack, (len - t) / release)
            s[start + i] += amp * Float(max(0, env)) * Float(sin(2 * .pi * freq * t))
        }
    }

    /// A mallet note: a fundamental and a softer fourth harmonic, struck and fading fast.
    private static func mallet(_ s: inout [Float], at t0: Double, freq: Double, amp: Float) {
        let start = Int(t0 * Double(rate)), n = Int(0.45 * Double(rate))
        for i in 0..<n where start + i < s.count {
            let t = Double(i) / Double(rate)
            let env = min(1, t / 0.004) * exp(-t * 9)
            let v = sin(2 * .pi * freq * t) + 0.22 * sin(2 * .pi * freq * 4 * t) * exp(-t * 30)
            s[start + i] += amp * Float(env * v)
        }
    }

    private static func wav(_ s: [Float]) -> Data {
        var d = Data()
        func u32(_ v: UInt32) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: UInt16) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 2)) }
        d.append(Data("RIFF".utf8)); u32(UInt32(36 + s.count * 2)); d.append(Data("WAVEfmt ".utf8))
        u32(16); u16(1); u16(1); u32(UInt32(rate)); u32(UInt32(rate * 2)); u16(2); u16(16)
        d.append(Data("data".utf8)); u32(UInt32(s.count * 2))
        let pcm = s.map { Int16(max(-1, min(1, $0)) * 32767) }
        pcm.withUnsafeBufferPointer { d.append(Data(buffer: $0)) }
        return d
    }
}
