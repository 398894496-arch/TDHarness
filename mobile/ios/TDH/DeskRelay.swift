// The person's desk on the company server (server/desk_hub.js), for the 助手 tab, the way a computer reaches it
// (desk/pack/common/desk-hub-relay.js): the web view loads http://127.0.0.1:<port>/ (the kernel then treats it as its
// own loopback page), and this relay passes each connection on to https://<site>/desk-hub/... with the person's
// sign-in token, the company CA checking the server in code.
//
// Each connection carries one request (answered with Connection: close) or one WebSocket: only the request head is
// rewritten (path under /desk-hub, Host the site's, Authorization added, Connection kept for an upgrade); after it
// the bytes go both ways untouched, so the kernel's live stream (/api/remote.mux) passes as it is.
import Foundation
import Network
import Security
import CryptoKit

final class DeskRelay {
    static let shared = DeskRelay()

    private let queue = DispatchQueue(label: "tdh.desk.relay")
    private var listener: NWListener?
    private(set) var port: UInt16 = 0
    private var token = ""
    /// Why a connection to the server did not open (company-phone-diag-v1), for DeskModel to show and report.
    var onError: ((String) -> Void)?

    func start(token: String) async throws -> URL {
        self.token = token
        if listener == nil || port == 0 { port = try await listen() }
        return URL(string: "http://127.0.0.1:\(port)/")!
    }

    #if DEBUG
    /// Proofs only: what iOS does to a background app's listener.
    func dropListenerForTest() { listener?.cancel(); listener = nil }
    #endif

    func stop() {
        listener?.cancel()
        listener = nil
        port = 0
        token = ""
    }

    // company-phone-stream-watch-v1 (the user, 2026-11-26: 「对话没有响应了…刚刚的回传手机的通道出问题了」): the page's
    // live connection (/api/remote.mux) carries the assistant's answers; iOS closes it when the app goes to the
    // background, a network can drop it without a word, and the page did not open another (7 minutes without one in
    // the server's log, the answers reaching only the desk). The relay knows each one it carries — an id the server's
    // hub knows too — so DeskModel can ask and bring the page back.
    private let muxLock = NSLock()
    private var muxes: [String: (page: NWConnection, server: URLSessionStreamTask, since: Date)] = [:]
    private var muxGone: Date? = Date()

    /// The newest live connection of the page now open here.
    var liveStream: (id: String, since: Date)? {
        muxLock.lock(); defer { muxLock.unlock() }
        return muxes.max(by: { $0.value.since < $1.value.since }).map { ($0.key, $0.value.since) }
    }

    /// Since when the page has had no live connection; nil while it has one.
    var streamGoneSince: Date? {
        muxLock.lock(); defer { muxLock.unlock() }
        return muxes.isEmpty ? muxGone : nil
    }

    /// A page is loading: its live connection is expected from now.
    func expectStream() {
        muxLock.lock(); defer { muxLock.unlock() }
        if muxes.isEmpty { muxGone = Date() }
    }

    /// Ends every live connection (they are dead on the server's side): the page then has none, and says so.
    func dropStreams() {
        muxLock.lock()
        let all = muxes
        muxes = [:]
        muxGone = Date()
        muxLock.unlock()
        for (_, m) in all { m.server.cancel(); m.page.cancel() }
    }

    private func streamEnded(_ id: String?) {
        guard let id else { return }
        muxLock.lock(); defer { muxLock.unlock() }
        if muxes.removeValue(forKey: id) != nil, muxes.isEmpty { muxGone = Date() }
    }

    /// Whether iOS closed the listener while the app was away.
    private(set) var dead = false

