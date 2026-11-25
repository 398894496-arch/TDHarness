// Chat (company-phone-chat-native-v1): the list of chats and one chat, drawn by the app from ChatStore — round
// avatars, white bubbles for others and light blue for this person's own, files and pictures as cards that open in
// place (Quick Look, with 转发 and 交给 AI), and the same composer as AI.
import AVFoundation
import SwiftUI

enum ChatRoute: Hashable {
    case chat(String)
    case contacts
}

/// Chat (the user, 2026-11-25: 「右上角能不能增加一个按钮 列表 里面有通讯录 建群 然后搜索 可以有通讯录名单+聊天内容相关」): the
/// chats that have messages (everyone else is in 通讯录, as on the desks); the menu at the top right for 通讯录 and 建群;
/// search finds people and groups by name here and messages by their words on the server, in all the person's own chats
/// and of any age (company-chat-search-all-v1: 「不是最近30天的聊天记录 是所有聊天记录」).
struct ChatListPage: View {
    @EnvironmentObject var chat: ChatStore
    @EnvironmentObject var session: Session
    @EnvironmentObject var desk: DeskModel
    @Binding var showSettings: Bool
    @State private var query = ""
    @State private var path: [ChatRoute] = []
    @State private var newGroup = false
    @State private var showMenu = false
    @State private var deleting: ChatTopic?
    @State private var openRow: String?
    @State private var hits: [ChatHit] = []
    @State private var searching = false

