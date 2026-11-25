// company-phone-cards-v1 (the user, 2026-11-25: 「除了纪要 任务卡也要排版 功能性的信息 包括文件工件 都要」): the chat's
// working messages drawn as what they are, as the desks' chat page draws them (server/chat/tdh-web/app.js): a task card
// (head tdh_card), TDH 助手's cards (head tdh_ai) with their 记下 / 不用 kind of answers (head tdh_ai_ok), and files and
// forwarded documents (an attachment, a 「📎 title」 line) as cards to open.
import SwiftUI

/// TDH 助手's words for each kind of card (the chat page's AI_WORDS).
struct AIWords {
    let label: String
    var yes: String? = nil
    var no: String? = nil
    var sayYes = ""
    var sayNo = ""
    var noteYes = ""
    var noteNo = ""
    var doneYes: (String) -> String = { _ in "" }
    var doneNo: (String) -> String = { _ in "" }
    var wait = ""
    let icon: String
    let tint: Color

    static func of(_ kind: String) -> AIWords {
        switch kind {
        case "task":
            return AIWords(label: "任务卡", yes: "记下", no: "不用", sayYes: "记下", sayNo: "不用记", noteYes: " 记下了这张任务卡", noteNo: " 说不用记",
                           doneYes: { "✓ \($0) 记下了" }, doneNo: { "\($0)：不用记" }, wait: " 决定", icon: "checklist", tint: .orange)
        case "task-made":
            return AIWords(label: "任务卡", icon: "checklist", tint: .orange)
        case "doc-saved":
            return AIWords(label: "财务单据", no: "撤销", sayNo: "撤销", noteNo: " 撤销了这张单据", doneNo: { "\($0) 撤销了这张单据" },
                           icon: "doc.text.magnifyingglass", tint: .green)
        case "doc-ask":
            return AIWords(label: "财务单据", yes: "存进财务", no: "不用", sayYes: "存进财务", sayNo: "不用存", noteYes: " 把它存进了财务",
                           noteNo: " 说不用存", doneYes: { "✓ \($0) 存进了财务" }, doneNo: { "\($0)：不用存" }, wait: " 决定",
                           icon: "doc.text.magnifyingglass", tint: .green)
        case "doc-note":
            return AIWords(label: "财务单据", icon: "doc.text.magnifyingglass", tint: .green)
        case "kb-ask":
            return AIWords(label: "知识库", yes: "放进去", no: "不放", sayYes: "放进去", sayNo: "不放", noteYes: " 让 TDH 收进知识库",
                           noteNo: " 说不放进知识库", doneYes: { "✓ \($0) 让它收进知识库" }, doneNo: { "\($0)：不放进知识库" }, wait: " 决定",
                           icon: "books.vertical", tint: .purple)
        case "kb-note":
            return AIWords(label: "知识库", icon: "books.vertical", tint: .purple)
        case "call-note":
            return AIWords(label: "通话纪要", yes: "转成任务卡", no: "不用", sayYes: "把纪要里的待办转成任务卡", sayNo: "待办不用转任务卡",
                           noteYes: " 把纪要里的待办转成了任务卡", noteNo: " 说待办不用转任务卡", doneYes: { "✓ \($0) 转成了任务卡" },
                           doneNo: { "\($0)：不用转任务卡" }, wait: " 决定", icon: "phone.bubble.fill", tint: .indigo)
        default:
            return AIWords(label: "自动查询", yes: "确认无误", no: "有误", sayYes: "确认无误", sayNo: "这条数据有误，我来核对",
                           noteYes: " 确认了 TDH 助手的数据", noteNo: " 说 TDH 助手的数据有误，正在核对", doneYes: { "✓ \($0) 确认无误" },
                           doneNo: { "✗ \($0)：有误，正在核对" }, wait: " 确认", icon: "chart.bar.doc.horizontal", tint: .blue)
        }
    }
}

/// TDH 助手's card: what kind it is, what it says (a call's minutes laid out as minutes), and at its foot either the
/// buttons for the one who decides, who decided what, or whom it waits for.
struct AssistantCard: View {
    @EnvironmentObject var chat: ChatStore
    let m: ChatMessage
    let topic: String
    let list: [ChatMessage]
    @State private var sending = false

