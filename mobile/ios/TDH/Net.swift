// The company server, as this app reaches it.
//
// Site.json (made per site by make-site.sh, never committed) names the server: the name its certificate carries
// (tdharness.local), the login port, the addresses to try in order (the office LAN name, the company tunnel, a public
// entry when the site has one), and the company's own root certificate. Every HTTPS request goes through `Net.session`,
// whose delegate accepts only a chain that ends at that root and names that host: the server's certificate is not one
// the phone trusts by itself, and nothing else may answer in its place.
// company-mobile-entry-v1: "more_ca" adds the roots of the site's public entries (the cloud entry for phones,
// 118.190.105.26:8443, has its own CA, name-constrained to the site's host, that only this app trusts:
// server/cloud/entry-ca.ps1); the name checked is the same. Off the office network and without the tunnel, the phone
// reaches the company through it.
import Foundation
import Network
import Security

struct SiteConfig: Decodable {
    let name: String
    let host: String
    let port: Int
    let addresses: [String]
    let ca: String
    let more_ca: [String]?
}

enum Site {
    static let config: SiteConfig = {
        if let url = Bundle.main.url(forResource: "Site", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let c = try? JSONDecoder().decode(SiteConfig.self, from: data) {
            return c
        }
        return SiteConfig(name: "TDH", host: "tdharness.local", port: 8443, addresses: ["tdharness.local"], ca: "", more_ca: nil)
    }()

    private static func cert(_ pem: String) -> SecCertificate? {
        let body = pem
            .replacingOccurrences(of: "-----BEGIN CERTIFICATE-----", with: "")
            .replacingOccurrences(of: "-----END CERTIFICATE-----", with: "")
            .components(separatedBy: .whitespacesAndNewlines).joined()
        guard let der = Data(base64Encoded: body) else { return nil }
        return SecCertificateCreateWithData(nil, der as CFData)
    }

    static let caCert: SecCertificate? = cert(config.ca)

    /// The roots a server certificate may chain to: the company's, then its public entries'.
    static let anchors: [SecCertificate] = ([config.ca] + (config.more_ca ?? [])).compactMap { cert($0) }
}

final class PinnedTrust: NSObject, URLSessionDelegate {
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        guard Site.caCert != nil else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        // The certificate's name, whatever address we dialled (an IP through the tunnel has no name of its own).
        SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, Site.config.host as CFString))
        SecTrustSetAnchorCertificates(trust, Site.anchors as CFArray)
        SecTrustSetAnchorCertificatesOnly(trust, true)
        var err: CFError?
        if SecTrustEvaluateWithError(trust, &err) {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            #if DEBUG
            print("DEBUG_NET trust \(challenge.protectionSpace.host) refused \(String(describing: err))")
            #endif
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }
}

enum NetError: LocalizedError {
    case offline
    case server(Int, String)

    var errorDescription: String? {
        switch self {
        case .offline: return "暂时连不上服务器，请检查网络后再试"
        case .server(let code, let hint): return hint.isEmpty ? "服务器出错了（\(code)）" : hint
        }
    }
}

