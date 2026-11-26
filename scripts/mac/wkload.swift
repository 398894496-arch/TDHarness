// For scripts/prove-chat-mac-files.mjs: WebKit (the Mac desk's engine) loads one URL in an off-screen window for N
// seconds, then exits. Never shown: the window sits far off screen and the process has no Dock icon.
import Cocoa
import WebKit
let url = URL(string: CommandLine.arguments[1])!
let secs = Double(CommandLine.arguments[2]) ?? 8
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 800, height: 600), configuration: WKWebViewConfiguration())
let win = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: 800, height: 600), styleMask: [.borderless], backing: .buffered, defer: false)
win.contentView = web
win.orderFrontRegardless()
web.load(URLRequest(url: url))
DispatchQueue.main.asyncAfter(deadline: .now() + secs) { exit(0) }
app.run()