    private var words: AIWords { AIWords.of(m.aiKind) }
    /// The answer that counts: the first from one of those who decide (anyone, when nobody is named).
    private var answer: ChatMessage? {
        list.first { $0.aiOkOf == m.seq && (m.aiDeciders.isEmpty || m.aiDeciders.contains($0.from)) }
    }
    private func name(_ uid: String) -> String { uid == chat.me ? "我" : chat.people[uid]?.name ?? "同事" }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if m.aiKind == "call-note", let minutes = CallMinutes(m.text) {
                CallMinutesCard(minutes: minutes, people: Array(chat.people.values), bare: true)
            } else {
                HStack(spacing: 8) {
                    Image(systemName: words.icon).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                        .frame(width: 26, height: 26).background(words.tint.gradient, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    Text("TDH 助手 · " + words.label).font(.caption.weight(.semibold)).foregroundStyle(words.tint)
                    Spacer()
                }
                Text(m.text.replacingOccurrences(of: "【TDH 助手】", with: "").trimmingCharacters(in: .whitespacesAndNewlines))
                    .font(.subheadline).foregroundStyle(Color.ink).lineSpacing(3).textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            foot
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frosted(RoundedRectangle(cornerRadius: 24, style: .continuous), amount: 0.7)
        .padding(.horizontal, 6)
    }

    @ViewBuilder private var foot: some View {
        if let a = answer {
            // The mark is the icon; the words without the ✓ / ✗ the desks put in front.
            let said = (a.aiOk ? words.doneYes(name(a.from)) : words.doneNo(name(a.from)))
                .replacingOccurrences(of: "✓ ", with: "").replacingOccurrences(of: "✗ ", with: "")
            if !said.isEmpty {
                Label(said, systemImage: a.aiOk ? "checkmark.circle.fill" : "xmark.circle")
                    .font(.footnote.weight(.medium)).foregroundStyle(a.aiOk ? Color.green : .secondary)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background((a.aiOk ? Color.green : Color.ink).opacity(0.08), in: Capsule())
                    .transition(.rise)
            }
        } else if words.no != nil && m.aiDeciders.contains(chat.me) {
            HStack(spacing: 10) {
                if let yes = words.yes {
                    Button { Task { await say(true) } } label: {
                        Text(yes).font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity).frame(height: 40)
                    }
                    .glass(Capsule(), tint: .ink, interactive: true).foregroundStyle(.white)
                }
                if let no = words.no {
                    Button { Task { await say(false) } } label: {
                        Text(no).font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity).frame(height: 40)
                    }
                    .glass(Capsule(), interactive: true).foregroundStyle(Color.ink)
                }
            }
            .disabled(sending)
            .opacity(sending ? 0.5 : 1)
        } else if words.no != nil && !m.aiDeciders.isEmpty && !words.wait.isEmpty {
            Text("等 " + m.aiDeciders.map(name).joined(separator: " 或 ") + words.wait)
                .font(.footnote).foregroundStyle(.secondary)
        }
    }

    private func say(_ ok: Bool) async {
        sending = true
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        _ = await chat.answerAi(topic, of: m.seq, ok: ok, say: ok ? words.sayYes : words.sayNo)
        sending = false
    }
}

/// An answer to one of TDH 助手's cards, as one quiet line in the middle (「郑飞飞 记下了这张任务卡」).
struct AssistantAnswerNote: View {
    @EnvironmentObject var chat: ChatStore
    let m: ChatMessage
    let list: [ChatMessage]

    var body: some View {
        let target = list.first { $0.seq == m.aiOkOf }
        let w = AIWords.of(target?.aiKind ?? "")
        let who = m.from == chat.me ? "我" : chat.people[m.from]?.name ?? "同事"
        Text(who + (m.aiOk ? w.noteYes : w.noteNo))
            .font(.caption).foregroundStyle(.secondary)
            .padding(.horizontal, 12).padding(.vertical, 5)
            .glass(Capsule())
            .frame(maxWidth: .infinity)
    }
}

/// A task card (head tdh_card): what happened to it in colour, its title, who does it by when, the note.
struct TaskCardView: View {
    let card: TaskCard

    private var event: (String, Color, String) {
        switch card.event {
        case "issued": return ("下达了任务卡", .blue, "paperplane.fill")
        case "submitted": return ("提交验收", .purple, "tray.and.arrow.up.fill")
        case "passed": return ("验收通过", .green, "checkmark.seal.fill")
        case "returned": return ("打回了", .red, "arrow.uturn.backward.circle.fill")
        case "cancelled": return ("作废了", .gray, "xmark.circle.fill")
        case "due": return ("改了截止时间", .orange, "calendar.badge.clock")
        default: return ("任务卡", .orange, "checklist")
        }
    }

