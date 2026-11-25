// 助手: the person's own desk on the company server (server/desk_hub.js) — the same agent, chats and artifacts as on
// their computer, in sync with it. The web view loads it from DeskRelay on 127.0.0.1, so the kernel treats it as its
// own loopback page (its settings are saved) and the company certificate is checked in code.
//
// company-phone-layout-v1: the page shows only the conversation (desk/plugins/company-shell, keyed on the TDH-iOS user
// agent); this app draws the rest natively — the title bar, the session list, settings, the artifact list — and drives
// the page through window.tdhPhone. The page posts {type:"state", current, sessions} to the "tdh" handler.
import SwiftUI
import WebKit

struct DeskSession: Identifiable, Equatable {
    let id: String
    let title: String
    let updated: Date?
    let busy: Bool
}

struct DeskArtifact: Identifiable, Equatable, Hashable {
    let id: String
    let title: String
    let kind: String
    let path: String
    let updated: Date?
}

/// A chat this person is in (company-chat-forward-v1), newest first.
struct DeskChat: Identifiable, Equatable {
    var id: String { topic }
    let topic: String
    let name: String
    let group: Bool
    let at: Date?
}

@MainActor
final class DeskModel: ObservableObject {
    @Published var sessions: [DeskSession] = []
    /// company-phone-notices-v1: the AI page in front (set by the tab bar); conversations answered while it was not,
    /// or while another one was open there (a dot on the AI tab and in History); the latest of them, for the banner.
    var aiVisible = false { didSet { if aiVisible { answered.remove(current) } } }
    @Published var answered: Set<String> = []
    @Published var finished: Banner?
    @Published var current = ""
    @Published var ready = false
    @Published var loaded = false
    @Published var failed = ""
    @Published var note = "正在打开你的工作台…"
    /// A short word over everything (已转发、已放进助手…), gone by itself.
    @Published var toast: String?
    /// Files put into the assistant's composer, to go with the next thing said (their names, for the native field).
    @Published var attached: [String] = []
    /// How many messages the open conversation shows (-1 until the page says): 0 is a new, empty one.
    @Published var flowCount = -1
    /// What the kernel lets History's swipe do (company-phone-history-swipe-v1).
    @Published var canArchive = false
    @Published var canRemove = false

    private var opening = false
    private let coordinator = ChatWebView.Coordinator()
    private lazy var messages = DeskMessages { [weak self] body in self?.take(body) }
    lazy var web: WKWebView = makeWeb()

    var currentBusy: Bool { sessions.first(where: { $0.id == current })?.busy ?? false }

    var currentTitle: String {
        if let s = sessions.first(where: { $0.id == current }) { return s.title }
        return "新对话"
    }

    func start(token: String) async {
        if loaded || opening { return }
        opening = true
        defer { opening = false }
        failed = ""
        do {
            let u = try await DeskRelay.shared.start(token: token)
            // The hub starts the kernel if it is not running yet (a minute at most); ask before showing the page, so a
            // refusal says why here instead of an empty page.
            note = "正在打开你的工作台…"
            let (code, j) = try await Net.getJSON("/desk-hub/_hub/status", token: token, timeout: 30)
            if code == 401 || code == 403 {
                failed = (j["hint"] as? String) ?? "这个账号还没开通手机工作台"
                return
            }
            if (j["state"] as? String) != "up" {
                note = "服务器正在启动你的工作台，第一次会慢一点…"
                _ = try? await Net.getJSON("/desk-hub/_hub/warm", token: token, timeout: 30)
                for _ in 0..<60 {
                    try? await Task.sleep(nanoseconds: 2_000_000_000)
                    if let (c, s) = try? await Net.getJSON("/desk-hub/_hub/status", token: token, timeout: 15), c == 200,
                       (s["state"] as? String) == "up" { break }
                }
            }
            web.load(URLRequest(url: u))
            loaded = true
        } catch {
            failed = "工作台没打开：" + ((error as? LocalizedError)?.errorDescription ?? "\(error)")
        }
    }

