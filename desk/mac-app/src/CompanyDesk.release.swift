import Cocoa
import Darwin
import WebKit

enum Desk {
  static let port: UInt16 = 17803
  static let url = URL(string: "http://127.0.0.1:17803")!
}

func portListening() -> Bool {
  var addr = sockaddr_in()
  addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
  addr.sin_family = sa_family_t(AF_INET)
  addr.sin_port = Desk.port.bigEndian
  addr.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
  let fd = socket(AF_INET, SOCK_STREAM, 0)
  guard fd >= 0 else { return false }
  defer { close(fd) }
  var timeout = timeval(tv_sec: 0, tv_usec: 400_000)
  setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
  let ok = withUnsafePointer(to: &addr) {
    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
      connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
    }
  }
  return ok == 0
}

func listenPids() -> [pid_t] {
  let task = Process()
  task.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
  task.arguments = ["-nP", "-iTCP:\(Desk.port)", "-sTCP:LISTEN", "-t"]
  let out = Pipe()
  task.standardOutput = out
  task.standardError = FileHandle.nullDevice
  do { try task.run() } catch { return [] }
  task.waitUntilExit()
  let text = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
  return text.split(whereSeparator: \.isNewline).compactMap {
    pid_t($0.trimmingCharacters(in: .whitespaces))
  }.filter { $0 > 1 }
}

func clearLoginFiles() {
  let rc = (NSHomeDirectory() as NSString).appendingPathComponent(".dsh-company-rc8")
  for name in ["gw.token", "smb.pass", "smb.user", "login.role", "login.name"] {
    let p = (rc as NSString).appendingPathComponent(name)
    try? FileManager.default.removeItem(atPath: p)
  }
}

func tokenPresent() -> Bool {
  let p = (NSHomeDirectory() as NSString).appendingPathComponent(".dsh-company-rc8/gw.token")
  return FileManager.default.fileExists(atPath: p)
}

func leaseNote() -> String {
  let p = (NSHomeDirectory() as NSString).appendingPathComponent(".dsh-company-rc8/lease.note")
  guard let text = try? String(contentsOfFile: p, encoding: .utf8) else { return "" }
  return text.trimmingCharacters(in: .whitespacesAndNewlines)
}

func quitLease() {
  guard let root = Bundle.main.resourcePath else { return }
  let js = (root as NSString).appendingPathComponent("desk-lease.js")
  let node = (root as NSString).appendingPathComponent("node/bin/node")
  guard FileManager.default.isExecutableFile(atPath: node),
        FileManager.default.fileExists(atPath: js) else { return }
  let task = Process()
  task.executableURL = URL(fileURLWithPath: node)
  task.arguments = [js, "quit"]
  task.standardOutput = FileHandle.nullDevice
  task.standardError = FileHandle.nullDevice
  do {
    try task.run()
    task.waitUntilExit()
  } catch { }
}

func stopDesk() {
  for pid in listenPids() { kill(pid, SIGTERM) }
  for _ in 0..<20 {
    if listenPids().isEmpty { return }
    Thread.sleep(forTimeInterval: 0.1)
  }
  for pid in listenPids() { kill(pid, SIGKILL) }
}

func primeCompanyShare() {
  let p = (NSHomeDirectory() as NSString).appendingPathComponent("company")
  var isDir: ObjCBool = false
  guard FileManager.default.fileExists(atPath: p, isDirectory: &isDir), isDir.boolValue else { return }
  _ = try? FileManager.default.contentsOfDirectory(atPath: p)
}

