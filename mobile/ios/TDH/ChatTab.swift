// The company chat page in a web view (the desks' way; the phone draws its Chat natively now, ChatViews.swift), and the
// web view helpers the AI page uses.
import SwiftUI
import WebKit
import ObjectiveC

struct ChatWebView: UIViewRepresentable {
    let url: URL
    var onFile: ((ChatFile) -> Void)? = nil

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let c = WKWebViewConfiguration()
        c.allowsInlineMediaPlayback = true
        c.mediaTypesRequiringUserActionForPlayback = []
        if let onFile {
            c.userContentController.add(FileMessages { body in
                guard let m = body as? [String: Any], let b64 = m["data"] as? String, let data = Data(base64Encoded: b64) else { return }
                onFile(ChatFile(name: m["name"] as? String ?? "文件", mime: m["mime"] as? String ?? "", data: data))
            }, name: "tdhfile")
        }
        let w = WKWebView(frame: .zero, configuration: c)
        w.uiDelegate = context.coordinator
        w.navigationDelegate = context.coordinator
        w.allowsBackForwardNavigationGestures = false
        w.scrollView.contentInsetAdjustmentBehavior = .never
        w.isOpaque = false
        w.backgroundColor = .clear
        WebKeyboard.hideAccessoryBar(w)
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

/// The ‹ › ✓ bar WebKit puts over the keyboard for a page's text fields, taken away (a phone app's own composer
/// does not have one): the page's content view gets a subclass of its own whose inputAccessoryView is nothing.
enum WebKeyboard {
    static func hideAccessoryBar(_ web: WKWebView) {
        guard let content = web.scrollView.subviews.first(where: { String(describing: type(of: $0)).hasPrefix("WKContent") }) else { return }
        let base: AnyClass = type(of: content)
        let name = String(cString: class_getName(base)) + "_TDHNoBar"
        var sub: AnyClass? = NSClassFromString(name)
        if sub == nil, let made = objc_allocateClassPair(base, name, 0) {
            let block: @convention(block) (AnyObject) -> AnyObject? = { _ in nil }
            let sel = #selector(getter: UIResponder.inputAccessoryView)
            if let m = class_getInstanceMethod(UIResponder.self, sel) {
                class_addMethod(made, sel, imp_implementationWithBlock(block), method_getTypeEncoding(m))
            }
            objc_registerClassPair(made)
            sub = made
        }
        if let sub { object_setClass(content, sub) }
    }
}

/// A file someone sent in the chat, handed over by the page when it is tapped (company-chat-view-v1).
struct ChatFile: Identifiable {
    let id = UUID()
    let name: String
    let mime: String
    let data: Data
}

final class FileMessages: NSObject, WKScriptMessageHandler {
    private let got: (Any) -> Void
    init(_ got: @escaping (Any) -> Void) { self.got = got }
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) { got(message.body) }
}