    /// Whether the listener really takes a connection now (asked, not trusted: iOS takes a background app's listening
    /// socket away without always saying so — the page then fails with 「Load failed」, 2026-11-26).
    private func answers() async -> Bool {
        guard port != 0 else { return false }
        return await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
            let c = NWConnection(host: .ipv4(.loopback), port: NWEndpoint.Port(rawValue: port)!, using: .tcp)
            let once = RelayOnce()
            let finish: (Bool) -> Void = { ok in
                guard !once.done else { return }
                once.done = true
                c.cancel()
                cont.resume(returning: ok)
            }
            c.stateUpdateHandler = { st in
                switch st {
                case .ready: finish(true)
                case .failed, .waiting: finish(false)
                default: break
                }
            }
            c.start(queue: queue)
            queue.asyncAfter(deadline: .now() + 1.0) { finish(false) }
        }
    }

    /// The listener on its own port again if it no longer answers. True when it had to be brought back (its page
    /// must then load again).
    @discardableResult
    func revive() async -> Bool {
        guard port != 0 else { return false }
        if !dead, await answers() { return false }
        listener?.cancel()
        listener = nil
        for _ in 0..<3 {
            if let p = try? await listen(on: port), p == port { return true }
            try? await Task.sleep(nanoseconds: 200_000_000)
        }
        return false
    }

    private func listen() async throws -> UInt16 {
        for p: UInt16 in [17803, 17804, 17805, 0] {
            if let got = try? await listen(on: p) { return got }
        }
        throw NetError.offline
    }

    private func listen(on p: UInt16) async throws -> UInt16 {
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        params.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: p == 0 ? .any : NWEndpoint.Port(rawValue: p)!)
        let l = try NWListener(using: params)
        l.newConnectionHandler = { [weak self] c in self?.accept(c) }
        return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<UInt16, Error>) in
            let once = RelayOnce()
            l.stateUpdateHandler = { [weak self] st in
                // After it was up: iOS takes a background app's listening socket away; say so, so the app brings it
                // back on the same port when it is in front again (revive) — the page's address stays the same.
                if once.done {
                    if case .failed = st { self?.dead = true }
                    if case .cancelled = st, self?.listener === l { self?.dead = true }
                    return
                }
                switch st {
                case .ready:
                    once.done = true
                    self?.listener = l
                    self?.dead = false
                    cont.resume(returning: l.port?.rawValue ?? p)
                case .failed(let e):
                    once.done = true
                    l.cancel()
                    cont.resume(throwing: e)
                default: break
                }
            }
            l.start(queue: queue)
        }
    }

    private func accept(_ c: NWConnection) {
        c.start(queue: queue)
        readHead(c, Data())
    }

    private func readHead(_ c: NWConnection, _ buf: Data) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, complete, err in
            guard let self else { c.cancel(); return }
            var b = buf
            if let d = data { b.append(d) }
            if err != nil || (complete && b.isEmpty) { c.cancel(); return }
            guard let end = b.range(of: Data("\r\n\r\n".utf8)) else {
                if complete || b.count > 256 * 1024 { c.cancel() } else { self.readHead(c, b) }
                return
            }
            let head = b.subdata(in: b.startIndex..<end.lowerBound)
            let rest = b.subdata(in: end.upperBound..<b.endIndex)
            self.forward(c, head: head, rest: rest)
        }
    }

    /// The request head as the server must see it; nil for a head this relay does not answer (another Host).
    func rewrite(_ head: Data, stream: String? = nil) -> Data? {
        guard let text = String(data: head, encoding: .utf8) else { return nil }
        var lines = text.components(separatedBy: "\r\n")
        let first = lines.removeFirst().split(separator: " ", maxSplits: 2).map(String.init)
        guard first.count == 3, first[1].hasPrefix("/") else { return nil }
        var host = "", upgrade = false
        var kept: [String] = []
        for l in lines {
            guard let i = l.firstIndex(of: ":") else { continue }
            let k = l[..<i].lowercased(), v = l[l.index(after: i)...].trimmingCharacters(in: .whitespaces)
            switch k {
            case "host": host = v
            case "authorization", "proxy-connection", "keep-alive": continue
            case "connection": upgrade = v.lowercased().contains("upgrade")
            default: kept.append(l)
            }
        }
        guard host == "127.0.0.1:\(port)" || host == "localhost:\(port)" else { return nil }
        let siteHost = Site.config.host + (Site.config.port == 443 ? "" : ":\(Site.config.port)")
        var out = "\(first[0]) /desk-hub\(first[1]) \(first[2])\r\nHost: \(siteHost)\r\nAuthorization: Bearer \(token)\r\n"
        out += upgrade ? "Connection: Upgrade\r\n" : "Connection: close\r\n"
        if let stream { out += "X-TDH-Stream: \(stream)\r\n" }
        for l in kept { out += l + "\r\n" }
        return Data((out + "\r\n").utf8)
    }

    private func forward(_ c: NWConnection, head: Data, rest: Data) {
        // The desk's side-panel socket (/sidebar/ws/…: files the assistant opens beside the conversation) has nothing to
        // show on a phone, and the page opened and closed it every few seconds — a TLS connection through the cloud
        // entry each time (company-phone-net-v1). It never leaves the phone: answered here as opened, and then silent.
        // Answered, not left waiting (2026-11-26): a browser opens one WebSocket to an address at a time, the next
        // only once the one before has its answer — held unanswered, this socket kept the page's live connection
        // (/api/remote.mux) from ever being opened again after it dropped (「对话没有响应了」: 7 minutes without one).
        if let text = String(data: head, encoding: .utf8), text.hasPrefix("GET /sidebar/ws/") {
            var key = ""
            for l in text.components(separatedBy: "\r\n") where l.lowercased().hasPrefix("sec-websocket-key:") {
                key = l[l.index(after: l.firstIndex(of: ":")!)...].trimmingCharacters(in: .whitespaces)
            }
            guard !key.isEmpty else {
                c.send(content: Data("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8), completion: .contentProcessed { _ in c.cancel() })
                return
            }
            let accept = Data(Insecure.SHA1.hash(data: Data((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").utf8))).base64EncodedString()
            let answer = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: \(accept)\r\n\r\n"
            c.send(content: Data(answer.utf8), completion: .contentProcessed { [weak self] _ in self?.swallow(c) })
            return
        }
        let line = String(data: head.prefix(200), encoding: .utf8) ?? ""
        #if DEBUG
        if UserDefaults.standard.bool(forKey: "tdhRelayLog") {
            print("DEBUG_RELAY \(String(format: "%.1f", Date().timeIntervalSince1970.truncatingRemainder(dividingBy: 1000))) \(line.components(separatedBy: "\r\n").first?.prefix(90) ?? "")")
        }
        #endif
        let stream: String? = line.hasPrefix("GET /api/remote.mux") ? UUID().uuidString : nil
        guard let newHead = rewrite(head, stream: stream) else {
            c.send(content: Data("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8), completion: .contentProcessed { _ in c.cancel() })
            return
        }
        Task {
            // The address already found (a page is dozens of requests: probing for each would trip the cloud entry's
            // sign-in limit and its ban); a failed connection forgets it, so the next looks again.
            var found = Net.base
            if found == nil { found = await Net.findServer() }
            guard let base = found, let host = base.host else {
                self.onError?("relay: no server answers")
                c.send(content: Data("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8), completion: .contentProcessed { _ in c.cancel() })
                return
            }
            // The upstream through URLSession (a TLS stream task, PinnedTrust checking the certificate) — the stack the
            // phone's sign-in and chat already reach the server with. Network.framework's own connection opened on a
            // Mac but sent nothing from the user's phone on 5G (2026-11-26).
            var first = newHead
            first.append(rest)
            let up = Self.streams.streamTask(withHostName: host, port: base.port ?? Site.config.port)
            up.startSecureConnection()
            up.resume()
            if let stream {
                #if DEBUG
                print("DEBUG_STREAM mux opens at \(String(format: "%.1f", Date().timeIntervalSince1970.truncatingRemainder(dividingBy: 1000)))")
                #endif
                self.muxLock.lock()
                self.muxes[stream] = (c, up, Date())
                self.muxLock.unlock()
            }
            up.write(first, timeout: 20) { [weak self] err in
                guard let self else { up.cancel(); c.cancel(); return }
                if let err {
                    Net.forget()
                    self.onError?("relay \(host): \(err.localizedDescription) \((err as NSError).code)")
                    up.cancel()
                    c.cancel()
                    self.streamEnded(stream)
                    return
                }
                self.down(up, to: c, stream)
                self.upward(c, to: up, stream)
            }
        }
    }

    /// What the page says on a socket answered here is read and dropped, until the page closes it.
    private func swallow(_ c: NWConnection) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] _, _, complete, err in
            if complete || err != nil { c.cancel(); return }
            self?.swallow(c)
        }
    }

    /// Long-lived streams (the kernel's live connection stays open for hours), the same certificate check as Net.session.
    static let streams: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 24 * 3600
        c.timeoutIntervalForResource = 7 * 24 * 3600
        return URLSession(configuration: c, delegate: PinnedTrust(), delegateQueue: nil)
    }()

    /// Server → page.
    private func down(_ up: URLSessionStreamTask, to c: NWConnection, _ stream: String?) {
        up.readData(ofMinLength: 1, maxLength: 256 * 1024, timeout: 24 * 3600) { [weak self] data, eof, err in
            if let d = data, !d.isEmpty { c.send(content: d, completion: .contentProcessed { _ in }) }
            if eof || err != nil {
                c.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in c.cancel() })
                up.cancel()
                self?.streamEnded(stream)
                return
            }
            self?.down(up, to: c, stream)
        }
    }

    /// Page → server, in order (the next read only once the write is taken).
    private func upward(_ c: NWConnection, to up: URLSessionStreamTask, _ stream: String?) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [weak self] data, _, complete, err in
            let finish = complete || err != nil
            guard let d = data, !d.isEmpty else {
                // The page's side of a live connection is gone: the whole of it ends (half-open, the server kept it).
                if finish { if stream != nil { up.cancel(); self?.streamEnded(stream) } else { up.closeWrite() } } else { self?.upward(c, to: up, stream) }
                return
            }
            up.write(d, timeout: 60) { e in
                if e != nil { up.cancel(); c.cancel(); self?.streamEnded(stream); return }
                if finish { if stream != nil { up.cancel(); self?.streamEnded(stream) } else { up.closeWrite() } } else { self?.upward(c, to: up, stream) }
            }
        }
    }

}

/// Set once on the relay's queue: whether the listener's start has been answered.
final class RelayOnce: @unchecked Sendable { var done = false }
