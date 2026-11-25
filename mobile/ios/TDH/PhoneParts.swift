// company-phone-ui-v2 (the user, 2026-11-25, after the native prototype: 「都对 聊天头像圆形 接数据！」): the parts the
// four pages share — the Today-style composer (「+」 · 按住说话 / typing · keyboard), speech to text for holding to talk,
// the 「+」 sheet, round avatars, the white cards and the press that gives under a finger.
import AVFoundation
import Photos
import PhotosUI
import Speech
import SwiftUI
import UniformTypeIdentifiers

// MARK: glass, cards and presses
// The user, 2026-11-25: 「你特别仔细看一下today的视觉 很多毛玻璃 和光泽细节 你一定一定要给我把这个保留 还有就是非线性的丝滑动态」.
// Today's controls are glass (the background shows through, a fine bright rim, a soft shadow under); its cards are
// frosted panes with a bright top edge; its ink is near-black, not blue; and things arrive on springs, rising out of a
// little blur rather than sliding in straight.

extension Color {
    /// One colour by day, another by night (company-phone-dark-v1, the user 2026-11-25: 「设置里增加一个黑夜模式」).
    static func day(_ d: (CGFloat, CGFloat, CGFloat, CGFloat), night n: (CGFloat, CGFloat, CGFloat, CGFloat)) -> Color {
        Color(UIColor { t in
            let c = t.userInterfaceStyle == .dark ? n : d
            return UIColor(red: c.0, green: c.1, blue: c.2, alpha: c.3)
        })
    }

    /// Today's ink: the selected tab, the icons, the switches, the send button. Near-white by night.
    static let ink = day((0.11, 0.12, 0.14, 1), night: (0.93, 0.94, 0.96, 1))
    /// A surface under words (cards, rows, menus, panes): white by day, a deep slate by night.
    static let paper = day((1, 1, 1, 1), night: (0.17, 0.19, 0.24, 1))
    /// The bright edge of glass: white by day, a faint line by night.
    static let rim = day((1, 1, 1, 1), night: (1, 1, 1, 0.22))
    /// One's own message: a pale sky by day, a deep blue by night.
    static let mine = day((0.82, 0.88, 0.99, 1), night: (0.20, 0.28, 0.46, 1))
    /// A sheet's ground under its cards.
    static let ground = day((0.97, 0.97, 0.99, 1), night: (0.08, 0.09, 0.12, 1))
}

extension View {
    /// A control on glass: iOS 26's Liquid Glass where there is one, else a frosted pane with a bright rim.
    @ViewBuilder func glass<S: Shape>(_ shape: S, tint: Color? = nil, interactive: Bool = false) -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(Self.glassKind(tint, interactive), in: shape)
        } else {
            self.background(.ultraThinMaterial, in: shape)
                .background((tint ?? .white).opacity(tint == nil ? 0.25 : 0.85), in: shape)
                .overlay(shape.stroke(LinearGradient(colors: [Color.rim.opacity(0.95), Color.rim.opacity(0.25)], startPoint: .top, endPoint: .bottom), lineWidth: 0.6))
                .shadow(color: Color(red: 0.12, green: 0.2, blue: 0.35).opacity(0.10), radius: 14, y: 6)
        }
    }

    @available(iOS 26.0, *)
    private static func glassKind(_ tint: Color?, _ interactive: Bool) -> Glass {
        var g = Glass.regular
        if let tint { g = g.tint(tint) }
        if interactive { g = g.interactive() }
        return g
    }

    /// A pane of content (cards, bubbles, lists): frosted, a bright edge on top fading down, a soft shadow.
    func frosted<S: InsettableShape>(_ shape: S, wash: Color = .paper, amount: Double = 0.5) -> some View {
        self.background(wash.opacity(amount), in: shape)
            .background(.ultraThinMaterial, in: shape)
            .overlay(shape.strokeBorder(LinearGradient(colors: [Color.rim.opacity(0.95), Color.rim.opacity(0.3)], startPoint: .top, endPoint: .bottom), lineWidth: 0.6))
            .shadow(color: Color(red: 0.12, green: 0.2, blue: 0.35).opacity(0.08), radius: 16, y: 6)
    }

    /// Rises into place out of a little blur, on a spring, a beat after the one before it (index).
    func rise(_ index: Int = 0) -> some View { modifier(Rise(index: index)) }
}

/// Glass shapes that melt into each other when they meet and pull apart like drops when they part (iOS 26).
struct GlassGroup<Content: View>: View {
    var spacing: CGFloat = 14
    @ViewBuilder var content: Content
    var body: some View {
        if #available(iOS 26.0, *) { GlassEffectContainer(spacing: spacing) { content } } else { content }
    }
}

