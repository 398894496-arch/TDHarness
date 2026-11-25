// Signing in, the same three ways a desk does (company-login-sms-v1, company-login-remember-v1): a text code, the
// password, or this phone's remembered sign-in. What the server hands a desk for the company share (smb_*) is never
// kept here; the gateway token lives in memory only and is asked for again at each start.
import Foundation
import SwiftUI

struct Person {
    let login: String
    let role: String
    let dept: String
    let gwToken: String
}

@MainActor
final class Session: ObservableObject {
    enum Phase { case starting, signedOut, signedIn }

    @Published var phase: Phase = .starting
    @Published var person: Person?
    @Published var note = ""
    @Published var server: String = ""
    /// company-chat-avatar-v1: the person's chat card has no picture yet; the app asks for one before anything else.
    @Published var needsAvatar = false

    private var rememberKey: String { "remember.token" }

    func start() async {
        phase = .starting
        note = "正在连接公司服务器…"
        let base = await Net.findServer()
        server = base?.host ?? ""
        if let tok = Keychain.get(rememberKey), !tok.isEmpty {
            do {
                let (code, j) = try await Net.postJSON("/company/login/resume", ["token": tok, "device_id": Keychain.deviceId])
                if code == 200, let p = take(j) {
                    person = p
                    warm(p)
                    note = ""
                    phase = .signedIn
                    return
                }
                if code == 401 || code == 403 || code == 404 { Keychain.delete(rememberKey) }
            } catch {
                note = (error as? LocalizedError)?.errorDescription ?? "连不上公司服务器"
                phase = .signedOut
                return
            }
        }
        note = base == nil ? (NetError.offline.errorDescription ?? "") : ""
        phase = .signedOut
    }

    /// nil when the code was sent; otherwise what to tell the person.
    func sendCode(phone: String) async -> String? {
        do {
            let (code, j) = try await Net.postJSON("/company/login/sms-code", ["phone": phone])
            if code == 200 { return nil }
            if code == 404 { return (j["hint"] as? String) ?? "这个手机号没有登记在公司花名册里，请找管理员登记。" }
            return (j["hint"] as? String) ?? "验证码没发出去（\(code)）"
        } catch {
            return (error as? LocalizedError)?.errorDescription
        }
    }

    func signIn(phone: String, code: String, remember: Bool) async -> String? {
        await finish("/company/login/sms", ["phone": phone, "code": code], remember: remember)
    }

    func signIn(user: String, password: String, remember: Bool) async -> String? {
        await finish("/company/login", ["username": user, "password": password], remember: remember)
    }

    private func finish(_ path: String, _ body: [String: Any], remember: Bool) async -> String? {
        var b = body
        b["device_id"] = Keychain.deviceId
        if remember { b["remember"] = true }
        do {
            let (code, j) = try await Net.postJSON(path, b)
            guard code == 200, let p = take(j) else {
                if let h = j["hint"] as? String, !h.isEmpty { return h }
                return code == 401 || code == 403 ? "账号、密码或验证码不对" : "登录没成功（\(code)）"
            }
            if remember, let t = j["remember_token"] as? String, !t.isEmpty { Keychain.set(rememberKey, t) }
            if !remember { Keychain.delete(rememberKey) }
            person = p
            warm(p)
            server = Net.base?.host ?? ""
            phase = .signedIn
            return nil
        } catch {
            return (error as? LocalizedError)?.errorDescription
        }
    }

    /// company-desk-hub-warm-v1: the person's kernel on the server comes up while they look at the screen.
    private func warm(_ p: Person) {
        Task.detached { _ = try? await Net.getJSON("/desk-hub/_hub/warm", token: p.gwToken, timeout: 20) }
        Task { await checkAvatar(p) }
    }

    /// No picture on the chat card: ask for one, and nothing else until there is one (the user, 2026-11-25: 「第一次手机
    /// 登录就要求设置头像 锁死」). A check that cannot be made is tried again, then counts as no picture.
    private func checkAvatar(_ p: Person) async {
        #if DEBUG
        if UserDefaults.standard.bool(forKey: "tdhAvatarForce") { needsAvatar = true; return }
        #endif
        var st = ChatRelay.AvatarState.unknown
        for wait in [0, 3, 8] as [UInt64] {
            if wait > 0 { try? await Task.sleep(nanoseconds: wait * 1_000_000_000) }
            st = await ChatRelay.shared.avatarState(login: p.login, gwToken: p.gwToken)
            if st != .unknown || person?.login != p.login { break }
        }
        if person?.login == p.login { needsAvatar = st != .has }
    }

    func setAvatar(_ jpeg: Data) async -> Bool {
        guard let p = person else { return false }
        return await ChatRelay.shared.setAvatar(jpeg, login: p.login, gwToken: p.gwToken)
    }

    private func take(_ j: [String: Any]) -> Person? {
        guard (j["ok"] as? Bool) == true, let login = j["login"] as? String, let gw = j["gw_token"] as? String,
              !login.isEmpty, !gw.isEmpty else { return nil }
        return Person(login: login, role: j["role"] as? String ?? "", dept: j["dept"] as? String ?? "", gwToken: gw)
    }

    func signOut() async {
        await PushCenter.shared.stop()
        if let tok = Keychain.get(rememberKey) {
            _ = try? await Net.postJSON("/company/login/forget", ["token": tok])
        }
        Keychain.delete(rememberKey)
        ChatRelay.shared.stop()
        DeskRelay.shared.stop()
        needsAvatar = false
        person = nil
        phase = .signedOut
    }
}