func launchStartCommand() {
  guard let root = Bundle.main.resourcePath else { return }
  let start = (root as NSString).appendingPathComponent("start.command")
  guard FileManager.default.isExecutableFile(atPath: start) else { return }
  let logDir = (NSHomeDirectory() as NSString).appendingPathComponent("Library/Logs")
  let logPath = (logDir as NSString).appendingPathComponent("TDHarness.log")
  try? FileManager.default.createDirectory(atPath: logDir, withIntermediateDirectories: true)
  if !FileManager.default.fileExists(atPath: logPath) {
    FileManager.default.createFile(atPath: logPath, contents: nil)
  }
  let task = Process()
  task.executableURL = URL(fileURLWithPath: "/bin/bash")
  task.arguments = [start]
  task.currentDirectoryURL = URL(fileURLWithPath: root, isDirectory: true)
  var env = ProcessInfo.processInfo.environment
  env["NO_OPEN"] = "1"
  // company-login-page-v1: this shell shows the sign-in page (desk-boot.status "login"); start.command asks no dialogs.
  env["TDH_SHELL_LOGIN_PAGE"] = "1"
  env["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"
  task.environment = env
  if let handle = FileHandle(forWritingAtPath: logPath) {
    _ = try? handle.seekToEnd()
    task.standardOutput = handle
    task.standardError = handle
  }
  try? task.run()
}

func installMenus() {
  let main = NSMenu()
  let appName = "TDHarness"

  let appMenu = NSMenu()
  appMenu.addItem(withTitle: "关于 \(appName)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
  appMenu.addItem(NSMenuItem.separator())
  appMenu.addItem(withTitle: "隐藏 \(appName)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
  let hideOthers = NSMenuItem(
    title: "隐藏其他",
    action: #selector(NSApplication.hideOtherApplications(_:)),
    keyEquivalent: "h"
  )
  hideOthers.keyEquivalentModifierMask = [.command, .option]
  appMenu.addItem(hideOthers)
  appMenu.addItem(withTitle: "全部显示", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
  appMenu.addItem(NSMenuItem.separator())
  appMenu.addItem(withTitle: "退出 \(appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
  let appItem = NSMenuItem()
  appItem.submenu = appMenu
  main.addItem(appItem)

  let edit = NSMenu(title: "编辑")
  edit.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
  edit.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
  edit.addItem(NSMenuItem.separator())
  edit.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
  edit.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
  edit.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
  edit.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
  let editItem = NSMenuItem(title: "编辑", action: nil, keyEquivalent: "")
  editItem.submenu = edit
  main.addItem(editItem)

  NSApp.mainMenu = main
}

final class App: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
  var window: NSWindow!
  var web: WKWebView?
  var loginWeb: WKWebView?
  // company-login-page-v1: the waiting words on login.html#wait (a living page, not a grey line); the label stays
  // for a pack without login.html.
  var waitWeb: WKWebView?
  var lastStatus = "正在打开本机 Agent…"
  // A start that failed: said on the waiting page (its 退出 / 重新打开 come back here as "quit" / "relaunch").
  var lastFail: String?
  var status: NSTextField!
  var logoutWatch: Timer?
  var portMisses = 0

  func applicationWillFinishLaunching(_ notification: Notification) {
    installMenus()
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    let mask: NSWindow.StyleMask = [.titled, .closable, .miniaturizable, .resizable]
    window = NSWindow(
      contentRect: NSRect(x: 80, y: 80, width: 1280, height: 800),
      styleMask: mask,
      backing: .buffered,
      defer: false
    )
    window.title = "TDHarness"
    // company-login-page-v1: the waiting window wears the desk's page colour, so nothing flashes grey between steps.
    window.backgroundColor = NSColor(name: nil) { look in
      look.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        ? NSColor(srgbRed: 0x16 / 255.0, green: 0x16 / 255.0, blue: 0x18 / 255.0, alpha: 1)
        : NSColor(srgbRed: 0xf0 / 255.0, green: 0xf0 / 255.0, blue: 0xef / 255.0, alpha: 1)
    }
    status = NSTextField(labelWithString: "正在打开本机 Agent…")
    status.textColor = .secondaryLabelColor
    status.font = NSFont.systemFont(ofSize: 16)
    status.alignment = .center
    status.translatesAutoresizingMaskIntoConstraints = false
    window.contentView?.addSubview(status)
    if let view = window.contentView {
      NSLayoutConstraint.activate([
        status.centerXAnchor.constraint(equalTo: view.centerXAnchor),
        status.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      ])
    }
    showWaitPage()
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    primeCompanyShare()
    DispatchQueue.global(qos: .userInitiated).async {
      // Always run start.command. Do not open the desk just because 17803 is
      // already listening — that is the old tree, and an in-flight update
      // would look like "I clicked 更新 but nothing happened".
      // Wipe a leftover "ready" from the last run before the child starts,
      // or the first poll would load the old page while 17803 is still up.
      Self.writeBootStatus("starting")
      DispatchQueue.main.async { self.setStatus(Self.label(for: "starting")) }
      launchStartCommand()
      var ready = false
      // Ten minutes for the desk to start; the time a person spends on the sign-in page does not count.
      var waited = 0
      while waited < 600 {
        let boot = Self.readBootStatus()
        if boot == "login" {
          DispatchQueue.main.async { self.showLogin() }
          Thread.sleep(forTimeInterval: 0.3)
          continue
        }
        DispatchQueue.main.async { self.hideLogin(); self.setStatus(Self.label(for: boot)) }
        if boot == "quit" {
          DispatchQueue.main.async { NSApp.terminate(nil) }
          return
        }
        if boot == "fail" {
          DispatchQueue.main.async { self.fail(self.deskError()) }
          return
        }
        if boot == "ready" && portListening() {
          ready = true
          break
        }
        Thread.sleep(forTimeInterval: 1)
        waited += 1
      }
      if !ready {
        DispatchQueue.main.async { self.fail(self.deskError()) }
        return
      }
      DispatchQueue.main.async { self.showDesk() }
    }
  }

  static func bootStatusPath() -> String {
    (NSHomeDirectory() as NSString).appendingPathComponent(".dsh-company-rc8/desk-boot.status")
  }

  static func readBootStatus() -> String {
    guard let text = try? String(contentsOfFile: bootStatusPath(), encoding: .utf8) else { return "" }
    return text.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  static func writeBootStatus(_ value: String) {
    let path = bootStatusPath()
    let dir = (path as NSString).deletingLastPathComponent
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    try? value.write(toFile: path, atomically: true, encoding: .utf8)
  }

  // 0.1.2 prints `dsh web: http://127.0.0.1:17803/?token=...`. The hardcoded
  // loopback URL 401s. Prefer the last printed URL; stay on loopback only.
  static func deskUrl() -> URL {
    let p = (NSHomeDirectory() as NSString).appendingPathComponent(".dsh-company-rc8/desk-home/web-runtime.out")
    if let text = try? String(contentsOfFile: p, encoding: .utf8) {
      for line in text.split(whereSeparator: \.isNewline).reversed() {
        let s = String(line)
        guard s.hasPrefix("dsh web: http://127.0.0.1:") else { continue }
        let rest = String(s.dropFirst("dsh web: ".count))
        let first = rest.split(separator: " ").first.map(String.init) ?? rest
        if let u = URL(string: first), u.host == "127.0.0.1" { return u }
      }
    }
    return Desk.url
  }

  // tree-restore.sh writes "<phase> <done> <total>" here while it downloads
  // and unpacks, so a 400 MB update shows movement instead of a frozen line.
  static func updatingLabel() -> String {
    let path = (NSHomeDirectory() as NSString).appendingPathComponent(".dsh-company-rc8/desk-boot.progress")
    let base = "正在更新公司新版，请不要关窗口…"
    guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { return base }
    let parts = text.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: " ").map(String.init)
    guard parts.count == 3, let done = Int64(parts[1]), let total = Int64(parts[2]) else { return base }
    switch parts[0] {
    case "download":
      let mb = done / 1_048_576
      if total <= 0 { return "正在下载新版 \(mb) MB…" }
      return "正在下载新版 \(mb) / \(total / 1_048_576) MB（\(done * 100 / total)%）"
    case "install":
      if total <= 0 { return "正在安装新版…" }
      return "正在安装新版 \(done) / \(total) 个文件（\(done * 100 / total)%）"
    default:
      return base
    }
  }

  static func label(for boot: String) -> String {
    switch boot {
    case "updating": return updatingLabel()
    case "starting": return "正在打开本机 Agent…"
    case "share": return "正在连接公司盘…"
    case "lease": return "正在领取座位、同步会话…"
    case "agent": return "正在启动本机 Agent…"
    case "ready": return "正在打开工作台…"
    case "fail": return "更新失败"
    case "quit": return "已取消"
    case "kicked": return "这个账号已在其他设备登录"
    case "desk-down": return "座位已过期，请重新打开。"
    default: return "正在打开本机 Agent…"
    }
  }

  // company-login-page-v1: start.command's sign-in page (mac-login-page.js), from desk-login.url, loopback only.
  static func loginUrl() -> URL? {
    let p = (NSHomeDirectory() as NSString).appendingPathComponent(".dsh-company-rc8/desk-login.url")
    guard let text = try? String(contentsOfFile: p, encoding: .utf8) else { return nil }
    let s = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard s.hasPrefix("http://127.0.0.1:"), let u = URL(string: s), u.host == "127.0.0.1" else { return nil }
    return u
  }

  func showWaitPage() {
    guard let root = Bundle.main.resourcePath else { return }
    let file = URL(fileURLWithPath: (root as NSString).appendingPathComponent("login.html"))
    guard FileManager.default.fileExists(atPath: file.path),
          var parts = URLComponents(url: file, resolvingAgainstBaseURL: false) else { return }
    parts.fragment = "wait"
    guard let url = parts.url else { return }
    let cfg = WKWebViewConfiguration()
    cfg.userContentController.add(self, name: "tdh")
    let w = WKWebView(frame: window.contentView!.bounds, configuration: cfg)
    w.autoresizingMask = [.width, .height]
    w.setValue(false, forKey: "drawsBackground")
    w.navigationDelegate = self
    window.contentView?.addSubview(w)
    w.loadFileURL(url, allowingReadAccessTo: file.deletingLastPathComponent())
    waitWeb = w
    status.isHidden = true
  }

  func pushWait() {
    guard let w = waitWeb else { return }
    let words = lastStatus.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
    // The steps that read and write the company share wait on its link; say so, away from the office it is slow.
    let slow = lastStatus.contains("公司盘") || lastStatus.contains("座位")
    let sub = slow ? "要读写公司盘；不在公司时会慢一些" : "第一次打开会慢一点"
    w.evaluateJavaScript("window.tdhWait && window.tdhWait(\"" + words + "\", \"" + sub + "\")", completionHandler: nil)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if webView === waitWeb {
      if let f = lastFail { pushFail(f) } else { pushWait() }
    }
  }

  func pushFail(_ text: String) {
    guard let w = waitWeb else { return }
    let words = text.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"").replacingOccurrences(of: "\n", with: " ")
    w.evaluateJavaScript("window.tdhFail && window.tdhFail(\"" + words + "\")", completionHandler: nil)
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.name == "tdh", let what = message.body as? String else { return }
    if what == "quit" { NSApp.terminate(nil) }
    if what == "relaunch" {
      let bundle = Bundle.main.bundleURL
      let task = Process()
      task.executableURL = URL(fileURLWithPath: "/bin/sh")
      task.arguments = ["-c", "sleep 1; /usr/bin/open \"$0\"", bundle.path]
      try? task.run()
      NSApp.terminate(nil)
    }
  }

  func showLogin() {
    if loginWeb != nil { return }
    guard let url = Self.loginUrl() else { return }
    status.isHidden = true
    let cfg = WKWebViewConfiguration()
    let w = WKWebView(frame: window.contentView!.bounds, configuration: cfg)
    w.autoresizingMask = [.width, .height]
    w.setValue(false, forKey: "drawsBackground")
    window.contentView?.addSubview(w)
    window.makeFirstResponder(w)
    w.load(URLRequest(url: url))
    loginWeb = w
  }

  func hideLogin() {
    guard let w = loginWeb else { return }
    w.removeFromSuperview()
    loginWeb = nil
    status.isHidden = waitWeb != nil
  }

  func setStatus(_ text: String) {
    status.stringValue = text
    if text != lastStatus {
      lastStatus = text
      pushWait()
    }
  }

  func deskError() -> String {
    let durable = (NSHomeDirectory() as NSString).appendingPathComponent(".dsh-company-rc8/desk-home/web-runtime.err")
    if let text = try? String(contentsOfFile: durable, encoding: .utf8) {
      let lines = text.split(whereSeparator: \.isNewline).map(String.init)
      if let err = lines.last(where: { $0.hasPrefix("Error:") }), !err.isEmpty {
        return err
      }
    }
    let log = (NSHomeDirectory() as NSString).appendingPathComponent("Library/Logs/TDHarness.log")
    if let text = try? String(contentsOfFile: log, encoding: .utf8) {
      let lines = text.split(whereSeparator: \.isNewline).map(String.init)
      let tail = Array(lines.suffix(24))
      if tail.contains(where: { $0.hasPrefix("session-mirror-fail") || $0.hasPrefix("BLOCKED=desk-lease") }) {
        return "公司盘太慢（中继）。请再开一次。"
      }
      if let err = lines.last(where: { $0.hasPrefix("Error:") }), !err.isEmpty {
        return err
      }
    }
    guard let root = Bundle.main.resourcePath else { return "打不开本机 Agent" }
    let err = (root as NSString).appendingPathComponent("home/web-runtime.err")
    guard let text = try? String(contentsOfFile: err, encoding: .utf8) else {
      return "打不开本机 Agent"
    }
    let tail = text.split(whereSeparator: \.isNewline).suffix(6).joined(separator: "\n")
    return tail.isEmpty ? "打不开本机 Agent" : tail
  }

  func fail(_ message: String) {
    // company-login-page-v1 (the user, 2026-11-24: 「弹窗能取消都取消，全部做在开机动态里」): on the waiting page when the
    // pack has it; the system alert only for a pack without login.html.
    loginWeb?.removeFromSuperview()
    loginWeb = nil
    if waitWeb == nil { showWaitPage() }
    if waitWeb != nil {
      lastFail = message
      pushFail(message)
      return
    }
    let alert = NSAlert()
    alert.messageText = "TDHarness"
    alert.informativeText = message
    alert.runModal()
    NSApp.terminate(nil)
  }

  func leaveDeadDesk(_ why: String) {
    logoutWatch?.invalidate()
    logoutWatch = nil
    web?.removeFromSuperview()
    web = nil
    let note = leaseNote()
    let text: String
    if !note.isEmpty {
      text = note
    } else if why == "kicked" {
      text = "这个账号已在其他设备登录，本机已退出。"
    } else {
      text = "座位已过期，请重新打开。"
    }
    fail(text)
  }

  func showDesk() {
    status.removeFromSuperview()
    waitWeb?.removeFromSuperview()
    waitWeb = nil
    let cfg = WKWebViewConfiguration()
    // company-chat-call-v1: a call's sound plays as soon as it comes, not after a click.
    cfg.mediaTypesRequiringUserActionForPlayback = []
    web = WKWebView(frame: window.contentView!.bounds, configuration: cfg)
    web!.autoresizingMask = [.width, .height]
    web!.navigationDelegate = self
    web!.uiDelegate = self
    window.contentView?.addSubview(web!)
    window.makeFirstResponder(web)
    web!.load(URLRequest(url: Self.deskUrl()))
    logoutWatch?.invalidate()
    portMisses = 0
    logoutWatch = Timer.scheduledTimer(withTimeInterval: 0.8, repeats: true) { [weak self] _ in
      guard let self = self else { return }
      if !tokenPresent() {
        self.logoutWatch?.invalidate()
        self.logoutWatch = nil
        NSApp.terminate(nil)
        return
      }
      let boot = Self.readBootStatus()
      if boot == "kicked" || boot == "desk-down" || boot == "fail" || boot == "quit" {
        self.leaveDeadDesk(boot)
        return
      }
      if portListening() {
        self.portMisses = 0
        return
      }
      self.portMisses += 1
      if self.portMisses >= 2 {
        Self.writeBootStatus("desk-down")
        self.leaveDeadDesk("desk-down")
      }
    }
  }

  // company-chat-voice-v1 / company-chat-call-v1: the chat page as this Mac's own relay serves it (chat-relay.js:
  // http://127.0.0.1, ports 17811-17814) records voice messages and makes calls; its microphone is allowed here
  // without WebKit asking again each time (macOS still asks once, for the app: NSMicrophoneUsageDescription).
  // company-chat-mic-frame-v1 (the user, 2026-11-25: 「每一次通话都有一个提示出来 我的mac」): on the desk the chat page is
  // a frame inside the desk's own page (127.0.0.1:17803), and WebKit names the page's origin, not the frame's: the
  // frame is looked at too. Anything else gets WebKit's own question.
  @available(macOS 12.0, *)
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo,
               type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    func loopback(_ o: WKSecurityOrigin) -> Bool { o.protocol == "http" && (o.host == "127.0.0.1" || o.host == "localhost") }
    func relay(_ o: WKSecurityOrigin) -> Bool { loopback(o) && (17811...17814).contains(o.port) }
    let chat = relay(origin) || (loopback(origin) && relay(frame.securityOrigin))
    decisionHandler(chat && type == .microphone ? .grant : .prompt)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  func applicationWillTerminate(_ notification: Notification) {
    // The window closed on the sign-in page: mac-login-page.js and start.command end with it.
    if Self.readBootStatus() == "login" { Self.writeBootStatus("quit") }
    logoutWatch?.invalidate()
    clearLoginFiles()
    quitLease()
    stopDesk()
  }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