struct Rise: ViewModifier {
    let index: Int
    @State private var on = false
    func body(content: Content) -> some View {
        content
            .opacity(on ? 1 : 0)
            .blur(radius: on ? 0 : 6)
            .scaleEffect(on ? 1 : 0.96, anchor: .top)
            .offset(y: on ? 0 : 16)
            .onAppear {
                withAnimation(.spring(response: 0.55, dampingFraction: 0.8).delay(Double(min(index, 10)) * 0.04)) { on = true }
            }
    }
}

/// Insertion for a new message: up out of a blur, a touch small, settling on a spring.
struct RiseFx: ViewModifier {
    let on: Bool
    func body(content: Content) -> some View {
        content.opacity(on ? 1 : 0).blur(radius: on ? 0 : 8).scaleEffect(on ? 1 : 0.9, anchor: .bottom).offset(y: on ? 0 : 20)
    }
}

extension AnyTransition {
    static var rise: AnyTransition {
        .asymmetric(insertion: .modifier(active: RiseFx(on: false), identity: RiseFx(on: true)), removal: .opacity)
    }
}

/// A frosted card (Today's cards).
struct PhoneCard<Content: View>: View {
    var padding: CGFloat = 14
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frosted(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}

/// A press that gives under the finger and springs back, like Today's cards.
struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.965 : 1)
            .brightness(configuration.isPressed ? -0.02 : 0)
            .animation(.spring(response: 0.28, dampingFraction: 0.55), value: configuration.isPressed)
    }
}

/// A person's or a group's picture, round; their initials on a colour of their own when there is none.
struct Avatar: View {
    let name: String
    var image: UIImage?
    var size: CGFloat = 50

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                ForwardPicker.color(name)
                Text(ForwardPicker.initial(name))
                    .font(.system(size: size * 0.36, weight: .semibold)).foregroundStyle(.white)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }
}

extension Date {
    /// 刚刚 · 14:02 · 昨天 · 周一 · 11月18日, the way chat lists say it.
    var chatWhen: String {
        let cal = Calendar.current
        let now = Date()
        if now.timeIntervalSince(self) < 60 { return "刚刚" }
        if cal.isDateInToday(self) { return formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits)) }
        if cal.isDateInYesterday(self) { return "昨天" }
        if let d = cal.dateComponents([.day], from: cal.startOfDay(for: self), to: cal.startOfDay(for: now)).day, d < 7 {
            return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][cal.component(.weekday, from: self) - 1]
        }
        let f = DateFormatter()
        f.dateFormat = cal.component(.year, from: self) == cal.component(.year, from: now) ? "M月d日" : "yyyy年M月d日"
        return f.string(from: self)
    }
}

// MARK: holding to talk

