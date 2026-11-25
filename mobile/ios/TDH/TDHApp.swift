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
        ZStack {
            switch session.phase {
            case .starting:
                VStack(spacing: 16) {
                    LavaDots()
                    Text(session.note).font(.footnote).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(DeskBackground())
                .transition(.opacity)
            case .signedOut:
                LoginView().transition(.opacity)
            case .signedIn:
                MainView().transition(.opacity.combined(with: .scale(scale: 0.98)))
            }
        }
        .animation(.spring(response: 0.55, dampingFraction: 0.86), value: session.phase)
    }
}

/// 聊天 / 助手 / 工件, and a round 新对话 button set apart on the right (the search-role slot of the iOS 26 tab bar).
/// Settings is a sheet from the gear in 助手 and 工件.
struct MainView: View {
    @EnvironmentObject var session: Session
    @StateObject private var desk = DeskModel()
    @State private var tab = 1
    @State private var showSettings = false

    var body: some View {
        tabs
            .overlay(alignment: .bottom) {
                if let t = desk.toast {
                    Text(t)
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 18).padding(.vertical, 11)
                        .background(.regularMaterial, in: Capsule())
                        .shadow(color: .black.opacity(0.12), radius: 14, y: 6)
                        .padding(.horizontal, 20)
                        .padding(.bottom, 104)
                        .transition(.move(edge: .bottom).combined(with: .opacity).combined(with: .scale(scale: 0.9)))
                        .allowsHitTesting(false)
                }
            }
            .environmentObject(desk)
            .sheet(isPresented: $showSettings) { SettingsSheet() }
            .fullScreenCover(isPresented: $session.needsAvatar) { AvatarSetupView().environmentObject(session) }
            .onChange(of: tab) { _, now in
                guard now == 3 else { return }
                tab = 1
                desk.newChat()
            }
            .task {
                // The desk loads at sign-in, whichever tab is in front, so 助手 is ready when it is opened.
                if let p = session.person { await desk.start(token: p.gwToken) }
            }
            #if DEBUG
            .onAppear { if UserDefaults.standard.object(forKey: "tdhTab") != nil { tab = UserDefaults.standard.integer(forKey: "tdhTab") } }
            #endif
    }

    @ViewBuilder private var tabs: some View {
        if #available(iOS 18.0, *) {
            TabView(selection: $tab) {
                Tab("聊天", systemImage: "bubble.left.and.bubble.right", value: 0) { ChatTab() }
                Tab("助手", systemImage: "sparkles", value: 1) { DeskTab(showSettings: $showSettings) }
                Tab("工件", systemImage: "doc.on.doc", value: 2) { ArtifactsTab(tab: $tab, showSettings: $showSettings) }
                Tab("新对话", systemImage: "square.and.pencil", value: 3, role: .search) { Color.clear }
            }
        } else {
            TabView(selection: $tab) {
                ChatTab().tabItem { Label("聊天", systemImage: "bubble.left.and.bubble.right") }.tag(0)
                DeskTab(showSettings: $showSettings).tabItem { Label("助手", systemImage: "sparkles") }.tag(1)
                ArtifactsTab(tab: $tab, showSettings: $showSettings).tabItem { Label("工件", systemImage: "doc.on.doc") }.tag(2)
                Color.clear.tabItem { Label("新对话", systemImage: "square.and.pencil") }.tag(3)
            }
        }
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
        // The sign-in screens without forgetting this phone's remembered sign-in (screenshots of the login flow).
        if d.bool(forKey: "tdhShowLogin") { s.phase = .signedOut }
        // The chat relay against the real server with no one signed in: the page and Tinode's long polling only.
        if d.bool(forKey: "tdhChatProbe"), let u = try? await ChatRelay.shared.start(login: "", gwToken: "") {
            print("DEBUG_DRIVE relay=" + u.absoluteString)
        }
        print("DEBUG_DRIVE phase=\(s.phase) server=\(s.server)")
    }
}
#endif

/// The desk's lava lamp, small: three drops drifting on their own slow sine paths (never a straight, even move) that
/// stick together and pull apart like wax (blurred, then cut at half alpha), coloured by one sky-to-sand gradient.
struct LavaDots: View {
    var width: CGFloat = 70
    var height: CGFloat = 36

    var body: some View {
        TimelineView(.animation) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            LinearGradient(colors: [Color(red: 0.25, green: 0.45, blue: 0.95), Color(red: 0.45, green: 0.75, blue: 0.98),
                                    Color(red: 0.98, green: 0.72, blue: 0.5)],
                           startPoint: .leading, endPoint: .trailing)
                .mask {
                    Canvas { ctx, size in
                        ctx.addFilter(.alphaThreshold(min: 0.5, color: .black))
                        ctx.addFilter(.blur(radius: size.height * 0.16))
                        ctx.drawLayer { layer in
                            for i in 0..<3 {
                                let p = Self.spot(i, t, size)
                                let r = size.height * [0.30, 0.25, 0.22][i]
                                layer.fill(Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)), with: .color(.black))
                            }
                        }
                    }
                }
        }
        .frame(width: width, height: height)
        .accessibilityHidden(true)
    }

    private static func spot(_ i: Int, _ t: Double, _ s: CGSize) -> CGPoint {
        let speed = [0.85, 1.25, 0.65][i], phase = [0.0, 2.1, 4.2][i]
        let x = s.width / 2 + s.width * 0.27 * sin(t * speed + phase)
        let y = s.height / 2 + s.height * 0.12 * cos(t * speed * 1.4 + phase)
        return CGPoint(x: x, y: y)
    }
}
