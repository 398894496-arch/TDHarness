import SwiftUI

@main
struct TDHApp: App {
    @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var appDelegate
    @StateObject private var session = Session()
    @AppStorage(Appearance.key) private var appearance = Appearance.system

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .onChange(of: appearance, initial: true) { _, a in Appearance.apply(a) }
                .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in Appearance.apply(appearance) }
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

/// company-phone-dark-v1: 跟随系统 / 浅色 / 深色, kept on this phone. Set on the app's windows themselves, so every page,
/// sheet and web view follows at once (and 跟随系统 hands it back to the phone's own setting).
enum Appearance {
    static let key = "tdhAppearance"
    static let system = 0, light = 1, dark = 2

    @MainActor static func apply(_ a: Int, tries: Int = 0) {
        let style: UIUserInterfaceStyle = a == light ? .light : a == dark ? .dark : .unspecified
        let windows = UIApplication.shared.connectedScenes.flatMap { ($0 as? UIWindowScene)?.windows ?? [] }
        // At launch the window may not be there yet: try again a moment later.
        if windows.isEmpty {
            if tries < 40 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { apply(a, tries: tries + 1) } }
            return
        }
        for w in windows where w.overrideUserInterfaceStyle != style {
            if tries == 0 && w.isKeyWindow {
                UIView.transition(with: w, duration: 0.35, options: .transitionCrossDissolve) { w.overrideUserInterfaceStyle = style }
            } else {
                w.overrideUserInterfaceStyle = style
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
                VStack(spacing: 18) {
                    LavaDots(width: 96, height: 48)
                    BetaBadge()
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

/// company-phone-ui-v2 (the user, 2026-11-25: 「记录 助手 聊天 交付 … 我不要中文」「助手应为直接用AI」「下面就放四个按钮」):
/// History · AI · Chat · Docs. Settings is a sheet from the gear on AI.
struct MainView: View {
    @EnvironmentObject var session: Session
    @StateObject private var desk = DeskModel()
    @StateObject private var chat = ChatStore()
    @StateObject private var calls = CallCenter()
    @State private var tab = 1
    @State private var showSettings = false
    @State private var banner: Banner?
    @Environment(\.colorScheme) private var scheme

    /// Only the chats in the list count (a chat deleted on this phone does not).
    private var unread: Int { chat.topics.filter { chat.shows($0) }.reduce(0) { $0 + $1.unread } }

    private var inCall: Binding<Bool> {
        Binding(get: { calls.call != nil }, set: { if !$0 && calls.call?.state != "ended" { calls.hangup() } })
    }

    var body: some View {
        tabs
            .background(CallHost(web: calls.web).frame(width: 2, height: 2).opacity(0.01).allowsHitTesting(false))
            .fullScreenCover(isPresented: inCall) {
                if let c = calls.call {
                    CallScreen(call: c).environmentObject(calls).environmentObject(chat)
                }
            }
            .overlay(alignment: .top) {
                if let b = banner {
                    BannerView(banner: b, onTap: { follow(b) }, onDismiss: {
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) { if banner == b { banner = nil } }
                    })
                    .id(b.id)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .padding(.top, 4)
                }
            }
            .onReceive(chat.$incoming.compactMap { $0 }) { show($0) }
            .onReceive(desk.$finished.compactMap { $0 }) { show($0) }
            // A notification tapped (company-phone-push-v1): open what it is about, as its banner would.
            .onReceive(PushCenter.shared.$opened.compactMap { $0 }) { b in
                PushCenter.shared.opened = nil
                follow(b)
            }
            .onChange(of: unread) { _, n in PushCenter.shared.badge(n) }
            .onChange(of: scheme, initial: true) { _, s in desk.setDark(s == .dark) }
            .onChange(of: tab) { _, t in desk.aiVisible = t == 1 }
            .onAppear { desk.aiVisible = tab == 1 }
            .overlay(alignment: .bottom) {
                if let t = desk.toast {
                    Text(t)
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 18).padding(.vertical, 11)
                        .glass(Capsule())
                        .padding(.horizontal, 20)
                        .padding(.bottom, 170)
                        .transition(.rise)
                        .allowsHitTesting(false)
                }
            }
            .environmentObject(desk)
            .environmentObject(chat)
            .environmentObject(calls)
            .sheet(isPresented: $showSettings) { PhoneSettings().environmentObject(chat) }
            .fullScreenCover(isPresented: $session.needsAvatar) { AvatarSetupView().environmentObject(session) }
            .onReceive(NotificationCenter.default.publisher(for: .tdhShowDesk)) { _ in tab = 1 }
            .task {
                // The desk and the chat start at sign-in, whichever tab is in front, so each is ready when opened.
                guard let p = session.person else { return }
                Task { await PushCenter.shared.start(gwToken: p.gwToken) }
                chat.start(login: p.login, gwToken: p.gwToken)
                async let callsUp: Void = calls.start(login: p.login, gwToken: p.gwToken)
                await desk.start(token: p.gwToken)
                await callsUp
                #if DEBUG
                // Debug builds only: a banner as a colleague's message would bring (-tdhBannerTest 1).
                if UserDefaults.standard.bool(forKey: "tdhBannerTest") {
                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                    if let t = chat.topics.first(where: { chat.shows($0) }) {
                        chat.incoming = Banner(kind: .chat, target: t.topic, title: t.name, body: "【测试】提醒横幅验证", photo: t.photo)
                    }
                }
                // Debug builds only: a test call to a chat named on the command line (-tdhCallTo 名字).
                if let to = UserDefaults.standard.string(forKey: "tdhCallTo") {
                    for _ in 0..<60 where !(calls.ready && chat.topics.contains { $0.name == to }) {
                        try? await Task.sleep(nanoseconds: 500_000_000)
                    }
                    if let t = chat.topics.first(where: { $0.name == to && $0.topic.hasPrefix("usr") }) {
                        print("DEBUG_CALL dial \(t.topic) ok=\(await calls.dial(t.topic))")
                    } else { print("DEBUG_CALL dial: no such chat") }
                }
                #endif
            }
            .onDisappear { chat.stop() }
            #if DEBUG
            .onAppear { if UserDefaults.standard.object(forKey: "tdhTab") != nil { tab = UserDefaults.standard.integer(forKey: "tdhTab") } }
            #endif
    }

    private func show(_ b: Banner) {
        // Not over a call; an AI banner only when its answer is not already on screen.
        if calls.call != nil { return }
        BannerView.announce(b)
        withAnimation(.spring(response: 0.45, dampingFraction: 0.8)) { banner = b }
    }

    private func follow(_ b: Banner) {
        withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) { banner = nil }
        switch b.kind {
        case .chat:
            withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) { tab = 2 }
            chat.openRequest = b.target
        case .ai:
            desk.open(b.target)
            withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) { tab = 1 }
        }
    }

    @ViewBuilder private var tabs: some View {
        // Today's tab bar: the selected one in ink, not blue.
        tabView.tint(Color.ink)
    }

    @ViewBuilder private var tabView: some View {
        if #available(iOS 18.0, *) {
            TabView(selection: $tab) {
                Tab("History", systemImage: "clock.arrow.circlepath", value: 0) { HistoryPage(tab: $tab, showSettings: $showSettings) }
                Tab("AI", systemImage: "sparkles", value: 1) { DeskTab(showSettings: $showSettings) }
                    .badge(desk.answered.count)
                Tab("Chat", systemImage: "bubble.left.and.bubble.right", value: 2) { ChatListPage(showSettings: $showSettings) }
                    .badge(unread)
                Tab("Docs", systemImage: "doc.text", value: 3) { DocsPage(tab: $tab, showSettings: $showSettings) }
            }
        } else {
            TabView(selection: $tab) {
                HistoryPage(tab: $tab, showSettings: $showSettings).tabItem { Label("History", systemImage: "clock.arrow.circlepath") }.tag(0)
                DeskTab(showSettings: $showSettings).tabItem { Label("AI", systemImage: "sparkles") }.tag(1).badge(desk.answered.count)
                ChatListPage(showSettings: $showSettings).tabItem { Label("Chat", systemImage: "bubble.left.and.bubble.right") }.tag(2).badge(unread)
                DocsPage(tab: $tab, showSettings: $showSettings).tabItem { Label("Docs", systemImage: "doc.text") }.tag(3)
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