/// Speech to text while a finger holds 按住说话 (on the phone where possible), with the voice's loudness for the wave.
@MainActor
final class Dictation: ObservableObject {
    @Published var text = ""
    @Published var level: CGFloat = 0
    @Published var problem = ""

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))
    private var finished: CheckedContinuation<String, Never>?

    func start() async -> Bool {
        problem = ""
        text = ""
        let speech = await withCheckedContinuation { c in SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0) } }
        guard speech == .authorized else { problem = "要在「设置 → TDH」里打开语音识别"; return false }
        guard await AVAudioApplication.requestRecordPermission() else { problem = "要在「设置 → TDH」里打开麦克风"; return false }
        guard let recognizer, recognizer.isAvailable else { problem = "语音识别现在用不了，请打字"; return false }
        #if DEBUG
        print("DICT start auth=\(speech.rawValue) onDevice=\(recognizer.supportsOnDeviceRecognition)")
        #endif
        do {
            let s = AVAudioSession.sharedInstance()
            try s.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker])
            try s.setActive(true, options: .notifyOthersOnDeactivation)
            let req = SFSpeechAudioBufferRecognitionRequest()
            req.shouldReportPartialResults = true
            if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = false }
            request = req
            let input = engine.inputNode
            let fmt = input.outputFormat(forBus: 0)
            #if DEBUG
            print("DICT input format rate=\(fmt.sampleRate) ch=\(fmt.channelCount)")
            #endif
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: fmt) { [weak self] buf, _ in
                req.append(buf)
                guard let ch = buf.floatChannelData?[0] else { return }
                var sum: Float = 0
                for i in 0..<Int(buf.frameLength) { sum += ch[i] * ch[i] }
                let rms = sqrt(sum / Float(max(buf.frameLength, 1)))
                let v = CGFloat(min(1, rms * 12))
                #if DEBUG
                if v > 0.05 { print("DICT level \(String(format: "%.2f", v))") }
                #endif
                Task { @MainActor in self?.level = v }
            }
            engine.prepare()
            try engine.start()
            task = recognizer.recognitionTask(with: req) { [weak self] r, err in
                Task { @MainActor in
                    guard let self else { return }
                    if let r { self.text = r.bestTranscription.formattedString }
                    #if DEBUG
                    print("DICT result text=\(r?.bestTranscription.formattedString ?? "-") final=\(r?.isFinal ?? false) err=\(err.map { "\($0)" } ?? "-")")
                    #endif
                    if let err, self.text.isEmpty {
                        // The recogniser itself failed (no words yet): say so, rather than 「没听清」.
                        self.problem = "语音识别现在用不了，请打字"
                        _ = err
                    }
                    if err != nil || (r?.isFinal ?? false) { self.done() }
                }
            }
            return true
        } catch {
            #if DEBUG
            print("DICT start failed \(error)")
            #endif
            problem = "麦克风没打开"
            stopAudio()
            return false
        }
    }

    /// The words heard, once the recognizer has caught up (two seconds at most).
    func finish() async -> String {
        #if DEBUG
        print("DICT finish task=\(task != nil) text=\(text)")
        #endif
        stopAudio()
        request?.endAudio()
        if task == nil { return text }
        return await withCheckedContinuation { c in
            finished = c
            Task {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                done()
            }
        }
    }

    func cancel() {
        stopAudio()
        task?.cancel()
        task = nil
        request = nil
        text = ""
        finished?.resume(returning: "")
        finished = nil
    }

    private func done() {
        task = nil
        request = nil
        finished?.resume(returning: text)
        finished = nil
    }

    private func stopAudio() {
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        level = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

// MARK: voice messages

/// A voice message as the chat page records one (company-chat-voice-v1): 16 kHz mono 16-bit WAV, at most 60 s, with
/// up to 64 bars of waveform (0…255, base64), so the desks play it and the server writes its words.
@MainActor
final class VoiceRecorder: ObservableObject {
    @Published var level: CGFloat = 0
    @Published var seconds = 0
    @Published var problem = ""
    static let maxSeconds = 60

    private let engine = AVAudioEngine()
    private var samples: [Float] = []
    private var rate: Double = 48000
    private var peaks: [Float] = []
    private var peak: Float = 0
    private var count = 0
    private var began = Date()
    private var tick: Timer?
    var onLimit: (() -> Void)?

    func start() async -> Bool {
        problem = ""
        guard await AVAudioApplication.requestRecordPermission() else { problem = "要在「设置 → TDH」里打开麦克风"; return false }
        do {
            let s = AVAudioSession.sharedInstance()
            try s.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothHFP])
            try s.setActive(true)
            samples = []
            peaks = []
            peak = 0
            count = 0
            let input = engine.inputNode
            let fmt = input.outputFormat(forBus: 0)
            rate = fmt.sampleRate
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 2048, format: fmt) { [weak self] buf, _ in
                guard let ch = buf.floatChannelData?[0] else { return }
                let n = Int(buf.frameLength)
                let chunk = Array(UnsafeBufferPointer(start: ch, count: n))
                Task { @MainActor in self?.take(chunk) }
            }
            engine.prepare()
            try engine.start()
            began = Date()
            seconds = 0
            tick = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self else { return }
                    self.seconds = Int(Date().timeIntervalSince(self.began))
                    if self.seconds >= Self.maxSeconds { self.onLimit?() }
                }
            }
            return true
        } catch {
            problem = "麦克风没打开"
            stopAudio()
            return false
        }
    }

    private func take(_ chunk: [Float]) {
        samples.append(contentsOf: chunk)
        var sum: Float = 0
        for x in chunk {
            sum += x * x
            peak = max(peak, abs(x))
        }
        count += chunk.count
        if Double(count) >= rate / 10 { peaks.append(peak); peak = 0; count = 0 }
        level = CGFloat(min(1, sqrt(sum / Float(max(chunk.count, 1))) * 12))
    }

    /// The recording as WAV, its length in ms and its waveform; nil when it is under a second (too short to send).
    func finish() -> (wav: Data, ms: Int, preview: String)? {
        stopAudio()
        let ms = min(Self.maxSeconds * 1000, Int(Date().timeIntervalSince(began) * 1000))
        guard ms >= 1000, !samples.isEmpty else { problem = "说话时间太短"; return nil }
        return (Self.wav(samples, from: rate, to: 16000), ms, Self.preview(peaks))
    }

    func cancel() { stopAudio(); samples = [] }

    private func stopAudio() {
        tick?.invalidate()
        tick = nil
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        level = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// Float samples at `from` Hz to 16-bit mono WAV at `to` Hz, each output sample the mean of its span (as encodeWav).
    static func wav(_ all: [Float], from: Double, to: Int) -> Data {
        let k = from / Double(to)
        let len = Int(Double(all.count) / k)
        var d = Data(capacity: 44 + len * 2)
        func u32(_ v: UInt32) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: UInt16) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 2)) }
        d.append(Data("RIFF".utf8)); u32(UInt32(36 + len * 2)); d.append(Data("WAVEfmt ".utf8))
        u32(16); u16(1); u16(1); u32(UInt32(to)); u32(UInt32(to * 2)); u16(2); u16(16)
        d.append(Data("data".utf8)); u32(UInt32(len * 2))
        var out = [Int16](repeating: 0, count: len)
        for i in 0..<len {
            let a = Int(Double(i) * k), b = max(a + 1, Int(Double(i + 1) * k))
            var s: Float = 0
            var n = 0
            var j = a
            while j < b && j < all.count { s += all[j]; n += 1; j += 1 }
            let x = max(-1, min(1, n > 0 ? s / Float(n) : 0))
            out[i] = Int16(x < 0 ? x * 32768 : x * 32767)
        }
        out.withUnsafeBufferPointer { d.append(Data(buffer: $0)) }
        return d
    }

    /// Up to 64 bars, 0…255, base64 (voicePeaks).
    static func preview(_ peaks: [Float]) -> String {
        let m = max(0.001, peaks.max() ?? 0)
        let bars = max(1, min(64, peaks.count))
        var out = [UInt8]()
        for i in 0..<bars {
            let a = i * peaks.count / bars, b = max(a + 1, (i + 1) * peaks.count / bars)
            var p: Float = 0
            for j in a..<min(b, peaks.count) { p = max(p, peaks[j]) }
            out.append(UInt8(min(255, (255 * p / m).rounded())))
        }
        return Data(out).base64EncodedString()
    }
}