    private var talked: [ChatTopic] { chat.topics.filter { chat.shows($0) } }
    private var q: String { query.trimmingCharacters(in: .whitespaces) }
    private var nameHits: [ChatTopic] {
        q.isEmpty ? [] : chat.topics.filter { $0.name.localizedCaseInsensitiveContains(q) }
            .sorted { ($0.touched ?? .distantPast) > ($1.touched ?? .distantPast) }
    }

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if q.isEmpty {
                    chatList
                } else {
                    ScrollView { searchResults.padding(.bottom, 100) }
                }
            }
            .overlay {
                if !chat.loaded {
                    if chat.problem.isEmpty { LavaDots(width: 96, height: 48) }
                    else { Text(chat.problem).font(.footnote).foregroundStyle(.secondary) }
                } else if q.isEmpty && talked.isEmpty {
                    ContentUnavailableView("还没有聊天", systemImage: "bubble.left.and.bubble.right",
                                           description: Text("点右上角「通讯录」找同事说句话"))
                }
            }
            .animation(.spring(response: 0.45, dampingFraction: 0.85), value: talked.map(\.topic))
            .background(DeskBackground())
            .navigationTitle("Chat")
            .searchable(text: $query, prompt: "搜索同事、群和聊天记录")
            .task(id: q) { await search() }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }.accessibilityLabel("设置")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { withAnimation(.spring(response: 0.36, dampingFraction: 0.8)) { showMenu = true } } label: {
                        Image(systemName: "line.3.horizontal")
                    }
                    .accessibilityLabel("更多")
                }
            }
            .navigationDestination(for: ChatRoute.self) { r in
                switch r {
                case .chat(let topic): ChatRoom(topic: topic)
                case .contacts: ContactsPage(path: $path)
                }
            }
            .sheet(isPresented: $newGroup) {
                NewGroupSheet { grp in path.append(.chat(grp)) }.environmentObject(chat)
            }
            .confirmationDialog("删除这个聊天？", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                                titleVisibility: .visible, presenting: deleting) { t in
                Button("删除「\(t.name)」", role: .destructive) {
                    Task { if !(await chat.deleteChat(t.topic)) { desk.say("没删掉，稍后再试") } }
                }
            } message: { _ in
                Text("你这边的聊天记录会清空，对方那边不受影响。有新消息时它会重新出现。")
            }
        }
        .overlay { menu }
    }

    /// The chats (the user, 2026-11-25: 「聊天界面 左滑 给两个选项 置顶和删除」): pinned ones first with a pin, a swipe
    /// to the left for 置顶 / 取消置顶 and 删除.
    /// The system's own swipe (iOS 26: two floating capsules with words under them) cut the card's row square and stood
    /// off it (the user: 「这个设计你不觉得丑吗」): this one is the card's own — the row slides, two flat blocks of its height
    /// under it, words only, the card's corners keeping them.
    private var chatList: some View {
        ScrollView {
            VStack(spacing: 0) {
                ForEach(Array(talked.enumerated()), id: \.element.id) { i, t in
                    let pinned = chat.pinned.contains(t.topic)
                    SwipeRow(id: t.topic, open: $openRow, actions: [
                        SwipeAction(title: pinned ? "取消置顶" : "置顶", tone: .sky) {
                            Task { if !(await chat.togglePin(t.topic)) { desk.say(pinned ? "没取消成功，稍后再试" : "没置顶成功，稍后再试") } }
                        },
                        SwipeAction(title: "删除", tone: .rose) { deleting = t },
                    ]) {
                        Button {
                            if openRow != nil { withAnimation(SwipeRow<EmptyView>.spring) { openRow = nil } }
                            else { path.append(.chat(t.topic)) }
                        } label: { ChatRow(t: t, pinned: pinned) }
                        .buttonStyle(RowPress())
                    }
                    // The row's colour under the whole row, so the card stays whole while the tiles show.
                    .background(pinned ? Color.white.opacity(0.78) : Color.white.opacity(0.55))
                    if i < talked.count - 1 {
                        Rectangle().fill(Color.black.opacity(0.08)).frame(height: 0.5).padding(.leading, 78)
                            .background(Color.white.opacity(0.55))
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 100)
        }
        .closesSwipe($openRow)
        .animation(.spring(response: 0.45, dampingFraction: 0.85), value: talked.map(\.topic))
        .animation(.spring(response: 0.45, dampingFraction: 0.85), value: chat.pinned)
    }

    /// The menu (the user, 2026-11-25: 「再窄一点 … 两个图标也要是一个系列一样大小 … 跟左边的设置图标没有对齐」, then 「太宽太大
    /// 了」 of the system's own): narrow, two lines and a line between, opening out of the button's own place — its top on
    /// the line of the gear at the left, 16 from the edge as the gear is.
    @ViewBuilder private var menu: some View {
        GeometryReader { g in
            ZStack(alignment: .topTrailing) {
                if showMenu {
                    Color.black.opacity(0.001)
                        .onTapGesture { withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { showMenu = false } }
                    VStack(spacing: 0) {
                        menuRow("book.closed", "通讯录") { path.append(.contacts) }
                        Divider().padding(.horizontal, 12)
                        menuRow("plus.bubble", "建群") { newGroup = true }
                    }
                    .frame(width: 140)
                    // Glass a little whiter than the bar's, so the button under it does not show through.
                    .background(.white.opacity(0.55), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .glass(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .padding(.top, g.safeAreaInsets.top)
                    .padding(.trailing, 16)
                    .transition(.scale(scale: 0.25, anchor: .topTrailing).combined(with: .opacity))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            .ignoresSafeArea()
        }
    }

    private func menuRow(_ icon: String, _ title: String, _ act: @escaping () -> Void) -> some View {
        Button {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { showMenu = false }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { act() }
        } label: {
            HStack(spacing: 10) {
                Text(title).font(.system(size: 15, weight: .medium))
                Spacer(minLength: 0)
                // One box for both icons, so they look one size.
                Image(systemName: icon).resizable().scaledToFit().frame(width: 17, height: 17)
            }
            .foregroundStyle(Color.ink)
            .padding(.horizontal, 14).frame(height: 40).contentShape(Rectangle())
        }
        .buttonStyle(RowPress())
    }

    @ViewBuilder private var searchResults: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !nameHits.isEmpty {
                Text("联系人和群").font(.footnote).foregroundStyle(.secondary).padding(.leading, 22).padding(.top, 6)
                VStack(spacing: 0) {
                    ForEach(nameHits.prefix(8)) { t in
                        NavigationLink(value: ChatRoute.chat(t.topic)) {
                            HStack(spacing: 12) {
                                Avatar(name: t.name, image: t.photo, size: 40)
                                Text(Self.mark(t.name, q)).lineLimit(1)
                                if t.group { Text("群").font(.caption2).foregroundStyle(.secondary).padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(Color.ink.opacity(0.06), in: RoundedRectangle(cornerRadius: 5)) }
                                Spacer()
                            }
                            .padding(.horizontal, 14).padding(.vertical, 10).contentShape(Rectangle())
                        }
                        .buttonStyle(RowPress()).foregroundStyle(Color.ink)
                    }
                }
                .frosted(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .padding(.horizontal, 16)
            }
            HStack {
                Text("聊天记录").font(.footnote).foregroundStyle(.secondary)
                if searching { ProgressView().controlSize(.mini) }
                Spacer()
                Text("全部记录").font(.caption2).foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 22).padding(.top, 6)
            if hits.isEmpty {
                Text(searching ? "正在搜…" : "没有找到含「\(q)」的消息").font(.subheadline).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity).padding(.vertical, 24)
                    .frosted(RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .padding(.horizontal, 16)
            } else {
                VStack(spacing: 0) {
                    ForEach(hits) { h in
                        let t = chat.topics.first { $0.topic == h.topic } ?? chat.topics.first { $0.name == h.chat }
                        Button { if let t { path.append(.chat(t.topic)) } } label: {
                            HStack(alignment: .top, spacing: 12) {
                                Avatar(name: h.chat, image: t?.photo, size: 40)
                                VStack(alignment: .leading, spacing: 3) {
                                    HStack {
                                        Text(h.chat).font(.subheadline.weight(.semibold)).lineLimit(1)
                                        Spacer()
                                        Text(h.when).font(.caption).foregroundStyle(.tertiary)
                                    }
                                    Text(Self.mark((t?.group ?? false ? h.from + "：" : "") + h.text, q))
                                        .font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                                }
                            }
                            .padding(.horizontal, 14).padding(.vertical, 10).contentShape(Rectangle())
                        }
                        .buttonStyle(RowPress()).foregroundStyle(Color.ink)
                        .transition(.rise)
                    }
                }
                .frosted(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .padding(.horizontal, 16)
            }
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.85), value: hits.map(\.id))
    }

    /// The word found, in the text, in bold blue.
    static func mark(_ text: String, _ word: String) -> AttributedString {
        var a = AttributedString(text)
        guard !word.isEmpty else { return a }
        var from = a.startIndex
        while let r = a[from...].range(of: word, options: .caseInsensitive) {
            a[r].foregroundColor = .blue
            a[r].font = .subheadline.weight(.semibold)
            from = r.upperBound
        }
        return a
    }

    private func search() async {
        let word = q
        hits = []
        guard !word.isEmpty, let tok = session.person?.gwToken else { searching = false; return }
        searching = true
        try? await Task.sleep(nanoseconds: 450_000_000)  // while still typing, nothing is asked
        guard !Task.isCancelled else { return }
        let got = try? await Net.postJSON("/company/ext/chat/find", ["q": word], token: tok, timeout: 30)
        guard !Task.isCancelled, word == q else { return }
        searching = false
        let rows = (got?.1["hits"] as? [[String: Any]]) ?? []
        hits = rows.enumerated().map { i, r in
            ChatHit(id: i, chat: r["chat"] as? String ?? "", topic: r["topic"] as? String ?? "", from: r["from"] as? String ?? "",
                    text: r["text"] as? String ?? "", when: Self.when(r["time"] as? String ?? ""))
        }
    }

    private static func when(_ s: String) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm"
        f.timeZone = TimeZone(identifier: "Asia/Shanghai")  // the server's clock (the company is in China)
        return f.date(from: String(s.prefix(16)))?.chatWhen ?? String(s.prefix(10))
    }
}

struct ChatHit: Identifiable, Equatable {
    let id: Int
    let chat: String
    let topic: String
    let from: String
    let text: String
    let when: String
}

/// 通讯录: the groups, then everyone in the company, by the order of their names (pinyin); tap to talk.
struct ContactsPage: View {
    @EnvironmentObject var chat: ChatStore
    @Binding var path: [ChatRoute]
    @State private var query = ""

    private func sorted(_ l: [ChatTopic]) -> [ChatTopic] {
        l.sorted { $0.name.compare($1.name, locale: Locale(identifier: "zh-Hans")) == .orderedAscending }
    }

    var body: some View {
        let q = query.trimmingCharacters(in: .whitespaces)
        let all = chat.topics.filter { q.isEmpty || $0.name.localizedCaseInsensitiveContains(q) }
        let groups = sorted(all.filter(\.group))
        let people = sorted(all.filter { !$0.group })
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if !groups.isEmpty { block("群聊", groups) }
                block("同事（\(people.count)）", people)
            }
            .padding(.bottom, 40)
        }
        .background(DeskBackground())
        .navigationTitle("通讯录")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "搜索同事或群")
    }

    private func block(_ title: String, _ list: [ChatTopic]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.footnote).foregroundStyle(.secondary).padding(.leading, 22).padding(.top, 6)
            VStack(spacing: 0) {
                ForEach(Array(list.enumerated()), id: \.element.id) { i, t in
                    Button { path.append(.chat(t.topic)) } label: {
                        HStack(spacing: 12) {
                            Avatar(name: t.name, image: t.photo, size: 40)
                            Text(t.name).foregroundStyle(Color.ink)
                            Spacer()
                            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 9).contentShape(Rectangle())
                    }
                    .buttonStyle(RowPress())
                    .rise(min(i, 12))
                    if t.topic != list.last?.topic { Divider().padding(.leading, 66) }
                }
            }
            .frosted(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .padding(.horizontal, 16)
        }
    }
}

