// company-phone-ui-v2: History (the assistant's past conversations, the same as on the computer), Docs (what the
// assistant made), and the settings sheet — the prototype the user approved, on real data.
import SwiftUI

struct HistoryPage: View {
    @EnvironmentObject var desk: DeskModel
    @Binding var tab: Int
    @Binding var showSettings: Bool
    @State private var query = ""
    @State private var deleting: DeskSession?
    @State private var openRow: String?

    private var rows: [DeskSession] {
        let q = query.trimmingCharacters(in: .whitespaces)
        return q.isEmpty ? desk.sessions : desk.sessions.filter { $0.title.localizedCaseInsensitiveContains(q) }
    }

    private func group(_ s: DeskSession) -> String {
        guard let d = s.updated else { return "更早" }
        let cal = Calendar.current
        if cal.isDateInToday(d) { return "今天" }
        if let n = cal.dateComponents([.day], from: cal.startOfDay(for: d), to: cal.startOfDay(for: Date())).day, n < 7 { return "最近一周" }
        return "更早"
    }

    var body: some View {
        NavigationStack {
            // Cards with the one swipe of every list (company-phone-swipe-v1): 归档 and, where the desk can, 删除.
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(["今天", "最近一周", "更早"], id: \.self) { g in
                        let list = rows.filter { group($0) == g }
                        if !list.isEmpty {
                            Text(g).font(.footnote).foregroundStyle(.secondary).padding(.leading, 6).padding(.top, 8)
                            ForEach(Array(list.enumerated()), id: \.element.id) { i, s in
                                SwipeRow(id: s.id, open: $openRow, actions: actions(s)) {
                                    Button {
                                        if openRow != nil { withAnimation(SwipeRow<EmptyView>.spring) { openRow = nil }; return }
                                        desk.open(s.id)
                                        withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) { tab = 1 }
                                    } label: { HistoryCard(s: s, on: s.id == desk.current, fresh: desk.answered.contains(s.id)) }
                                    .buttonStyle(FadePress())
                                }
                                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                                .frosted(RoundedRectangle(cornerRadius: 22, style: .continuous))
                                .overlay {
                                    if s.id == desk.current {
                                        RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Color.ink.opacity(0.18), lineWidth: 1.5)
                                    }
                                }
                                .rise(i)
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 100)
            }
            .closesSwipe($openRow)
            .animation(.spring(response: 0.45, dampingFraction: 0.85), value: rows.map(\.id))
            .overlay {
                if !desk.ready {
                    if desk.failed.isEmpty { LavaDots(width: 96, height: 48) }
                    else { Text(desk.failed).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center).padding() }
                } else if rows.isEmpty {
                    ContentUnavailableView(query.isEmpty ? "还没有对话" : "没找到",
                                           systemImage: query.isEmpty ? "clock.arrow.circlepath" : "magnifyingglass",
                                           description: Text(query.isEmpty ? "在 AI 里说第一句话，电脑上的对话也会出现在这里" : "换个词试试"))
                }
            }
            .background(DeskBackground())
            .navigationTitle("History")
            .searchable(text: $query, prompt: "搜索过往对话")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }.accessibilityLabel("设置")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        desk.newChat()
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) { tab = 1 }
                    } label: { Image(systemName: "square.and.pencil") }
                    .accessibilityLabel("新对话")
                }
            }
            .confirmationDialog("删除这个对话？", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                                titleVisibility: .visible, presenting: deleting) { s in
                Button("删除「\(s.title)」", role: .destructive) { Task { await remove(s) } }
            } message: { _ in
                Text("删除后电脑上也看不到了，不能恢复。只想收起来就用「归档」。")
            }
        }
    }

    private func actions(_ s: DeskSession) -> [SwipeAction] {
        var a: [SwipeAction] = []
        if desk.canArchive { a.append(SwipeAction(title: "归档", tone: .sky) { Task { await archive(s) } }) }
        if desk.canRemove { a.append(SwipeAction(title: "删除", tone: .rose) { deleting = s }) }
        return a
    }

    private func archive(_ s: DeskSession) async {
        if await desk.archive(s.id) { desk.say("已归档，电脑上「已归档」里还能找到") } else { desk.say("没归档成功，稍后再试") }
    }

    private func remove(_ s: DeskSession) async {
        deleting = nil
        if await desk.remove(s.id) { desk.say("已删除") } else { desk.say("没删掉，稍后再试") }
    }
}

/// A press on a card whose glass is under the whole row: the words dim (a shrink would move only the words in the card).
private struct FadePress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.55 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

private struct HistoryCard: View {
    let s: DeskSession
    let on: Bool
    /// Answered while not looked at (company-phone-notices-v1).
    var fresh = false

    var body: some View {
        // (Fixed colours, not the hierarchical .secondary / .tertiary: over the card's material, inside the row's own
        // sideways scroll, those draw nothing.)
        // Only the words: the card itself is drawn under the whole row (HistoryPage), so the swipe's tiles open inside it
        // as they do in Chat (the user: 「图1在框内 图2在框外 我说了要统一啊」).
        VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    if fresh {
                        Circle().fill(Color(red: 0.46, green: 0.58, blue: 0.90)).frame(width: 8, height: 8)
                            .transition(.scale.combined(with: .opacity))
                    }
                    Text(s.title).font(.body.weight(.semibold)).lineLimit(1)
                    Spacer()
                    if let d = s.updated { Text(d.chatWhen).font(.footnote).foregroundStyle(Color(uiColor: .tertiaryLabel)) }
                }
                if s.busy {
                    HStack(spacing: 5) {
                        Circle().fill(.blue).frame(width: 6, height: 6)
                            .phaseAnimator([0.3, 1]) { c, o in c.opacity(o).scaleEffect(o) } animation: { _ in .easeInOut(duration: 0.8) }
                        Text("进行中").foregroundStyle(.blue)
                    }
                    .font(.subheadline)
                } else if fresh {
                    Text("有新回复").font(.subheadline).foregroundStyle(Color(red: 0.40, green: 0.52, blue: 0.86))
                } else if on {
                    Text("正在看的对话").font(.subheadline).foregroundStyle(Color(uiColor: .secondaryLabel))
                }
        }
        .padding(.horizontal, 14).padding(.vertical, 15)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .foregroundStyle(.primary)
    }
}