// MARK: the composer (Today's: + · hold to talk / type · keyboard)

struct PhoneComposer: View {
    var placeholder = "有什么需要我做的？"
    /// What is attached and goes with the next message (names), shown above the field.
    var attached: [String] = []
    var busy = false
    var onSend: (String) -> Void
    var plus: () -> Void
    /// Given, holding records a voice message (the chat, like WeChat) instead of turning speech into text (AI).
    var onVoice: ((Data, Int, String) -> Void)? = nil
    @StateObject private var dictation = Dictation()
    @StateObject private var recorder = VoiceRecorder()
    @State private var typing = false
    @State private var text = ""
    @State private var holding = false
    @State private var cancel = false
    @State private var note = ""
    @FocusState private var focus: Bool

    var body: some View {
        VStack(spacing: 8) {
            if holding {
                HoldWave(cancel: cancel, level: onVoice == nil ? dictation.level : recorder.level,
                         heard: onVoice == nil ? dictation.text : "",
                         seconds: onVoice == nil ? nil : recorder.seconds)
                    .transition(.rise)
            } else if !note.isEmpty {
                Text(note).font(.footnote).foregroundStyle(.secondary)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .glass(Capsule())
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
            GlassGroup(spacing: 16) {
                HStack(alignment: .bottom, spacing: 8) {
                    VStack(alignment: .leading, spacing: 0) {
                        if !attached.isEmpty {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 6) {
                                    ForEach(attached, id: \.self) { n in
                                        Label(n, systemImage: "paperclip").font(.footnote.weight(.medium)).lineLimit(1)
                                            .padding(.horizontal, 10).padding(.vertical, 6)
                                            .background(Color.ink.opacity(0.06), in: Capsule())
                                            .transition(.rise)
                                    }
                                }
                                .padding(.horizontal, 10).padding(.top, 8)
                            }
                            .transition(.opacity.combined(with: .move(edge: .bottom)))
                        }
                        HStack(spacing: 4) {
                            Button { plus() } label: { Image(systemName: "plus").font(.title3).frame(width: 40, height: 40) }
                                .foregroundStyle(Color.ink).accessibilityLabel("添加")
                            ZStack {
                                if typing {
                                    TextField(placeholder, text: $text, axis: .vertical)
                                        .lineLimit(1...5).focused($focus).submitLabel(.send)
                                        .onSubmit { submit() }
                                        .padding(.vertical, 9)
                                        .transition(.blurReplace)
                                } else {
                                    Text(holding ? (cancel ? "松开手指，取消发送" : "松手发送，上滑取消") : "按住说话")
                                        .font(.body.weight(.medium)).foregroundStyle(holding ? Color.secondary : Color.ink)
                                        .frame(maxWidth: .infinity, minHeight: 40)
                                        .contentShape(Rectangle())
                                        .gesture(hold)
                                        .scaleEffect(holding ? 0.97 : 1)
                                        .transition(.blurReplace)
                                }
                            }
                            .frame(maxWidth: .infinity)
                            Button {
                                withAnimation(.spring(response: 0.4, dampingFraction: 0.78)) { typing.toggle() }
                                focus = typing
                            } label: {
                                Image(systemName: typing ? "waveform" : "keyboard")
                                    .font(.title3).frame(width: 40, height: 40).contentTransition(.symbolEffect(.replace))
                            }
                            .foregroundStyle(Color.ink)
                            .accessibilityLabel(typing ? "按住说话" : "打字")
                        }
                        .padding(.horizontal, 6)
                        .frame(minHeight: 52)
                    }
                    .glass(RoundedRectangle(cornerRadius: 26, style: .continuous), interactive: true)
                    if typing && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        // The send button comes out of the field like a drop pulling away (and melts back when emptied).
                        Button { submit() } label: {
                            Image(systemName: "arrow.up").font(.body.weight(.bold)).foregroundStyle(.white)
                                .frame(width: 52, height: 52)
                        }
                        .glass(Circle(), tint: .ink, interactive: true)
                        .transition(.scale(scale: 0.3, anchor: .leading).combined(with: .opacity))
                        .accessibilityLabel("发送")
                    }
                }
            }
        }
        .animation(.spring(response: 0.42, dampingFraction: 0.7), value: text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        .animation(.spring(response: 0.38, dampingFraction: 0.8), value: attached)
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: holding)
        .animation(.easeOut(duration: 0.2), value: note)
    }

    private var hold: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { v in
                if !holding {
                    holding = true
                    cancel = false
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    Task {
                        if onVoice != nil {
                            recorder.onLimit = { release(drop: false) }
                            if !(await recorder.start()) { holding = false; say(recorder.problem) }
                        } else if !(await dictation.start()) {
                            holding = false
                            say(dictation.problem)
                        }
                    }
                }
                let c = v.translation.height < -60
                if c != cancel { cancel = c; UISelectionFeedbackGenerator().selectionChanged() }
            }
            .onEnded { _ in release(drop: cancel) }
    }

    private func release(drop: Bool) {
        guard holding else { return }
        holding = false
        cancel = false
        if let onVoice {
            if drop { recorder.cancel(); return }
            if let got = recorder.finish() {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                onVoice(got.wav, got.ms, got.preview)
            } else { say(recorder.problem) }
            return
        }
        Task {
            if drop { dictation.cancel(); return }
            let heard = await dictation.finish().trimmingCharacters(in: .whitespacesAndNewlines)
            if heard.isEmpty { say(dictation.problem.isEmpty ? "没听清，再说一次" : dictation.problem) } else { onSend(heard) }
        }
    }

    private func say(_ s: String) {
        guard !s.isEmpty else { return }
        note = s
        Task {
            try? await Task.sleep(nanoseconds: 2_400_000_000)
            if note == s { note = "" }
        }
    }

    private func submit() {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty || !attached.isEmpty else { return }
        text = ""
        onSend(t)
    }
}