/// 建群: a name and the people in it; the group opens once made.
struct NewGroupSheet: View {
    @EnvironmentObject var chat: ChatStore
    @Environment(\.dismiss) private var dismiss
    let made: (String) -> Void
    @State private var title = ""
    @State private var picked: [String] = []
    @State private var query = ""
    @State private var busy = false
    @State private var error = ""

    private var people: [ChatTopic] {
        let q = query.trimmingCharacters(in: .whitespaces)
        return chat.topics.filter { !$0.group && (q.isEmpty || $0.name.localizedCaseInsensitiveContains(q)) }
            .sorted { $0.name.compare($1.name, locale: Locale(identifier: "zh-Hans")) == .orderedAscending }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("群名称（比如：报价小组）", text: $title)
                } footer: {
                    if !error.isEmpty { Text(error).foregroundStyle(.red) }
                }
                if !picked.isEmpty {
                    Section {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 10) {
                                ForEach(picked, id: \.self) { u in
                                    let t = chat.topics.first { $0.topic == u }
                                    Button { toggle(u) } label: {
                                        VStack(spacing: 4) {
                                            Avatar(name: t?.name ?? "", image: t?.photo, size: 40)
                                                .overlay(alignment: .topTrailing) {
                                                    Image(systemName: "xmark.circle.fill").font(.caption).foregroundStyle(.white, .gray).offset(x: 4, y: -4)
                                                }
                                            Text(t?.name ?? "").font(.caption2).lineLimit(1).frame(width: 52)
                                        }
                                    }
                                    .foregroundStyle(Color.ink)
                                    .transition(.scale(scale: 0.5).combined(with: .opacity))
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
                Section("选同事") {
                    ForEach(people) { t in
                        let on = picked.contains(t.topic)
                        Button { toggle(t.topic) } label: {
                            HStack(spacing: 12) {
                                Avatar(name: t.name, image: t.photo, size: 36)
                                Text(t.name)
                                Spacer()
                                Image(systemName: on ? "checkmark.circle.fill" : "circle").font(.title3)
                                    .foregroundStyle(on ? Color.ink : Color.secondary.opacity(0.5))
                                    .symbolEffect(.bounce, value: on)
                            }
                        }
                        .foregroundStyle(Color.ink)
                    }
                }
            }
            .animation(.spring(response: 0.4, dampingFraction: 0.8), value: picked)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "搜索同事")
            .navigationTitle("建群")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button { dismiss() } label: { Image(systemName: "xmark") } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await create() } } label: {
                        Text(busy ? "正在建…" : picked.isEmpty ? "创建" : "创建(\(picked.count + 1))").fontWeight(.semibold)
                    }
                    .disabled(busy || picked.isEmpty || title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .tint(Color.ink)
        .presentationDragIndicator(.visible)
    }

    private func toggle(_ u: String) {
        if let i = picked.firstIndex(of: u) { picked.remove(at: i) } else { picked.append(u) }
        UISelectionFeedbackGenerator().selectionChanged()
    }

    private func create() async {
        busy = true
        error = ""
        let grp = await chat.createGroup(title: title.trimmingCharacters(in: .whitespaces), members: picked)
        busy = false
        guard let grp else { error = "群没建成，检查一下网络再试"; return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        dismiss()
        made(grp)
    }
}

