// company-phone-call-v1 (the user, 2026-11-25: 「手机聊天要有语音和通话功能！」): one-to-one voice calls on the phone, the
// same calls as the desks' (company-chat-call-v1): Tinode's own signalling, the sound straight between the two ends
// (WebRTC), and while it lasts each side's microphone in pieces to the server, which writes the call's minutes into the
// chat afterwards (server/chat_call.py).
//
// The call itself runs in the company chat page (the desks' page, server/chat/tdh-web/app.js), loaded unseen from this
// phone's ChatRelay — which already passes the pieces on (/tdh/call) with this person's token. The page offers its
// call functions on window.__tdhChat.fn and tells every change of its call (S.call) to the "tdhcall" handler
// (ChatRelay's boot script). What is seen is this app's own call screen.
import AudioToolbox
import AVFoundation
import SwiftUI
import WebKit

@MainActor
final class CallCenter: ObservableObject {
    struct Call: Equatable {
        var topic = ""
        var dir = ""        // out | in
        var state = ""      // dialing | ringing | connecting | live | ended
        var started: Double = 0
        var muted = false
        var tx = false
        var peerRinging = false
        var why = ""
    }

    @Published var call: Call?
    @Published var ready = false
    @Published var speaker = false

    private var loading = false
    private lazy var handler = FileMessages { [weak self] body in self?.take(body) }
    private let coordinator = ChatWebView.Coordinator()

    lazy var web: WKWebView = {
        let c = WKWebViewConfiguration()
        c.allowsInlineMediaPlayback = true
        c.mediaTypesRequiringUserActionForPlayback = []
        c.userContentController.add(handler, name: "tdhcall")
        let w = WKWebView(frame: CGRect(x: 0, y: 0, width: 2, height: 2), configuration: c)
        w.uiDelegate = coordinator
        w.navigationDelegate = coordinator
        w.isOpaque = false
        return w
    }()

    func start(login: String, gwToken: String) async {
        if loading { return }
        loading = true
        guard let url = try? await ChatRelay.shared.start(login: login, gwToken: gwToken) else { loading = false; return }
        web.load(URLRequest(url: url))
    }

    private func take(_ body: Any) {
        guard let s = body as? String, let d = s.data(using: .utf8),
              let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return }
        if !((j["me"] as? String) ?? "").isEmpty {
            #if DEBUG
            if !ready { print("DEBUG_CALL ready") }
            #endif
            ready = true
        }
        #if DEBUG
        print("DEBUG_CALL state " + s)
        #endif
        guard let c = j["call"] as? [String: Any] else {
            setCall(nil)
            return
        }
        var n = Call()
        n.topic = c["topic"] as? String ?? ""
        n.dir = c["dir"] as? String ?? (call?.dir ?? "")
        n.state = c["state"] as? String ?? ""
        n.started = (c["started"] as? NSNumber)?.doubleValue ?? 0
        n.muted = c["muted"] as? Bool ?? false
        n.tx = c["tx"] as? Bool ?? false
        n.peerRinging = c["ringing"] as? Bool ?? false
        n.why = c["why"] as? String ?? ""
        setCall(n)
    }

    private func setCall(_ n: Call?) {
        let was = call
        withAnimation(.spring(response: 0.5, dampingFraction: 0.85)) { call = n }
        // The call's sounds (company-phone-call-tones-v1): ringback while it rings at the other end, our ringtone and the
        // buzz while it rings here, a note when it connects, another when it ends.
        let ringing = n?.dir == "in" && n?.state == "ringing"
        let dialing = n?.dir == "out" && n?.state == "dialing"
        if ringing { CallTones.shared.ringing() }
        else if dialing { CallTones.shared.dialing() }
        else if was?.state != "live" && n?.state == "live" { CallTones.shared.connected(); UINotificationFeedbackGenerator().notificationOccurred(.success) }
        else if was != nil && was?.state != "ended" && (n == nil || n?.state == "ended") { CallTones.shared.ended() }
        else if n?.state != "dialing" && n?.state != "ringing" { CallTones.shared.stop() }
        if n == nil || n?.state == "ended" { speaker = false }
    }

    private func js(_ body: String, _ args: [String: Any] = [:]) async -> Any? {
        try? await web.callAsyncJavaScript(body, arguments: args, in: nil, contentWorld: .page)
    }

    /// Calls the person of a one-to-one chat (usr… topic). false when it could not start.
    func dial(_ topic: String) async -> Bool {
        guard ready else { return false }
        // The call's first message goes into the chat, so the page must be in it (as a desk is when its call button is
        // pressed): open it there and wait until it is attached.
        let r = await js("""
            const c = window.__tdhChat; if (!c) return 'no-page';
            c.open(t);
            for (let i = 0; i < 60; i++) {
                const tp = c.client.getTopic(t);
                if (tp && tp.isSubscribed()) break;
                await new Promise(r => setTimeout(r, 100));
            }
            const tp = c.client.getTopic(t);
            if (!tp || !tp.isSubscribed()) return 'not-attached';
            try { return (await c.fn.callStart(t)) ? 'ok' : 'failed'; } catch (e) { return 'error: ' + e; }
            """, ["t": topic])
        #if DEBUG
        print("DEBUG_CALL dial result \(String(describing: r))")
        #endif
        return (r as? String) == "ok"
    }

    func accept() { Task { _ = await js("const c = window.__tdhChat; if (c) await c.fn.callAccept();") } }

    func hangup() {
        Task { _ = await js("const c = window.__tdhChat; if (c) c.fn.callHangup(c.S.call && c.S.call.state === 'ringing' && c.S.call.dir === 'in' ? '已拒绝' : '');") }
    }

    func mute() { Task { _ = await js("const c = window.__tdhChat; if (c) c.fn.callMute();") } }

    func toggleSpeaker() {
        speaker.toggle()
        try? AVAudioSession.sharedInstance().overrideOutputAudioPort(speaker ? .speaker : .none)
    }
}

