// The phone app's own frame around the server desk (company-phone-layout-v1): the 工件 list and the settings sheet.
// Settings used to be a 我 tab; like most phone assistants it is now a sheet from the gear, which frees the tab for 工件.
import SwiftUI
import QuickLook
import WebKit

struct ArtifactsTab: View {
    @EnvironmentObject var desk: DeskModel
    @Binding var tab: Int
    @Binding var showSettings: Bool
    @State private var rows: [DeskArtifact] = []
    @State private var loading = true
    @State private var query = ""
    @State private var path: [DeskArtifact] = []

    private var shown: [DeskArtifact] {
        let q = query.trimmingCharacters(in: .whitespaces)
        return q.isEmpty ? rows : rows.filter { $0.title.localizedCaseInsensitiveContains(q) }
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if !shown.isEmpty {
                    Section {
                        ForEach(shown) { a in
                            NavigationLink(value: a) { ArtifactRow(a: a) }
                        }
                    } footer: {
                        Text("工件是助手在会话里做出来的文件，电脑上也能看到同一份。打开后左右滑动翻看。")
                    }
                }
            }
            .overlay {
                if loading && rows.isEmpty {
                    VStack(spacing: 12) { LavaDots(); Text("正在取工件…").font(.footnote).foregroundStyle(.secondary) }
                } else if shown.isEmpty {
                    ContentUnavailableView(query.isEmpty ? "还没有工件" : "没找到",
                                           systemImage: query.isEmpty ? "doc.on.doc" : "magnifyingglass",
                                           description: Text(query.isEmpty ? "让助手写报告、做表格，做好的文件会出现在这里" : "换个词试试"))
                }
            }
            .searchable(text: $query, prompt: "搜索工件")
            .refreshable { await load() }
            .navigationTitle("工件")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }.accessibilityLabel("设置")
                }
            }
            .navigationDestination(for: DeskArtifact.self) { a in
                ArtifactPager(items: shown, start: a, tab: $tab)
            }
        }
        .task(id: desk.ready) { await load() }
    }

    private func load() async {
        if !desk.ready { loading = desk.failed.isEmpty; return }
        loading = true
        rows = await desk.artifacts()
        loading = false
    }
}

/// One artifact full screen; swipe left or right for the next or the previous one (翻页). Below it: 转发 (into
/// chats, as this person) and 交给助手 (into the assistant's composer, then say what to do with it).
struct ArtifactPager: View {
    @EnvironmentObject var desk: DeskModel
    let items: [DeskArtifact]
    @Binding var tab: Int
    @State private var current: String
    @State private var forwarding = false
    @State private var asking = false
    @State private var shareFile: URL?

    init(items: [DeskArtifact], start: DeskArtifact, tab: Binding<Int>) {
        self.items = items.isEmpty ? [start] : items
        _tab = tab
        _current = State(initialValue: start.id)
    }

    private var index: Int { items.firstIndex { $0.id == current } ?? 0 }
    private var item: DeskArtifact { items[index] }

    var body: some View {
        TabView(selection: $current) {
            ForEach(items) { a in
                ArtifactPage(a: a).tag(a.id)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .background(DeskBackground())
        .navigationTitle(item.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            // A native menu: on iOS 26 the button swells into the glass menu and shrinks back into it.
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button { forwarding = true } label: { Label("转发到聊天", systemImage: "arrowshape.turn.up.right") }
                    Button { Task { await ask() } } label: { Label("交给 AI", systemImage: "sparkles") }
                    if let file = shareFile {
                        ShareLink(item: file) { Label("用其他 App 打开", systemImage: "square.and.arrow.up") }
                    }
                } label: {
                    Image(systemName: "ellipsis")
                }
                .accessibilityLabel("更多")
            }
        }
        .task(id: current) { await prepareShare() }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 10) {
                if items.count > 1 {
                    Text("\(index + 1) / \(items.count)")
                        .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        .contentTransition(.numericText())
                        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: index)
                }
                HStack(spacing: 12) {
                    Button { forwarding = true } label: {
                        Label("转发", systemImage: "arrowshape.turn.up.right").frame(maxWidth: .infinity).frame(height: 48)
                    }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    Button { Task { await ask() } } label: {
                        Label(asking ? "正在放进去…" : "交给 AI", systemImage: "sparkles").frame(maxWidth: .infinity).frame(height: 48)
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .tint(Color(red: 0.27, green: 0.45, blue: 0.93)).foregroundStyle(.white)
                    .disabled(asking)
                }
                .font(.body.weight(.semibold))
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 6)
        }
        .sheet(isPresented: $forwarding) {
            ForwardPicker(title: item.title) { topics, note in await desk.forward(item.path, to: topics, note: note) }
                .environmentObject(desk)
        }
    }

    /// The artifact as a file of its own (for 用其他 App 打开: Files, AirDrop, WeChat…), in this app's temporary folder.
    private func prepareShare() async {
        shareFile = nil
        guard let got = await desk.readArtifact(item.path) else { return }
        let base = (item.title.isEmpty ? "工件" : item.title).replacingOccurrences(of: "/", with: "-").prefix(80)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("share", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(String(base) + ".html")
        if (try? got.html.write(to: url, atomically: true, encoding: .utf8)) != nil { shareFile = url }
    }

    private func ask() async {
        asking = true
        let ok = await desk.askArtifact(item.path, title: item.title, fresh: true)
        asking = false
        if ok {
            tab = 1
            desk.say("已放进 AI 对话框，说说要怎么处理，比如「做成 PDF」")
        } else {
            desk.say("没放进去，稍后再试")
        }
    }
}

