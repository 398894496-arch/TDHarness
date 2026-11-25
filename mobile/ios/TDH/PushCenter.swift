// company-phone-push-v1 (the user, 2026-11-25: 「连后台推送一起」): the phone's side of the notifications server/push.py
// sends through Apple (APNs) while the app is in the background or the phone is locked:
//   - asks once to notify, registers with Apple, gives the server its address (POST /company/ext/chat/push) after
//     sign-in, and takes it back at sign-out;
//   - a notification tapped opens its chat or its conversation;
//   - while the app is open, its own banners speak (company-phone-notices-v1), so Apple's are not shown again;
//   - a silent push of what was read elsewhere (the desk) clears those chats' notifications and sets the badge.
import SwiftUI
import UIKit
import UserNotifications

final class PushAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in PushCenter.shared.gotToken(hex) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        #if DEBUG
        print("DEBUG_PUSH register failed \(error.localizedDescription)")
        #endif
    }

    /// A silent push: chats read elsewhere ("r": [[topic, seq]…]) and the new count ("b"; a silent push carries no
    /// badge of Apple's). The app is told it is done only once the list and the badge are changed, since iOS may
    /// suspend it right after.
    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any],
                     fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        let group = DispatchGroup()
        if let pairs = userInfo["r"] as? [[Any]] {
            for p in pairs where p.count == 2 {
                if let topic = p[0] as? String, let seq = (p[1] as? NSNumber)?.intValue {
                    group.enter()
                    ChatNotices.clear(topic: topic, upTo: seq) { group.leave() }
                }
            }
        }
        if let badge = (userInfo["b"] as? NSNumber)?.intValue {
            group.enter()
            UNUserNotificationCenter.current().setBadgeCount(max(0, badge)) { _ in group.leave() }
        }
        group.notify(queue: .main) {
            #if DEBUG
            print("DEBUG_PUSH silent read=\((userInfo["r"] as? [[Any]])?.count ?? 0) badge=\(String(describing: userInfo["b"]))")
            #endif
            completionHandler(.newData)
        }
    }

    /// While the app is open its own banner has already said it.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        let kind = info["k"] as? String ?? ""
        let target = (kind == "ai" ? info["s"] : info["t"]) as? String ?? ""
        Task { @MainActor in
            if !target.isEmpty { PushCenter.shared.opened = Banner(kind: kind == "ai" ? .ai : .chat, target: target, title: "", body: "") }
            completionHandler()
        }
    }
}

@MainActor
final class PushCenter: ObservableObject {
    static let shared = PushCenter()

    /// A notification tapped: the app opens what it is about (MainView follows it as it follows a banner).
    @Published var opened: Banner?

    private var token = ""
    private var gwToken = ""
    private var sent = ""

    /// Apple's server for this build's tokens: what its signing says (aps-environment in the embedded provisioning
    /// profile: development → sandbox, production → production). A build without one (the App Store's) is
    /// production; a debug build with none (the simulator) the sandbox.
    private let env: String = {
        if let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
           let data = try? Data(contentsOf: url),
           let text = String(data: data, encoding: .isoLatin1),
           let start = text.range(of: "<?xml"), let end = text.range(of: "</plist>", range: start.lowerBound..<text.endIndex),
           let plist = try? PropertyListSerialization.propertyList(from: Data(text[start.lowerBound..<end.upperBound].utf8), format: nil) as? [String: Any],
           let ent = plist["Entitlements"] as? [String: Any], let aps = ent["aps-environment"] as? String {
            return aps == "production" ? "production" : "sandbox"
        }
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }()

    /// After sign-in: ask (the first time), register, and hand the server the address once it is known.
    func start(gwToken: String) async {
        self.gwToken = gwToken
        let c = UNUserNotificationCenter.current()
        let ok = (try? await c.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        #if DEBUG
        print("DEBUG_PUSH allowed=\(ok)")
        #endif
        UIApplication.shared.registerForRemoteNotifications()
        await upload()
    }

    func gotToken(_ hex: String) {
        #if DEBUG
        print("DEBUG_PUSH token \(hex.prefix(8))…")
        #endif
        token = hex
        Task { await upload() }
    }

    private func upload() async {
        guard !token.isEmpty, !gwToken.isEmpty, sent != token + gwToken else { return }
        let r = try? await Net.postJSON("/company/ext/chat/push", ["token": token, "env": env, "on": true, "device_id": Keychain.deviceId], token: gwToken, timeout: 20)
        if (r?.1["ok"] as? Bool) == true { sent = token + gwToken }
        #if DEBUG
        print("DEBUG_PUSH registered \(String(describing: r?.1["ok"]))")
        #endif
    }

    /// At sign-out: this phone no longer gets that person's notifications.
    func stop() async {
        if !token.isEmpty && !gwToken.isEmpty {
            _ = try? await Net.postJSON("/company/ext/chat/push", ["token": token, "env": env, "on": false, "device_id": Keychain.deviceId], token: gwToken, timeout: 10)
        }
        gwToken = ""
        sent = ""
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        try? await UNUserNotificationCenter.current().setBadgeCount(0)
    }

    /// The app's badge: the chats' unread count, kept while the app is open.
    func badge(_ n: Int) {
        UNUserNotificationCenter.current().setBadgeCount(max(0, n)) { _ in }
    }
}