/// Holding to talk: the voice as a wave above the field (red once the finger has slid up to cancel), and the words
/// as they are heard.
private struct HoldWave: View {
    var cancel: Bool
    var level: CGFloat
    var heard: String
    /// Recording a voice message: how long so far.
    var seconds: Int? = nil

    var body: some View {
        VStack(spacing: 10) {
            if let seconds, !cancel {
                Text(String(format: "%d:%02d", seconds / 60, seconds % 60) + (seconds >= VoiceRecorder.maxSeconds - 10 ? "  还能说 \(VoiceRecorder.maxSeconds - seconds) 秒" : ""))
                    .font(.subheadline.monospacedDigit().weight(.medium)).foregroundStyle(Color.ink)
                    .contentTransition(.numericText())
            }
            if !heard.isEmpty && !cancel {
                Text(heard).font(.subheadline).lineLimit(3).multilineTextAlignment(.center).padding(.horizontal, 16)
            }
            TimelineView(.animation) { tl in
                let t = tl.date.timeIntervalSinceReferenceDate
                HStack(spacing: 3) {
                    ForEach(0..<28, id: \.self) { i in
                        let wob = abs(sin(t * 5 + Double(i) * 0.55)) * (0.5 + 0.5 * sin(Double(i) * 0.9))
                        Capsule().fill(cancel ? Color.red.opacity(0.7) : Color.ink.opacity(0.7))
                            .frame(width: 3, height: 5 + (8 + 26 * level) * wob)
                    }
                }
                .frame(height: 36)
            }
            Text(cancel ? "松开手指，取消发送" : "松手发送，上滑取消").font(.footnote).foregroundStyle(cancel ? .red : .secondary)
        }
        .padding(.vertical, 16).frame(maxWidth: .infinity)
        .glass(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}

// MARK: the 「+」 sheet

enum PlusPick {
    case image(UIImage, Data, String)
    case file(String, String, Data)
    case doc(DeskArtifact)
}

/// 「+」: the latest photos to tap, the camera, all photos, a file, or one of the Docs.
struct PlusSheet: View {
    @EnvironmentObject var desk: DeskModel
    @Environment(\.dismiss) private var dismiss
    var withDocs = true
    let picked: (PlusPick) -> Void
    @State private var recent: [PHAsset] = []
    @State private var thumbs: [String: UIImage] = [:]
    @State private var allPhotos: PhotosPickerItem?
    @State private var showAll = false
    @State private var camera = false
    @State private var files = false
    @State private var docs = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        if UIImagePickerController.isSourceTypeAvailable(.camera) {
                            Button { camera = true } label: {
                                Image(systemName: "camera").font(.title2).frame(width: 84, height: 84)
                                    .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                            }
                            .foregroundStyle(.primary).accessibilityLabel("拍照")
                        }
                        ForEach(recent, id: \.localIdentifier) { a in
                            Button { Task { await take(a) } } label: {
                                ZStack {
                                    RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.secondary.opacity(0.1))
                                    if let img = thumbs[a.localIdentifier] {
                                        Image(uiImage: img).resizable().scaledToFill()
                                    }
                                }
                                .frame(width: 84, height: 84)
                                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                            }
                            .buttonStyle(PressStyle())
                        }
                        if recent.isEmpty {
                            Button { showAll = true } label: {
                                VStack(spacing: 6) { Image(systemName: "photo.on.rectangle").font(.title2); Text("照片").font(.caption) }
                                    .frame(width: 84, height: 84)
                                    .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                            }
                            .foregroundStyle(.primary)
                        }
                    }
                    .padding(.horizontal, 16)
                }
                VStack(spacing: 0) {
                    row("folder", "上传文件") { files = true }
                    if withDocs {
                        Divider().padding(.leading, 52)
                        row("doc.text", "选一个文档", "从 Docs") { docs = true }
                    }
                }
                .background(Color.paper, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .padding(.horizontal, 16)
                Spacer()
            }
            .padding(.top, 4)
            .background(Color.ground)
            .navigationTitle("添加到对话")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }.accessibilityLabel("关闭")
                }
                ToolbarItem(placement: .topBarTrailing) { Button("全部照片") { showAll = true } }
            }
            .photosPicker(isPresented: $showAll, selection: $allPhotos, matching: .images)
            .onChange(of: allPhotos) { _, it in
                guard let it else { return }
                Task {
                    if let d = try? await it.loadTransferable(type: Data.self), let img = UIImage(data: d) {
                        give(.image(img, Self.jpeg(img), Self.photoName()))
                    }
                }
            }
            .fullScreenCover(isPresented: $camera) {
                CameraPicker { img in give(.image(img, Self.jpeg(img), Self.photoName())) }.ignoresSafeArea()
            }
            .fileImporter(isPresented: $files, allowedContentTypes: [.item]) { r in
                guard case .success(let u) = r else { return }
                let ok = u.startAccessingSecurityScopedResource()
                defer { if ok { u.stopAccessingSecurityScopedResource() } }
                guard let d = try? Data(contentsOf: u) else { return }
                let mime = UTType(filenameExtension: u.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                give(.file(u.lastPathComponent, mime, d))
            }
            .sheet(isPresented: $docs) {
                DocPickSheet { a in docs = false; give(.doc(a)) }.environmentObject(desk)
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task { await loadRecent() }
    }

    private func give(_ p: PlusPick) {
        dismiss()
        picked(p)
    }

    private func row(_ icon: String, _ title: String, _ value: String? = nil, _ act: @escaping () -> Void) -> some View {
        Button(action: act) {
            HStack(spacing: 14) {
                Image(systemName: icon).font(.title3).frame(width: 24)
                Text(title)
                Spacer()
                if let value { Text(value).foregroundStyle(.secondary) }
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 16).frame(height: 52).contentShape(Rectangle())
        }
        .foregroundStyle(.primary)
    }

    private func loadRecent() async {
        let st = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        guard st == .authorized || st == .limited else { return }
        let o = PHFetchOptions()
        o.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        o.fetchLimit = 12
        var l: [PHAsset] = []
        // Right after the person allows it the library can still answer empty for a moment: ask again briefly.
        for attempt in 0..<6 {
            l = []
            PHAsset.fetchAssets(with: .image, options: o).enumerateObjects { a, _, _ in l.append(a) }
            if !l.isEmpty || attempt == 5 { break }
            try? await Task.sleep(nanoseconds: 400_000_000)
        }
        withAnimation(.spring(response: 0.45, dampingFraction: 0.8)) { recent = l }
        for a in l {
            let opt = PHImageRequestOptions()
            opt.deliveryMode = .opportunistic
            opt.isNetworkAccessAllowed = true
            PHImageManager.default().requestImage(for: a, targetSize: CGSize(width: 252, height: 252), contentMode: .aspectFill, options: opt) { img, _ in
                if let img { Task { @MainActor in thumbs[a.localIdentifier] = img } }
            }
        }
    }

    private func take(_ a: PHAsset) async {
        let opt = PHImageRequestOptions()
        opt.deliveryMode = .highQualityFormat
        opt.isNetworkAccessAllowed = true
        let img: UIImage? = await withCheckedContinuation { c in
            PHImageManager.default().requestImage(for: a, targetSize: CGSize(width: 2048, height: 2048), contentMode: .aspectFit, options: opt) { img, info in
                if (info?[PHImageResultIsDegradedKey] as? Bool) == true { return }
                c.resume(returning: img)
            }
        }
        if let img { give(.image(img, Self.jpeg(img), Self.photoName())) }
    }

    static func jpeg(_ img: UIImage) -> Data {
        let maxSide: CGFloat = 2048
        let s = min(1, maxSide / max(img.size.width, img.size.height, 1))
        guard s < 1 else { return img.jpegData(compressionQuality: 0.85) ?? Data() }
        let size = CGSize(width: img.size.width * s, height: img.size.height * s)
        let f = UIGraphicsImageRendererFormat()
        f.scale = 1
        return UIGraphicsImageRenderer(size: size, format: f).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
            .jpegData(compressionQuality: 0.85) ?? Data()
    }

    static func photoName() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyyMMdd-HHmmss"
        return "照片-" + f.string(from: Date()) + ".jpg"
    }
}

