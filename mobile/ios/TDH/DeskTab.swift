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

struct DeskArtifact: Identifiable, Equatable {
    let id: String
    let title: String
    let kind: String
    let path: String
    let updated: Date?
}

@MainActor
final class DeskModel: ObservableObject {
    @Published var sessions: [DeskSession] = []
    @Published var current = ""
    @Published var ready = false
    @Published var loaded = false
    @Published var failed = ""
    @Published var note = "正在打开你的工作台…"

    private var opening = false
    private let coordinator = ChatWebView.Coordinator()
    private lazy var messages = DeskMessages { [weak self] body in self?.take(body) }
    lazy var web: WKWebView = makeWeb()

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
        let w = WKWebView(frame: .zero, configuration: c)
        w.uiDelegate = coordinator
        w.navigationDelegate = coordinator
        w.allowsBackForwardNavigationGestures = false
        w.isOpaque = false
        w.backgroundColor = .clear
        w.scrollView.contentInsetAdjustmentBehavior = .never
        return w
    }

    private func take(_ body: Any) {
        guard let m = body as? [String: Any], let type = m["type"] as? String else { return }
        if type == "ready" || (type == "state" && !ready) { setInsets(top: insets.0, bottom: insets.1) }
        if type == "ready" { ready = true }
        guard type == "state" else { return }
        ready = true
        // The page knows the open chat a moment after it opens; until then keep the one this app just asked for.
        if let c = m["current"] as? String, !c.isEmpty { current = c }
        let rows = m["sessions"] as? [[String: Any]] ?? []
        sessions = rows.compactMap { r in
            guard let id = r["id"] as? String, !id.isEmpty else { return nil }
            let ms = (r["updated"] as? NSNumber)?.doubleValue ?? 0
            return DeskSession(id: id, title: r["title"] as? String ?? "未命名会话",
                               updated: ms > 0 ? Date(timeIntervalSince1970: ms / 1000) : nil,
                               busy: r["busy"] as? Bool ?? false)
        }
    }

    private func call(_ body: String, _ args: [String: Any] = [:]) {
        Task { _ = try? await web.callAsyncJavaScript(body, arguments: args, in: nil, contentWorld: .page) }
    }

    func open(_ id: String) {
        current = id
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

/// The page's messages to the app. A separate object: WKUserContentController keeps its handlers strongly.
final class DeskMessages: NSObject, WKScriptMessageHandler {
    private let onMessage: (Any) -> Void
    init(_ onMessage: @escaping (Any) -> Void) { self.onMessage = onMessage }

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        onMessage(message.body)
    }
}

struct DeskTab: View {
    @EnvironmentObject var session: Session
    @EnvironmentObject var desk: DeskModel
    @Binding var showSettings: Bool
    @State private var showList = false

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
                        // Until the page has drawn itself (its first message), the drops and a word, not an empty page.
                        if !desk.ready {
                            VStack(spacing: 12) {
                                LavaDots(width: 96, height: 48)
                                Text("正在打开你的工作台…").font(.footnote).foregroundStyle(.secondary)
                            }
                            .transition(.opacity.combined(with: .scale(scale: 0.92)))
                        }
                    }
                    .animation(.spring(response: 0.5, dampingFraction: 0.85), value: desk.ready)
                } else if !desk.failed.isEmpty {
                    VStack(spacing: 14) {
                        Text(desk.failed).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        Button("重试") { Task { await open() } }.buttonStyle(.bordered)
                    }.padding()
                } else {
                    VStack(spacing: 12) {
                        LavaDots()
                        Text(desk.note).font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(DeskBackground())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel("设置")
                }
                ToolbarItem(placement: .principal) {
                    Button { showList = true } label: {
                        HStack(spacing: 4) {
                            Text(desk.currentTitle).font(.headline).lineLimit(1)
                            Image(systemName: "chevron.down").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: 220)
                    }
                    .foregroundStyle(.primary)
                    .accessibilityLabel("会话列表")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { desk.newChat() } label: { Image(systemName: "square.and.pencil") }
                        .accessibilityLabel("新对话")
                }
            }
            .sheet(isPresented: $showList) { SessionListSheet().environmentObject(desk) }
        }
        .task { await open() }
    }

    private func open() async {
        guard let p = session.person else { return }
        await desk.start(token: p.gwToken)
    }
}

/// The desk page's own sky-to-sand wash, behind the page while it loads and around the bars.
struct DeskBackground: View {
    var body: some View {
        LinearGradient(colors: [Color(red: 0.71, green: 0.81, blue: 0.94), Color(red: 0.86, green: 0.89, blue: 0.95),
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