private struct ArtifactPage: View {
    @EnvironmentObject var desk: DeskModel
    let a: DeskArtifact
    @State private var html: String?
    @State private var failed = false

    var body: some View {
        ZStack {
            if let html {
                ArtifactWebView(html: html)
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .shadow(color: .black.opacity(0.08), radius: 16, y: 6)
                    .padding(.horizontal, 12)
                    .transition(.opacity.combined(with: .scale(scale: 0.97)))
            } else if failed {
                ContentUnavailableView("这个工件没有读出来", systemImage: "exclamationmark.triangle",
                                       description: Text("公司盘可能还没连上，稍后再打开一次"))
            } else {
                VStack(spacing: 12) { LavaDots(width: 84, height: 42); Text("正在打开…").font(.footnote).foregroundStyle(.secondary) }
            }
        }
        .animation(.spring(response: 0.45, dampingFraction: 0.85), value: html != nil)
        .task(id: a.path) {
            if html != nil { return }
            if let got = await desk.readArtifact(a.path) { html = got.html } else { failed = true }
        }
    }
}

/// The artifact's own page, on its own: no cookies or storage kept, no way back into the app.
private struct ArtifactWebView: UIViewRepresentable {
    let html: String

    func makeUIView(context: Context) -> WKWebView {
        let c = WKWebViewConfiguration()
        c.websiteDataStore = .nonPersistent()
        let w = WKWebView(frame: .zero, configuration: c)
        w.isOpaque = false
        w.backgroundColor = .white
        w.loadHTMLString(html, baseURL: nil)
        return w
    }

    func updateUIView(_ w: WKWebView, context: Context) {}
}

/// 转发: the chats this person is in, the ones talked with last first; several at once, a word with it.
struct ForwardPicker: View {
    @EnvironmentObject var desk: DeskModel
    @Environment(\.dismiss) private var dismiss
    let title: String
    /// Sends the thing into the chats picked, with the note: the chats it went to, or why it did not.
    let send: ([String], String) async -> (sent: [String], error: String?)
    @State private var chats: [DeskChat] = []
    @State private var live = true
    @State private var loading = true
    @State private var picked: [String] = []
    @State private var query = ""
    @State private var note = ""
    @State private var sending = false
    @State private var error = ""

    private var shown: [DeskChat] {
        let q = query.trimmingCharacters(in: .whitespaces)
        return q.isEmpty ? chats : chats.filter { $0.name.localizedCaseInsensitiveContains(q) }
    }

