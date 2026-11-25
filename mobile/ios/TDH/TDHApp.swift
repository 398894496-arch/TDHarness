import SwiftUI

@main
struct TDHApp: App {
    @StateObject private var session = Session()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .task {
                    #if DEBUG
                    DebugDrive.seed()
                    #endif
                    await session.start()
                    #if DEBUG
                    await DebugDrive.run(session)
                    #endif
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject var session: Session

    var body: some View {
        switch session.phase {
        case .starting:
            VStack(spacing: 16) {
                LavaDots()
                Text(session.note).font(.footnote).foregroundStyle(.secondary)
            }
        case .signedOut:
            LoginView()
        case .signedIn:
            MainView()
        }
    }
}

struct MainView: View {
    @EnvironmentObject var session: Session
    @State private var tab = 0

    var body: some View {
        TabView(selection: $tab) {
            ChatTab()
                .tabItem { Label("聊天", systemImage: "bubble.left.and.bubble.right") }.tag(0)
            DeskTab()
                .tabItem { Label("助手", systemImage: "sparkles") }.tag(1)
            MeView()
                .tabItem { Label("我", systemImage: "person.crop.circle") }.tag(2)
        }
        #if DEBUG
        .onAppear { tab = UserDefaults.standard.integer(forKey: "tdhTab") }
        #endif
    }
}

#if DEBUG
/// Debug builds only, for checks without a person at the screen (simctl launch … -tdhTestUser u -tdhTestPass p,
/// or -tdhTestPhone n [-tdhTestCode c], -tdhTab 0|1|2, -tdhAsk "问题"). Not in a release build.
enum DebugDrive {
    /// Before the start: a test device's id and remembered sign-in (minted on a test server for a test account),
    /// so a check can open the app signed in without typing anything. -tdhTestDevice id -tdhTestRemember token.
    static func seed() {
        let d = UserDefaults.standard
        if let dev = d.string(forKey: "tdhTestDevice"), !dev.isEmpty { Keychain.set("device.id", dev) }
        if let tok = d.string(forKey: "tdhTestRemember"), !tok.isEmpty { Keychain.set("remember.token", tok) }
    }

    @MainActor
    static func run(_ s: Session) async {
        let d = UserDefaults.standard
        if s.phase == .signedOut {
            if let u = d.string(forKey: "tdhTestUser"), let p = d.string(forKey: "tdhTestPass") {
                print("DEBUG_DRIVE signin=" + (await s.signIn(user: u, password: p, remember: true) ?? "ok"))
            } else if let ph = d.string(forKey: "tdhTestPhone") {
                if let c = d.string(forKey: "tdhTestCode") {
                    print("DEBUG_DRIVE sms=" + (await s.signIn(phone: ph, code: c, remember: true) ?? "ok"))
                } else {
                    print("DEBUG_DRIVE code=" + (await s.sendCode(phone: ph) ?? "sent"))
                }
            }
        }
        if d.bool(forKey: "tdhSignOut") { await s.signOut(); print("DEBUG_DRIVE signout") }
        // The chat relay against the real server with no one signed in: the page and Tinode's long polling only.
        if d.bool(forKey: "tdhChatProbe"), let u = try? await ChatRelay.shared.start(login: "", gwToken: "") {
            print("DEBUG_DRIVE relay=" + u.absoluteString)
        }
        print("DEBUG_DRIVE phase=\(s.phase) server=\(s.server)")
    }
}
#endif

/// The desk's "thinking" lava lamp, small: three drops drifting at their own speeds.
struct LavaDots: View {
    @State private var t = false
    private let colors: [Color] = [Color(red: 0.25, green: 0.45, blue: 0.95), Color(red: 0.45, green: 0.75, blue: 0.98),
                                   Color(red: 0.98, green: 0.72, blue: 0.5)]

    var body: some View {
        ZStack {
            ForEach(0..<3, id: \.self) { i in
                Circle().fill(colors[i]).frame(width: 18, height: 18)
                    .offset(x: t ? CGFloat([18, -14, 6][i]) : CGFloat([-16, 12, -6][i]), y: t ? CGFloat([-4, 6, 3][i]) : CGFloat([5, -3, -6][i]))
                    .animation(.easeInOut(duration: [1.6, 2.1, 1.3][i]).repeatForever(autoreverses: true), value: t)
            }
        }
        .frame(width: 70, height: 36)
        .onAppear { t = true }
    }
}
