// company-phone-notices-v1 (the user, 2026-11-25: 「chat 聊天界面如果有消息 怎么提醒！ AI如果刚刚问了问题 已经出答案了怎么提醒」):
// while the app is open, a glass banner at the top — a colleague's message (not in the chat on screen), or the AI's
// answer (not on the AI page) — with a tap of the phone; a tap on it opens that chat or that conversation.
import AudioToolbox
import SwiftUI
import UserNotifications

struct Banner: Identifiable, Equatable {
    enum Kind { case chat, ai }
    let id = UUID()
    let kind: Kind
    /// chat: the topic; ai: the session id.
    let target: String
    let title: String
    let body: String
    var photo: UIImage?

    static func == (a: Banner, b: Banner) -> Bool { a.id == b.id }
}

/// The system's own notifications of a chat (company-phone-push-v1), cleared once it is read here or on the desk.
enum ChatNotices {
    static func clear(topic: String, upTo seq: Int, done: (() -> Void)? = nil) {
        let c = UNUserNotificationCenter.current()
        c.getDeliveredNotifications { list in
            let ids = list.filter {
                $0.request.content.threadIdentifier == topic
                    && (($0.request.content.userInfo["seq"] as? Int) ?? 0) <= seq
            }.map(\.request.identifier)
            if !ids.isEmpty { c.removeDeliveredNotifications(withIdentifiers: ids) }
            done?()
        }
    }
}

/// The banner: glass, the sender's face or the AI's mark, two lines; it slides down, stays four seconds, and goes up
/// on its own or with a flick upward.
struct BannerView: View {
    let banner: Banner
    let onTap: () -> Void
    let onDismiss: () -> Void
    @State private var drag: CGFloat = 0

    var body: some View {
        HStack(spacing: 12) {
            switch banner.kind {
            case .chat:
                Avatar(name: banner.title, image: banner.photo, size: 40)
            case .ai:
                Image(systemName: "sparkles")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(LinearGradient(colors: [Color(red: 0.66, green: 0.78, blue: 0.98), Color(red: 0.46, green: 0.58, blue: 0.90)],
                                               startPoint: .topLeading, endPoint: .bottomTrailing), in: Circle())
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(banner.title).font(.subheadline.weight(.semibold)).foregroundStyle(Color.ink).lineLimit(1)
                Text(banner.body).font(.subheadline).foregroundStyle(Color.ink.opacity(0.62)).lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(Color.paper.opacity(0.5), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .glass(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: Color(red: 0.12, green: 0.2, blue: 0.35).opacity(0.14), radius: 18, y: 8)
        .padding(.horizontal, 12)
        .offset(y: min(0, drag))
        .contentShape(Rectangle())
        .onTapGesture { onTap() }
        .gesture(
            DragGesture(minimumDistance: 6)
                .onChanged { drag = $0.translation.height }
                .onEnded { v in
                    if v.translation.height < -24 { onDismiss() } else { withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { drag = 0 } }
                }
        )
        .task(id: banner.id) {
            var stay: UInt64 = 4_000_000_000
            #if DEBUG
            if UserDefaults.standard.bool(forKey: "tdhBannerTest") { stay = 30_000_000_000 }
            #endif
            try? await Task.sleep(nanoseconds: stay)
            onDismiss()
        }
    }

    /// The tap that comes with it: a light buzz, and the message tone for a message.
    static func announce(_ b: Banner) {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        if b.kind == .chat { AudioServicesPlaySystemSound(1003) }
    }
}