private struct RowPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Color.black.opacity(0.05) : .clear)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

private struct ChatRow: View {
    let t: ChatTopic
    var pinned = false

    var body: some View {
        HStack(spacing: 12) {
            Avatar(name: t.name, image: t.photo, size: 50)
                .overlay(alignment: .topTrailing) {
                    if t.unread > 0 {
                        Text(t.unread > 99 ? "99+" : "\(t.unread)")
                            .font(.caption2.weight(.bold)).foregroundStyle(.white)
                            .padding(.horizontal, 5).frame(minWidth: 19, minHeight: 19)
                            .background(.red, in: Capsule())
                            .overlay(Capsule().stroke(.white, lineWidth: 1.5))
                            .offset(x: 5, y: -4)
                            .transition(.scale.combined(with: .opacity))
                    }
                }
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(t.name).font(.body.weight(.semibold)).lineLimit(1)
                    if pinned { Image(systemName: "pin.fill").font(.caption2).foregroundStyle(Color(red: 0.46, green: 0.58, blue: 0.90)).rotationEffect(.degrees(45)) }
                    Spacer()
                    if let d = t.touched { Text(d.chatWhen).font(.footnote).foregroundStyle(.tertiary) }
                }
                Text(t.preview.isEmpty ? " " : t.preview).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .contentShape(Rectangle())
        .foregroundStyle(.primary)
        .animation(.spring(response: 0.35, dampingFraction: 0.7), value: t.unread)
    }
}

struct ChatRoom: View {
    @EnvironmentObject var chat: ChatStore
    @EnvironmentObject var calls: CallCenter
    @EnvironmentObject var desk: DeskModel
    @EnvironmentObject var session: Session
    let topic: String
    @State private var showPlus = false
    @State private var file: ChatFile?
    @State private var opening: Int?
    @State private var olderBusy = false
    @State private var noMore = false
    @State private var entered = false

