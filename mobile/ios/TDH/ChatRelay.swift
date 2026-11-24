// The company chat for this phone, the way a desk does it (desk/plugins/company-shell/lib/chat-relay.js):
// a small HTTP server on 127.0.0.1 inside the app, which the chat tab's web view loads the chat page from.
//
// - The page and Tinode's API (/chat/*, /v0/*) are fetched from the company server through Net.session, so its
//   certificate is checked against the company CA in code (a web view on its own would refuse it).
// - The page is given the chat's own token (logged in here with the person's gateway token, Tinode's basic login that
//   the people service accepts), never the gateway token itself; and it is told to use long polling, which is plain
//   HTTP this relay can pass on (WebSockets it would have to bridge).
// - /tdh/voice and /tdh/call (a voice message's words, a call's transcription pieces) go to the server with the
//   person's gateway token, as a desk's relay does; only for the page that holds this start's key.
// - Only Host 127.0.0.1:<port> or localhost:<port> is answered.
import Foundation
import Network

/// Set once on the relay's queue: whether the listener's start has been answered.
private final class Once: @unchecked Sendable { var done = false }

final class ChatRelay {
    static let shared = ChatRelay()

    private let queue = DispatchQueue(label: "tdh.chat.relay")
    private var listener: NWListener?
    private(set) var port: UInt16 = 0
    private(set) var pageKey = ""
    private var login = ""
    private var gwToken = ""
    private var chatToken: (token: String, expires: String, at: Date)?

    /// The chat page's address on this phone (starting the relay the first time).
    func start(login: String, gwToken: String) async throws -> URL {
        if self.login != login { chatToken = nil }
        self.login = login
        self.gwToken = gwToken
        if listener == nil || port == 0 {
            pageKey = Self.randomKey()
            port = try await listen()
        }
        return URL(string: "http://127.0.0.1:\(port)/chat/?k=\(pageKey)")!
    }

    func stop() {
        listener?.cancel()
        listener = nil
        port = 0
        chatToken = nil
        gwToken = ""
        login = ""
    }