enum Net {
    static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 30
        c.timeoutIntervalForResource = 600
        c.httpCookieStorage = nil
        c.urlCache = nil
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: c, delegate: PinnedTrust(), delegateQueue: nil)
    }()

    private static let lock = NSLock()
    private static var current: URL?

    static var base: URL? {
        lock.withLock { current }
    }

    private static func setBase(_ u: URL?) {
        lock.withLock { current = u }
    }

    /// The address found is for the network it was found on: from the office Wi-Fi out onto 5G the LAN name no longer
    /// answers (and the chat's reconnects would keep dialling it), so any change of network, or a failed request,
    /// makes the next one look again.
    static func forget() { setBase(nil) }

    private static let monitor: NWPathMonitor = {
        let m = NWPathMonitor()
        var last = ""
        m.pathUpdateHandler = { path in
            let now = "\(path.status)|" + path.availableInterfaces.map { "\($0.type)" }.joined(separator: ",")
            if now != last { last = now; forget() }
        }
        m.start(queue: DispatchQueue(label: "tdh.net.path"))
        return m
    }()

    /// Started once at launch (TDHApp).
    static func watchNetwork() { _ = monitor }

    /// The address that answers first (any HTTP answer at all), all of Site.json's tried at once: off the office
    /// network the LAN name only times out, and waiting for it in turn cost seconds at every start.
    @discardableResult
    static func findServer() async -> URL? {
        // A page opens dozens of requests at once: one search, the others wait for its answer (each searching on its
        // own flooded the cloud entry's sign-in limit, 2026-11-26).
        let t: Task<URL?, Never> = lock.withLock {
            if let s = searching { return s }
            let s = Task { await search() }
            searching = s
            return s
        }
        let got = await t.value
        lock.withLock { if searching == t { searching = nil } }
        return got
    }

    private static var searching: Task<URL?, Never>?

    private static func search() async -> URL? {
        if let b = base, await answers(b) { return b }
        let candidates = Site.config.addresses.compactMap { a -> URL? in
            a.contains("://") ? URL(string: a) : URL(string: "https://\(a):\(Site.config.port)")
        }
        let found = await withTaskGroup(of: URL?.self) { g -> URL? in
            for u in candidates { g.addTask { await answers(u) ? u : nil } }
            for await r in g { if let u = r { g.cancelAll(); return u } }
            return nil
        }
        setBase(found)
        return found
    }

    private static func answers(_ base: URL) async -> Bool {
        var r = URLRequest(url: base.appendingPathComponent("company/login"))
        r.timeoutInterval = 4
        do {
            let (_, resp) = try await session.data(for: r)
            return resp is HTTPURLResponse
        } catch {
            #if DEBUG
            print("DEBUG_NET probe \(base.host ?? "") failed \(error)")
            #endif
            return false
        }
    }

    static func url(_ path: String) async throws -> URL {
        var b = base
        if b == nil { b = await findServer() }
        guard let root = b, let u = URL(string: path, relativeTo: root) else { throw NetError.offline }
        return u.absoluteURL
    }

    /// POST a JSON object; the answer as a JSON object (empty when it is not one) with its status.
    static func postJSON(_ path: String, _ body: [String: Any], token: String? = nil,
                         timeout: TimeInterval = 20) async throws -> (Int, [String: Any]) {
        var r = URLRequest(url: try await url(path))
        r.httpMethod = "POST"
        r.timeoutInterval = timeout
        r.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        if let t = token { r.setValue("Bearer " + t, forHTTPHeaderField: "Authorization") }
        r.httpBody = try JSONSerialization.data(withJSONObject: body)
        do {
            let (data, resp) = try await session.data(for: r)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            return (code, obj)
        } catch {
            setBase(nil)
            throw NetError.offline
        }
    }

    static func getJSON(_ path: String, token: String? = nil, timeout: TimeInterval = 20) async throws -> (Int, [String: Any]) {
        var r = URLRequest(url: try await url(path))
        r.timeoutInterval = timeout
        if let t = token { r.setValue("Bearer " + t, forHTTPHeaderField: "Authorization") }
        do {
            let (data, resp) = try await session.data(for: r)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            return (code, obj)
        } catch {
            setBase(nil)
            throw NetError.offline
        }
    }
}


/// company-phone-diag-v1: what went wrong on this phone, said to the server's log (who, where, the error; never what
/// anyone said or wrote), so a problem on someone's phone can be read there instead of asked for in screenshots.
enum Diag {
    private static let lock = NSLock()
    private static var tok = ""
    private static var sent = 0

    static var token: String {
        get { lock.withLock { tok } }
        set { lock.withLock { tok = newValue } }
    }

    static func say(_ place: String, _ what: String) {
        let t: String = lock.withLock {
            guard !tok.isEmpty, sent < 60 else { return "" }
            sent += 1
            return tok
        }
        guard !t.isEmpty else { return }
        Task.detached {
            _ = try? await Net.postJSON("/company/ext/chat/diag", ["where": place, "what": String(what.prefix(400))], token: t, timeout: 10)
        }
    }
}