    private func makeWeb() -> WKWebView {
        let c = WKWebViewConfiguration()
        c.allowsInlineMediaPlayback = true
        c.mediaTypesRequiringUserActionForPlayback = []
        // The company shell's phone layout keys on this (desk/plugins/company-shell, company-phone-layout-v1).
        c.applicationNameForUserAgent = "TDH-iOS/1.0"
        c.userContentController.add(messages, name: "tdh")
        c.userContentController.addUserScript(WKUserScript(source: Self.lookJS, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        let w = WKWebView(frame: .zero, configuration: c)
        w.uiDelegate = coordinator
        w.navigationDelegate = coordinator
        w.allowsBackForwardNavigationGestures = false
        w.isOpaque = false
        w.backgroundColor = .clear
        w.scrollView.contentInsetAdjustmentBehavior = .never
        WebKeyboard.hideAccessoryBar(w)
        return w
    }

    private func take(_ body: Any) {
        guard let m = body as? [String: Any], let type = m["type"] as? String else { return }
        if type == "ready" || (type == "state" && !ready) { setInsets(top: insets.0, bottom: insets.1) }
        if type == "ready" {
            ready = true
            Task {
                let c = await js("return window.tdhPhone && tdhPhone.can ? tdhPhone.can() : {}")
                canArchive = (c["archive"] as? Bool) ?? false
                canRemove = (c["remove"] as? Bool) ?? false
            }
        }
        if type == "flow" { flowCount = (m["count"] as? Int) ?? 0; return }
        #if DEBUG
        if type == "ready", let probe = UserDefaults.standard.string(forKey: "tdhDeskJS"), !probe.isEmpty {
            Task {
                try? await Task.sleep(nanoseconds: UInt64(UserDefaults.standard.double(forKey: "tdhDeskJSWait").clamped(1, 60) * 1e9))
                do {
                    let r = try await web.callAsyncJavaScript(probe, arguments: [:], in: nil, contentWorld: .page)
                    print("DEBUG_DESKJS " + String(describing: r ?? "nil"))
                } catch { print("DEBUG_DESKJS error \(error)") }
            }
        }
        #endif
        if type == "ready" { setDark(dark) }
        guard type == "state" else { return }
        ready = true
        // The page knows the open chat a moment after it opens; until then keep the one this app just asked for.
        if let c = m["current"] as? String, !c.isEmpty { current = c }
        let rows = m["sessions"] as? [[String: Any]] ?? []
        let wasBusy = Set(sessions.filter(\.busy).map(\.id))
        sessions = rows.compactMap { r in
            guard let id = r["id"] as? String, !id.isEmpty else { return nil }
            let ms = (r["updated"] as? NSNumber)?.doubleValue ?? 0
            return DeskSession(id: id, title: r["title"] as? String ?? "未命名会话",
                               updated: ms > 0 ? Date(timeIntervalSince1970: ms / 1000) : nil,
                               busy: r["busy"] as? Bool ?? false)
        }
        // An answer finished: was running, now is not.
        for s in sessions where wasBusy.contains(s.id) && !s.busy {
            if aiVisible && s.id == current { continue }
            answered.insert(s.id)
            finished = Banner(kind: .ai, target: s.id, title: "AI 已回复", body: s.title)
        }
        if aiVisible { answered.remove(current) }
    }

    private func call(_ body: String, _ args: [String: Any] = [:]) {
        Task { _ = try? await web.callAsyncJavaScript(body, arguments: args, in: nil, contentWorld: .page) }
    }

    /// company-phone-dark-v1: the page's own dark palette (body[data-ds-dark-theme]) on this phone only, following the
    /// app; the person's theme setting (the desk on the computer) is left as it is.
    private var dark = false
    func setDark(_ d: Bool) {
        dark = d
        call("window.__tdhDark = d; if (window.__tdhSetDark) window.__tdhSetDark(d)", ["d": d])
    }

    func open(_ id: String) {
        current = id
        if aiVisible { answered.remove(id) }
        call("if (window.tdhPhone) tdhPhone.open(id)", ["id": id])
    }

    func newChat() {
        current = ""
        call("if (window.tdhPhone) tdhPhone.newChat()")
    }

    func showArtifacts() { call("if (window.tdhPhone) tdhPhone.showArtifacts()") }

    func closeArtifacts() { call("if (window.tdhPhone) tdhPhone.closeArtifacts()") }

    /// The page lies under the glass bars; it pads the conversation by their heights.
    private var insets: (CGFloat, CGFloat) = (0, 0)
    func setInsets(top: CGFloat, bottom: CGFloat) {
        insets = (top, bottom)
        call("if (window.tdhPhone && tdhPhone.insets) tdhPhone.insets(t, b)", ["t": Double(top), "b": Double(bottom)])
    }

    /// A past conversation out of History: archived (it can come back on the computer) or deleted.
    func archive(_ id: String) async -> Bool {
        let r = await js("return window.tdhPhone && tdhPhone.archive ? await tdhPhone.archive(i) : {ok:false}", ["i": id])
        return (r["ok"] as? Bool) == true
    }

    func remove(_ id: String) async -> Bool {
        let r = await js("return window.tdhPhone && tdhPhone.remove ? await tdhPhone.remove(i) : {ok:false}", ["i": id])
        return (r["ok"] as? Bool) == true
    }

    /// Says it to the assistant in the open conversation (a new one when none is open), with what is attached.
    func send(_ text: String) async -> Bool {
        let r = await js("""
            if (!window.tdhPhone) return {ok:false, error:'not-ready'};
            const wait = (ms) => new Promise(r => setTimeout(r, ms));
            let put = tdhPhone.ask(t);
            if (!put) { tdhPhone.newChat(); await wait(700); put = tdhPhone.ask(t); }
            if (!put && t) return {ok:false, error:'no-session'};
            for (let i = 0; i < 20; i++) {
                await wait(60);
                const b = document.querySelector("[data-composer-card] button[aria-label='发送消息']");
                if (b && !b.disabled && b.getAttribute('aria-disabled') !== 'true') { b.click(); return {ok:true}; }
            }
            return {ok:false, error:'no-send'};
            """, ["t": text])
        let ok = (r["ok"] as? Bool) == true
        if ok { attached = [] }
        return ok
    }

    func say(_ text: String) {
        withAnimation(.spring(response: 0.45, dampingFraction: 0.8)) { toast = text }
        Task {
            try? await Task.sleep(nanoseconds: 2_600_000_000)
            if toast == text { withAnimation(.spring(response: 0.4, dampingFraction: 0.9)) { toast = nil } }
        }
    }

    private func js(_ body: String, _ args: [String: Any] = [:]) async -> [String: Any] {
        guard ready else { return [:] }
        let got = try? await web.callAsyncJavaScript(body, arguments: args, in: nil, contentWorld: .page)
        return got as? [String: Any] ?? [:]
    }

    /// The artifact's page (HTML) and its title, through the desk (dsh-artifact readArtifact, kept in the page).
    func readArtifact(_ path: String) async -> (title: String, html: String)? {
        let r = await js("return window.tdhPhone ? await tdhPhone.readArtifact(p) : {ok:false}", ["p": path])
        guard (r["ok"] as? Bool) == true, let html = r["content"] as? String else { return nil }
        return (r["title"] as? String ?? "", html)
    }

    func chats() async -> (live: Bool, list: [DeskChat]) {
        let r = await js("return window.tdhPhone ? await tdhPhone.chats() : {live:false, topics:[]}")
        let rows = r["topics"] as? [[String: Any]] ?? []
        let list = rows.compactMap { t -> DeskChat? in
            guard let topic = t["topic"] as? String, let name = t["name"] as? String else { return nil }
            let ms = (t["at"] as? NSNumber)?.doubleValue ?? 0
            return DeskChat(topic: topic, name: name, group: t["group"] as? Bool ?? false, at: ms > 0 ? Date(timeIntervalSince1970: ms / 1000) : nil)
        }
        return (r["live"] as? Bool ?? false, list)
    }

    /// Sends the artifact into the chats as this person. nil when it went; otherwise what to tell.
    func forward(_ path: String, to topics: [String], note: String) async -> (sent: [String], error: String?) {
        let r = await js("return window.tdhPhone ? await tdhPhone.forwardArtifact(p, t, n) : {ok:false, error:'not-ready'}",
                         ["p": path, "t": topics, "n": note])
        let sent = r["sent"] as? [String] ?? []
        if (r["ok"] as? Bool) == true { return (sent, nil) }
        return (sent, r["error"] as? String ?? "没发出去")
    }

    /// A chat file into the chats picked, as this person (the desk's host uploads and posts it).
    func forwardFile(_ f: ChatFile, to topics: [String], note: String) async -> (sent: [String], error: String?) {
        let r = await js("return window.tdhPhone && tdhPhone.forwardFile ? await tdhPhone.forwardFile(n, m, d, t, x) : {ok:false, error:'not-ready'}",
                         ["n": f.name, "m": f.mime, "d": f.data.base64EncodedString(), "t": topics, "x": note])
        let sent = r["sent"] as? [String] ?? []
        if (r["ok"] as? Bool) == true { return (sent, nil) }
        return (sent, r["error"] as? String ?? "没发出去")
    }

    /// A chat file into the assistant's composer as a file card.
    func askFile(_ f: ChatFile) async -> Bool {
        let r = await js("return window.tdhPhone && tdhPhone.askFile ? await tdhPhone.askFile(n, m, d) : {ok:false}",
                         ["n": f.name, "m": f.mime, "d": f.data.base64EncodedString()])
        let ok = (r["ok"] as? Bool) == true
        if ok { attached.append(f.name) }
        return ok
    }

    /// Into the assistant's composer as a file card (then: 「做成 PDF」「这里怎么改」).
    func askArtifact(_ path: String, title: String = "") async -> Bool {
        let r = await js("return window.tdhPhone ? await tdhPhone.askArtifact(p) : {ok:false}", ["p": path])
        let ok = (r["ok"] as? Bool) == true
        if ok { attached.append(title.isEmpty ? (path as NSString).lastPathComponent : title) }
        return ok
    }

    // company-phone-ui-v2: the conversation as the approved prototype draws it — this person's words in light blue on
    // the right, the answers on white cards, the system font — and no composer of the page's own (the app's is native).
    static let lookJS = """
    (function(){var css=[
    "html.cs-phone [data-composer-seat]{display:none!important}",
    "html.cs-phone [data-conversation-scroll]{padding-bottom:calc(var(--tdh-bottom,0px) + 16px)!important}",
    "html.cs-phone [data-chat-flow]{font-family:-apple-system,'PingFang SC',sans-serif!important;font-size:16px;line-height:1.6}",
    "html.cs-phone [data-chat-flow-kind=user] [class*='_actions'],html.cs-phone [data-chat-flow-kind=user] [data-clock]{display:none!important}",
    "html.cs-phone [data-chat-flow-kind=user] [class*='_bubble']{background:rgba(214,226,252,.78)!important;-webkit-backdrop-filter:blur(18px) saturate(1.6);backdrop-filter:blur(18px) saturate(1.6);color:#1c1e24!important;border-radius:18px!important;padding:10px 14px!important;border:.5px solid rgba(255,255,255,.9)!important;box-shadow:0 6px 16px rgba(31,51,89,.08),inset 0 1px 0 rgba(255,255,255,.9)!important}",
    "html.cs-phone [data-chat-flow-kind=assistant-step] [data-slot='conversation.chat.node']>div{background:rgba(255,255,255,.55);-webkit-backdrop-filter:blur(22px) saturate(1.7);backdrop-filter:blur(22px) saturate(1.7);border:.5px solid rgba(255,255,255,.95);border-radius:22px;padding:14px 16px;box-shadow:0 8px 22px rgba(31,51,89,.08),inset 0 1px 0 rgba(255,255,255,.95)}",
    "html.cs-phone [data-chat-flow-kind=assistant-step]{animation:tdh-in .6s cubic-bezier(.2,1.25,.32,1) both}",
    "html.cs-phone [data-chat-flow-kind=user]{animation:tdh-up .55s cubic-bezier(.2,1.3,.32,1) both}",
    "html.cs-phone body[data-ds-dark-theme] [data-chat-flow-kind=user] [class*='_bubble']{background:rgba(51,72,120,.74)!important;color:#eef1f7!important;border-color:rgba(255,255,255,.14)!important;box-shadow:0 6px 16px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.12)!important}",
    "html.cs-phone body[data-ds-dark-theme] [data-chat-flow-kind=assistant-step] [data-slot='conversation.chat.node']>div{background:rgba(38,42,54,.62);border-color:rgba(255,255,255,.12);box-shadow:0 8px 22px rgba(0,0,0,.32),inset 0 1px 0 rgba(255,255,255,.10)}",
    "html.cs-phone body[data-ds-dark-theme] .cs-typing{background:rgba(38,42,54,.62)!important;border-color:rgba(255,255,255,.12)!important;box-shadow:0 6px 16px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.10)!important}",
    "html.cs-phone .cs-typing{background:rgba(255,255,255,.55)!important;-webkit-backdrop-filter:blur(20px) saturate(1.7);border:.5px solid rgba(255,255,255,.95);box-shadow:0 6px 16px rgba(31,51,89,.08),inset 0 1px 0 rgba(255,255,255,.95)!important}",
    "@keyframes tdh-in{from{opacity:0;filter:blur(8px);transform:translateY(10px) scale(.96);transform-origin:top left}to{opacity:1;filter:none;transform:none}}",
    "@keyframes tdh-up{from{opacity:0;filter:blur(8px);transform:translateY(18px) scale(.94);transform-origin:bottom right}to{opacity:1;filter:none;transform:none}}"
    ].join("\\n");var st=document.createElement('style');st.id='tdh-phone-look';st.textContent=css;
    (document.head||document.documentElement).appendChild(st);
    window.__tdhSetDark=function(d){window.__tdhDark=!!d;var b=document.body;if(!b)return;var has=b.hasAttribute('data-ds-dark-theme');
    if(d&&!has)b.setAttribute('data-ds-dark-theme','');if(!d&&has)b.removeAttribute('data-ds-dark-theme');document.documentElement.style.colorScheme=d?'dark':'light';
    if(!window.__tdhDarkMo){window.__tdhDarkMo=new MutationObserver(function(){if(document.body.hasAttribute('data-ds-dark-theme')!==window.__tdhDark)window.__tdhSetDark(window.__tdhDark)});
    window.__tdhDarkMo.observe(b,{attributes:true,attributeFilter:['data-ds-dark-theme']})}};
    if(window.__tdhDark!==undefined)window.__tdhSetDark(window.__tdhDark);
    var lastN=-1,tm=0;function rep(){var n=document.querySelectorAll("[data-chat-flow-kind=user],[data-chat-flow-kind=assistant-step]").length;
    if(n!==lastN){lastN=n;try{webkit.messageHandlers.tdh.postMessage({type:'flow',count:n})}catch(e){}}}
    new MutationObserver(function(){clearTimeout(tm);tm=setTimeout(rep,150)}).observe(document.documentElement,{subtree:true,childList:true});setTimeout(rep,400)})();
    """

    func artifacts() async -> [DeskArtifact] {
        guard ready else { return [] }
        let got = try? await web.callAsyncJavaScript("return window.tdhPhone ? await tdhPhone.artifacts() : []",
                                                     arguments: [:], in: nil, contentWorld: .page)
        let rows = got as? [[String: Any]] ?? []
        return rows.compactMap { r in
            let id = r["id"] as? String ?? ""
            guard !id.isEmpty else { return nil }
            let ms = (r["updated"] as? NSNumber)?.doubleValue ?? 0
            return DeskArtifact(id: id, title: r["title"] as? String ?? id, kind: r["kind"] as? String ?? "",
                                path: r["path"] as? String ?? "",
                                updated: ms > 0 ? Date(timeIntervalSince1970: ms > 1e11 ? ms / 1000 : ms) : nil)
        }
    }
}

#if DEBUG
extension Double { func clamped(_ a: Double, _ b: Double) -> Double { self == 0 ? 10 : Swift.min(Swift.max(self, a), b) } }
#endif

/// The page's messages to the app. A separate object: WKUserContentController keeps its handlers strongly.
final class DeskMessages: NSObject, WKScriptMessageHandler {
    private let onMessage: (Any) -> Void
    init(_ onMessage: @escaping (Any) -> Void) { self.onMessage = onMessage }

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        onMessage(message.body)
    }
}

/// AI: the conversation (the desk's page, answers only), the Today-style composer under it, and above it the gear,
/// the drops with the conversation's title, and 新对话. Past conversations are in History.
struct DeskTab: View {
    @EnvironmentObject var session: Session
    @EnvironmentObject var desk: DeskModel
    @EnvironmentObject var chat: ChatStore
    @Binding var showSettings: Bool
    @State private var showPlus = false

