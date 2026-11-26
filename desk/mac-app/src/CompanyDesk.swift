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

/// Warm the SMB share so the first agent read is not the one that pays for the
/// mount. Never on the main thread: when the server is slow or away, both
/// fileExists and contentsOfDirectory block for minutes on smbfs, and a sample
/// of a wedged desk showed the whole boot parked here — no bridge, no window
/// progress, nothing saying why.
func primeCompanyShare() {
  DispatchQueue.global(qos: .utility).async {
    let p = (NSHomeDirectory() as NSString).appendingPathComponent("company")
    var isDir: ObjCBool = false
    guard FileManager.default.fileExists(atPath: p, isDirectory: &isDir), isDir.boolValue else { return }
    _ = try? FileManager.default.contentsOfDirectory(atPath: p)
  }
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
  // The shop context is hidden by design; the one thing a person must do by
  // hand is log in once. No agent can do that step.
  let shopIn = NSMenuItem(title: "店铺登录（后台窗口）", action: #selector(ShopMenu.showShop(_:)), keyEquivalent: "")
  shopIn.target = ShopMenu.shared
  appMenu.addItem(shopIn)
  let shopOut = NSMenuItem(title: "收起店铺窗口", action: #selector(ShopMenu.hideShop(_:)), keyEquivalent: "")
  shopOut.target = ShopMenu.shared
  appMenu.addItem(shopOut)
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

final class App: NSObject, NSApplicationDelegate, WKNavigationDelegate {
  var window: NSWindow!
  var web: WKWebView?
  var status: NSTextField!
  var logoutWatch: Timer?
  var sigterm: DispatchSourceSignal?
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
    status = NSTextField(labelWithString: "正在打开本机 Agent…")
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
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    // Listener only. The hidden shop view itself is built on first use, so a
    // desk that never reads the shop pays nothing at boot. Before the share
    // warm-up on purpose: nothing on this line may depend on the network.
    ShopBridge.shared.start()
    primeCompanyShare()
    // A plain kill/pkill would end the process before WebKit flushes its cookie
    // jar, and the shop login silently would not survive the restart. Turn
    // SIGTERM into a normal quit so applicationWillTerminate always runs.
    signal(SIGTERM, SIG_IGN)
    let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    term.setEventHandler { NSApp.terminate(nil) }
    term.resume()
    sigterm = term
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
      for _ in 0..<600 {
        let boot = Self.readBootStatus()
        DispatchQueue.main.async { self.setStatus(Self.label(for: boot)) }
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
    case "ready": return "正在打开工作台…"
    case "fail": return "更新失败"
    case "quit": return "已取消"
    case "kicked": return "这个账号已在其他设备登录"
    case "desk-down": return "座位已过期，请重新打开。"
    default: return "正在打开本机 Agent…"
    }
  }

  func setStatus(_ text: String) {
    status.stringValue = text
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
    let cfg = WKWebViewConfiguration()
    web = WKWebView(frame: window.contentView!.bounds, configuration: cfg)
    web!.autoresizingMask = [.width, .height]
    web!.navigationDelegate = self
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

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  func applicationWillTerminate(_ notification: Notification) {
    logoutWatch?.invalidate()
    ShopBridge.shared.stop()
    clearLoginFiles()
    quitLease()
    stopDesk()
  }
}

// MARK: - Shop context
//
/// Keeps the shop login across desk restarts.
///
/// The identified data store does persist — a probe cookie with max-age survived
/// a clean SIGTERM restart — but the seller login did not: part of 千牛's login is
/// session-scoped, and those are meant to die with the process. The desk restarts
/// on its own (lease renewal, updates), and asking a shopkeeper to re-scan a QR
/// every time is not a product. So we snapshot the jar while it is alive and put
/// it back on the next launch.
///
/// The file holds live 淘宝 credentials. 0600, in the same directory as the bridge
/// secret, never on the company share, never uploaded. It is the same trust level
/// as the logged-in view itself; anyone who can read it could already read the
/// running desk's memory.
final class ShopJar: NSObject, WKHTTPCookieStoreObserver {
  private let store: WKHTTPCookieStore
  private var saveScheduled = false
  private(set) var restored = false
  private var waiting: [() -> Void] = []

  static func path() -> String {
    (NSHomeDirectory() as NSString).appendingPathComponent(".dsh-company-rc8/shop-cookies.json")
  }

  private var ticker: Timer?

  init(store: WKHTTPCookieStore) {
    self.store = store
    super.init()
    // The observer is kept, but nothing may depend on it: measured 2026-09-18,
    // cookiesDidChange did not fire for the 千牛 login and did not even fire for a
    // cookie set from page JS. It appears to report only API-side writes. So the
    // jar is also saved on a timer and after every page load; that is what
    // actually catches a login.
    store.add(self)
    let t = Timer(timeInterval: 30, repeats: true) { [weak self] _ in self?.save() }
    RunLoop.main.add(t, forMode: .common)
    ticker = t
  }

  func flush() { save() }

  func whenRestored(_ block: @escaping () -> Void) {
    if restored { block(); return }
    waiting.append(block)
  }

  func restore() {
    guard let d = FileManager.default.contents(atPath: ShopJar.path()),
          let rows = (try? JSONSerialization.jsonObject(with: d)) as? [[String: Any]], !rows.isEmpty
    else {
      finishRestore()
      return
    }
    var left = rows.count
    for row in rows {
      guard let c = ShopJar.cookie(from: row) else {
        left -= 1
        if left == 0 { finishRestore() }
        continue
      }
      store.setCookie(c) { [weak self] in
        left -= 1
        if left == 0 { self?.finishRestore() }
      }
    }
    if left == 0 { finishRestore() }
  }

  private func finishRestore() {
    if restored { return }
    restored = true
    let pending = waiting
    waiting = []
    for b in pending { b() }
  }

  func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
    // Login writes a burst of cookies; one save after it settles is enough.
    if saveScheduled { return }
    saveScheduled = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
      self?.saveScheduled = false
      self?.save()
    }
  }

  private func save() {
    store.getAllCookies { cookies in
      var rows: [[String: Any]] = []
      for c in cookies {
        // Only the shop. A stray cookie from anywhere else has no business in
        // this file.
        let d = c.domain.hasPrefix(".") ? String(c.domain.dropFirst()) : c.domain
        guard d.hasSuffix("taobao.com") || d.hasSuffix("tmall.com") || d.hasSuffix("alicdn.com")
        else { continue }
        var row: [String: Any] = [
          "name": c.name, "value": c.value, "domain": c.domain, "path": c.path,
          "secure": c.isSecure, "httpOnly": c.isHTTPOnly,
        ]
        if let e = c.expiresDate { row["expires"] = e.timeIntervalSince1970 }
        rows.append(row)
      }
      guard let data = try? JSONSerialization.data(withJSONObject: rows) else { return }
      let p = ShopJar.path()
      try? FileManager.default.createDirectory(
        atPath: (p as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
      try? data.write(to: URL(fileURLWithPath: p), options: [.atomic])
      try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: p)
    }
  }

  static func cookie(from row: [String: Any]) -> HTTPCookie? {
    guard let name = row["name"] as? String, let value = row["value"] as? String,
          let domain = row["domain"] as? String, let path = row["path"] as? String
    else { return nil }
    var props: [HTTPCookiePropertyKey: Any] = [
      .name: name, .value: value, .domain: domain, .path: path,
    ]
    if let e = row["expires"] as? Double {
      // Drop what 淘宝 already considers dead rather than re-injecting garbage.
      let when = Date(timeIntervalSince1970: e)
      if when < Date() { return nil }
      props[.expires] = when
    }
    if (row["secure"] as? Bool) == true { props[.secure] = "TRUE" }
    return HTTPCookie(properties: props)
  }
}

// A hidden WKWebView with its own cookie jar, so reading the company shop never
// touches the employee's own browser. This is the piece OpenCLI cannot give us:
// `--window background` only means "do not raise the window", the tab is still
// the one the человек is looking at.
//
// Two things only possible because we own the context:
//   - a document-start user script, so the page's OWN signed mtop calls are
//     recorded with their parameters. Private seller APIs demand undocumented
//     params (sourceApp, sellerCountEnum, codes…); guessing them is reverse
//     engineering, watching the page ask is not.
//   - a persistent store that survives relaunch, so the owner logs in once.
final class ShopContext: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
  static let shared = ShopContext()

  private var window: NSWindow?
  private var web: WKWebView?
  private var jar: ShopJar?
  private var loading = false

  static func savedCookieCount() -> Int {
    guard let d = FileManager.default.contents(atPath: ShopJar.path()),
          let rows = (try? JSONSerialization.jsonObject(with: d)) as? [[String: Any]]
    else { return 0 }
    return rows.count
  }

  /// Recorder. Wraps lib.mtop.request as soon as the sdk exists on the page.
  /// Ring-buffered: a workbench tab fires dozens of calls and we only ever want
  /// the recent ones.
  private static let recorderJS = """
  (function () {
    if (window.__tdhShopRec) { return }
    var R = (window.__tdhShopRec = { calls: [], hooked: false });

    // This script runs in every frame, and each frame gets its own R. The
    // workbench loads 商品 / 营销 as iframes, so the calls that matter happen in a
    // child while /eval only ever reads the top frame — which is why the item
    // list looked like it fetched nothing but config. Children relay upward.
    var isTop = true;
    try { isTop = window.top === window } catch (e) { isTop = false }
    if (isTop) {
      R.frames = 0;
      window.addEventListener("message", function (ev) {
        var d = ev.data;
        if (!d || d.__tdhShopRec !== 1 || typeof d.rec !== "string") { return }
        var rec;
        try { rec = JSON.parse(d.rec) } catch (e) { return }
        // Tagged with the sender so a relayed row is never mistaken for
        // something the top page asked itself.
        rec.frame = ev.origin || "?";
        R.frames++;
        push(rec);
      });
    }
    function push(rec) {
      R.calls.push(rec);
      if (R.calls.length > 200) { R.calls.shift() }
      if (relay) { relay(rec) }
    }
    var relay = isTop ? null : function (rec) {
      try {
        var s = JSON.stringify(rec);
        if (s.length > 24000) { rec = { api: rec.api, web: rec.web, ret: rec.ret, status: rec.status, resp: "[oversize]" }; s = JSON.stringify(rec) }
        window.top.postMessage({ __tdhShopRec: 1, rec: s }, "*");
      } catch (e) {}
    };
    function hook() {
      var m = window.lib && window.lib.mtop;
      if (!m || !m.request || R.hooked) { return !!R.hooked }
      var orig = m.request.bind(m);
      m.request = function (opt, ok, fail) {
        var t = Date.now();
        var api = opt && opt.api;
        return orig(opt, function (d) {
          push({ api: api, v: opt && opt.v, data: opt && opt.data, ret: d && d.ret, resp: d && d.data, ms: Date.now() - t });
          if (ok) { ok(d) }
        }, function (e) {
          push({ api: api, v: opt && opt.v, data: opt && opt.data, ret: e && e.ret, failed: true, ms: Date.now() - t });
          if (fail) { fail(e) }
        });
      };
      R.hooked = true;
      return true;
    }
    // Two minutes, not fifteen seconds: the 改库存 drawer is a micro-app that
    // pulls react and its own bundle off a cdn inside a throttled hidden view,
    // and lib.mtop can show up long after document-start.
    var n = 0;
    var iv = setInterval(function () { if (hook() || ++n > 2400) { clearInterval(iv) } }, 50);

    // Not every seller surface goes through mtop: 生意参谋 uses plain XHR and the
    // sold-orders list is a form POST to trade.taobao.com. Record those too, or
    // whole pages would look empty to us.
    function keep(url) {
      return typeof url === "string" && /taobao\\.com|tmall\\.com/.test(url)
        && !/\\.(js|css|png|jpg|jpeg|gif|webp|svg|woff2?)(\\?|$)/.test(url);
    }
    // Best effort on a request body: a write can carry a string, URLSearchParams,
    // FormData or JSON, and we want SOMETHING recognisable for every shape.
    function bodyText(b) {
      try {
        if (b == null) { return null }
        if (typeof b === "string") { return b.slice(0, 8000) }
        if (typeof URLSearchParams !== "undefined" && b instanceof URLSearchParams) { return b.toString().slice(0, 8000) }
        if (typeof FormData !== "undefined" && b instanceof FormData) {
          var o = {};
          b.forEach(function (v, k) { o[k] = typeof v === "string" ? v : "[file]" });
          return JSON.stringify(o).slice(0, 8000);
        }
        return JSON.stringify(b).slice(0, 8000);
      } catch (e) { return "[unreadable]" }
    }
    // The REQUEST is the part a write needs, and until 2026-09-19 this recorded
    // only the answer. That is why the 改库存 drawer could be seen happening and
    // still not be learnable: the url was known, the params never were. It also
    // used to drop anything whose response did not start with "{", which threw
    // away writes that reply with plain text or nothing at all.
    function pushWeb(url, status, text, method, body) {
      if (!keep(url)) { return }
      var json = typeof text === "string" && (text.charAt(0) === "{" || text.charAt(0) === "[");
      var rec = {
        web: String(url).slice(0, 300),
        method: method || "GET",
        status: status,
        reqBody: bodyText(body)
      };
      if (json) { rec.resp = text.slice(0, 20000) }
      else if (typeof text === "string") { rec.respText = text.slice(0, 400) }
      // A GET with no body and no JSON answer is noise; a write never is.
      if (!json && rec.reqBody == null && rec.method === "GET") { return }
      push(rec);
    }
    var XO = window.XMLHttpRequest && window.XMLHttpRequest.prototype.open;
    var XS = window.XMLHttpRequest && window.XMLHttpRequest.prototype.send;
    if (XO && XS && !window.XMLHttpRequest.prototype.__tdhHooked) {
      window.XMLHttpRequest.prototype.open = function (m, u) {
        try { this.__tdhM = m; this.__tdhU = u } catch (e) {}
        return XO.apply(this, arguments);
      };
      window.XMLHttpRequest.prototype.send = function (b) {
        var self = this;
        try {
          this.addEventListener("load", function () {
            try { pushWeb(self.__tdhU, self.status, self.responseText, self.__tdhM, b) } catch (e) {}
          });
        } catch (e) {}
        return XS.apply(this, arguments);
      };
      window.XMLHttpRequest.prototype.__tdhHooked = true;
    }
    if (window.fetch && !window.fetch.__tdhHooked) {
      var F = window.fetch;
      var wrapped = function (input, init) {
        var u = typeof input === "string" ? input : (input && input.url) || "";
        var m = (init && init.method) || (input && input.method) || "GET";
        var b = init && init.body;
        return F(input, init).then(function (res) {
          if (keep(u)) {
            res.clone().text().then(function (t) { pushWeb(u, res.status, t, m, b) }).catch(function () {});
          }
          return res;
        });
      };
      wrapped.__tdhHooked = true;
      window.fetch = wrapped;
    }

    // Catch-all. XHR and fetch are not the only ways a page asks for something.
    // On 2026-09-19 the 改库存 drawer saved successfully and left NOT ONE row
    // behind: a jsonp call is a <script src> and a ping is a beacon, and neither
    // passes through the two hooks above, so "nothing recorded" was read as
    // "nothing happened". Resource timing sees every request there is. It has no
    // body — but a jsonp write carries its entire request in the query string,
    // which is precisely what a replay needs.
    var perfSeen = 0;
    function flushPerf() {
      try {
        var all = performance.getEntriesByType("resource");
        for (var i = perfSeen; i < all.length; i++) {
          var e = all[i];
          perfSeen = i + 1;
          if (!keep(e.name)) { continue }
          // Those two are already recorded above, with their bodies.
          if (e.initiatorType === "xmlhttprequest" || e.initiatorType === "fetch") { continue }
          push({ web: String(e.name).slice(0, 300), method: "GET", via: e.initiatorType || "?", perf: true });
        }
        perfSeen = all.length;
      } catch (e) {}
    }
    try { new PerformanceObserver(flushPerf).observe({ entryTypes: ["resource"] }) } catch (e) {}
    // A frame that dies on success — the drawer closes the instant the save
    // returns — would carry its unrelayed rows to the grave. Push them first.
    try {
      window.addEventListener("pagehide", flushPerf);
      window.addEventListener("unload", flushPerf);
    } catch (e) {}
    if (navigator.sendBeacon && !navigator.sendBeacon.__tdhHooked) {
      var SB = navigator.sendBeacon.bind(navigator);
      var sb = function (u, b) { try { pushWeb(u, 0, "", "POST", b) } catch (e) {} return SB(u, b) };
      sb.__tdhHooked = true;
      try { navigator.sendBeacon = sb } catch (e) {}
    }

    // Tell the app this frame exists, so /eval can be aimed at it. The 改库存
    // drawer lives on inventorymanage.taobao.com, a different origin: replaying
    // its request from the top frame would be a cross-origin fetch and CORS
    // would refuse it. Evaluating INSIDE the frame is the only honest way.
    try {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.tdhFrame) {
        window.webkit.messageHandlers.tdhFrame.postMessage({
          origin: location.origin, href: String(location.href).slice(0, 300), top: isTop
        });
      }
    } catch (e) {}
  })()
  """

  private func ensure() -> WKWebView {
    if let w = web { return w }
    let cfg = WKWebViewConfiguration()
    // macOS 14 can give this context its own store. On 13 the app's default
    // store is still separate from Chrome, which is the isolation that matters.
    if #available(macOS 14.0, *) {
      cfg.websiteDataStore = WKWebsiteDataStore(forIdentifier: ShopContext.storeId)
    }
    let ctl = WKUserContentController()
    ctl.addUserScript(
      WKUserScript(source: ShopContext.recorderJS, injectionTime: .atDocumentStart, forMainFrameOnly: false)
    )
    // Every frame announces itself here; see frames[] and eval(in:).
    ctl.add(self, name: "tdhFrame")
    cfg.userContentController = ctl
    let w = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 900), configuration: cfg)
    w.navigationDelegate = self
    // Off-screen rather than zero-sized: a 0x0 or fully occluded view gets its
    // timers throttled, and the seller workbench needs its own scripts to run.
    // No .closable: this window is driven by the menu and the bridge. A stray
    // click on a red dot must not feed the app's "last window closed → quit".
    let win = NSWindow(
      contentRect: NSRect(x: -20000, y: -20000, width: 1180, height: 820),
      styleMask: [.titled, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    win.title = "店铺登录（后台窗口）— 登完可以直接收起"
    win.isReleasedWhenClosed = false
    win.contentView?.addSubview(w)
    w.autoresizingMask = [.width, .height]
    win.orderOut(nil)
    // Ask the window server, do not guess. isVisible is our own flag and it says
    // nothing about whether anyone can actually SEE the window: on 2026-09-19 a
    // shown-but-unfocused window had isVisible true and was still throttled, so
    // the "reload once someone looks" patch never fired and 出售中宝贝 stayed at
    // 共0件商品. occlusionState is the real answer, and this notification is the
    // moment it changes.
    NotificationCenter.default.addObserver(
      forName: NSWindow.didChangeOcclusionStateNotification, object: win, queue: .main
    ) { [weak self] _ in
      self?.redoLoadIfItHappenedInTheDark()
    }
    window = win
    web = w
    let j = ShopJar(store: w.configuration.websiteDataStore.httpCookieStore)
    jar = j
    j.restore()
    return w
  }

  /// Stable per-user id so the login survives relaunch.
  private static let storeId: UUID = {
    let p = (NSHomeDirectory() as NSString).appendingPathComponent(".dsh-company-rc8/shop-store.id")
    if let s = try? String(contentsOfFile: p, encoding: .utf8),
       let u = UUID(uuidString: s.trimmingCharacters(in: .whitespacesAndNewlines)) {
      return u
    }
    let u = UUID()
    try? FileManager.default.createDirectory(
      atPath: (p as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
    try? u.uuidString.write(toFile: p, atomically: true, encoding: .utf8)
    return u
  }()

  func setVisible(_ show: Bool) {
    let w = ensure()
    guard let win = window else { return }
    if show {
      // Centre it. The old (120,120) sat almost exactly on top of the desk
      // window, so one click on the desk buried it and it read as "never
      // appeared". Also order front regardless of who is active, otherwise a
      // bridge-driven show while another app is frontmost does nothing visible.
      let size = NSSize(width: 1180, height: 820)
      let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
      win.setFrame(
        NSRect(
          x: screen.midX - size.width / 2,
          y: screen.midY - size.height / 2,
          width: size.width, height: size.height),
        display: true)
      win.orderFrontRegardless()
      win.makeKeyAndOrderFront(nil)
      NSApp.activate(ignoringOtherApps: true)
      // A page that loaded while this window was hidden has its DOM half built.
      // WebKit throttles rendering work for an offscreen window: the fetches do
      // go out (which is why the recorded recipes work at all), but the render
      // task never runs, so a React list sits there with zero rows. 2026-09-19:
      // 出售中宝贝 showed 共0件商品 / 没有数据 while the very same response in the
      // recorder carried 20 items and the tab count said 207. Read by eye that
      // is "the shop is empty", and the person we are about to ask to edit one
      // item by hand would have nothing to click. So a load that happened in the
      // dark is redone now that someone is looking.
      redoLoadIfItHappenedInTheDark()
      _ = w
    } else {
      win.orderOut(nil)
      win.setFrame(NSRect(x: -20000, y: -20000, width: 1180, height: 820), display: false)
    }
  }

  /// Set when a page is loaded with nobody able to see it, cleared when we redo
  /// the load for a human. See seenByTheWindowServer / setVisible(true).
  private var loadedWhileHidden = false

  /// What the window server thinks, not what we hope. An off-screen, covered or
  /// never-ordered-in window is not visible, and WebKit throttles its rendering.
  private var seenByTheWindowServer: Bool {
    guard let win = window else { return false }
    return win.occlusionState.contains(.visible)
  }

  /// A page fetched in the dark has a DOM but no committed frame: the requests go
  /// out (which is why recorded recipes work) while the React list renders zero
  /// rows. Redo it the moment the window is genuinely on screen, so the person we
  /// are about to ask to edit one item by hand is not looking at an empty shop.
  private func redoLoadIfItHappenedInTheDark() {
    guard loadedWhileHidden, seenByTheWindowServer, let w = web, let u = w.url,
          u.absoluteString != "about:blank"
    else { return }
    loadedWhileHidden = false
    w.reload()
  }

  func navigate(_ url: URL) {
    let w = ensure()
    loading = true
    loadedWhileHidden = !seenByTheWindowServer
    // Never load before the saved jar is back in the store, or the first page of
    // a fresh process is the login page even though we do hold the login.
    if let j = jar, !j.restored {
      j.whenRestored { w.load(URLRequest(url: url)) }
      return
    }
    w.load(URLRequest(url: url))
  }

  /// Live frames by origin, newest wins. A WKFrameInfo is only good while that
  /// frame is alive, so this is a cache of handles, not a list of facts: a stale
  /// one fails the eval and gets dropped rather than answering wrongly.
  private var frames: [String: (info: WKFrameInfo, href: String)] = [:]

  func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.name == "tdhFrame", let d = message.body as? [String: Any],
          let origin = d["origin"] as? String, !origin.isEmpty, origin != "null"
    else { return }
    frames[origin] = (message.frameInfo, (d["href"] as? String) ?? "")
  }

  var frameOrigins: [String] { frames.keys.sorted() }

  func eval(_ js: String, frame: String? = nil, done: @escaping (String) -> Void) {
    let w = ensure()
    // Aimed at one frame: needed to replay a request that belongs to that origin.
    if let want = frame, !want.isEmpty {
      guard let hit = frames[want] else {
        done("{\"ok\":false,\"error\":\"no-such-frame\",\"known\":\(ShopBridge.escList(frameOrigins))}")
        return
      }
      let wrapped = "try { return JSON.stringify({ ok: true, value: await (\(js)) }) } "
        + "catch (e) { return JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }) }"
      w.callAsyncJavaScript(wrapped, in: hit.info, in: .page) { [weak self] result in
        switch result {
        case .success(let v):
          done((v as? String) ?? "{\"ok\":false,\"error\":\"eval-not-string\"}")
        case .failure(let e):
          // A dead frame must not linger and keep answering.
          self?.frames.removeValue(forKey: want)
          let msg = String(describing: e).replacingOccurrences(of: "\"", with: "'")
          done("{\"ok\":false,\"error\":\"frame-eval-failed: \(msg)\"}")
        }
      }
      return
    }
    // Hand back a JSON string always: callers parse one shape, and a thrown
    // page error must not look like an empty answer.
    // callAsyncJavaScript takes a function BODY, so it must `return`. Passing a
    // bare expression evaluates it and hands back undefined, which showed up as
    // a useless "eval-not-string".
    let wrapped = "try { return JSON.stringify({ ok: true, value: await (\(js)) }) } "
      + "catch (e) { return JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }) }"
    w.callAsyncJavaScript(wrapped, in: nil, in: .page) { result in
      switch result {
      case .success(let v):
        done((v as? String) ?? "{\"ok\":false,\"error\":\"eval-not-string\"}")
      case .failure(let e):
        let msg = String(describing: e).replacingOccurrences(of: "\"", with: "'")
        done("{\"ok\":false,\"error\":\"\(msg)\"}")
      }
    }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    loading = false
    // A finished load is when the login redirect has settled, so this is the
    // cheapest honest moment to keep the jar.
    jar?.flush()
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { loading = false }
  func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { loading = false }

  var isLoading: Bool { loading || (web?.isLoading ?? false) }
  var currentUrl: String { web?.url?.absoluteString ?? "" }
  var hasView: Bool { web != nil }
  var isVisible: Bool { window?.isVisible ?? false }
}

final class ShopMenu: NSObject {
  static let shared = ShopMenu()
  static let home = URL(string: "https://myseller.taobao.com/home.htm")!

  @objc func showShop(_ sender: Any?) {
    ShopContext.shared.setVisible(true)
    if ShopContext.shared.currentUrl.isEmpty { ShopContext.shared.navigate(ShopMenu.home) }
  }

  @objc func hideShop(_ sender: Any?) { ShopContext.shared.setVisible(false) }
}

// MARK: - Shop bridge
//
// Loopback HTTP so the company-shell HOST tool can drive the hidden context.
// Port is ephemeral and the secret is per-launch; both land in a 0600 file that
// only this user can read. Nothing here is reachable off the machine.
/// Approval tickets for shop WRITES.
///
/// The whole point of this class is to put one step of a write outside the
/// agent's reach. Everything else in the write path is code the model can read,
/// call, or (on a machine it has a shell on) edit; a confirmation code printed
/// back to the model would be theatre, because the model would know the code.
/// So the decision is a button in this app's own window: the model can ask for
/// a ticket and can ask whether it was approved, and it cannot approve one.
///
/// Two consequences worth stating plainly:
///   * Nobody clicking = nothing happens. Timeout is a refusal, not a retry.
///   * consume() is single-use, so an approval cannot be replayed for a second
///     write, and the digest is checked so it cannot be reused for a different
///     one than the human read.
final class ShopTickets {
  static let shared = ShopTickets()
  private let queue = DispatchQueue(label: "company.shop.tickets")

  static func dir() -> String {
    (NSHomeDirectory() as NSString).appendingPathComponent(".dsh-company-rc8/shop-writes")
  }

  /// Writes are off unless this desk was planted as the owner desk
  /// (plant-shop-recipes.sh SHOP_WRITE_OWNER=1). Phase 1: only the boss's desk.
  /// This is a role switch, not a security boundary — the boundary is the click
  /// below. An employee desk simply never offers the panel, so their agent's
  /// write attempt dies here with write-not-enabled-on-this-desk.
  static func ownerEnabled() -> Bool {
    FileManager.default.fileExists(
      atPath: (NSHomeDirectory() as NSString).appendingPathComponent(".dsh-company-rc8/shop-write-owner"))
  }

  private static func file(_ id: String) -> String? {
    // id is ours, but it arrives back over HTTP, so treat it as data.
    guard id.count == 32, id.allSatisfy({ $0.isHexDigit }) else { return nil }
    return (dir() as NSString).appendingPathComponent("\(id).json")
  }

  private static func load(_ id: String) -> [String: Any]? {
    guard let p = file(id), let d = FileManager.default.contents(atPath: p),
          let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any]
    else { return nil }
    return o
  }

  private static func store(_ id: String, _ o: [String: Any]) {
    guard let p = file(id), let d = try? JSONSerialization.data(withJSONObject: o, options: [.prettyPrinted])
    else { return }
    try? FileManager.default.createDirectory(atPath: dir(), withIntermediateDirectories: true)
    try? d.write(to: URL(fileURLWithPath: p), options: .atomic)
    try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: p)
  }

  /// A pending ticket past its ttl reads as rejected. Said the other way: if the
  /// human walked away, the write does not happen.
  private static func effectiveState(_ o: [String: Any]) -> String {
    let state = (o["state"] as? String) ?? "pending"
    guard state == "pending" else { return state }
    let born = (o["createdAt"] as? NSNumber)?.doubleValue ?? 0
    let ttl = (o["ttlSec"] as? NSNumber)?.doubleValue ?? 300
    return Date().timeIntervalSince1970 - born > ttl ? "expired" : "pending"
  }

  func create(recipe: String, title: String, lines: [String], digest: String, ttlSec: Double) -> String {
    let id = (UUID().uuidString + UUID().uuidString)
      .replacingOccurrences(of: "-", with: "").lowercased().prefix(32).description
    ShopTickets.store(id, [
      "id": id, "recipe": recipe, "title": title, "lines": lines, "digest": digest,
      "createdAt": Date().timeIntervalSince1970, "ttlSec": ttlSec, "state": "pending",
    ])
    return id
  }

  /// Show the human what is about to change and record what they said.
  /// Presented after the HTTP answer is already on its way, because this blocks
  /// the main thread for as long as the person takes to read it.
  func ask(id: String, title: String, lines: [String]) {
    guard var o = ShopTickets.load(id), ShopTickets.effectiveState(o) == "pending" else { return }
    let a = NSAlert()
    a.messageText = "店铺写操作需要你确认"
    a.informativeText = ([title, ""] + lines + ["", "同意后 agent 才能执行；不理它就当拒绝。"]).joined(separator: "\n")
    a.alertStyle = .warning
    // 拒绝 first so Return does not approve: the dangerous answer must be aimed at.
    a.addButton(withTitle: "拒绝")
    a.addButton(withTitle: "同意执行")
    NSApp.activate(ignoringOtherApps: true)
    let approved = a.runModal() == .alertSecondButtonReturn
    // Re-read: the ttl may have run out while it sat on screen.
    guard var fresh = ShopTickets.load(id), ShopTickets.effectiveState(fresh) == "pending" else { return }
    fresh["state"] = approved ? "approved" : "rejected"
    fresh["decidedAt"] = Date().timeIntervalSince1970
    fresh["approver"] = NSFullUserName()
    o = fresh
    ShopTickets.store(id, o)
  }

  func state(id: String) -> [String: Any] {
    guard let o = ShopTickets.load(id) else { return ["ok": false, "error": "no-ticket"] }
    return [
      "ok": true, "state": ShopTickets.effectiveState(o), "recipe": (o["recipe"] as? String) ?? "",
      "digest": (o["digest"] as? String) ?? "",
      "approver": (o["approver"] as? String) ?? "",
      "consumed": o["consumedAt"] != nil,
    ]
  }

  /// Spend an approval. Single-use and digest-bound, serialised on one queue so
  /// two commits cannot both win.
  func consume(id: String, digest: String) -> [String: Any] {
    queue.sync {
      guard var o = ShopTickets.load(id) else { return ["ok": false, "error": "no-ticket"] }
      let st = ShopTickets.effectiveState(o)
      if st != "approved" { return ["ok": false, "error": "not-approved", "state": st] }
      if o["consumedAt"] != nil { return ["ok": false, "error": "already-consumed"] }
      if (o["digest"] as? String) != digest {
        return ["ok": false, "error": "digest-mismatch",
                "hint": "the plan changed after it was approved; plan again"]
      }
      o["consumedAt"] = Date().timeIntervalSince1970
      ShopTickets.store(id, o)
      return ["ok": true, "approver": (o["approver"] as? String) ?? ""]
    }
  }
}