    private var t: ChatTopic? { chat.topics.first { $0.topic == topic } }
    private var list: [ChatMessage] { chat.messages[topic] ?? [] }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    if !list.isEmpty && !noMore {
                        ProgressView().opacity(olderBusy ? 1 : 0).frame(height: 24)
                            .onAppear { Task { await older(proxy) } }
                    }
                    ForEach(Array(list.enumerated()), id: \.element.id) { i, m in
                        if i == 0 || m.at.timeIntervalSince(list[i - 1].at) > 300 {
                            Text(m.at.chatWhen == "刚刚" ? "刚刚" : stamp(m.at)).font(.caption).foregroundStyle(.tertiary).padding(.top, 4)
                        }
                        bubble(m).id(m.id)
                            .transition(.rise)
                    }
                    Color.clear.frame(height: 1).id("end")
                }
                .padding(.horizontal, 14)
                .padding(.top, 8)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: list.count)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: list.last?.id) { _, _ in withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) { proxy.scrollTo("end") } }
        }
        .overlay {
            if list.isEmpty {
                if entered {
                    VStack(spacing: 10) {
                        Avatar(name: t?.name ?? "", image: t?.photo, size: 64)
                        Text("还没有消息，打个招呼吧").font(.subheadline).foregroundStyle(.secondary)
                    }
                    .transition(.opacity.combined(with: .scale(scale: 0.95)))
                } else {
                    ProgressView()
                }
            }
        }
        .background(DeskBackground())
        .safeAreaInset(edge: .bottom) {
            PhoneComposer(placeholder: "发消息…", onSend: { text in
                Task { if !(await chat.sendText(topic, text)) { desk.say("没发出去，检查一下网络") } }
            }, plus: { showPlus = true }, onVoice: { wav, ms, preview in
                Task { if !(await chat.sendVoice(topic, wav: wav, ms: ms, preview: preview)) { desk.say("语音没发出去，检查一下网络") } }
            })
            .padding(.horizontal, 14).padding(.bottom, 6)
        }
        .navigationTitle(t?.name ?? "聊天")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            // One-to-one chats: a voice call (company-phone-call-v1).
            if topic.hasPrefix("usr") {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task {
                            if !(await calls.dial(topic)) { desk.say(calls.ready ? "没打出去，稍后再试" : "通话还没准备好，稍等几秒再试") }
                        }
                    } label: { Image(systemName: "phone") }
                    .accessibilityLabel("语音通话")
                }
            }
        }
        .sheet(isPresented: $showPlus) {
            PlusSheet { p in Task { await send(p) } }.environmentObject(desk)
        }
        .sheet(item: $file) { f in ChatFileSheet(file: f).environmentObject(desk).environmentObject(session) }
        .task {
            await chat.enter(topic)
            withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) { entered = true }
        }
        .onDisappear { chat.leave(topic) }
    }

    @ViewBuilder private func bubble(_ m: ChatMessage) -> some View {
        if m.call != nil {
            callNote(m)
        } else if m.aiOkOf != nil {
            AssistantAnswerNote(m: m, list: list)
        } else if m.ai {
            AssistantCard(m: m, topic: topic, list: list)
        } else {
            plainBubble(m)
        }
    }

    /// A call, as the desks show it: one line in the middle (语音通话 0:36, 对方未接听…); tap it to call back.
    private func callNote(_ m: ChatMessage) -> some View {
        let mine = m.from == chat.me
        let secs = m.callMs / 1000
        let text: String = switch m.call ?? "" {
        case "finished": "语音通话" + (secs > 0 ? String(format: " %d:%02d", secs / 60, secs % 60) : "")
        case "missed": mine ? "对方未接听" : "未接的语音通话"
        case "declined": mine ? "对方已拒绝" : "已拒绝语音通话"
        case "busy": mine ? "对方忙" : "未接的语音通话"
        case "disconnected": "通话中断"
        default: "语音通话"
        }
        return Button {
            guard topic.hasPrefix("usr") else { return }
            Task { if !(await calls.dial(topic)) { desk.say("没打出去，稍后再试") } }
        } label: {
            Label(text, systemImage: m.call == "missed" && !mine ? "phone.arrow.down.left" : "phone")
                .font(.footnote).foregroundStyle(m.call == "missed" && !mine ? Color.red : .secondary)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .glass(Capsule())
        }
        .buttonStyle(PressStyle())
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private func plainBubble(_ m: ChatMessage) -> some View {
        let mine = m.from == chat.me
        let who = chat.people[m.from]
        HStack(alignment: .top, spacing: 10) {
            if mine { Spacer(minLength: 56) } else { Avatar(name: who?.name ?? "同事", image: who?.photo, size: 40) }
            VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
                if !mine && (t?.group ?? false) { Text(who?.name ?? "同事").font(.caption).foregroundStyle(.secondary) }
                if let card = m.card {
                    TaskCardView(card: card)
                } else if let f = m.attachments.first(where: { $0.kind == .file }) {
                    // A file with the words that came with it, as one card.
                    Button { Task { await open(f, m) } } label: { FileCard(a: f, text: m.text, opening: opening == m.seq) }
                        .buttonStyle(PressStyle())
                } else if !m.text.isEmpty {
                    Text(m.text)
                        .textSelection(.enabled)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .frosted(RoundedRectangle(cornerRadius: 18, style: .continuous),
                                 wash: mine ? Color(red: 0.82, green: 0.88, blue: 0.99) : .white, amount: mine ? 0.75 : 0.6)
                        .opacity(m.pending ? 0.6 : 1)
                }
                if m.card == nil {
                    ForEach(Array(m.attachments.filter { $0.kind != .file }.enumerated()), id: \.offset) { _, a in attachment(a, m) }
                }
            }
            if mine { Avatar(name: chat.people[chat.me]?.name ?? "我", image: chat.people[chat.me]?.photo, size: 40) }
            else { Spacer(minLength: 56) }
        }
    }

    @ViewBuilder private func attachment(_ a: ChatAttachment, _ m: ChatMessage) -> some View {
        switch a.kind {
        case .image:
            Button { Task { await open(a, m) } } label: {
                Group {
                    if let d = a.inline, let img = UIImage(data: d) {
                        Image(uiImage: img).resizable().scaledToFill()
                    } else {
                        Color.secondary.opacity(0.12).overlay(Image(systemName: "photo").foregroundStyle(.secondary))
                    }
                }
                .frame(width: imgSize(a).width, height: imgSize(a).height)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.white.opacity(0.8), lineWidth: 1))
                .shadow(color: Color(red: 0.12, green: 0.2, blue: 0.35).opacity(0.1), radius: 12, y: 5)
                .overlay { if opening == m.seq { ProgressView() } }
            }
            .buttonStyle(PressStyle())
        case .file:
            Button { Task { await open(a, m) } } label: {
                HStack(spacing: 12) {
                    let ext = (a.name as NSString).pathExtension.uppercased()
                    Text(ext.isEmpty ? "FILE" : String(ext.prefix(4))).font(.caption2.weight(.heavy)).foregroundStyle(.white)
                        .frame(width: 40, height: 40).background(Self.extColor(ext), in: RoundedRectangle(cornerRadius: 10))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(a.name).font(.subheadline).lineLimit(2)
                        Text(opening == m.seq ? "正在打开…" : Self.size(a.size) + " · 点开预览").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .padding(12)
                .frame(maxWidth: 260, alignment: .leading)
                .frosted(RoundedRectangle(cornerRadius: 18, style: .continuous), amount: 0.65)
            }
            .buttonStyle(PressStyle()).foregroundStyle(.primary)
        case .audio:
            VoiceBubble(a: a, mine: m.from == chat.me)
        }
    }

    private func imgSize(_ a: ChatAttachment) -> CGSize {
        let w = CGFloat(max(a.width, 1)), h = CGFloat(max(a.height, 1))
        let maxW: CGFloat = 200, maxH: CGFloat = 240
        let s = min(maxW / w, maxH / h, 1.0 * 4)
        return CGSize(width: max(80, min(maxW, w * s)), height: max(80, min(maxH, h * s)))
    }

    private func open(_ a: ChatAttachment, _ m: ChatMessage) async {
        guard opening == nil else { return }
        opening = m.seq
        let d = await chat.fetch(a)
        opening = nil
        guard let d else { desk.say("文件没取下来，稍后再试"); return }
        file = ChatFile(name: a.name, mime: a.mime, data: d)
    }

    private func send(_ p: PlusPick) async {
        switch p {
        case .image(let img, let data, let name):
            desk.say("正在发送图片…")
            if !(await chat.sendFile(topic, name: name, mime: "image/jpeg", data: data, image: img)) { desk.say("图片没发出去") }
        case .file(let name, let mime, let data):
            desk.say("正在发送 " + name)
            if !(await chat.sendFile(topic, name: name, mime: mime, data: data)) { desk.say("文件没发出去") }
        case .doc(let a):
            let r = await desk.forward(a.path, to: [topic], note: "")
            desk.say(r.error == nil ? "已发送「\(a.title)」" : "没发出去：" + (r.error ?? ""))
        }
    }

    private func older(_ proxy: ScrollViewProxy) async {
        guard !olderBusy, !noMore else { return }
        olderBusy = true
        let anchor = list.first?.id
        let more = await chat.loadOlder(topic)
        olderBusy = false
        if !more { noMore = true } else if let anchor { proxy.scrollTo(anchor, anchor: .top) }
    }

    private func stamp(_ d: Date) -> String {
        let time = d.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits))
        return Calendar.current.isDateInToday(d) ? time : d.chatWhen + " " + time
    }

    static func size(_ n: Int) -> String {
        n <= 0 ? "" : ByteCountFormatter.string(fromByteCount: Int64(n), countStyle: .file)
    }

    static func extColor(_ ext: String) -> Color {
        switch ext {
        case "PDF": return .red
        case "DOC", "DOCX": return .blue
        case "XLS", "XLSX", "CSV": return .green
        case "PPT", "PPTX": return .orange
        default: return .gray
        }
    }
}