    var body: some View {
        NavigationStack {
            List {
                if !picked.isEmpty {
                    Section {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(picked, id: \.self) { id in
                                    let c = chats.first { $0.topic == id }
                                    Button { toggle(id) } label: {
                                        HStack(spacing: 4) { Text(c?.name ?? id); Image(systemName: "xmark").font(.caption2.weight(.bold)) }
                                            .font(.footnote.weight(.medium))
                                            .padding(.horizontal, 12).padding(.vertical, 7)
                                            .background(Color.accentColor.opacity(0.12), in: Capsule())
                                    }
                                    .transition(.scale(scale: 0.6).combined(with: .opacity))
                                }
                            }
                            .padding(.vertical, 2)
                        }
                        .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                    }
                }
                if query.isEmpty && !chats.isEmpty {
                    Section("最近聊天") { ForEach(chats.prefix(5)) { row($0) } }
                    if chats.count > 5 { Section("全部") { ForEach(chats.dropFirst(5)) { row($0) } } }
                } else if !shown.isEmpty {
                    Section("搜索结果") { ForEach(shown) { row($0) } }
                }
            }
            .animation(.spring(response: 0.4, dampingFraction: 0.8), value: picked)
            .overlay {
                if loading {
                    VStack(spacing: 12) { LavaDots(); Text("正在取聊天列表…").font(.footnote).foregroundStyle(.secondary) }
                } else if chats.isEmpty {
                    ContentUnavailableView(live ? "还没有聊天" : "聊天还没连上", systemImage: "bubble.left.and.bubble.right",
                                           description: Text(live ? "先在「聊天」里找同事说句话" : "稍后再试"))
                } else if shown.isEmpty {
                    ContentUnavailableView.search(text: query)
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "搜索同事或群")
            .navigationTitle("转发「\(title)」")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }.accessibilityLabel("取消")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await send() } } label: {
                        Text(sending ? "发送中…" : picked.count > 1 ? "发送(\(picked.count))" : "发送").fontWeight(.semibold)
                    }
                    .disabled(picked.isEmpty || sending)
                }
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 6) {
                    if !error.isEmpty { Text(error).font(.footnote).foregroundStyle(.red) }
                    TextField("留言（可不填）", text: $note)
                        .submitLabel(.send)
                        .onSubmit { Task { await send() } }
                        .padding(.horizontal, 18).frame(height: 46)
                        .background(.regularMaterial, in: Capsule())
                }
                .padding(.horizontal, 16).padding(.vertical, 8)
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task {
            let got = await desk.chats()
            chats = got.list
            live = got.live
            loading = false
        }
    }

    private func row(_ c: DeskChat) -> some View {
        let on = picked.contains(c.topic)
        return Button { toggle(c.topic) } label: {
            HStack(spacing: 12) {
                Text(Self.initial(c.name))
                    .font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(Self.color(c.name), in: RoundedRectangle(cornerRadius: c.group ? 11 : 18, style: .continuous))
                Text(c.name).lineLimit(1)
                if c.group {
                    Text("群").font(.caption2).foregroundStyle(.secondary)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 5))
                }
                Spacer(minLength: 0)
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(on ? Color.accentColor : Color.secondary.opacity(0.5))
                    .symbolEffect(.bounce, value: on)
            }
            .contentShape(Rectangle())
        }
        .foregroundStyle(.primary)
    }

    private func toggle(_ id: String) {
        error = ""
        if let i = picked.firstIndex(of: id) { picked.remove(at: i) } else { picked.append(id) }
        UISelectionFeedbackGenerator().selectionChanged()
    }

    private func send() async {
        guard !picked.isEmpty, !sending else { return }
        sending = true
        let r = await send(picked, note.trimmingCharacters(in: .whitespacesAndNewlines))
        sending = false
        if let e = r.error {
            error = "转发没成功：" + e
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            return
        }
        let names = r.sent.compactMap { id in chats.first { $0.topic == id }?.name }
        let who = names.count > 3 ? names.prefix(3).joined(separator: "、") + " 等 \(names.count) 个" : names.joined(separator: "、")
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        desk.say("已转发给 " + who)
        dismiss()
    }

    static func initial(_ name: String) -> String {
        let t = name.trimmingCharacters(in: .whitespaces)
        let cjk = t.filter { ("\u{4e00}"..."\u{9fff}").contains(String($0)) }
        if cjk.count >= 2 { return String(cjk.suffix(2)) }
        return String(t.prefix(1)).uppercased()
    }

    static func color(_ name: String) -> Color {
        let hues: [Double] = [212, 262, 330, 18, 150, 190, 40, 280]
        var h: UInt32 = 0
        for u in name.unicodeScalars { h = h &* 31 &+ u.value }
        return Color(hue: hues[Int(h % UInt32(hues.count))] / 360, saturation: 0.55, brightness: 0.85)
    }
}