final class ShopBridge {
  static let shared = ShopBridge()
  private var sock: Int32 = -1
  private let secret = UUID().uuidString.replacingOccurrences(of: "-", with: "")
    + UUID().uuidString.replacingOccurrences(of: "-", with: "")
  private let queue = DispatchQueue(label: "company.shop.bridge")

  static func infoPath() -> String {
    (NSHomeDirectory() as NSString).appendingPathComponent(".dsh-company-rc8/shop-bridge.json")
  }

  /// Plain BSD sockets rather than Network.framework: binding an ephemeral port
  /// on loopback only is exactly expressible here, and the first attempt with
  /// NWListener + requiredLocalEndpoint(port: .any) silently never reached
  /// .ready, so the app ran with no listener at all and nothing said why.
  /// True only for the desk that wrote the info file. A second desk must not
  /// overwrite it and must not delete it on the way out: both happened, and the
  /// symptom was a desk that was still running while the runner reported
  /// "bridge-missing".
  private var owner = false

  static func liveOwnerPid() -> Int32? {
    guard let d = FileManager.default.contents(atPath: infoPath()),
          let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
          let pid = (o["pid"] as? NSNumber)?.int32Value, pid > 0, pid != getpid(),
          kill(pid, 0) == 0
    else { return nil }
    return pid
  }

