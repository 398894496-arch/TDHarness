// 助手: the person's own desk on the company server (server/desk_hub.js) — the same agent, chats and artifacts as on
// their computer, in sync with it. The web view loads it from DeskRelay on 127.0.0.1, so the kernel treats it as its
// own loopback page (its settings are saved) and the company certificate is checked in code.
import SwiftUI
import WebKit

struct DeskTab: View {
    @EnvironmentObject var session: Session
    @State private var url: URL?
    @State private var failed = ""
    @State private var note = "正在打开你的工作台…"

    var body: some View {
        Group {
            if let u = url {
                DeskWebView(url: u).ignoresSafeArea(edges: .bottom)
            } else if !failed.isEmpty {
                VStack(spacing: 14) {
                    Text(failed).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    Button("重试") { Task { await open() } }.buttonStyle(.bordered)
                }.padding()
            } else {
                VStack(spacing: 12) {
                    LavaDots()
                    Text(note).font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
        .task { await open() }
    }

    private func open() async {
        failed = ""
        guard let p = session.person else { return }
        do {
            let u = try await DeskRelay.shared.start(token: p.gwToken)
            // The hub starts the kernel if it is not running yet (a minute at most); ask before showing the page, so a
            // refusal says why here instead of an empty page.
            note = "正在打开你的工作台…"
            let (code, j) = try await Net.getJSON("/desk-hub/_hub/status", token: p.gwToken, timeout: 30)
            if code == 401 || code == 403 {
                failed = (j["hint"] as? String) ?? "这个账号还没开通手机工作台"
                return
            }
            if (j["state"] as? String) != "up" {
                note = "服务器正在启动你的工作台，第一次会慢一点…"
                _ = try? await Net.getJSON("/desk-hub/_hub/warm", token: p.gwToken, timeout: 30)
                for _ in 0..<60 {
                    try? await Task.sleep(nanoseconds: 2_000_000_000)
                    if let (c, s) = try? await Net.getJSON("/desk-hub/_hub/status", token: p.gwToken, timeout: 15), c == 200,
                       (s["state"] as? String) == "up" { break }
                }
            }
            url = u
        } catch {
            failed = "工作台没打开：" + ((error as? LocalizedError)?.errorDescription ?? "\(error)")
        }
    }
}

struct DeskWebView: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> ChatWebView.Coordinator { ChatWebView.Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let c = WKWebViewConfiguration()
        c.allowsInlineMediaPlayback = true
        c.mediaTypesRequiringUserActionForPlayback = []
        // The company shell's phone layout keys on this (desk/plugins/company-shell, company-phone-layout-v1).
        c.applicationNameForUserAgent = "TDH-iOS/1.0"
        let w = WKWebView(frame: .zero, configuration: c)
        w.uiDelegate = context.coordinator
        w.navigationDelegate = context.coordinator
        w.allowsBackForwardNavigationGestures = false
        w.scrollView.contentInsetAdjustmentBehavior = .never
        w.load(URLRequest(url: url))
        return w
    }

    func updateUIView(_ w: WKWebView, context: Context) {
        if w.url == nil { w.load(URLRequest(url: url)) }
    }
}
