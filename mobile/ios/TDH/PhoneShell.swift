// The phone app's own frame around the server desk (company-phone-layout-v1): the 工件 list and the settings sheet.
// Settings used to be a 我 tab; like most phone assistants it is now a sheet from the gear, which frees the tab for 工件.
import SwiftUI

struct ArtifactsTab: View {
    @EnvironmentObject var desk: DeskModel
    @Binding var tab: Int
    @Binding var showSettings: Bool
    @State private var rows: [DeskArtifact] = []
    @State private var loading = true
    @State private var query = ""

    private var shown: [DeskArtifact] {
        let q = query.trimmingCharacters(in: .whitespaces)
        return q.isEmpty ? rows : rows.filter { $0.title.localizedCaseInsensitiveContains(q) }
    }

    var body: some View {
        NavigationStack {
            List {
                if !shown.isEmpty {
                    Section {
                        ForEach(shown) { a in
                            Button { openOnDesk() } label: { ArtifactRow(a: a) }.foregroundStyle(.primary)
                        }
                    } footer: {
                        Text("工件是助手在会话里做出来的文件，电脑上也能看到同一份。")
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
                ToolbarItem(placement: .topBarTrailing) {
                    Button { openOnDesk() } label: { Image(systemName: "rectangle.stack") }.accessibilityLabel("在助手里打开工件栏")
                }
            }
        }
        .task(id: desk.ready) { await load() }
    }

    /// v1: the desk's own artifact panel, full screen in the 助手 tab (opening one artifact by itself comes next).
    private func openOnDesk() {
        tab = 1
        desk.showArtifacts()
    }

    private func load() async {
        if !desk.ready { loading = !desk.failed.isEmpty ? false : true; return }
        loading = true
        rows = await desk.artifacts()
        loading = false
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
        if t.contains("html") || t.contains("web") { return "globe" }
        return "doc.text"
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