/// A voice message, WeChat's way: a bubble as long as the message is long, its waveform, tap to play (the bars fill as
/// it plays); its words underneath once the server has written them out (asked again while it is still at it).
private struct VoiceBubble: View {
    @EnvironmentObject var chat: ChatStore
    @EnvironmentObject var session: Session
    let a: ChatAttachment
    let mine: Bool
    @State private var player: AVAudioPlayer?
    @State private var playing = false
    @State private var progress: Double = 0
    @State private var words = ""
    @State private var gist = ""

    private var secs: Int { max(1, Int((Double(a.duration) / 1000).rounded())) }

    var body: some View {
        VStack(alignment: mine ? .trailing : .leading, spacing: 6) {
            Button { Task { await play() } } label: {
                HStack(spacing: 8) {
                    Image(systemName: playing ? "pause.fill" : "play.fill").font(.footnote).frame(width: 14)
                    bars
                    Text("\(secs)″").font(.subheadline.monospacedDigit())
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                .frame(width: min(230, 110 + CGFloat(secs) * 3), alignment: .leading)
                .frosted(RoundedRectangle(cornerRadius: 18, style: .continuous),
                         wash: mine ? Color(red: 0.82, green: 0.88, blue: 0.99) : .white, amount: mine ? 0.75 : 0.6)
            }
            .buttonStyle(PressStyle()).foregroundStyle(Color.ink)
            if !gist.isEmpty || !words.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    if !gist.isEmpty { Text("要点：" + gist).font(.footnote.weight(.semibold)) }
                    if !words.isEmpty { Text(words).font(.footnote).foregroundStyle(.secondary) }
                }
                .textSelection(.enabled)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .frame(maxWidth: 250, alignment: .leading)
                .frosted(RoundedRectangle(cornerRadius: 14, style: .continuous), amount: 0.4)
                .transition(.rise)
            }
        }
        .animation(.spring(response: 0.45, dampingFraction: 0.8), value: words)
        .task { await transcribe() }
    }

    private var bars: some View {
        let peaks = a.preview.isEmpty ? Array(repeating: UInt8(90), count: 16) : a.preview
        let n = min(24, max(8, secs + 6))
        return HStack(spacing: 2) {
            ForEach(0..<n, id: \.self) { i in
                let v = Double(peaks[min(peaks.count - 1, i * peaks.count / n)]) / 255
                Capsule()
                    .fill(Double(i) / Double(n) < progress ? Color.ink : Color.ink.opacity(0.3))
                    .frame(width: 2.5, height: 4 + 14 * max(0.15, v))
            }
        }
        .frame(height: 20)
    }

    private func play() async {
        if playing { player?.stop(); playing = false; progress = 0; return }
        guard let d = await chat.fetch(a) else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        guard let p = try? AVAudioPlayer(data: d) else { return }
        player = p
        p.play()
        playing = true
        let len = max(0.3, p.duration)
        let t0 = Date()
        while playing && p.isPlaying {
            withAnimation(.linear(duration: 0.1)) { progress = min(1, Date().timeIntervalSince(t0) / len) }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        playing = false
        withAnimation(.easeOut(duration: 0.3)) { progress = 0 }
    }

    private func transcribe() async {
        guard let ref = a.ref, let tok = session.person?.gwToken else { return }
        for wait in [0, 4, 8, 15, 30] {
            if wait > 0 { try? await Task.sleep(nanoseconds: UInt64(wait) * 1_000_000_000) }
            guard let (code, j) = try? await Net.postJSON("/company/ext/chat/voice", ["ref": ref], token: tok, timeout: 15), code == 200 else { continue }
            if let t = j["text"] as? String, !t.isEmpty {
                words = t
                gist = (j["gist"] as? String) ?? ""
                return
            }
            if (j["pending"] as? Bool) != true { return }
        }
    }
}