/// One of the Docs, for the 「+」 sheet.
private struct DocPickSheet: View {
    @EnvironmentObject var desk: DeskModel
    @Environment(\.dismiss) private var dismiss
    let picked: (DeskArtifact) -> Void
    @State private var rows: [DeskArtifact] = []
    @State private var loading = true

    var body: some View {
        NavigationStack {
            List(rows) { a in
                Button { picked(a) } label: {
                    HStack(spacing: 12) {
                        DocIcon(a: a, size: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(a.title).lineLimit(1)
                            if let d = a.updated { Text(d.chatWhen).font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                }
                .foregroundStyle(.primary)
            }
            .overlay {
                if loading { LavaDots() } else if rows.isEmpty { ContentUnavailableView("还没有文档", systemImage: "doc.text") }
            }
            .navigationTitle("选一个文档")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button { dismiss() } label: { Image(systemName: "xmark") } } }
        }
        .task { rows = await desk.artifacts(); loading = false }
    }
}

/// A document's kind as a tinted symbol.
struct DocIcon: View {
    let a: DeskArtifact
    var size: CGFloat = 44

    var body: some View {
        let (sym, color) = Self.look(a)
        Image(systemName: sym).font(.system(size: size * 0.45)).foregroundStyle(color)
            .frame(width: size, height: size)
            .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: size * 0.27, style: .continuous))
    }

    static func look(_ a: DeskArtifact) -> (String, Color) {
        let t = (a.title + " " + a.kind + " " + a.path).lowercased()
        if t.contains("pdf") || t.contains("报价") { return ("doc.richtext", .red) }
        if t.contains("xls") || t.contains("csv") || t.contains("sheet") || t.contains("表") || t.contains("预算") { return ("tablecells", .green) }
        if t.contains("chart") || t.contains("产量") || t.contains("统计") || t.contains("简报") || t.contains("看板") { return ("chart.bar.xaxis", .blue) }
        if t.contains("ppt") || t.contains("slide") { return ("rectangle.on.rectangle", .orange) }
        return ("doc.text", .purple)
    }
}

