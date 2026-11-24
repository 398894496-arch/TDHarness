// 聊天: the company chat page (the same one the desks show), from ChatRelay on this phone.
import SwiftUI
import WebKit

struct ChatTab: View {
    @EnvironmentObject var session: Session
    @State private var url: URL?
    @State private var failed = ""

    var body: some View {
        Group {
            if let u = url {
                ChatWebView(url: u).ignoresSafeArea(edges: .bottom)
            } else if !failed.isEmpty {
                VStack(spacing: 14) {
                    Text(failed).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    Button("重试") { Task { await open() } }.buttonStyle(.bordered)
                }.padding()
            } else {
                LavaDots()
            }
        }
        .task { await open() }
    }

    private func open() async {
        failed = ""
        guard let p = session.person else { return }
        do {
            url = try await ChatRelay.shared.start(login: p.login, gwToken: p.gwToken)
        } catch {
            failed = "聊天没打开：" + ((error as? LocalizedError)?.errorDescription ?? "\(error)")
        }
    }
}

struct ChatWebView: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let c = WKWebViewConfiguration()
        c.allowsInlineMediaPlayback = true
        c.mediaTypesRequiringUserActionForPlayback = []
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

    final class Coordinator: NSObject, WKUIDelegate, WKNavigationDelegate {
        // Voice messages and calls: the microphone, for this page only (it is the relay's own address).
        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                     initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                     decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            decisionHandler(origin.host == "127.0.0.1" || origin.host == "localhost" ? .grant : .deny)
        }

        // Links out of the chat (a web address someone sent) open in Safari, not in place of the chat.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let u = action.request.url else { decisionHandler(.cancel); return }
            if u.host == "127.0.0.1" || u.host == "localhost" || u.scheme == "about" || u.scheme == "blob" || u.scheme == "data" {
                decisionHandler(.allow)
                return
            }
            if action.targetFrame?.isMainFrame ?? true, u.scheme == "http" || u.scheme == "https" {
                UIApplication.shared.open(u)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            present(message, cancel: false) { _ in completionHandler() }
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            present(message, cancel: true, completionHandler)
        }

        private func present(_ message: String, cancel: Bool, _ done: @escaping (Bool) -> Void) {
            guard let top = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first?.rootViewController else {
                done(!cancel)
                return
            }
            var vc = top
            while let p = vc.presentedViewController { vc = p }
            let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            if cancel { a.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in done(false) }) }
            a.addAction(UIAlertAction(title: "好", style: .default) { _ in done(true) })
            vc.present(a, animated: true)
        }
    }
}