/// A call's minutes as the server writes them (chat_call.card_text): 「【TDH 助手】通话纪要（甲 与 乙，11月25日 21:11，36秒）」,
/// then 要点 / 定下的事 / 待办, one 「· 」 line each (a to-do 「· 谁：什么（截止 …）」), or one plain line.
struct CallMinutes {
    var a = "", b = "", when = "", length = ""
    var points: [String] = []
    var decisions: [String] = []
    var todos: [(who: String, what: String, due: String)] = []
    var plain: [String] = []

    init?(_ text: String) {
        var lines = text.components(separatedBy: "\n")
        guard let first = lines.first, first.contains("通话纪要（") else { return nil }
        lines.removeFirst()
        let head = first.replacingOccurrences(of: "【TDH 助手】", with: "")
        if let r = head.range(of: #"通话纪要（(.+?) 与 (.+?)，(.+?)，(.+?)）"#, options: .regularExpression) {
            let inner = String(head[r]).dropFirst(5).dropLast()
            let parts = inner.components(separatedBy: "，")
            let who = (parts.first ?? "").components(separatedBy: " 与 ")
            a = who.first ?? ""
            b = who.count > 1 ? who[1] : ""
            when = parts.count > 1 ? parts[1] : ""
            length = parts.count > 2 ? parts[2] : ""
        }
        var section = ""
        for raw in lines {
            let l = raw.trimmingCharacters(in: .whitespaces)
            if l.isEmpty { continue }
            if ["要点：", "定下的事：", "待办："].contains(l) { section = l; continue }
            guard l.hasPrefix("·") else { plain.append(l); continue }
            let item = l.dropFirst().trimmingCharacters(in: .whitespaces)
            switch section {
            case "要点：": points.append(item)
            case "定下的事：": decisions.append(item)
            case "待办：":
                var who = "", what = item, due = ""
                if let c = item.firstIndex(of: "：") { who = String(item[..<c]); what = String(item[item.index(after: c)...]) }
                if let r = what.range(of: #"（截止 (.+)）$"#, options: .regularExpression) {
                    due = String(what[r]).replacingOccurrences(of: "（截止 ", with: "").replacingOccurrences(of: "）", with: "")
                    what = String(what[..<r.lowerBound])
                }
                todos.append((who, what, due))
            default: plain.append(item)
            }
        }
    }
}