    var body: some View {
        NavigationStack {
            Group {
                if desk.loaded {
                    GeometryReader { g in
                        DeskWebView(web: desk.web)
                            .ignoresSafeArea()
                            .onAppear { desk.setInsets(top: g.safeAreaInsets.top, bottom: g.safeAreaInsets.bottom) }
                            .onChange(of: g.safeAreaInsets) { _, v in desk.setInsets(top: v.top, bottom: v.bottom) }
                            .opacity(desk.ready ? 1 : 0)
                    }
                    .overlay {
                        // A new conversation: a greeting, what it can do, and a few things to tap.
                        if desk.ready && desk.flowCount == 0 && !desk.currentBusy {
                            AIWelcome(name: chat.people[chat.me]?.name ?? "") { text in
                                Task { if !(await desk.send(text)) { desk.say("没发出去，稍后再试") } }
                            }
                            .transition(.opacity.combined(with: .scale(scale: 0.97)))
                        }
                        // Until the page has drawn itself (its first message), the drops and a word, not an empty page.
                        if !desk.ready {
                            // Only the drops (the user, 2026-11-25: 「这我能不能不要中文 只要动态的那个动画就可以」).
                            LavaDots(width: 96, height: 48)
                                .transition(.opacity.combined(with: .scale(scale: 0.92)))
                        }
                    }
                    .animation(.spring(response: 0.5, dampingFraction: 0.85), value: desk.ready)
                    .animation(.spring(response: 0.5, dampingFraction: 0.85), value: desk.flowCount == 0)
                } else if !desk.failed.isEmpty {
                    VStack(spacing: 14) {
                        Text(desk.failed).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        Button("重试") { Task { await open() } }.buttonStyle(.bordered)
                    }.padding()
                } else {
                    LavaDots(width: 96, height: 48)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(DeskBackground())
            .safeAreaInset(edge: .bottom) {
                if desk.ready {
                    PhoneComposer(attached: desk.attached) { text in
                        Task { if !(await desk.send(text)) { desk.say("没发出去，稍后再试") } }
                    } plus: { showPlus = true }
                    .padding(.horizontal, 16).padding(.bottom, 6)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel("设置")
                }
                ToolbarItem(placement: .principal) {
                    // Today's head: its picture in a glass circle, its name on a glass pill tucked under it.
                    VStack(spacing: -8) {
                        // Only while the assistant thinks or answers (the user, 2026-11-25: 「要模型在思考的时候才要那个动态」
                        // 「直接不要他 不是静止」): it rises out of the title, flows, and sinks back when the answer is done.
                        if desk.currentBusy {
                            LavaDots(width: 38, height: 20)
                                .frame(width: 46, height: 46)
                                .glass(Circle())
                                .transition(.scale(scale: 0.4, anchor: .bottom).combined(with: .opacity).combined(with: .offset(y: 14)))
                        }
                        HStack(spacing: 4) {
                            Text(desk.currentTitle).font(.caption.weight(.semibold)).foregroundStyle(Color.ink).lineLimit(1)
                                .contentTransition(.opacity)
                        }
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .frame(maxWidth: 190)
                        .glass(Capsule())
                    }
                    .animation(.spring(response: 0.5, dampingFraction: 0.68), value: desk.currentBusy)
                    .animation(.spring(response: 0.45, dampingFraction: 0.8), value: desk.currentTitle)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) { desk.newChat() } } label: {
                        Image(systemName: "square.and.pencil")
                    }
                    .accessibilityLabel("新对话")
                }
            }
            .sheet(isPresented: $showPlus) {
                PlusSheet { p in Task { await attach(p) } }.environmentObject(desk)
            }
        }
        .task { await open() }
    }