    var body: some View {
        let (label, tint, icon) = event
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Text("任务卡").font(.caption2.weight(.bold)).foregroundStyle(.white)
                    .padding(.horizontal, 7).padding(.vertical, 3).background(Color.orange.gradient, in: Capsule())
                Spacer()
                Label(label, systemImage: icon).font(.caption.weight(.semibold)).foregroundStyle(tint)
            }
            Text(card.title).font(.headline).foregroundStyle(card.event == "cancelled" ? Color.secondary : Color.ink)
                .strikethrough(card.event == "cancelled", color: .secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                if !card.to.isEmpty {
                    Label("负责人 " + card.to, systemImage: "person.fill").font(.caption).foregroundStyle(.secondary)
                }
                if let d = card.due {
                    Label("截止 " + d.formatted(.dateTime.month().day().hour().minute()), systemImage: "calendar")
                        .font(.caption.weight(.medium)).foregroundStyle(d < Date() && card.event != "passed" ? Color.red : .orange)
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background((d < Date() && card.event != "passed" ? Color.red : Color.orange).opacity(0.1), in: Capsule())
                }
            }
            if !card.note.isEmpty {
                Text(card.note).font(.subheadline).foregroundStyle(Color.ink.opacity(0.85))
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.paper.opacity(0.55), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            Text("在电脑 TDH 左栏「任务」里查看和处理").font(.caption2).foregroundStyle(.tertiary)
        }
        .padding(14)
        .frame(width: 272, alignment: .leading)
        .frosted(RoundedRectangle(cornerRadius: 20, style: .continuous), amount: 0.75)
        .overlay(alignment: .leading) {
            UnevenRoundedRectangle(topLeadingRadius: 20, bottomLeadingRadius: 20, style: .continuous)
                .fill(tint.gradient).frame(width: 4)
        }
    }
}

/// A file (or a forwarded document: an HTML attachment under a 「📎 title」 line) as a card: its kind in colour, its
/// name, how big, and the words that came with it.
struct FileCard: View {
    let a: ChatAttachment
    let text: String
    let opening: Bool

    private var ext: String { (a.name as NSString).pathExtension.uppercased() }
    private var isDoc: Bool { ext == "HTML" || ext == "HTM" || a.mime == "text/html" }
    private var title: String {
        if isDoc, let l = text.components(separatedBy: "\n").first(where: { $0.hasPrefix("📎") }) {
            return l.replacingOccurrences(of: "📎", with: "").trimmingCharacters(in: .whitespaces)
        }
        return a.name
    }
    private var note: String {
        text.components(separatedBy: "\n").filter { !$0.hasPrefix("📎") }.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }
    private var look: (String, Color) {
        if isDoc { return ("doc.richtext.fill", .indigo) }
        switch ext {
        case "PDF": return ("doc.fill", .red)
        case "DOC", "DOCX": return ("doc.text.fill", .blue)
        case "XLS", "XLSX", "CSV": return ("tablecells.fill", .green)
        case "PPT", "PPTX": return ("rectangle.on.rectangle.angled.fill", .orange)
        case "ZIP", "RAR", "7Z": return ("archivebox.fill", .brown)
        case "TXT", "MD": return ("doc.plaintext.fill", .gray)
        default: return ("doc.fill", .gray)
        }
    }

    var body: some View {
        let (icon, tint) = look
        VStack(alignment: .leading, spacing: 10) {
            if !note.isEmpty {
                Text(note).font(.subheadline).foregroundStyle(Color.ink).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 12) {
                ZStack(alignment: .bottomTrailing) {
                    Image(systemName: icon).font(.system(size: 22)).foregroundStyle(.white)
                        .frame(width: 46, height: 46).background(tint.gradient, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    if !ext.isEmpty && !isDoc {
                        Text(String(ext.prefix(4))).font(.system(size: 8, weight: .heavy)).foregroundStyle(tint)
                            .padding(.horizontal, 3).padding(.vertical, 1)
                            .background(Color.paper, in: RoundedRectangle(cornerRadius: 3)).offset(x: 4, y: 4)
                    }
                }
                VStack(alignment: .leading, spacing: 3) {
                    if isDoc {
                        Text("文档").font(.caption2.weight(.bold)).foregroundStyle(tint)
                    }
                    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Color.ink).lineLimit(2)
                    Text(opening ? "正在打开…" : [isDoc ? "" : ext, ChatRoom.size(a.size), "点开查看"].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
        }
        .padding(12)
        .frame(width: 262, alignment: .leading)
        .frosted(RoundedRectangle(cornerRadius: 20, style: .continuous), amount: 0.7)
    }
}