struct DocsPage: View {
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

    private func group(_ a: DeskArtifact) -> String {
        guard let d = a.updated else { return "更早" }
        let cal = Calendar.current
        if cal.isDateInToday(d) { return "今天" }
        if let n = cal.dateComponents([.day], from: cal.startOfDay(for: d), to: cal.startOfDay(for: Date())).day, n < 7 { return "最近一周" }
        return "更早"
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(["今天", "最近一周", "更早"], id: \.self) { g in
                        let list = shown.filter { group($0) == g }
                        if !list.isEmpty {
                            Text(g).font(.footnote).foregroundStyle(.secondary).padding(.leading, 6).padding(.top, 6)
                            ForEach(Array(list.enumerated()), id: \.element.id) { i, a in
                                NavigationLink(value: a) {
                                    PhoneCard {
                                        HStack(spacing: 14) {
                                            DocIcon(a: a)
                                            VStack(alignment: .leading, spacing: 3) {
                                                Text(a.title).font(.body.weight(.semibold)).lineLimit(1)
                                                if let d = a.updated { Text(d.chatWhen).font(.footnote).foregroundStyle(.secondary) }
                                            }
                                            Spacer()
                                            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                                        }
                                    }
                                }
                                .buttonStyle(PressStyle()).foregroundStyle(.primary)
                                .rise(i)
                            }
                        }
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 100)
            }
            .refreshable { await load() }
            .overlay {
                if loading && rows.isEmpty {
                    LavaDots(width: 96, height: 48)
                } else if shown.isEmpty {
                    ContentUnavailableView(query.isEmpty ? "还没有文档" : "没找到",
                                           systemImage: query.isEmpty ? "doc.text" : "magnifyingglass",
                                           description: Text(query.isEmpty ? "让 AI 写报告、做表格，做好的文件会出现在这里" : "换个词试试"))
                }
            }
            .background(DeskBackground())
            .navigationTitle("Docs")
            .searchable(text: $query, prompt: "搜索文档")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }.accessibilityLabel("设置")
                }
            }
            .navigationDestination(for: DeskArtifact.self) { a in ArtifactPager(items: shown, start: a, tab: $tab) }
        }
        .task(id: desk.ready) { await load() }
    }

    private func load() async {
        if !desk.ready { loading = desk.failed.isEmpty; return }
        loading = true
        rows = await desk.artifacts().sorted { ($0.updated ?? .distantPast) > ($1.updated ?? .distantPast) }
        loading = false
    }
}

struct PhoneSettings: View {
    @EnvironmentObject var session: Session
    @EnvironmentObject var chat: ChatStore
    @Environment(\.dismiss) private var dismiss
    @State private var confirmOut = false
    @State private var avatar = false
    @AppStorage(Appearance.key) private var appearance = Appearance.system

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(spacing: 8) {
                        let me = chat.people[chat.me]
                        Avatar(name: me?.name ?? session.person?.login ?? "我", image: me?.photo, size: 76)
                        Text(me?.name ?? session.person?.login ?? "").font(.title3.weight(.semibold))
                        Text([session.person?.dept ?? "", session.person?.login ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity).listRowBackground(Color.clear)
                }
                Section("账号") {
                    Button { avatar = true } label: { Label("更换头像", systemImage: "person.crop.circle") }.foregroundStyle(.primary)
                    if let d = session.person?.dept, !d.isEmpty {
                        LabeledContent { Text(d) } label: { Label("部门", systemImage: "building.2") }
                    }
                    if let r = session.person?.role, !r.isEmpty {
                        LabeledContent { Text(r) } label: { Label("角色", systemImage: "person.badge.key") }
                    }
                }
                // company-phone-dark-v1 (the user, 2026-11-25: 「设置里增加一个黑夜模式」).
                Section("外观") {
                    Picker("外观", selection: $appearance) {
                        Text("跟随系统").tag(Appearance.system)
                        Text("浅色").tag(Appearance.light)
                        Text("深色").tag(Appearance.dark)
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
                Section("通用") {
                    LabeledContent { Text(session.server.isEmpty ? "未连接" : "已连接") } label: { Label("公司服务器", systemImage: "server.rack") }
                    LabeledContent { Text(chat.connected ? "已连接" : "正在连接") } label: { Label("聊天", systemImage: "bubble.left.and.bubble.right") }
                    LabeledContent { Text((Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "") } label: {
                        Label("关于 TDH", systemImage: "info.circle")
                    }
                }
                Section {
                    Button("退出登录", role: .destructive) { confirmOut = true }.frame(maxWidth: .infinity)
                } footer: {
                    Text("退出后这台手机不再免登录，下次要重新输验证码或密码。")
                }
            }
            .tint(Color.ink)
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
            .sheet(isPresented: $avatar, onDismiss: { chat.refreshCard() }) { AvatarSetupView(again: true).environmentObject(session) }
        }
        .presentationDragIndicator(.visible)
    }
}