    private func attach(_ p: PlusPick) async {
        let ok: Bool
        switch p {
        case .image(_, let data, let name): ok = await desk.askFile(ChatFile(name: name, mime: "image/jpeg", data: data))
        case .file(let name, let mime, let data): ok = await desk.askFile(ChatFile(name: name, mime: mime, data: data))
        case .doc(let a): ok = await desk.askArtifact(a.path, title: a.title)
        }
        if !ok { desk.say("没放进去，稍后再试") }
    }

    private func open() async {
        guard let p = session.person else { return }
        await desk.start(token: p.gwToken)
    }
}

/// A new, empty conversation (the user, 2026-11-25: 「这个界面画面中心太空了 你看看其他大厂是怎么做的 帮我加点东西 或者介绍
/// 什么的」): as the big assistants do it — a greeting by the time of day and the person's name, one line on what it does,
/// and four things people here ask for, each sent as it is when tapped.
struct AIWelcome: View {
    let name: String
    let ask: (String) -> Void

    private struct Idea: Identifiable {
        let id = UUID()
        let icon: String
        let tint: Color
        let title: String
        let detail: String
        let prompt: String
    }

    private let ideas: [Idea] = [
        .init(icon: "envelope.open", tint: .blue, title: "整理邮件", detail: "挑出要回的，其余归档",
              prompt: "帮我整理今天的邮件，挑出需要我回复的，其余的归档。"),
        .init(icon: "doc.richtext", tint: .red, title: "做报价单", detail: "按模板排版，直接出 PDF",
              prompt: "帮我做一份报价单，排好版后导出成 PDF。需要的信息你先问我。"),
        .init(icon: "chart.bar.xaxis", tint: .green, title: "查车间产量", detail: "本月产量合格率，对比上月",
              prompt: "汇总本月各车间的产量和合格率，和上个月对比一下。"),
        .init(icon: "square.and.pencil", tint: .purple, title: "回复客户", detail: "帮你起草，语气得体",
              prompt: "帮我起草一封给客户的回复邮件，语气正式、要点清楚。内容你先问我。"),
    ]

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        let part = h < 5 ? "夜深了" : h < 11 ? "早上好" : h < 13 ? "中午好" : h < 18 ? "下午好" : "晚上好"
        return name.isEmpty ? part : part + "，" + name
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            VStack(spacing: 8) {
                Text(greeting)
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(Color.ink)
                    .rise(0)
                // The user, 2026-11-25: 「这一页的文案也改一改 不好」: one short question, as the big assistants ask it.
                Text("今天先帮你处理点什么？")
                    .font(.body).foregroundStyle(.secondary)
                    .rise(1)
            }
            .padding(.horizontal, 24)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(Array(ideas.enumerated()), id: \.element.id) { i, idea in
                    Button { ask(idea.prompt) } label: {
                        VStack(alignment: .leading, spacing: 10) {
                            Image(systemName: idea.icon).font(.system(size: 17, weight: .semibold)).foregroundStyle(idea.tint)
                                .frame(width: 34, height: 34)
                                .background(idea.tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(idea.title).font(.subheadline.weight(.semibold)).foregroundStyle(Color.ink)
                                Text(idea.detail).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity, minHeight: 118, alignment: .topLeading)
                        .frosted(RoundedRectangle(cornerRadius: 22, style: .continuous))
                    }
                    .buttonStyle(PressStyle())
                    .rise(i + 2)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 28)
            Spacer(minLength: 0)
            Spacer(minLength: 0)
        }
    }
}

