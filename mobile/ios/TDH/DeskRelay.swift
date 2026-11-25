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

final class DeskRelay {
    static let shared = DeskRelay()

    private let queue = DispatchQueue(label: "tdh.desk.relay")
    private var listener: NWListener?
    private(set) var port: UInt16 = 0
    private var token = ""

    func start(token: String) async throws -> URL {
        self.token = token
        if listener == nil || port == 0 { port = try await listen() }
        return URL(string: "http://127.0.0.1:\(port)/")!
    }

    func stop() {
        listener?.cancel()
        listener = nil
        port = 0
        token = ""
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
                guard !once.done else { return }
                switch st {
                case .ready:
                    once.done = true
                    self?.listener = l
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
    func rewrite(_ head: Data) -> Data? {
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
        for l in kept { out += l + "\r\n" }
        return Data((out + "\r\n").utf8)
    }

    private func forward(_ c: NWConnection, head: Data, rest: Data) {
        guard let newHead = rewrite(head) else {
            c.send(content: Data("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8), completion: .contentProcessed { _ in c.cancel() })
            return
        }
        Task {
            guard let base = await Net.findServer(), let host = base.host else {
                c.send(content: Data("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8), completion: .contentProcessed { _ in c.cancel() })
                return
            }
            let up = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: UInt16(base.port ?? Site.config.port))!, using: Self.tlsParams())
            up.stateUpdateHandler = { [weak self] st in
                switch st {
                case .ready:
                    var first = newHead
                    first.append(rest)
                    up.send(content: first, completion: .contentProcessed { _ in })
                    self?.pipe(from: up, to: c)
                    self?.pipe(from: c, to: up)
                case .failed, .cancelled:
                    c.cancel()
                default: break
                }
            }
            up.start(queue: self.queue)
        }
    }

    private func pipe(from a: NWConnection, to b: NWConnection) {
        a.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [weak self] data, _, complete, err in
            if let d = data, !d.isEmpty {
                b.send(content: d, completion: .contentProcessed { _ in })
            }
            if complete || err != nil {
                b.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in b.cancel() })
                a.cancel()
                return
            }
            self?.pipe(from: a, to: b)
        }
    }

    /// TLS whose certificate must chain to the company root and name the site's host (as Net.session checks).
    static func tlsParams() -> NWParameters {
        let tls = NWProtocolTLS.Options()
        sec_protocol_options_set_tls_server_name(tls.securityProtocolOptions, Site.config.host)
        sec_protocol_options_set_verify_block(tls.securityProtocolOptions, { _, trustRef, done in
            let trust = sec_trust_copy_ref(trustRef).takeRetainedValue()
            guard let ca = Site.caCert else { done(false); return }
            SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, Site.config.host as CFString))
            SecTrustSetAnchorCertificates(trust, [ca] as CFArray)
            SecTrustSetAnchorCertificatesOnly(trust, true)
            var e: CFError?
            done(SecTrustEvaluateWithError(trust, &e))
        }, DispatchQueue.global())
        return NWParameters(tls: tls)
    }
}

/// Set once on the relay's queue: whether the listener's start has been answered.
private final class RelayOnce: @unchecked Sendable { var done = false }
