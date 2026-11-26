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
    @Published var sessions: [DeskSession] = [] {
        didSet { if !sessions.isEmpty && !cacheKey.isEmpty { saveCache() } }
    }
    private var cacheKey = ""

    /// The last list of conversations, shown at once at the next start (the user, 2026-11-26: 「历史对话载入有延迟」);
    /// the desk's own list replaces it as soon as its page is up.
    func prime(login: String) {
        cacheKey = "tdhSessions." + login
        guard sessions.isEmpty, let rows = UserDefaults.standard.array(forKey: cacheKey) as? [[String: Any]] else { return }
        sessions = rows.compactMap { r in
            guard let id = r["id"] as? String else { return nil }
            let t = (r["u"] as? Double) ?? 0
            return DeskSession(id: id, title: r["t"] as? String ?? "未命名会话", updated: t > 0 ? Date(timeIntervalSince1970: t) : nil, busy: false)
        }
    }

    private func saveCache() {
        let rows: [[String: Any]] = sessions.prefix(80).map { ["id": $0.id, "t": $0.title, "u": $0.updated?.timeIntervalSince1970 ?? 0] }
        UserDefaults.standard.set(rows, forKey: cacheKey)
    }
    /// company-phone-notices-v1: the AI page in front (set by the tab bar); conversations answered while it was not,
    /// or while another one was open there (a dot on the AI tab and in History); the latest of them, for the banner.
    var aiVisible = false { didSet { if aiVisible { answered.remove(current) } } }
    @Published var answered: Set<String> = []
    @Published var finished: Banner?
    @Published var current = "" { didSet { settleWelcome() } }
    @Published var ready = false { didSet { if ready && !oldValue { readyAt = Date() }; settleWelcome() } }
    /// The greeting and its four cards over an empty conversation. Kept here, not in the tab's view (the user,
    /// 2026-11-26: 「新窗口闪烁…解决不了吗」): the tab's view is made anew at every switch of tabs, and a state kept in
    /// it started from "hidden" each time — the cards went and came back. It follows "empty and nothing on its way"
    /// only once that has held a moment (the page redraws itself now and then), and leaves at once when something
    /// is sent or a conversation is opened.
    @Published var welcome = false
    private var welcomeTask: Task<Void, Never>?
    private var wantWelcome: Bool { ready && flowCount == 0 && !currentBusy && !sending && !saidHere }
    /// Something was sent in the conversation now open: the greeting never comes back over it, whatever the page
    /// counts (the user's screenshot, 2026-11-26: the four cards over the messages just sent, the page's live
    /// connection gone and its count at nothing).
    private var saidHere = false { didSet { settleWelcome() } }
    private func settleWelcome() {
        let want = wantWelcome
        welcomeTask?.cancel()
        welcomeTask = nil
        if want == welcome { return }
        if !want && (sending || flowCount < 0) { welcome = false; return }
        welcomeTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: want ? 120_000_000 : 600_000_000)
            guard let self, !Task.isCancelled, self.wantWelcome == want else { return }
            self.welcome = want
        }
    }
    /// A message on its way: the welcome goes at once, not when the page shows the message (「感觉是卡了一样」).
    @Published var sending = false { didSet { settleWelcome() } }
    /// Each start of the app opens on a new conversation (the user, 2026-11-26), not on the one left last time.
    private var freshStart = true
    /// Thinking before its answer begins (the drops under the conversation; gone when the words come).
    @Published var thinking = false
    /// Where the page keeps the room for them (its hidden 「正在回答」), in the web view's points.
    @Published var thinkingAt: CGRect = .zero
    @Published var loaded = false
    @Published var failed = ""
    @Published var note = "正在打开你的工作台…"
    /// A short word over everything (已转发、已放进助手…), gone by itself.
    @Published var toast: String?
    /// Files put into the assistant's composer, to go with the next thing said (their names, for the native field).
    @Published var attached: [String] = []
    /// How many messages the open conversation shows (-1 until the page says): 0 is a new, empty one.
    @Published var flowCount = -1 { didSet { settleWelcome() } }
    /// What the kernel lets History's swipe do (company-phone-history-swipe-v1).
    @Published var canArchive = false
    @Published var canRemove = false

    private var opening = false
    private let coordinator = ChatWebView.Coordinator()
    /// The last thing that went wrong opening the page (company-phone-diag-v1), shown if it never becomes ready.
    private var lastError = ""
    private var diagToken = ""
    private lazy var messages = DeskMessages { [weak self] body in self?.take(body) }
    lazy var web: WKWebView = makeWeb()

    var currentBusy: Bool { sessions.first(where: { $0.id == current })?.busy ?? false }

    var currentTitle: String {
        if let s = sessions.first(where: { $0.id == current }), !s.title.hasPrefix("_"), s.title != "新会话" { return s.title }
        return "新对话"
    }

    func start(token: String) async {
        if loaded || opening { return }
        opening = true
        defer { opening = false }
        failed = ""
        lastError = ""
        diagToken = token
        coordinator.onFail = { [weak self] why in Task { @MainActor in self?.problem(why) } }
        DeskRelay.shared.onError = { [weak self] why in Task { @MainActor in self?.problem(why) } }
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
                       (s["state"] as? String) == "up" { boot = s["boot"] as? String ?? ""; break }
                }
            } else { boot = j["boot"] as? String ?? "" }
            DeskRelay.shared.expectStream()
            web.load(URLRequest(url: u))
            loaded = true
            watchReady()
            startHealing()
        } catch {
            failed = "工作台没打开：" + ((error as? LocalizedError)?.errorDescription ?? "\(error)")
        }
    }

    // MARK: staying usable (company-phone-heal-v1)
    //
    // The user, 2026-11-26: 「我又无法在手机端新建对话了」「别反复出同样的问题了」. Two things take the page's ground away
    // without the page knowing: iOS closes this app's local relay while the app is in the background (every request of
    // the page then fails, 「Load failed」), and the server starts the person's kernel anew (the page belongs to the old
    // one). Both are asked for, not assumed — when the app comes to the front, every 20 s while it is there, and before
    // anything is sent — and answered the same way: the relay back on its port, the page loaded again, the open
    // conversation kept.

    /// Which start of the kernel the page was loaded from (the hub's status "boot").
    private var boot = ""
    private var healing = false
    private var healLoop: Task<Void, Never>?

    private func startHealing() {
        guard healLoop == nil else { return }
        healLoop = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 20_000_000_000)
                guard let self else { return }
                if UIApplication.shared.applicationState == .active { await self.heal(full: true) }
            }
        }
    }

    /// full: also asks the server whether the kernel is the one this page came from.
    func heal(full: Bool) async {
        guard loaded, !healing else { return }
        healing = true
        defer { healing = false }
        var again = await DeskRelay.shared.revive()
        if again { report("heal: relay was gone") }
        let stream = DeskRelay.shared.liveStream
        let ask = "/desk-hub/_hub/status" + (stream.map { "?stream=" + $0.id } ?? "")
        if full, !diagToken.isEmpty,
           let (c, j) = try? await Net.getJSON(ask, token: diagToken, timeout: 8), c == 200 {
            // The live connection the page has is not open on the server any more (dropped on the way without a word):
            // ended here too, so the page gets a new one below.
            if let stream, Date().timeIntervalSince(stream.since) > 10, (j["stream"] as? Bool) == false,
               DeskRelay.shared.liveStream?.id == stream.id {
                DeskRelay.shared.dropStreams()
                report("heal: live stream was dead")
            }
            if (j["state"] as? String) != "up" {
                _ = try? await Net.getJSON("/desk-hub/_hub/warm", token: diagToken, timeout: 20)
                for _ in 0..<30 {
                    try? await Task.sleep(nanoseconds: 2_000_000_000)
                    if let (c2, s) = try? await Net.getJSON("/desk-hub/_hub/status", token: diagToken, timeout: 10), c2 == 200,
                       (s["state"] as? String) == "up" { boot = s["boot"] as? String ?? ""; break }
                }
                again = true
                report("heal: kernel was down")
            } else if let b = j["boot"] as? String, !b.isEmpty {
                if !boot.isEmpty && b != boot { again = true; report("heal: kernel started anew") }
                boot = b
            }
        }
        if !again, streamMissing() { again = true; report("heal: live stream was gone") }
        if again { reloadPage() }
    }

    /// The page is up and has had no live connection for a while (iOS closed it in the background, the network
    /// dropped it): nothing the assistant says would reach it. The page opens another by itself within a second
    /// (measured 0.6 s, once the relay stopped holding its side-panel socket unanswered); this is for when it has
    /// not. Not asked again within 30 s of the last reload.
    private func streamMissing() -> Bool {
        #if DEBUG
        if UserDefaults.standard.bool(forKey: "tdhNoStreamReload") { return false }
        #endif
        guard loaded, ready, Date().timeIntervalSince(readyAt) > 6, Date().timeIntervalSince(streamReloadAt) > 30,
              Date().timeIntervalSince(frontAt) > 4,
              let gone = DeskRelay.shared.streamGoneSince, Date().timeIntervalSince(gone) > 3 else { return false }
        streamReloadAt = Date()
        return true
    }
    #if DEBUG
    private static var dropped = false
    static func clock() -> String { String(format: "%.1f", Date().timeIntervalSince1970.truncatingRemainder(dividingBy: 1000)) }
    #endif
    private var readyAt = Date()
    /// When the app last came to the front: the page opens its own live connection again within a second of that
    /// (and of any drop); it is loaded again only when it has not.
    var frontAt = Date()
    private var streamReloadAt = Date.distantPast

    /// The page again from the relay, the open conversation kept (a new one stays a new one).
    private func reloadPage() {
        #if DEBUG
        print("DEBUG_STREAM reload at \(Self.clock())")
        #endif
        DeskRelay.shared.expectStream()
        ready = false
        thinking = false
        sending = false
        if current.isEmpty { freshStart = true } else { pendingOpen = (current, nil) }
        web.load(URLRequest(url: URL(string: "http://127.0.0.1:\(DeskRelay.shared.port)/")!))
        watchReady()
    }

    /// The relay asked before the page is told anything; true when the page had to be loaded again (what was asked
    /// for is then done by the page's "ready").
    private func relayGone() async -> Bool {
        guard loaded else { return false }
        if await DeskRelay.shared.revive() { report("heal: relay was gone") }
        else if streamMissing() { report("heal: live stream was gone") }
        else { return false }
        reloadPage()
        return true
    }

    /// company-phone-diag-v1 (the user's phone, 2026-11-26: the drops for minutes, nothing reached the server): the page
    /// gets 40 s to say it is ready; otherwise the tab says so with the reason and 重试, and the server's log gets the
    /// reason (who, where, what went wrong: no words of anyone's).
    private func watchReady() {
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 40_000_000_000)
            guard loaded, !ready else { return }
            report("desk not ready in 40 s; " + (lastError.isEmpty ? "no error seen" : lastError))
            web.stopLoading()
            loaded = false
            failed = "工作台没打开，点重试再试一次" + (lastError.isEmpty ? "" : "\n（" + String(lastError.prefix(80)) + "）")
        }
    }

    private func problem(_ why: String) {
        lastError = why
        report(why)
    }

    private var reported = 0
    private func report(_ what: String) {
        guard !diagToken.isEmpty, reported < 20 else { return }
        reported += 1
        let tok = diagToken
        Task.detached {
            _ = try? await Net.postJSON("/company/ext/chat/diag", ["where": "desk", "what": String(what.prefix(400))], token: tok, timeout: 10)
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
        // Only the conversation inside the page scrolls. The page itself stays put: left to move, a drag was shared
        // between the two (the user, 2026-11-26: 「往上滑很丝滑 往下滑就会卡住」).
        w.scrollView.isScrollEnabled = false
        w.scrollView.bounces = false
        // The bars float over the page with no band of their own colour (the user, 2026-11-26: 「顶部有一节是颜色匹配不上的」).
        // The top keeps iOS's soft edge (words scrolling under the title fade there, 2026-11-26: 「回答问题跟对话框标题重叠了」);
        // the page's background is the app's now, so it no longer shows as a band of another colour.
        if #available(iOS 26.0, *) { w.scrollView.topEdgeEffect.style = .soft; w.scrollView.bottomEdgeEffect.isHidden = true }
        WebKeyboard.hideAccessoryBar(w)
        return w
    }

    private func take(_ body: Any) {
        guard let m = body as? [String: Any], let type = m["type"] as? String else { return }
        if type == "ready" || (type == "state" && !ready) { setInsets(top: insets.0, bottom: insets.1) }
        if type == "ready" {
            #if DEBUG
            print("DEBUG_STREAM page ready at \(Self.clock()), live=\(DeskRelay.shared.liveStream != nil)")
            #endif
            ready = true
            if freshStart && pendingOpen == nil { freshStart = false; newChat() }
            freshStart = false
            sendPendingOpen()
            Task {
                let c = await js("return window.tdhPhone && tdhPhone.can ? tdhPhone.can() : {}")
                canArchive = (c["archive"] as? Bool) ?? false
                canRemove = (c["remove"] as? Bool) ?? false
            }
        }
        if type == "flow" { flowCount = (m["count"] as? Int) ?? 0; if flowCount > 0 { sending = false }; return }
        if type == "copy" {
            UIPasteboard.general.string = m["text"] as? String ?? ""
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            return
        }
        // The page's own 「正在回答」 bubble (hidden): there while it thinks, gone once the answer's words begin.
        if type == "thinking" {
            thinking = (m["on"] as? Bool) ?? false
            if thinking, let x = (m["x"] as? NSNumber)?.doubleValue, let y = (m["y"] as? NSNumber)?.doubleValue {
                thinkingAt = CGRect(x: x, y: y, width: (m["w"] as? NSNumber)?.doubleValue ?? 56, height: (m["h"] as? NSNumber)?.doubleValue ?? 28)
            }
            return
        }
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
        #if DEBUG
        // Proofs only: the live connection ended as iOS ends it (-tdhDropStreams seconds, once).
        if type == "ready", UserDefaults.standard.double(forKey: "tdhDropStreams") > 0, !Self.dropped {
            Self.dropped = true
            Task {
                try? await Task.sleep(nanoseconds: UInt64(UserDefaults.standard.double(forKey: "tdhDropStreams") * 1e9))
                print("DEBUG_STREAM dropping at \(Self.clock()), live=\(DeskRelay.shared.liveStream?.id ?? "none")")
                DeskRelay.shared.dropStreams()
            }
        }
        #endif
        if type == "ready" { setDark(dark) }
        guard type == "state" else { return }
        if !ready { ready = true; sendPendingOpen() }
        // The page knows the open chat a moment after it opens; until then (or 10 s after asking) keep the one this app
        // asked for — a notification tapped before the page was up must not lose to the page's last open chat.
        if let c = m["current"] as? String, !c.isEmpty {
            if let p = pendingOpen, c == p.id || (p.asked.map { Date().timeIntervalSince($0) > 10 } ?? false) { pendingOpen = nil }
            if pendingOpen == nil { current = c }
        }
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

    /// A conversation the app asked the page to open: sent once the page is up, kept as current until the page says so.
    private var pendingOpen: (id: String, asked: Date?)?

    func open(_ id: String) {
        if id != current { attached = []; artifactRefs = []; flowCount = -1; saidHere = false }
        current = id
        if aiVisible { answered.remove(id) }
        pendingOpen = (id, nil)
        Task { @MainActor in
            if await relayGone() { return }
            if ready { sendPendingOpen() }
        }
    }

    private func sendPendingOpen() {
        guard let p = pendingOpen else { return }
        pendingOpen = (p.id, Date())
        call("if (window.tdhPhone) tdhPhone.open(id)", ["id": p.id])
    }

    func newChat() {
        pendingOpen = nil
        current = ""
        saidHere = false
        // What was attached belonged to the conversation left behind.
        attached = []
        artifactRefs = []
        Task { @MainActor in
            if await relayGone() { return }
            call("if (window.tdhPhone) tdhPhone.newChat()")
        }
    }

    func showArtifacts() { call("if (window.tdhPhone) tdhPhone.showArtifacts()") }

    func closeArtifacts() { call("if (window.tdhPhone) tdhPhone.closeArtifacts()") }

    /// The page lies under the glass bars; it pads the conversation by their heights.
    private var insets: (CGFloat, CGFloat) = (0, 0)
    func setInsets(top: CGFloat, bottom: CGFloat) {
        insets = (top, bottom)
        // While the assistant works, room under the last answer for the thinking drops (DeskTab).
        call("if (window.tdhPhone && tdhPhone.insets) tdhPhone.insets(t, b)", ["t": Double(top), "b": Double(bottom)])
    }

    static let thinkingRoom: CGFloat = 40


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
        sending = true
        // The page must be reachable before it is asked: a relay that went while the app was away is brought back and
        // the page waited for (up to 20 s), instead of 「没发出去」.
        if await relayGone() {
            for _ in 0..<66 { if ready { break }; try? await Task.sleep(nanoseconds: 300_000_000) }
            try? await Task.sleep(nanoseconds: 600_000_000)
        }
        // Artifacts said by their place in the workspace, which the assistant reads with its own tools (the user,
        // 2026-11-26: 「AI看不到我关联的工件」 — as a file card an HTML page did not reach it).
        let refs = artifactRefs.map { Self.mention($0.path) }.filter { !$0.isEmpty }
        let full = refs.isEmpty ? text : (refs.joined(separator: " ") + "\n" + text)
        let r = await js("""
            if (!window.tdhPhone) return {ok:false, error:'not-ready'};
            const wait = (ms) => new Promise(r => setTimeout(r, ms));
            const cards = () => [...document.querySelectorAll("[data-composer-card] button")].some(x => (x.getAttribute('aria-label') || '').startsWith('移除文件'));
            let put = tdhPhone.ask(t);
            if (!put && cards()) {
                for (let i = 0; i < 5 && !put; i++) { await wait(400); put = tdhPhone.ask(t); }
                if (!put) return {ok:false, error:'ask-failed-with-files'};
            }
            if (!put) { tdhPhone.newChat(); await wait(700); put = tdhPhone.ask(t); }
            if (!put && t) return {ok:false, error:'no-session'};
            for (let i = 0; i < 20; i++) {
                await wait(60);
                const b = document.querySelector("[data-composer-card] button[aria-label='发送消息']");
                if (b && !b.disabled && b.getAttribute('aria-disabled') !== 'true') { b.click(); return {ok:true}; }
            }
            return {ok:false, error:'no-send'};
            """, ["t": full])
        let ok = (r["ok"] as? Bool) == true
        if ok {
            // Until the page shows the message (flow > 0), at most 8 s.
            Task { @MainActor in try? await Task.sleep(nanoseconds: 8_000_000_000); self.sending = false }
        } else { sending = false }
        if ok { attached = []; artifactRefs = []; saidHere = true } else { report("send: " + (r["error"] as? String ?? "?")) }
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
        guard ready else { return ["ok": false, "error": "not-ready"] }
        do {
            let got = try await web.callAsyncJavaScript(body, arguments: args, in: nil, contentWorld: .page)
            return got as? [String: Any] ?? ["ok": false, "error": "no-answer"]
        } catch {
            // A script that failed said nothing before (company-phone-diag-v1): now its reason goes with it.
            return ["ok": false, "error": "js: " + (error as NSError).description]
        }
    }

    /// An attached file out of the composer again (the user, 2026-11-26: 「这个工件无法撤销」): the page's own
    /// 「移除文件 <name>」 button on its file card.
    func detach(_ name: String) async {
        if artifactRefs.contains(where: { $0.title == name }) {
            artifactRefs.removeAll { $0.title == name }
            attached.removeAll { $0 == name }
            return
        }
        let r = await js("""
            const b = [...document.querySelectorAll("[data-composer-card] button")]
                .find(x => (x.getAttribute('aria-label') || '').startsWith('移除文件') && (x.getAttribute('aria-label') || '').includes(n));
            if (!b) return {ok:false, error:'no-card'};
            b.click();
            return {ok:true};
            """, ["n": name])
        if (r["ok"] as? Bool) == true || (r["error"] as? String) == "no-card" { attached.removeAll { $0 == name } }
        if (r["ok"] as? Bool) != true { report("detach: " + (r["error"] as? String ?? "?")) }
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

    /// Something handed to the assistant from elsewhere (an artifact, a chat's file) starts a conversation of its own
    /// (the user, 2026-11-26: 「关联的工件 还是关联聊天记录里的文件 都默认开新窗口」); more of them before sending join it.
    private func freshFor(_ fresh: Bool) async {
        guard fresh, attached.isEmpty else { return }
        newChat()
        try? await Task.sleep(nanoseconds: 900_000_000)
    }

    /// A chat file into the assistant's composer as a file card.
    func askFile(_ f: ChatFile, fresh: Bool = false) async -> Bool {
        await freshFor(fresh)
        if !f.mime.hasPrefix("image/"), f.data.count > 12 * 1024 * 1024 {
            say("这个文件超过 12MB，手机上暂时交不了 AI，请在电脑上拖进对话")
            return false
        }
        if !f.mime.hasPrefix("image/"), !diagToken.isEmpty {
            let got = try? await Net.postJSON("/company/ext/chat/stash", ["name": f.name, "data": f.data.base64EncodedString()],
                                              token: diagToken, timeout: 60)
            if let rel = got?.1["rel"] as? String, (got?.1["ok"] as? Bool) == true {
                artifactRefs.append((title: f.name, path: rel))
                attached.append(f.name)
                return true
            }
            report("stash: " + String(describing: got?.1["error"] ?? "no-answer"))
            return false
        }
        let r = await js("return window.tdhPhone && tdhPhone.askFile ? await tdhPhone.askFile(n, m, d) : {ok:false}",
                         ["n": f.name, "m": f.mime, "d": f.data.base64EncodedString()])
        let ok = (r["ok"] as? Bool) == true
        if ok { attached.append(f.name) }
        return ok
    }

    /// Into the assistant's composer as a file card (then: 「做成 PDF」「这里怎么改」).
    func askArtifact(_ path: String, title: String = "", fresh: Bool = false) async -> Bool {
        await freshFor(fresh)
        let name = title.isEmpty ? (path as NSString).lastPathComponent : title
        guard !artifactRefs.contains(where: { $0.path == path }) else { return true }
        artifactRefs.append((title: name, path: path))
        attached.append(name)
        return true
    }

    /// Artifacts and files to go with the next message, by their place in the workspace (artifacts/…, inbox/…).
    private var artifactRefs: [(title: String, path: String)] = []

    /// The desk's mention of a workspace file (company-shell deskFileMention): @rel, or @"rel" with spaces. An
    /// artifact's full path becomes artifacts/<name>, relative to the workspace, as the desk writes it.
    static func mention(_ path: String) -> String {
        var rel = path.replacingOccurrences(of: "\\", with: "/")
        if let r = rel.range(of: "/artifacts/", options: .backwards) { rel = "artifacts/" + rel[r.upperBound...] }
        guard !rel.isEmpty, rel.rangeOfCharacter(from: CharacterSet(charactersIn: "\"")) == nil else { return "" }
        return rel.contains(" ") ? "@\"" + rel + "\"" : "@" + rel
    }

    // company-phone-ui-v2: the conversation as the approved prototype draws it — this person's words in light blue on
    // the right, the answers on white cards, the system font — and no composer of the page's own (the app's is native).
    static let lookJS = """
    (function(){var css=[
    "html.cs-phone [data-composer-seat]{display:none!important}",
    "html.cs-phone .cs-typing{display:block!important;visibility:hidden!important;width:56px;height:28px;margin:6px 0 0 0;padding:0!important;background:none!important;border:0!important;box-shadow:none!important}",
    "html.cs-phone,html.cs-phone body,html.cs-phone #root,html.cs-phone #app,html.cs-phone [class*='_frame'],html.cs-phone [data-dsh-center-col],html.cs-phone [data-conversation-scroll],html.cs-phone main{background:transparent!important;background-image:none!important}",
    "html.cs-phone .tdh-copy{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;background:none;color:inherit;border-radius:8px;cursor:pointer}",
    "html.cs-phone .tdh-copy:active{background:rgba(127,127,127,.18)}",
    "html.cs-phone [data-chat-flow-kind=user] .tdh-copy-row{justify-content:flex-end}",
    "html.cs-phone .tdh-copy-row{display:flex;align-items:center;gap:10px;margin-top:6px;font-size:12px;color:rgba(28,30,36,.45)}",
    "html.cs-phone body[data-ds-dark-theme] .tdh-copy-row{color:rgba(238,241,247,.45)}",
    "html.cs-phone [data-conversation-scroll]{padding-bottom:calc(var(--tdh-bottom,0px) + 16px)!important}",
    "html.cs-phone [data-chat-flow]{font-family:-apple-system,'PingFang SC',sans-serif!important;font-size:16px;line-height:1.6}",
    "html.cs-phone [data-chat-flow-kind=user] [class*='_actions'],html.cs-phone [data-chat-flow-kind=user] [data-clock]{display:none!important}",
    "html.cs-phone [data-chat-flow-kind=assistant-step] [data-slot='conversation.chat.node']>div{background:none!important;border:0!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;padding:0 2px!important}",
    "html.cs-phone [data-chat-flow-kind=assistant-step]{animation:tdh-in .22s ease-out both}",
    "html.cs-phone [data-chat-flow-kind=user]{animation:tdh-up .3s cubic-bezier(.2,.8,.2,1) both}",
    "@keyframes tdh-in{from{opacity:0}to{opacity:1}}",
    "@keyframes tdh-up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}"
    ].join("\\n");var st=document.createElement('style');st.id='tdh-phone-look';st.textContent=css;
    (document.head||document.documentElement).appendChild(st);
    window.__tdhSetDark=function(d){window.__tdhDark=!!d;var b=document.body;if(!b)return;var has=b.hasAttribute('data-ds-dark-theme');
    if(d&&!has)b.setAttribute('data-ds-dark-theme','');if(!d&&has)b.removeAttribute('data-ds-dark-theme');document.documentElement.style.colorScheme=d?'dark':'light';
    if(!window.__tdhDarkMo){window.__tdhDarkMo=new MutationObserver(function(){if(document.body.hasAttribute('data-ds-dark-theme')!==window.__tdhDark)window.__tdhSetDark(window.__tdhDark)});
    window.__tdhDarkMo.observe(b,{attributes:true,attributeFilter:['data-ds-dark-theme']})}};
    if(window.__tdhDark!==undefined)window.__tdhSetDark(window.__tdhDark);
    if(!window.__tdhCopyMo){var ICON='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/></svg>';
    var OK='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    var clockOf=function(el){var c=el.querySelector('[data-clock]');if(c&&c.innerText.trim())return c.innerText.trim();var p=el.previousElementSibling;while(p){if(p.getAttribute&&p.getAttribute('data-chat-flow-kind')==='user'){var k=p.querySelector('[data-clock]');return k?k.innerText.trim():''}p=p.previousElementSibling}return ''};
    var addCopy=function(){var running=!!document.querySelector("[data-conversation-scroll] [data-chat-running='true']");var items=[].slice.call(document.querySelectorAll("[data-chat-flow-kind=user],[data-chat-flow-kind=assistant-step]"));
    items.forEach(function(el,i){if(el.querySelector(':scope > .tdh-copy-row'))return;
    if(running&&i===items.length-1&&el.getAttribute('data-chat-flow-kind')==='assistant-step')return;
    var row=document.createElement('div');row.className='tdh-copy-row';var t=document.createElement('span');t.textContent=clockOf(el);
    var b=document.createElement('button');b.className='tdh-copy';b.type='button';b.setAttribute('aria-label','复制');b.innerHTML=ICON;
    b.addEventListener('click',function(e){e.stopPropagation();var src=el.querySelector("[class*='_bubble']")||el;var c=src.cloneNode(true);c.querySelectorAll('.tdh-copy-row,[data-clock]').forEach(function(x){x.remove()});
    try{webkit.messageHandlers.tdh.postMessage({type:'copy',text:(c.innerText||'').trim()})}catch(err){}b.innerHTML=OK;setTimeout(function(){b.innerHTML=ICON},1400)});
    if(el.getAttribute('data-chat-flow-kind')==='user'){row.appendChild(t);row.appendChild(b)}else{row.appendChild(b);row.appendChild(t)}el.appendChild(row)})};
    var ct=0;window.__tdhCopyMo=new MutationObserver(function(){clearTimeout(ct);ct=setTimeout(addCopy,300)});
    window.__tdhCopyMo.observe(document.documentElement,{childList:true,subtree:true});setTimeout(addCopy,500)}
    if(!window.__tdhScrollGuard){window.__tdhScrollGuard=1;var busy=false,bt=0,dTop=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');
    var settle=function(){clearTimeout(bt);bt=setTimeout(function(){busy=false},260)};
    var atEnd=function(sc,v){return v>=sc.scrollHeight-sc.clientHeight-2};
    var guard=function(){var sc=document.querySelector('[data-conversation-scroll]');if(!sc||sc.__tdhGuard)return;sc.__tdhGuard=1;
    sc.addEventListener('touchstart',function(){busy=true;clearTimeout(bt)},{passive:true,capture:true});
    sc.addEventListener('touchend',settle,{passive:true,capture:true});sc.addEventListener('touchcancel',settle,{passive:true,capture:true});
    sc.addEventListener('scroll',function(){if(busy&&bt)settle()},{passive:true,capture:true});
    Object.defineProperty(sc,'scrollTop',{configurable:true,get:function(){return dTop.get.call(this)},set:function(v){if(busy&&atEnd(this,v))return;dTop.set.call(this,v)}});
    ['scrollTo','scroll'].forEach(function(n){var f=sc[n].bind(sc);sc[n]=function(a,b){var top=(a&&typeof a==='object')?a.top:b;if(busy&&typeof top==='number'&&atEnd(sc,top))return;return f.apply(null,arguments)}})};
    var sIV=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(){if(busy&&this.closest&&this.closest('[data-conversation-scroll]'))return;return sIV.apply(this,arguments)};
    new MutationObserver(guard).observe(document.documentElement,{childList:true,subtree:true});guard()}
    if(!window.__tdhThinkMo){var lastThink=null;var thinkPost=function(){var b=document.querySelector('.cs-typing');var r=b?b.getBoundingClientRect():null;
    var key=b?Math.round(r.left)+','+Math.round(r.top):'off';if(key===lastThink)return;lastThink=key;
    try{webkit.messageHandlers.tdh.postMessage(b?{type:'thinking',on:true,x:r.left,y:r.top,w:r.width,h:r.height}:{type:'thinking',on:false})}catch(e){}};
    window.__tdhThinkMo=new MutationObserver(thinkPost);window.__tdhThinkMo.observe(document.documentElement,{childList:true,subtree:true});
    document.addEventListener('scroll',thinkPost,true);window.addEventListener('resize',thinkPost)}
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
                            // Thinking: the app's own drops, right under the question where the answer begins (the user,
                            // 2026-11-26: 「是我们默认的那个动画…出现在这个位置」), over the page's hidden place for them.
                            // The page measures from the top of the screen (the web view lies under the bars), so the
                            // drops' layer does too: laid out inside the safe area it began under the title bar, and the
                            // drops sat about a bar's height below the question (the user, 2026-11-26: 「对话时候那个
                            // 动画效果 不是应该出现在「我是……」那里吗」).
                            .overlay(alignment: .topLeading) {
                                ZStack(alignment: .topLeading) {
                                    if desk.ready && desk.thinking && desk.thinkingAt != .zero {
                                        LavaDots(width: 48, height: 24)
                                            .offset(x: desk.thinkingAt.minX, y: desk.thinkingAt.midY - 12)
                                            .transition(.opacity)
                                    }
                                }
                                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                                .ignoresSafeArea()
                                .allowsHitTesting(false)
                            }
                            .animation(.easeOut(duration: 0.2), value: desk.thinking)
                            .onAppear { desk.setInsets(top: g.safeAreaInsets.top, bottom: g.safeAreaInsets.bottom) }
                            .onChange(of: g.safeAreaInsets) { _, v in desk.setInsets(top: v.top, bottom: v.bottom) }
                            .opacity(desk.ready ? 1 : 0)
                    }
                    .overlay {
                        // A new conversation: a greeting, what it can do, and a few things to tap.
                        // Always there, seen or not (desk.welcome): nothing is put in or taken out, so nothing flashes.
                        AIWelcome(name: chat.people[chat.me]?.name ?? "") { text in
                            Task { if !(await desk.send(text)) { desk.say("没发出去，稍后再试") } }
                        }
                        .opacity(desk.welcome ? 1 : 0)
                        .allowsHitTesting(desk.welcome)
                        .accessibilityHidden(!desk.welcome)
                        // Until the page has drawn itself (its first message), the drops and a word, not an empty page.
                        if !desk.ready {
                            // Only the drops (the user, 2026-11-25: 「这我能不能不要中文 只要动态的那个动画就可以」).
                            LavaDots(width: 96, height: 48)
                                .transition(.opacity.combined(with: .scale(scale: 0.92)))
                        }
                    }
                    .animation(.spring(response: 0.5, dampingFraction: 0.85), value: desk.ready)
                    .animation(.easeOut(duration: 0.18), value: desk.welcome)
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
                    PhoneComposer(attached: desk.attached, detach: { n in Task { await desk.detach(n) } }) { text in
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
                    VStack(spacing: 0) {
                        // Just the words (the user, 2026-11-26: 「这个窗口的名称 不要这个胶囊」).
                        Text(desk.currentTitle).font(.subheadline.weight(.semibold)).foregroundStyle(Color.ink).lineLimit(1)
                            .contentTransition(.opacity)
                            .frame(maxWidth: 200)
                    }
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
        // The card's own name, not a new number each time (the user, 2026-11-26: 「那4个卡片…一直反复跳动」「新窗口闪烁」):
        // with a fresh UUID at every redraw of the page — a chat message, the list of conversations, a count —
        // SwiftUI took the four cards for four new ones, threw the old away and played their entrance again.
        var id: String { title }
        let icon: String
        let tint: Color
        let title: String
        let detail: String
        let prompt: String
    }

    private static let ideas: [Idea] = [
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
            // A fixed place from the top (the user, 2026-11-26: 「那4个卡片总是反复重新跳动」): centred, it moved with every
            // change of the room under it.
            Color.clear.frame(height: 72)
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
                ForEach(Array(Self.ideas.enumerated()), id: \.element.id) { i, idea in
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
        }
        .frame(maxHeight: .infinity, alignment: .top)
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