/// The desk page's own sky-to-sand wash, behind the page while it loads and around the bars.
struct DeskBackground: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        // Day: Today's sky to peach. Night (company-phone-dark-v1): the same fall, deep — night blue to a dusk plum.
        LinearGradient(colors: scheme == .dark
                       ? [Color(red: 0.07, green: 0.10, blue: 0.18), Color(red: 0.08, green: 0.09, blue: 0.14),
                          Color(red: 0.16, green: 0.11, blue: 0.13)]
                       : [Color(red: 0.71, green: 0.81, blue: 0.94), Color(red: 0.86, green: 0.89, blue: 0.95),
                          Color(red: 0.96, green: 0.87, blue: 0.78)],
                       startPoint: .top, endPoint: .bottom)
            .ignoresSafeArea()
    }
}

struct DeskWebView: UIViewRepresentable {
    let web: WKWebView

    func makeUIView(context: Context) -> WKWebView { web }

    func updateUIView(_ w: WKWebView, context: Context) {}
}

struct SessionListSheet: View {
    @EnvironmentObject var desk: DeskModel
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var rows: [DeskSession] {
        let q = query.trimmingCharacters(in: .whitespaces)
        return q.isEmpty ? desk.sessions : desk.sessions.filter { $0.title.localizedCaseInsensitiveContains(q) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button { desk.newChat(); dismiss() } label: { Label("新对话", systemImage: "square.and.pencil") }
                }
                Section(query.isEmpty ? "最近" : "搜索结果") {
                    ForEach(rows) { s in
                        Button { desk.open(s.id); dismiss() } label: { SessionRow(s: s, on: s.id == desk.current) }
                            .foregroundStyle(.primary)
                    }
                }
            }
            .overlay {
                if rows.isEmpty {
                    ContentUnavailableView(query.isEmpty ? "还没有会话" : "没找到",
                                           systemImage: query.isEmpty ? "bubble.left" : "magnifyingglass",
                                           description: Text(query.isEmpty ? "点「新对话」开始，电脑上的会话也会出现在这里" : "换个词试试"))
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "搜索会话")
            .navigationTitle("会话")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }.accessibilityLabel("关闭")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

private struct SessionRow: View {
    let s: DeskSession
    let on: Bool

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(s.title).font(.body.weight(on ? .semibold : .regular)).lineLimit(1)
                if let d = s.updated {
                    Text(Self.when.localizedString(for: d, relativeTo: Date())).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            if s.busy {
                Text("进行中").font(.caption2.weight(.medium)).foregroundStyle(.blue)
                    .padding(.horizontal, 7).padding(.vertical, 3).background(.blue.opacity(0.12), in: Capsule())
            }
            if on { Image(systemName: "checkmark").font(.footnote.weight(.semibold)).foregroundStyle(.blue) }
        }
        .contentShape(Rectangle())
    }

    static let when: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.locale = Locale(identifier: "zh_CN")
        f.unitsStyle = .short
        return f
    }()
}
