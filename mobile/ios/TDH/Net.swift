// The company server, as this app reaches it.
//
// Site.json (made per site by make-site.sh, never committed) names the server: the name its certificate carries
// (tdharness.local), the login port, the addresses to try in order (the office LAN name, the company tunnel, a public
// entry when the site has one), and the company's own root certificate. Every HTTPS request goes through `Net.session`,
// whose delegate accepts only a chain that ends at that root and names that host: the server's certificate is not one
// the phone trusts by itself, and nothing else may answer in its place.
import Foundation
import Security

struct SiteConfig: Decodable {
    let name: String
    let host: String
    let port: Int
    let addresses: [String]
    let ca: String
}

enum Site {
    static let config: SiteConfig = {
        if let url = Bundle.main.url(forResource: "Site", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let c = try? JSONDecoder().decode(SiteConfig.self, from: data) {
            return c
        }
        return SiteConfig(name: "TDH", host: "tdharness.local", port: 8443, addresses: ["tdharness.local"], ca: "")
    }()

    static let caCert: SecCertificate? = {
        let body = config.ca
            .replacingOccurrences(of: "-----BEGIN CERTIFICATE-----", with: "")
            .replacingOccurrences(of: "-----END CERTIFICATE-----", with: "")
            .components(separatedBy: .whitespacesAndNewlines).joined()
        guard let der = Data(base64Encoded: body) else { return nil }
        return SecCertificateCreateWithData(nil, der as CFData)
    }()
}

final class PinnedTrust: NSObject, URLSessionDelegate {
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        guard let ca = Site.caCert else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        // The certificate's name, whatever address we dialled (an IP through the tunnel has no name of its own).
        SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, Site.config.host as CFString))
        SecTrustSetAnchorCertificates(trust, [ca] as CFArray)
        SecTrustSetAnchorCertificatesOnly(trust, true)
        var err: CFError?
        if SecTrustEvaluateWithError(trust, &err) {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }
}

enum NetError: LocalizedError {
    case offline
    case server(Int, String)

    var errorDescription: String? {
        switch self {
        case .offline: return "连不上公司服务器。在公司请连公司 Wi-Fi；在外面要等公司开通外网入口。"
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

    /// The address that answers first (any HTTP answer at all), all of Site.json's tried at once: off the office
    /// network the LAN name only times out, and waiting for it in turn cost seconds at every start.
    @discardableResult
    static func findServer() async -> URL? {
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
            throw NetError.offline
        }
    }
}