private struct ArtifactRow: View {
    let a: DeskArtifact

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(.blue)
                .frame(width: 36, height: 36)
                .background(.blue.opacity(0.1), in: RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 3) {
                Text(a.title).lineLimit(1)
                if let d = a.updated {
                    Text(d.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private var icon: String {
        let t = (a.title + " " + a.kind + " " + a.path).lowercased()
        if t.contains("xls") || t.contains("csv") || t.contains("sheet") { return "tablecells" }
        if t.contains("ppt") || t.contains("slide") { return "rectangle.on.rectangle" }
        if t.contains("png") || t.contains("jpg") || t.contains("image") { return "photo" }
        return "doc.richtext"
    }
}

struct SettingsSheet: View {
    @EnvironmentObject var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var confirmOut = false

    var body: some View {
        NavigationStack {
            List {
                Section("账号") {
                    LabeledContent("账号", value: session.person?.login ?? "")
                    if let d = session.person?.dept, !d.isEmpty { LabeledContent("部门", value: d) }
                    if let r = session.person?.role, !r.isEmpty { LabeledContent("角色", value: r) }
                }
                Section("连接") {
                    LabeledContent("公司服务器", value: session.server.isEmpty ? "未连接" : session.server)
                    LabeledContent("助手", value: "在公司服务器上，电脑和手机同步")
                }
                Section {
                    Button("退出登录", role: .destructive) { confirmOut = true }
                        .frame(maxWidth: .infinity)
                } footer: {
                    Text("退出后这台手机不再免登录，下次要重新输验证码或密码。")
                }
                Section {
                    LabeledContent("版本", value: (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "")
                }
            }
            .navigationTitle("设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }.accessibilityLabel("关闭")
                }
            }
            .confirmationDialog("退出登录？", isPresented: $confirmOut, titleVisibility: .visible) {
                Button("退出登录", role: .destructive) { dismiss(); Task { await session.signOut() } }
            }
        }
        .presentationDragIndicator(.visible)
    }
}

/// A chat file, shown by Quick Look (pages, PDF, pictures, Office files, text…), with 转发 and 交给助手. Nothing is
/// kept: the file sits in this app's temporary folder while it is shown.
struct ChatFileSheet: View {
    @EnvironmentObject var desk: DeskModel
    @EnvironmentObject var session: Session
    @Environment(\.dismiss) private var dismiss
    let file: ChatFile
    @State private var local: URL?
    @State private var forwarding = false
    @State private var asking = false

    var body: some View {
        NavigationStack {
            Group {
                if let local {
                    QuickLookView(url: local).ignoresSafeArea(edges: .bottom)
                } else {
                    VStack(spacing: 12) { LavaDots(); Text("正在打开…").font(.footnote).foregroundStyle(.secondary) }
                }
            }
            .navigationTitle(file.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }.accessibilityLabel("关闭")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { forwarding = true } label: { Label("转发到聊天", systemImage: "arrowshape.turn.up.right") }
                        Button { Task { await ask() } } label: { Label("交给 AI", systemImage: "sparkles") }
                    } label: { Image(systemName: "ellipsis") }
                    .accessibilityLabel("更多")
                }
            }
            .safeAreaInset(edge: .bottom) {
                HStack(spacing: 12) {
                    Button { forwarding = true } label: {
                        Label("转发", systemImage: "arrowshape.turn.up.right").frame(maxWidth: .infinity).frame(height: 48)
                    }
                    .buttonStyle(.bordered).buttonBorderShape(.capsule)
                    Button { Task { await ask() } } label: {
                        Label(asking ? "正在放进去…" : "交给 AI", systemImage: "sparkles").frame(maxWidth: .infinity).frame(height: 48)
                    }
                    .buttonStyle(.borderedProminent).buttonBorderShape(.capsule)
                    .tint(Color(red: 0.27, green: 0.45, blue: 0.93)).foregroundStyle(.white).disabled(asking)
                }
                .font(.body.weight(.semibold))
                .padding(.horizontal, 20).padding(.vertical, 8)
                .background(.bar)
            }
        }
        .task { local = Self.write(file) }
        .onDisappear { if let local { try? FileManager.default.removeItem(at: local) } }
        .sheet(isPresented: $forwarding) {
            ForwardPicker(title: file.name) { topics, note in await desk.forwardFile(file, to: topics, note: note) }
                .environmentObject(desk)
        }
    }

    private func ask() async {
        asking = true
        let ok = await desk.askFile(file, fresh: true)
        asking = false
        if ok {
            dismiss()
            NotificationCenter.default.post(name: .tdhShowDesk, object: nil)
            desk.say("已放进 AI 对话框，说说要怎么处理它")
        } else {
            desk.say(desk.ready ? "没放进去，稍后再试" : "AI 还没打开，稍后再试")
        }
    }

    static func write(_ f: ChatFile) -> URL? {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("chat-view", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let safe = f.name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
        let url = dir.appendingPathComponent(safe.isEmpty ? "文件" : safe)
        return (try? f.data.write(to: url, options: .atomic)) != nil ? url : nil
    }
}

extension Notification.Name {
    /// Asks the app to bring 助手 forward (a file was just handed to the assistant from 聊天).
    static let tdhShowDesk = Notification.Name("tdhShowDesk")
}

struct QuickLookView: UIViewControllerRepresentable {
    let url: URL

    func makeCoordinator() -> Source { Source(url) }

    func makeUIViewController(context: Context) -> QLPreviewController {
        let c = QLPreviewController()
        c.dataSource = context.coordinator
        return c
    }

    func updateUIViewController(_ c: QLPreviewController, context: Context) {}

    final class Source: NSObject, QLPreviewControllerDataSource {
        let url: URL
        init(_ url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
    }
}