  func start() {
    guard sock < 0 else { return }
    // Another desk already owns the shop context. One hidden login per machine
    // is the point, so leave its file alone rather than racing it — but keep
    // checking: if that desk is the short-lived one, it takes the file with it
    // when it goes, and without this retry the survivor would run bridgeless.
    if ShopBridge.liveOwnerPid() != nil {
      queue.asyncAfter(deadline: .now() + 5) { [weak self] in self?.start() }
      return
    }
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    guard fd >= 0 else { return }
    var yes: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
    var addr = sockaddr_in()
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = 0  // kernel picks
    addr.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
    let bound = withUnsafePointer(to: &addr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
    guard bound == 0, listen(fd, 8) == 0 else { close(fd); return }
    var back = sockaddr_in()
    var len = socklen_t(MemoryLayout<sockaddr_in>.size)
    let got = withUnsafeMutablePointer(to: &back) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &len) }
    }
    guard got == 0 else { close(fd); return }
    sock = fd
    publish(port: UInt16(bigEndian: back.sin_port))
    queue.async { [weak self] in self?.acceptLoop(fd) }
  }

  func stop() {
    if sock >= 0 { close(sock); sock = -1 }
    guard owner else { return }
    try? FileManager.default.removeItem(atPath: ShopBridge.infoPath())
    owner = false
  }

  private func acceptLoop(_ fd: Int32) {
    while true {
      let c = accept(fd, nil, nil)
      if c < 0 {
        if errno == EINTR { continue }
        return
      }
      serve(c)
      close(c)
    }
  }

  private func serve(_ c: Int32) {
    var buf = Data()
    var chunk = [UInt8](repeating: 0, count: 65536)
    var headEnd: Int? = nil
    // Read headers, then exactly Content-Length bytes. A short read must not be
    // mistaken for an empty body.
    while true {
      if headEnd == nil { headEnd = ShopBridge.findHeadEnd(buf) }
      if let he = headEnd {
        let head = String(data: buf.prefix(he), encoding: .utf8) ?? ""
        let need = ShopBridge.contentLength(head)
        let start = he + 4
        if buf.count - start >= need {
          let body = buf.subdata(in: start..<(start + need))
          let sem = DispatchSemaphore(value: 0)
          var code = 500
          var json = "{\"ok\":false,\"error\":\"no-answer\"}"
          route(head: head, body: body) { c2, j in
            code = c2
            json = j
            sem.signal()
          }
          // The eval hop runs on main; 150s covers a cold seller page.
          if sem.wait(timeout: .now() + 150) == .timedOut {
            code = 504
            json = "{\"ok\":false,\"error\":\"eval-timeout\"}"
          }
          ShopBridge.write(c, code: code, json: json)
          return
        }
      }
      let n = read(c, &chunk, chunk.count)
      if n <= 0 { return }
      buf.append(contentsOf: chunk[0..<n])
      if buf.count > 4 << 20 { return }
    }
  }

  private static func write(_ c: Int32, code: Int, json: String) {
    let payload = Data(json.utf8)
    var head = "HTTP/1.1 \(code) \(code == 200 ? "OK" : "ERR")\r\n"
    head += "Content-Type: application/json; charset=utf-8\r\n"
    head += "Content-Length: \(payload.count)\r\nConnection: close\r\n\r\n"
    var out = Data(head.utf8)
    out.append(payload)
    out.withUnsafeBytes { raw in
      var off = 0
      while off < raw.count {
        let n = Darwin.write(c, raw.baseAddress!.advanced(by: off), raw.count - off)
        if n <= 0 { return }
        off += n
      }
    }
  }

  private func publish(port: UInt16) {
    let body = "{\n  \"url\": \"http://127.0.0.1:\(port)\",\n  \"secret\": \"\(secret)\",\n  \"pid\": \(getpid())\n}\n"
    let path = ShopBridge.infoPath()
    try? FileManager.default.createDirectory(
      atPath: (path as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
    try? body.write(toFile: path, atomically: true, encoding: .utf8)
    try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path)
    owner = true
  }

  private static func findHeadEnd(_ d: Data) -> Int? {
    let pat = Data("\r\n\r\n".utf8)
    guard d.count >= 4 else { return nil }
    for i in 0...(d.count - 4) {
      if d.subdata(in: i..<(i + 4)) == pat { return i }
    }
    return nil
  }

  private static func contentLength(_ head: String) -> Int {
    for line in head.split(separator: "\r\n") {
      let parts = line.split(separator: ":", maxSplits: 1).map(String.init)
      if parts.count == 2, parts[0].lowercased() == "content-length" {
        return Int(parts[1].trimmingCharacters(in: .whitespaces)) ?? 0
      }
    }
    return 0
  }

  private static func jsonString(_ body: Data, _ key: String) -> String? {
    guard let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any] else { return nil }
    return obj[key] as? String
  }

  private static func jsonObj(_ body: Data) -> [String: Any]? {
    try? JSONSerialization.jsonObject(with: body) as? [String: Any]
  }

  private static func dump(_ o: [String: Any]) -> String {
    guard let d = try? JSONSerialization.data(withJSONObject: o, options: []),
          let s = String(data: d, encoding: .utf8)
    else { return "{\"ok\":false,\"error\":\"encode\"}" }
    return s
  }

  private static func jsonBool(_ body: Data, _ key: String) -> Bool? {
    guard let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any] else { return nil }
    return obj[key] as? Bool
  }

  static func escList(_ rows: [String]) -> String {
    let d = try? JSONSerialization.data(withJSONObject: rows, options: [])
    return d.flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
  }

  private static func esc(_ s: String) -> String {
    let d = try? JSONSerialization.data(withJSONObject: [s], options: [])
    let t = d.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
    return String(t.dropFirst().dropLast())
  }

  private func route(head: String, body: Data, done: @escaping (Int, String) -> Void) {
    let lines = head.split(separator: "\r\n").map(String.init)
    let request = lines.first ?? ""
    let bits = request.split(separator: " ").map(String.init)
    let method = bits.first ?? ""
    let path = bits.count > 1 ? bits[1] : ""
    let authed = lines.contains {
      $0.lowercased().hasPrefix("authorization:") && $0.contains(secret)
    }
    guard authed else {
      done(401, "{\"ok\":false,\"error\":\"bad-secret\"}")
      return
    }
    DispatchQueue.main.async {
      let shop = ShopContext.shared
      switch (method, path) {
      case ("GET", "/state"):
        // esc() already returns a quoted JSON string; do not quote it again.
        done(200, "{\"ok\":true,\"url\":\(ShopBridge.esc(shop.currentUrl)),"
          + "\"loading\":\(shop.isLoading),\"started\":\(shop.hasView),\"visible\":\(shop.isVisible),"
          // How many shop cookies are on disk for the next launch. 0 with a
          // logged-in view means the jar is not saving, which is the difference
          // between "log in once" and "log in every restart".
          + "\"savedCookies\":\(ShopContext.savedCookieCount()),"
          // Whether this desk may even ask for a write approval. Reported so
          // "写不了" is answerable without reading the plant script.
          + "\"writeOwner\":\(ShopTickets.ownerEnabled()),"
          // Which origins can be evaluated into. The 改库存 drawer is a different
          // origin than the item list, and "which frames do we hold" is the
          // difference between replaying its request and guessing at it.
          + "\"frames\":\(ShopBridge.escList(shop.frameOrigins))}")
      case ("POST", "/nav"):
        guard let u = ShopBridge.jsonString(body, "url"), let url = URL(string: u),
              url.scheme == "https" else {
          done(400, "{\"ok\":false,\"error\":\"need-https-url\"}")
          return
        }
        shop.navigate(url)
        done(200, "{\"ok\":true,\"navigating\":\(ShopBridge.esc(u))}")
      case ("POST", "/window"):
        let show = ShopBridge.jsonBool(body, "show") ?? false
        shop.setVisible(show)
        done(200, "{\"ok\":true,\"visible\":\(show)}")
      case ("POST", "/eval"):
        guard let js = ShopBridge.jsonString(body, "js"), !js.isEmpty else {
          done(400, "{\"ok\":false,\"error\":\"need-js\"}")
          return
        }
        // `frame` aims the eval at one origin's frame; absent means the top one.
        shop.eval(js, frame: ShopBridge.jsonString(body, "frame")) { out in done(200, out) }

      // ---- writes: ask, look, spend. Never "do". ----
      case ("POST", "/write/new"):
        guard ShopTickets.ownerEnabled() else {
          done(403, "{\"ok\":false,\"error\":\"write-not-enabled-on-this-desk\"}")
          return
        }
        guard let o = ShopBridge.jsonObj(body),
              let recipe = o["recipe"] as? String, !recipe.isEmpty,
              let digest = o["digest"] as? String, !digest.isEmpty,
              let lines = o["lines"] as? [String], !lines.isEmpty else {
          done(400, "{\"ok\":false,\"error\":\"need-recipe-digest-lines\"}")
          return
        }
        let title = (o["title"] as? String) ?? recipe
        // Long enough to read a diff, short enough that an approval left on the
        // screen over lunch is not still spendable after it.
        let ttl = min(max((o["ttlSec"] as? NSNumber)?.doubleValue ?? 300, 30), 900)
        let id = ShopTickets.shared.create(
          recipe: recipe, title: title, lines: lines, digest: digest, ttlSec: ttl)
        done(200, "{\"ok\":true,\"id\":\"\(id)\",\"state\":\"pending\",\"ttlSec\":\(Int(ttl))}")
        // After the answer, because this blocks main until the human decides.
        DispatchQueue.main.async { ShopTickets.shared.ask(id: id, title: title, lines: lines) }
      case ("POST", "/write/state"):
        guard let id = ShopBridge.jsonString(body, "id") else {
          done(400, "{\"ok\":false,\"error\":\"need-id\"}")
          return
        }
        done(200, ShopBridge.dump(ShopTickets.shared.state(id: id)))
      case ("POST", "/write/consume"):
        guard let id = ShopBridge.jsonString(body, "id"),
              let digest = ShopBridge.jsonString(body, "digest") else {
          done(400, "{\"ok\":false,\"error\":\"need-id-digest\"}")
          return
        }
        let r = ShopTickets.shared.consume(id: id, digest: digest)
        done((r["ok"] as? Bool) == true ? 200 : 409, ShopBridge.dump(r))

      default:
        done(404, "{\"ok\":false,\"error\":\"no-route\"}")
      }
    }
  }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