    private static func randomKey() -> String {
        var b = [UInt8](repeating: 0, count: 18)
        _ = SecRandomCopyBytes(kSecRandomDefault, b.count, &b)
        return Data(b).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    // Fixed ports first, so the page keeps its storage between starts; any free port when they are taken.
    private func listen() async throws -> UInt16 {
        for p: UInt16 in [17811, 17812, 17813, 17814, 0] {
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
            let once = Once()
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
                default:
                    break
                }
            }
            l.start(queue: queue)
        }
    }

    // ---- one request per connection ------------------------------------------------------------------------------
    struct Request {
        var method = ""
        var target = ""
        var headers: [String: String] = [:]
        var body = Data()
    }

    private static let maxBody = 210 * 1024 * 1024 // the chat's own upload limit, with room for the form around it

    private func accept(_ c: NWConnection) {
        c.start(queue: queue)
        read(c, Data())
    }

    private func read(_ c: NWConnection, _ buf: Data) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { [weak self] data, _, complete, err in
            guard let self else { c.cancel(); return }
            var b = buf
            if let d = data { b.append(d) }
            if err != nil { c.cancel(); return }
            if let req = Self.parse(b) {
                Task { await self.answer(c, req) }
            } else if complete || b.count > Self.maxBody + 65536 {
                c.cancel()
            } else {
                self.read(c, b)
            }
        }
    }

    /// A whole request (head and its Content-Length body), or nil while more is to come.
    static func parse(_ b: Data) -> Request? {
        guard let end = b.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        guard let head = String(data: b[b.startIndex..<end.lowerBound], encoding: .utf8) else { return nil }
        var lines = head.components(separatedBy: "\r\n")
        let first = lines.removeFirst().split(separator: " ")
        guard first.count >= 2 else { return nil }
        var r = Request()
        r.method = String(first[0])
        r.target = String(first[1])
        for l in lines {
            guard let i = l.firstIndex(of: ":") else { continue }
            r.headers[l[..<i].lowercased()] = l[l.index(after: i)...].trimmingCharacters(in: .whitespaces)
        }
        let n = Int(r.headers["content-length"] ?? "0") ?? 0
        let bodyStart = end.upperBound
        if b.count - (bodyStart - b.startIndex) < n { return nil }
        r.body = b.subdata(in: bodyStart..<(bodyStart + n))
        return r
    }

    private func answer(_ c: NWConnection, _ r: Request) async {
        let (status, headers, body) = await route(r)
        var head = "HTTP/1.1 \(status) \(Self.reason(status))\r\n"
        for (k, v) in headers { head += "\(k): \(v)\r\n" }
        head += "Content-Length: \(body.count)\r\nConnection: close\r\n\r\n"
        var out = Data(head.utf8)
        out.append(body)
        c.send(content: out, completion: .contentProcessed { _ in c.cancel() })
    }

    private static func reason(_ s: Int) -> String {
        [200: "OK", 204: "No Content", 206: "Partial Content", 304: "Not Modified", 400: "Bad Request", 401: "Unauthorized",
         403: "Forbidden", 404: "Not Found", 413: "Payload Too Large", 500: "Internal Server Error", 502: "Bad Gateway"][s] ?? "Status"
    }

    typealias Reply = (Int, [String: String], Data)

    private func plain(_ s: Int, _ text: String) -> Reply {
        (s, ["Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"], Data(text.utf8))
    }

    private func json(_ s: Int, _ obj: [String: Any]) -> Reply {
        (s, ["Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"],
         (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{}".utf8))
    }

    private func route(_ r: Request) async -> Reply {
        let host = r.headers["host"] ?? ""
        guard host == "127.0.0.1:\(port)" || host == "localhost:\(port)" else { return plain(403, "forbidden") }
        guard let u = URLComponents(string: "http://x" + r.target) else { return plain(400, "bad request") }
        let path = u.path
        let q: (String) -> String = { k in u.queryItems?.first(where: { $0.name == k })?.value ?? "" }
        if (path == "/chat/" || path == "/chat/index.html") && r.method == "GET" {
            guard q("k") == pageKey else { return plain(403, "请从 TDH 的「聊天」打开。") }
            return await page()
        }
        if path.hasPrefix("/chat/") && r.method == "GET" { return await relay(r, long: false) }
        if path.hasPrefix("/v0/") { return await relay(r, long: true) }
        if path == "/tdh/voice" && r.method == "GET" {
            guard q("k") == pageKey else { return plain(403, "forbidden") }
            let ref = q("ref")
            guard ref.range(of: "^[A-Za-z0-9_/.:-]{4,200}$", options: .regularExpression) != nil else {
                return json(400, ["ok": false, "error": "bad-request"])
            }
            return await server("/company/ext/chat/voice", ["ref": ref], timeout: 15)
        }
        if path == "/tdh/call" && r.method == "POST" {
            guard q("k") == pageKey else { return plain(403, "forbidden") }
            let op = q("op")
            var out: [String: Any] = ["op": op]
            let num: (String) -> Int? = { k in q(k).range(of: "^\\d{1,15}$", options: .regularExpression) != nil ? Int(q(k)) : nil }
            if op == "piece" || op == "end" {
                guard q("peer").range(of: "^usr[A-Za-z0-9_-]{4,40}$", options: .regularExpression) != nil, let seq = num("seq") else {
                    return json(400, ["ok": false, "error": "bad-request"])
                }
                out["peer"] = q("peer")
                out["seq"] = seq
                if op == "piece" {
                    guard let at = num("at"), let ms = num("ms") else { return json(400, ["ok": false, "error": "bad-request"]) }
                    guard r.body.count <= 3 * 1024 * 1024 else { return json(413, ["ok": false, "error": "too-large"]) }
                    out["at"] = at
                    out["ms"] = ms
                    out["wav"] = r.body.base64EncodedString()
                }
            } else if op == "text" {
                guard q("id").range(of: "^[A-Za-z0-9._~-]{3,140}$", options: .regularExpression) != nil else {
                    return json(400, ["ok": false, "error": "bad-request"])
                }
                out["id"] = q("id")
            } else if op != "on" {
                return json(400, ["ok": false, "error": "bad-request"])
            }
            return await server("/company/ext/chat/call", out, timeout: 30)
        }
        if path.hasPrefix("/tdh/") { return json(404, ["ok": false, "error": "not-on-phone"]) }
        return plain(404, "not found")
    }

    private func server(_ path: String, _ body: [String: Any], timeout: TimeInterval) async -> Reply {
        guard !gwToken.isEmpty else { return json(400, ["ok": false, "error": "no-login"]) }
        do {
            let (code, j) = try await Net.postJSON(path, body, token: gwToken, timeout: timeout)
            return json(j.isEmpty ? 502 : code, j.isEmpty ? ["ok": false, "error": "server-\(code)"] : j)
        } catch {
            return json(502, ["ok": false, "error": "server"])
        }
    }

    private static let passReq = ["accept", "accept-language", "content-type", "range", "if-none-match", "if-modified-since",
                                  "if-range", "x-tinode-apikey", "x-tinode-auth", "authorization"]
    private static let passRes = ["content-type", "cache-control", "etag", "last-modified", "content-disposition",
                                  "content-range", "accept-ranges", "expires", "vary"]

    private func relay(_ r: Request, long: Bool) async -> Reply {
        guard let url = try? await Net.url(r.target) else { return plain(502, "聊天服务器没连上。") }
        var req = URLRequest(url: url)
        req.httpMethod = r.method
        // Long polling holds a request until there is something to say (Tinode answers within a minute).
        req.timeoutInterval = long ? 120 : 30
        for k in Self.passReq { if let v = r.headers[k] { req.setValue(v, forHTTPHeaderField: k) } }
        if !r.body.isEmpty { req.httpBody = r.body }
        do {
            let (data, resp) = try await Net.session.data(for: req)
            guard let h = resp as? HTTPURLResponse else { return plain(502, "聊天服务器没连上。") }
            var out: [String: String] = [:]
            for (k, v) in h.allHeaderFields {
                guard let ks = (k as? String)?.lowercased(), Self.passRes.contains(ks) else { continue }
                out[ks] = "\(v)"
            }
            return (h.statusCode, out, data)
        } catch {
            return plain(502, "聊天服务器没连上。")
        }
    }

    // ---- the page ------------------------------------------------------------------------------------------------
    private func page() async -> Reply {
        guard let url = try? await Net.url("/chat/") else { return plain(502, "聊天服务器没连上。") }
        async let pageData = try? Net.session.data(from: url)
        let tok = await token()
        guard let (data, resp) = await pageData, (resp as? HTTPURLResponse)?.statusCode == 200,
              var html = String(data: data, encoding: .utf8) else {
            return plain(502, "聊天服务器没连上。")
        }
        let boot = bootScript(login: login, token: tok)
        if let r = html.range(of: "<head>") { html.replaceSubrange(r, with: "<head>\n" + boot) } else { html = boot + html }
        return (200, ["Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer"],
                Data(html.utf8))
    }

    /// Runs before the page's own scripts: the chat token in its storage (it logs in from there), this relay as its
    /// server, long polling instead of a WebSocket. A different person than last time: empty storage first.
    func bootScript(login: String, token: (token: String, expires: String)?) -> String {
        func data(_ v: Any) -> String {
            let d = (try? JSONSerialization.data(withJSONObject: [v], options: [.fragmentsAllowed])) ?? Data("[null]".utf8)
            var s = String(data: d, encoding: .utf8) ?? "[null]"
            s = String(s.dropFirst().dropLast())
            return s.replacingOccurrences(of: "<", with: "\\u003c")
        }
        let t: Any = token.map { ["token": $0.token, "expires": $0.expires] as Any } ?? NSNull()
        let js = "(function(){var u=" + data(login) + ",t=" + data(t) + ";" +
            "try{var s=window.localStorage;" +
            "if(u&&s.getItem('tdh-chat-user')!==u){s.clear();try{indexedDB.deleteDatabase('tinode-web')}catch(e){}s.setItem('tdh-chat-user',u)}" +
            "if(t){s.setItem('keep-logged-in','true');s.setItem('auth-token',JSON.stringify(t))}" +
            "var c={};try{c=JSON.parse(s.getItem('settings')||'{}')||{}}catch(e){}" +
            "c.serverAddress=location.host;c.secureConnection=false;s.setItem('settings',JSON.stringify(c))" +
            "}catch(e){}" +
            // Tinode's SDK arrives as window.tinode = {Tinode, Drafty, ...}: hand the page a Tinode that long-polls.
            "var M;Object.defineProperty(window,'tinode',{configurable:true,get:function(){return M},set:function(v){" +
            "if(v&&typeof v.Tinode==='function'){var B=v.Tinode;var W=class extends B{constructor(c,o){super(Object.assign({},c,{transport:'lp'}),o)}};" +
            "M=new Proxy(v,{get:function(o,k){return k==='Tinode'?W:o[k]}})}else{M=v}}});" +
            "window.TDH_PHONE=1;})();"
        return "<script>" + js + "</script>"
    }

    private func token() async -> (token: String, expires: String)? {
        if let t = chatToken, Date().timeIntervalSince(t.at) < 6 * 3600 { return (t.token, t.expires) }
        guard let t = await chatLogin() else { return nil }
        chatToken = (t.token, t.expires, Date())
        return t
    }

    // One login over long polling: open a session, {hi}, {login basic "login:<gateway token>"}; the answer carries
    // the chat token.
    private func chatLogin() async -> (token: String, expires: String)? {
        guard !login.isEmpty, !gwToken.isEmpty, let key = await apiKey() else { return nil }
        let lp = "/v0/channels/lp?apikey=" + (key.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? key)
        guard let open = await get(lp) else { return nil }
        var sid = ""
        for m in Self.lines(open) {
            if let ctrl = m["ctrl"] as? [String: Any], let p = ctrl["params"] as? [String: Any], let s = p["sid"] as? String { sid = s }
        }
        guard !sid.isEmpty else { return nil }
        let at = lp + "&sid=" + (sid.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? sid)
        func send(_ msg: [String: Any], _ id: String) async -> [String: Any]? {
            guard let body = try? JSONSerialization.data(withJSONObject: msg), var got = await post(at, body) else { return nil }
            let deadline = Date().addingTimeInterval(15)
            while Date() < deadline {
                for m in Self.lines(got) {
                    if let ctrl = m["ctrl"] as? [String: Any], (ctrl["id"] as? String) == id { return ctrl }
                }
                guard let more = await get(at) else { return nil }
                got = more
            }
            return nil
        }
        guard let hi = await send(["hi": ["id": "1", "ver": "0.25", "ua": "TDH-iOS/1.0"]], "1"),
              (hi["code"] as? Int ?? 500) < 300 else { return nil }
        let secret = Data((login + ":" + gwToken).utf8).base64EncodedString()
        guard let r = await send(["login": ["id": "2", "scheme": "basic", "secret": secret]], "2"),
              (r["code"] as? Int ?? 500) < 300, let p = r["params"] as? [String: Any], let tok = p["token"] as? String else { return nil }
        return (tok, p["expires"] as? String ?? "")
    }

    private var apiKeyCache = ""
    private func apiKey() async -> String? {
        if !apiKeyCache.isEmpty { return apiKeyCache }
        guard let d = await get("/chat/tdh/config.js"), let s = String(data: d, encoding: .utf8),
              let r = s.range(of: "AQ[A-Za-z0-9_-]{30}", options: .regularExpression) else { return nil }
        apiKeyCache = String(s[r])
        return apiKeyCache
    }

    private func get(_ path: String) async -> Data? {
        guard let u = try? await Net.url(path) else { return nil }
        var r = URLRequest(url: u)
        r.timeoutInterval = 20
        return try? await Net.session.data(for: r).0
    }

    private func post(_ path: String, _ body: Data) async -> Data? {
        guard let u = try? await Net.url(path) else { return nil }
        var r = URLRequest(url: u)
        r.httpMethod = "POST"
        r.timeoutInterval = 20
        // Not a form: Tinode reads a form-typed POST as a form and calls the message malformed.
        r.setValue("text/plain", forHTTPHeaderField: "Content-Type")
        r.httpBody = body
        return try? await Net.session.data(for: r).0
    }

    static func lines(_ d: Data) -> [[String: Any]] {
        guard let s = String(data: d, encoding: .utf8) else { return [] }
        return s.split(whereSeparator: \.isNewline).compactMap { l in
            (try? JSONSerialization.jsonObject(with: Data(l.utf8))) as? [String: Any]
        }
    }
}