/// The minutes, laid out (the user, 2026-11-25: 「通话纪要 能不能排个版 好丑」): who and when under the title, the length
/// at the corner, then 要点 / 定下的事 / 待办 each under its own coloured mark, a to-do with its owner and its due time.
struct CallMinutesCard: View {
    let minutes: CallMinutes
    let people: [ChatPerson]
    /// Inside TDH 助手's card (which has the frame and the answer buttons): the minutes only.
    var bare = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "phone.bubble.fill").font(.system(size: 18, weight: .semibold)).foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(LinearGradient(colors: [Color(red: 0.36, green: 0.55, blue: 0.98), Color(red: 0.55, green: 0.42, blue: 0.95)],
                                               startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text("通话纪要").font(.headline).foregroundStyle(Color.ink)
                    if !minutes.a.isEmpty {
                        Text(minutes.a + " 与 " + minutes.b).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    if !minutes.when.isEmpty { Text(minutes.when).font(.caption2).foregroundStyle(.tertiary) }
                }
                Spacer(minLength: 0)
                if !minutes.length.isEmpty {
                    Label(minutes.length, systemImage: "clock").font(.caption.weight(.medium)).foregroundStyle(.secondary)
                        .padding(.horizontal, 9).padding(.vertical, 4)
                        .background(Color.ink.opacity(0.05), in: Capsule())
                }
            }
            if !minutes.points.isEmpty { section("要点", "text.alignleft", .blue) { bullets(minutes.points, .blue) } }
            if !minutes.decisions.isEmpty { section("定下的事", "checkmark.seal.fill", .green) { bullets(minutes.decisions, .green) } }
            if !minutes.todos.isEmpty {
                section("待办", "checklist", .orange) {
                    VStack(spacing: 8) {
                        ForEach(Array(minutes.todos.enumerated()), id: \.offset) { _, t in
                            HStack(alignment: .top, spacing: 10) {
                                Avatar(name: t.who, image: people.first { $0.name == t.who }?.photo, size: 26)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(t.what).font(.subheadline).foregroundStyle(Color.ink).fixedSize(horizontal: false, vertical: true)
                                    HStack(spacing: 6) {
                                        Text(t.who).font(.caption.weight(.medium)).foregroundStyle(.secondary)
                                        if !t.due.isEmpty {
                                            Label(t.due, systemImage: "calendar").font(.caption2.weight(.medium)).foregroundStyle(.orange)
                                                .padding(.horizontal, 7).padding(.vertical, 2)
                                                .background(Color.orange.opacity(0.12), in: Capsule())
                                        }
                                    }
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(10)
                            .background(.white.opacity(0.55), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                    }
                }
            }
            if !minutes.plain.isEmpty {
                Text(minutes.plain.joined(separator: "\n")).font(.subheadline).foregroundStyle(.secondary)
            }
            HStack(spacing: 5) {
                Image(systemName: "sparkles").font(.caption2)
                Text("TDH 助手根据通话自动整理").font(.caption2)
            }
            .foregroundStyle(.tertiary)
        }
        .textSelection(.enabled)
        .modifier(MinutesFrame(on: !bare))
    }

    private func section<C: View>(_ title: String, _ icon: String, _ tint: Color, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: icon).font(.caption.weight(.bold)).foregroundStyle(tint)
            content()
        }
    }

    private func bullets(_ items: [String], _ tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, x in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Circle().fill(tint.opacity(0.7)).frame(width: 5, height: 5).alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
                    Text(x).font(.subheadline).foregroundStyle(Color.ink).lineSpacing(2).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

/// The minutes' own frame (left off inside TDH 助手's card, which has one).
private struct MinutesFrame: ViewModifier {
    let on: Bool
    func body(content: Content) -> some View {
        if on {
            content
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .frosted(RoundedRectangle(cornerRadius: 24, style: .continuous), amount: 0.7)
                .padding(.horizontal, 6)
        } else {
            content
        }
    }
}