// MARK: - company-phone-swipe-v1: one left swipe for every list (the user, 2026-11-25: 「参考这样做就行了 左滑 所有都这样做就行了
// 渐变一点」, WeChat's list as the reference): the row slides, flat blocks of its own height sit under it at the right,
// words only, each block a soft gradient of its colour. One row open at a time; a spring, and a rubber band past the end.

struct SwipeAction {
    enum Tone { case sky, rose }
    let title: String
    let tone: Tone
    let act: () -> Void

    init(title: String, tone: Tone, act: @escaping () -> Void) {
        self.title = title
        self.tone = tone
        self.act = act
    }

    /// The tone's two ends, light then deep: the app's own colours, not WeChat's (the user: 「不一定要参考微信的橙色和红色」).
    var ends: (Color, Color) {
        switch tone {
        case .sky: (Color(red: 0.66, green: 0.78, blue: 0.98), Color(red: 0.46, green: 0.58, blue: 0.90))
        case .rose: (Color(red: 0.95, green: 0.64, blue: 0.72), Color(red: 0.88, green: 0.42, blue: 0.52))
        }
    }
}

struct SwipeRow<Content: View>: View {
    static var spring: Animation { .spring(response: 0.38, dampingFraction: 0.82) }

    let id: String
    @Binding var open: String?
    let actions: [SwipeAction]
    @ViewBuilder let content: Content