/// The page that carries the calls, in the window but not seen (a web view outside one stops its sound and microphone).
struct CallHost: UIViewRepresentable {
    let web: WKWebView
    func makeUIView(context: Context) -> WKWebView { web }
    func updateUIView(_ w: WKWebView, context: Context) {}
}

/// The call, full screen, Today's way: the person large on glass, rings that breathe while it rings, the time once
/// connected, and round glass buttons.
struct CallScreen: View {
    @EnvironmentObject var calls: CallCenter
    @EnvironmentObject var chat: ChatStore
    let call: CallCenter.Call

    private var peer: ChatTopic? { chat.topics.first { $0.topic == call.topic } }
    private var name: String { peer?.name ?? "同事" }
    private var waiting: Bool { call.state == "dialing" || call.state == "ringing" }

    var body: some View {
        ZStack {
            DeskBackground()
            Avatar(name: name, image: peer?.photo, size: 420)
                .blur(radius: 90).opacity(0.45).ignoresSafeArea()
            VStack(spacing: 0) {
                if call.tx && call.state == "live" {
                    Label("本通话将转写，挂断后生成纪要", systemImage: "text.bubble")
                        .font(.footnote.weight(.medium)).foregroundStyle(Color.ink)
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .glass(Capsule())
                        .transition(.rise)
                        .padding(.top, 12)
                }
                Spacer()
                ZStack {
                    if waiting {
                        ForEach(0..<3, id: \.self) { i in
                            Circle().stroke(Color.white.opacity(0.6), lineWidth: 1.2)
                                .frame(width: 150, height: 150)
                                .phaseAnimator([false, true]) { v, on in
                                    v.scaleEffect(on ? 1.9 : 1).opacity(on ? 0 : 0.8)
                                } animation: { _ in .easeOut(duration: 2.4).delay(Double(i) * 0.8) }
                        }
                    }
                    Avatar(name: name, image: peer?.photo, size: 132)
                        .padding(6)
                        .glass(Circle())
                }
                .frame(height: 260)
                Text(name).font(.system(size: 30, weight: .bold)).foregroundStyle(Color.ink).padding(.top, 8)
                status.padding(.top, 8)
                Spacer()
                buttons.padding(.bottom, 40)
            }
            .padding(.horizontal, 24)
        }
        .animation(.spring(response: 0.5, dampingFraction: 0.8), value: call)
    }

    @ViewBuilder private var status: some View {
        switch call.state {
        case "live":
            TimelineView(.periodic(from: .now, by: 1)) { tl in
                let secs = call.started > 0 ? Int(tl.date.timeIntervalSince1970 - call.started / 1000) : 0
                Text(String(format: "%d:%02d", max(0, secs) / 60, max(0, secs) % 60))
                    .font(.title3.monospacedDigit()).foregroundStyle(.secondary)
                    .contentTransition(.numericText())
            }
        case "ended":
            Text(call.why.isEmpty ? "通话结束" : call.why).font(.title3).foregroundStyle(.secondary)
        default:
            Text(call.dir == "in" ? (call.state == "ringing" ? "邀请你语音通话" : "正在接通…")
                 : call.state == "connecting" ? "正在接通…" : call.peerRinging ? "对方响铃中…" : "正在呼叫…")
                .font(.title3).foregroundStyle(.secondary)
                .phaseAnimator([0.55, 1]) { v, o in v.opacity(o) } animation: { _ in .easeInOut(duration: 1.1) }
        }
    }

    @ViewBuilder private var buttons: some View {
        if call.state == "ended" {
            Color.clear.frame(height: 96)
        } else if call.dir == "in" && call.state == "ringing" {
            HStack {
                round("phone.down.fill", "拒绝", tint: .red) { calls.hangup() }
                Spacer()
                round("phone.fill", "接听", tint: .green) { calls.accept() }
            }
            .padding(.horizontal, 30)
        } else {
            GlassGroup(spacing: 30) {
                HStack {
                    round(call.muted ? "mic.slash.fill" : "mic.fill", call.muted ? "已静音" : "静音", on: call.muted) { calls.mute() }
                    Spacer()
                    round("phone.down.fill", "挂断", tint: .red) { calls.hangup() }
                    Spacer()
                    round(calls.speaker ? "speaker.wave.3.fill" : "speaker.wave.2", "免提", on: calls.speaker) { calls.toggleSpeaker() }
                }
            }
        }
    }

    private func round(_ icon: String, _ label: String, tint: Color? = nil, on: Bool = false, _ act: @escaping () -> Void) -> some View {
        VStack(spacing: 8) {
            Button {
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                act()
            } label: {
                Image(systemName: icon).font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(tint != nil || on ? Color.white : Color.ink)
                    .frame(width: 72, height: 72)
                    .contentTransition(.symbolEffect(.replace))
            }
            .glass(Circle(), tint: tint ?? (on ? Color.ink : nil), interactive: true)
            .buttonStyle(PressStyle())
            Text(label).font(.footnote).foregroundStyle(Color.ink)
        }
    }
}