    // The row is its own sideways scroll (the system's own nesting of sideways in up-and-down, its own feel and bounce),
    // the blocks after it, and it rests either shut or fully open.
    @State private var isOpen = false
    // One look on every page (the user: 「形态一致 风格一致 配色一致」): each action a tile of the same size and corners,
    // glossy, light at its left and deep at its right, centred in the row with a little air between tiles; an ordinary
    // action sky, a deleting one rose.
    private let w: CGFloat = 76
    private let h: CGFloat = 40
    private let gap: CGFloat = 6
    private let radius: CGFloat = 14
    private var full: CGFloat { CGFloat(actions.count) * (w + gap) + 10 }

    var body: some View {
        if actions.isEmpty {
            content
        } else {
            ScrollViewReader { proxy in
                ScrollView(.horizontal) {
                    HStack(spacing: 0) {
                        content.containerRelativeFrame(.horizontal).id(0)
                            .onGeometryChange(for: Bool.self) { $0.frame(in: .scrollView).minX < -full / 2 } action: { o in
                                isOpen = o
                                if o && open != id {
                                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                    open = id
                                } else if !o && open == id {
                                    open = nil
                                }
                            }
                        HStack(spacing: gap) {
                            ForEach(Array(actions.enumerated()), id: \.offset) { _, a in
                                block(a) { withAnimation(Self.spring) { proxy.scrollTo(0, anchor: .leading) } }
                            }
                        }
                        .padding(.leading, gap)
                        .padding(.trailing, 10)
                        .frame(maxHeight: .infinity)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    .scrollTargetLayout()
                }
                .scrollIndicators(.hidden)
                .scrollTargetBehavior(SwipeSnap(full: full))
                .onChange(of: open) { _, o in
                    if o != id && isOpen { withAnimation(Self.spring) { proxy.scrollTo(0, anchor: .leading) } }
                }
            }
        }
    }

    private func block(_ a: SwipeAction, close: @escaping () -> Void) -> some View {
        Button {
            close()
            a.act()
        } label: {
            let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
            Text(a.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                .shadow(color: a.ends.1.opacity(0.35), radius: 2, y: 1)
                .lineLimit(1).fixedSize()
                .frame(width: w, height: h)
                .background(LinearGradient(colors: [a.ends.0, a.ends.1], startPoint: .leading, endPoint: .trailing), in: shape)
                .overlay(LinearGradient(colors: [.white.opacity(0.30), .white.opacity(0)], startPoint: .top, endPoint: .center).clipShape(shape))
                .overlay(shape.strokeBorder(.white.opacity(0.35), lineWidth: 0.5))
                .contentShape(shape)
        }
        .buttonStyle(.plain)
    }
}

/// Shut or fully open, whichever the finger was heading for.
private struct SwipeSnap: ScrollTargetBehavior {
    let full: CGFloat
    func updateTarget(_ target: inout ScrollTarget, context: TargetContext) {
        target.rect.origin.x = target.rect.minX > full / 2 ? full : 0
    }
}

extension View {
    /// A scroll closes an open swipe row (iOS 18 and later; before that the next touch does).
    @ViewBuilder func closesSwipe(_ open: Binding<String?>) -> some View {
        if #available(iOS 18.0, *) {
            onScrollPhaseChange { _, p in
                if p != .idle && open.wrappedValue != nil { withAnimation(SwipeRow<EmptyView>.spring) { open.wrappedValue = nil } }
            }
        } else {
            self
        }
    }
}

/// The test build's mark (the user, 2026-11-25: 「版本记得是Beta版 注明一下 在开机页的时候」「首页logo也要说明」): a small
/// glass capsule under the drops of the opening and sign-in pages. Off (and the plain icon back,
/// mobile/ios/icon-release-1024.png) for the App Store.
struct BetaBadge: View {
    static let on = true

    var body: some View {
        if Self.on {
            Text("Beta")
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .tracking(0.6)
                .foregroundStyle(Color.ink.opacity(0.7))
                .padding(.horizontal, 10).padding(.vertical, 4)
                .background(Color.paper.opacity(0.55), in: Capsule())
                .overlay(Capsule().strokeBorder(Color.rim.opacity(0.8), lineWidth: 0.5))
        }
    }
}
