// company-phone-chat-native-v1 (the user, 2026-11-25: the phone prototype — 「都对 聊天头像圆形 接数据！」): the Chat tab is
// drawn by the app, not by the chat's web page. This is its data: one long-polling connection of this person's own to
// the company chat (Tinode, through the company server like everything else), logged in the way ChatRelay does it
// (basic "login:<gateway token>"). It keeps the list of chats (me's subscriptions), the open chats' messages, the
// people in them and their pictures, and sends text and files as this person.
import Foundation
import SwiftUI
import UIKit

struct ChatTopic: Identifiable, Equatable {
    var id: String { topic }
    let topic: String
    var name: String
    var photo: UIImage?
    var group: Bool
    var seq: Int
    var read: Int
    var touched: Date?
    var preview = ""
    var unread: Int { max(0, seq - read) }

    static func == (a: ChatTopic, b: ChatTopic) -> Bool {
        a.topic == b.topic && a.name == b.name && a.seq == b.seq && a.read == b.read && a.touched == b.touched
            && a.preview == b.preview && (a.photo == nil) == (b.photo == nil)
    }
}

struct ChatAttachment: Equatable {
    enum Kind { case image, file, audio }
    let kind: Kind
    let name: String
    let mime: String
    let size: Int
    /// Inline bytes (small pictures and voice come this way) or the server's address for them.
    let inline: Data?
    let ref: String?
    let width: Int
    let height: Int
    let duration: Int
    /// A voice message's waveform: up to 64 bars, 0…255.
    var preview: [UInt8] = []
}

struct ChatMessage: Identifiable, Equatable {
    var id: Int { seq }
    let seq: Int
    let from: String
    let at: Date
    let text: String
    let attachments: [ChatAttachment]
    /// A message this phone has sent and the server has not echoed yet.
    var pending = false
    /// A voice call's message (head webrtc): started | accepted | finished | missed | declined | busy …, and how long.
    var call: String? = nil
    var callMs = 0
    /// This message stands in for an earlier one (head replace ":seq"): it updates that one, it is not shown itself.
    var replaces: Int? = nil
    /// TDH 助手's card (head tdh_ai): the call minutes, a task card…
    var ai = false
    /// Its kind (data, task, task-made, doc-saved, doc-ask, doc-note, kb-ask, kb-note, call-note) and who may answer it.
    var aiKind = ""
    var aiDeciders: [String] = []
    /// An answer to TDH 助手's card (head tdh_ai_ok): which card, yes or no.
    var aiOkOf: Int? = nil
    var aiOk = true
    /// A task card between two people (head tdh_card, company-chat-cards-v1).
    var card: TaskCard? = nil
}

struct TaskCard: Equatable {
    let id: String
    let event: String   // issued | submitted | passed | returned | cancelled | due
    let title: String
    let to: String
    let due: Date?
    let note: String
}

struct ChatPerson: Equatable {
    var name: String
    var photo: UIImage?
    static func == (a: ChatPerson, b: ChatPerson) -> Bool { a.name == b.name && (a.photo == nil) == (b.photo == nil) }
}

@MainActor
final class ChatStore: ObservableObject {
    @Published var topics: [ChatTopic] = []
    @Published var messages: [String: [ChatMessage]] = [:]
    @Published var people: [String: ChatPerson] = [:]
    @Published var connected = false
    @Published var loaded = false
    @Published var problem = ""
    @Published var me = ""
    /// Pinned chats, the first the highest (Tinode's own: me's private tpin, as the desks' chat page keeps it).
    @Published var pinned: [String] = []
    /// Chats deleted on this phone: hidden until a message newer than the one they had (topic → its seq then).
    /// Kept per person signed in (another person on the same phone has their own).
    @Published var hidden: [String: Int] = [:]
    private var hiddenKey: String { "tdhChatHidden." + me }
    /// The chat on screen: its messages count as read as they come.
    var open = ""

    private var login = ""
    private var gwToken = ""
    private var apiKey = ""
    private var authToken = ""
    private var at = ""
    private var running = false
    private var nextId = 100
    private var waiting: [String: CheckedContinuation<[String: Any]?, Never>] = [:]
    private var attached: Set<String> = []
    private var older: [String: Bool] = [:]
    private var photoRefs: Set<String> = []
    /// Later states of calls whose own message has not come yet (history comes newest first): topic → seq → (state, ms).
    private var callLater: [String: [Int: (String, Int)]] = [:]

    func start(login: String, gwToken: String) {
        if running && self.login == login { return }
        self.login = login
        self.gwToken = gwToken
        running = true
        Task { await connectLoop() }
    }

    func stop() {
        running = false
        connected = false
        for (_, c) in waiting { c.resume(returning: nil) }
        waiting = [:]
    }

    // MARK: the connection

    private func connectLoop() async {
        var delay: UInt64 = 1
        while running {
            if await connect() {
                delay = 1
                await reader?.value
            }
            at = ""
            connected = false
            attached = []
            for (_, c) in waiting { c.resume(returning: nil) }
            waiting = [:]
            if !running { break }
            try? await Task.sleep(nanoseconds: delay * 1_000_000_000)
            delay = min(delay * 2, 20)
        }
    }

    private func connect() async -> Bool {
        if apiKey.isEmpty {
            guard let d = await rawGet("/chat/tdh/config.js"), let s = String(data: d, encoding: .utf8),
                  let r = s.range(of: "AQ[A-Za-z0-9_-]{30}", options: .regularExpression) else {
                problem = "聊天服务器没连上"
                return false
            }
            apiKey = String(s[r])
        }
        let lp = "/v0/channels/lp?apikey=" + enc(apiKey)
        guard let first = await rawGet(lp) else { problem = "聊天服务器没连上"; return false }
        var sid = ""
        for m in ChatRelay.lines(first) {
            if let c = m["ctrl"] as? [String: Any], let p = c["params"] as? [String: Any], let s = p["sid"] as? String { sid = s }
        }
        guard !sid.isEmpty else { problem = "聊天服务器没连上"; return false }
        at = lp + "&sid=" + enc(sid)
        // The reader has to run while the first requests wait for their answers.
        let path = at
        reader = Task { await readLoop(path) }
        guard let hi = await request(["hi": ["ver": "0.25", "ua": "TDH-iOS/1.0"]]), code(hi) < 300 else { return false }
        let secret = Data((login + ":" + gwToken).utf8).base64EncodedString()
        guard let lg = await request(["login": ["scheme": "basic", "secret": secret]]), code(lg) < 300 else {
            problem = "聊天登录没成功"
            return false
        }
        let p = lg["params"] as? [String: Any] ?? [:]
        authToken = p["token"] as? String ?? ""
        me = p["user"] as? String ?? ""
        hidden = (UserDefaults.standard.dictionary(forKey: hiddenKey) as? [String: Int]) ?? [:]
        connected = true
        problem = ""
        await subscribeMe()
        return true
    }

    private var reader: Task<Void, Never>?

    /// One reader per connection; it ends when the connection drops (or a newer one replaced it).
    private func readLoop(_ mine: String) async {
        var misses = 0
        while running && at == mine {
            guard let d = await rawGet(mine, timeout: 90) else {
                misses += 1
                if misses >= 2 { break }
                continue
            }
            misses = 0
            for m in ChatRelay.lines(d) { take(m) }
        }
    }

    private func send(_ msg: [String: Any]) async {
        guard let body = try? JSONSerialization.data(withJSONObject: msg) else { return }
        if let d = await rawPost(at, body) { for m in ChatRelay.lines(d) { take(m) } }
    }

    /// One message with an id; its {ctrl} answer (or the {meta} of a get), nil after 20 s.
    private func request(_ msg: [String: Any]) async -> [String: Any]? {
        nextId += 1
        let id = String(nextId)
        var m = msg
        if let k = m.keys.first, var inner = m[k] as? [String: Any] { inner["id"] = id; m[k] = inner }
        return await withCheckedContinuation { (c: CheckedContinuation<[String: Any]?, Never>) in
            waiting[id] = c
            Task {
                await send(m)
                try? await Task.sleep(nanoseconds: 20_000_000_000)
                if let c = waiting.removeValue(forKey: id) { c.resume(returning: nil) }
            }
        }
    }

    private func answer(_ id: String?, _ v: [String: Any]) {
        guard let id, let c = waiting.removeValue(forKey: id) else { return }
        c.resume(returning: v)
    }

    private func code(_ ctrl: [String: Any]) -> Int { ctrl["code"] as? Int ?? 500 }

    // MARK: what comes in

    private func take(_ m: [String: Any]) {
        if let c = m["ctrl"] as? [String: Any] {
            answer(c["id"] as? String, c)
        } else if let meta = m["meta"] as? [String: Any] {
            takeMeta(meta)
            answer(meta["id"] as? String, meta)
        } else if let d = m["data"] as? [String: Any] {
            takeData(d)
        } else if let p = m["pres"] as? [String: Any] {
            takePres(p)
        }
    }

    private func takeMeta(_ meta: [String: Any]) {
        let topic = meta["topic"] as? String ?? ""
        if topic == "me" {
            if let desc = meta["desc"] as? [String: Any], let pub = desc["public"] as? [String: Any] {
                people[me] = ChatPerson(name: pub["fn"] as? String ?? "我", photo: photo(pub, key: me))
            }
            if let desc = meta["desc"] as? [String: Any], let priv = desc["private"] as? [String: Any] {
                pinned = priv["tpin"] as? [String] ?? []
                topics = sorted(topics)
            }
            if let subs = meta["sub"] as? [[String: Any]] {
                var list = topics
                for s in subs {
                    guard let t = s["topic"] as? String, t.hasPrefix("usr") || t.hasPrefix("grp") else { continue }
                    if s["deleted"] != nil { list.removeAll { $0.topic == t }; continue }
                    let pub = s["public"] as? [String: Any] ?? [:]
                    let priv = s["private"] as? [String: Any]
                    let name = (priv?["comment"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? pub["fn"] as? String ?? "未命名"
                    let row = ChatTopic(topic: t, name: name, photo: photo(pub, key: t), group: t.hasPrefix("grp"),
                                        seq: s["seq"] as? Int ?? 0, read: s["read"] as? Int ?? 0,
                                        touched: date(s["touched"]) ?? date(s["updated"]))
                    if t.hasPrefix("usr") { people[t] = ChatPerson(name: row.name, photo: row.photo) }
                    if let i = list.firstIndex(where: { $0.topic == t }) {
                        var r = row
                        r.preview = list[i].preview
                        if r.photo == nil { r.photo = list[i].photo }
                        list[i] = r
                    } else {
                        list.append(row)
                    }
                }
                topics = sorted(list)
                loaded = true
            }
        } else if let subs = meta["sub"] as? [[String: Any]] {
            for s in subs {
                guard let u = s["user"] as? String else { continue }
                let pub = s["public"] as? [String: Any] ?? [:]
                let old = people[u]
                people[u] = ChatPerson(name: pub["fn"] as? String ?? old?.name ?? "同事", photo: photo(pub, key: u) ?? old?.photo)
            }
        }
    }

    private func takeData(_ d: [String: Any]) {
        guard let topic = d["topic"] as? String, let seq = d["seq"] as? Int else { return }
        var msg = Self.message(d)
        var list = messages[topic] ?? []
        if msg.replaces == nil, let later = callLater[topic]?.removeValue(forKey: seq) {
            msg.call = later.0
            msg.callMs = max(msg.callMs, later.1)
        }
        if let target = msg.replaces {
            // A call's later state (accepted, finished…) updates the call's own message.
            if let i = list.firstIndex(where: { $0.seq == target }) {
                var m = list[i]
                if msg.call != nil { m.call = msg.call; m.callMs = max(m.callMs, msg.callMs) }
                list[i] = m
                messages[topic] = list
            } else if let st = msg.call {
                let old = callLater[topic]?[target]
                // Keep the latest state (the highest seq wins: finished after accepted).
                if old == nil || msg.callMs >= old!.1 { callLater[topic, default: [:]][target] = (st, msg.callMs) }
            }
            if let i = topics.firstIndex(where: { $0.topic == topic }) {
                topics[i].seq = max(topics[i].seq, seq)
                if msg.from == me || topic == open { topics[i].read = max(topics[i].read, seq) }
            }
            return
        }
        if let i = list.firstIndex(where: { $0.seq == seq }) {
            list[i] = msg
        } else {
            // The echo of what this phone just sent takes the place of its stand-in.
            if msg.from == me, let i = list.firstIndex(where: { $0.pending && $0.text == msg.text }) { list.remove(at: i) }
            let at = list.firstIndex { !$0.pending && $0.seq > seq } ?? list.firstIndex { $0.pending } ?? list.count
            list.insert(msg, at: at)
        }
        messages[topic] = list
        if let i = topics.firstIndex(where: { $0.topic == topic }) {
            var t = topics[i]
            if seq >= t.seq || t.preview.isEmpty {
                t.preview = Self.preview(msg, group: t.group, who: people[msg.from]?.name, me: msg.from == me)
            }
            t.seq = max(t.seq, seq)
            if msg.from == me || topic == open { t.read = max(t.read, seq) }
            if seq >= t.seq { t.touched = max(t.touched ?? msg.at, msg.at) }
            topics[i] = t
            topics = sorted(topics)
        }
        if topic == open && msg.from != me { Task { await markRead(topic, seq) } }
    }

    private func takePres(_ p: [String: Any]) {
        guard (p["topic"] as? String) == "me", let src = p["src"] as? String else { return }
        let what = p["what"] as? String ?? ""
        if what == "msg", let seq = p["seq"] as? Int, let i = topics.firstIndex(where: { $0.topic == src }) {
            var t = topics[i]
            t.seq = max(t.seq, seq)
            t.touched = Date()
            topics[i] = t
            topics = sorted(topics)
            if !attached.contains(src) { Task { await attach(src, limit: 1) } }
        } else if what == "msg" || what == "acs" || what == "upd" {
            Task { await refreshMe() }
        }
    }

    /// Pinned first (in their order), then the latest.
    private func sorted(_ l: [ChatTopic]) -> [ChatTopic] {
        l.sorted {
            let a = pinned.firstIndex(of: $0.topic) ?? Int.max, b = pinned.firstIndex(of: $1.topic) ?? Int.max
            if a != b { return a < b }
            return ($0.touched ?? .distantPast) > ($1.touched ?? .distantPast)
        }
    }

    /// Whether a chat shows in the list: pinned ones always; others once they have a message newer than a deletion.
    func shows(_ t: ChatTopic) -> Bool {
        if pinned.contains(t.topic) { return true }
        return t.seq > 0 && t.seq > (hidden[t.topic] ?? 0)
    }

    /// 置顶 / 取消置顶 (company-phone-chat-swipe-v1, the user: 「聊天界面 左滑 给两个选项 置顶和删除」): me's private tpin,
    /// the same list the desks' chat page pins with, so it holds on every device.
    func togglePin(_ topic: String) async -> Bool {
        var list = pinned.filter { $0 != topic }
        if !pinned.contains(topic) { list.insert(topic, at: 0) }
        let old = pinned
        withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) { pinned = list; topics = sorted(topics) }
        let r = await request(["set": ["topic": "me", "desc": ["private": ["tpin": list.isEmpty ? "\u{2421}" : list as Any]]]])
        if r == nil || code(r!) >= 300 {
            withAnimation { pinned = old; topics = sorted(topics) }
            return false
        }
        return true
    }

    /// 删除 a chat on this person's side, as WeChat does: its messages deleted for them (not for the other side), and
    /// the chat out of the list until someone writes in it again.
    func deleteChat(_ topic: String) async -> Bool {
        guard let t = topics.first(where: { $0.topic == topic }) else { return false }
        if t.seq > 0 {
            await attach(topic, limit: 1)
            let r = await request(["del": ["topic": topic, "what": "msg", "delseq": [["low": 1, "hi": t.seq + 1]], "hard": false]])
            if r == nil || code(r!) >= 300 { return false }
            // Read up to the end on the server too: else its unread would come back on the next sync, a count on the tab
            // from a chat no longer in the list.
            await markRead(topic, t.seq)
        }
        withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) {
            hidden[topic] = t.seq
            messages[topic] = []
            if let i = topics.firstIndex(where: { $0.topic == topic }) { topics[i].preview = ""; topics[i].read = t.seq }
        }
        UserDefaults.standard.set(hidden, forKey: hiddenKey)
        if pinned.contains(topic) { _ = await togglePin(topic) }
        return true
    }

    // MARK: asking

    private func subscribeMe() async {
        _ = await request(["sub": ["topic": "me", "get": ["what": "desc sub"]]])
        // The sub's {ctrl} can come before its {meta}: ask for the list on its own when it is not here yet.
        if topics.isEmpty { _ = await request(["get": ["topic": "me", "what": "sub"]]) }
        // The latest message of each recent chat, for the list (and new ones as they come).
        for t in topics.prefix(24) { await attach(t.topic, limit: 1) }
        loaded = true
        #if DEBUG
        // Debug builds only: one test message into a chat named on the command line (-tdhChatSendTo 名字 -tdhChatSendText 文字).
        let d = UserDefaults.standard
        if let to = d.string(forKey: "tdhChatSendTo"), let text = d.string(forKey: "tdhChatSendText"),
           let t = topics.first(where: { $0.name == to }) {
            d.removeObject(forKey: "tdhChatSendTo")
            print("DEBUG_CHATSEND topic=\(t.topic) ok=\(await sendText(t.topic, text))")
        }
        #endif
    }

    /// This person's own card again (a new picture was just put on it).
    func refreshCard() { Task { _ = await request(["get": ["topic": "me", "what": "desc"]]) } }

    private func refreshMe() async { _ = await request(["get": ["topic": "me", "what": "sub"]]) }

    private func attach(_ topic: String, limit: Int) async {
        if attached.contains(topic) {
            if limit > 1 { _ = await request(["get": ["topic": topic, "what": "data sub", "data": ["limit": limit], "sub": [:]]]) }
            return
        }
        let r = await request(["sub": ["topic": topic, "get": ["what": limit > 1 ? "data sub" : "data", "data": ["limit": limit]]]])
        if let r, code(r) < 300 { attached.insert(topic) }
    }

    /// Opening a chat: its last messages and its people; then everything in it counts as read.
    func enter(_ topic: String) async {
        open = topic
        await attach(topic, limit: 40)
        if let t = topics.first(where: { $0.topic == topic }), t.seq > 0 { await markRead(topic, t.seq) }
    }

    func leave(_ topic: String) {
        if open == topic { open = "" }
    }

    /// Older messages, 30 at a time; false when there are none left.
    func loadOlder(_ topic: String) async -> Bool {
        if older[topic] == false { return false }
        guard let first = messages[topic]?.first(where: { !$0.pending })?.seq, first > 1 else { older[topic] = false; return false }
        let before = messages[topic]?.count ?? 0
        _ = await request(["get": ["topic": topic, "what": "data", "data": ["before": first, "limit": 30]]])
        let more = (messages[topic]?.count ?? 0) > before
        older[topic] = more
        return more
    }

    private func markRead(_ topic: String, _ seq: Int) async {
        if let i = topics.firstIndex(where: { $0.topic == topic }) { topics[i].read = max(topics[i].read, seq) }
        await send(["note": ["topic": topic, "what": "read", "seq": seq]])
    }

    // MARK: sending

    func sendText(_ topic: String, _ text: String) async -> Bool {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return true }
        stand(topic, ChatMessage(seq: Int.max - (messages[topic]?.count ?? 0), from: me, at: Date(), text: t, attachments: [], pending: true))
        await attach(topic, limit: 1)
        let r = await request(["pub": ["topic": topic, "noecho": false, "content": t]])
        if r == nil || code(r!) >= 300 {
            messages[topic]?.removeAll { $0.pending && $0.text == t }
            return false
        }
        return true
    }

    /// A picture or a file into the chat, as this person: up to the chat's file store, then a message pointing at it.
    func sendFile(_ topic: String, name: String, mime: String, data: Data, image: UIImage? = nil) async -> Bool {
        guard let ref = await upload(name: name, mime: mime, data: data) else { return false }
        await attach(topic, limit: 1)
        var ent: [String: Any] = ["mime": mime, "name": name, "ref": ref, "size": data.count]
        var tp = "EX"
        if let img = image {
            tp = "IM"
            ent["width"] = Int(img.size.width * img.scale)
            ent["height"] = Int(img.size.height * img.scale)
            // A small picture of it inline, so the list and the bubble show it before the file is fetched.
            if let small = Self.thumb(img) { ent["val"] = small.base64EncodedString() }
        }
        let content: [String: Any] = ["txt": " ", "fmt": [["at": -1, "len": 0, "key": 0]], "ent": [["tp": tp, "data": ent]]]
        let r = await request(["pub": ["topic": topic, "noecho": false, "head": ["mime": "text/x-drafty"], "content": content,
                                       "extra": ["attachments": [ref]]]])
        return r != nil && code(r!) < 300
    }

    /// A new group (the chat page's createGroup): Tinode makes it from a "new…" topic, named here, then each member is
    /// invited. The group's topic, or nil.
    func createGroup(title: String, members: [String]) async -> String? {
        let draft = "new" + UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(10)
        guard let r = await request(["sub": ["topic": draft, "set": ["desc": ["public": ["fn": title]]]]]), code(r) < 300,
              let grp = r["topic"] as? String, grp.hasPrefix("grp") else { return nil }
        attached.insert(grp)
        for u in members {
            _ = await request(["set": ["topic": grp, "sub": ["user": u]]])
        }
        await refreshMe()
        if !topics.contains(where: { $0.topic == grp }) {
            topics.insert(ChatTopic(topic: grp, name: title, photo: nil, group: true, seq: 0, read: 0, touched: Date()), at: 0)
        }
        return grp
    }

    /// An answer to TDH 助手's card, as the chat page's confirmAi sends it: the words said, and head tdh_ai_ok.
    func answerAi(_ topic: String, of seq: Int, ok: Bool, say: String) async -> Bool {
        await attach(topic, limit: 1)
        let r = await request(["pub": ["topic": topic, "noecho": false, "content": say,
                                       "head": ["tdh_ai_ok": ["of": seq, "ok": ok], "reply": "\(seq)"]]])
        return r != nil && code(r!) < 300
    }

    /// A voice message (company-chat-voice-v1): the WAV up to the chat's file store, then a message with its audio entity,
    /// as the chat page's Drafty.appendAudio writes it. The server writes its words (chat_voice.py).
    func sendVoice(_ topic: String, wav: Data, ms: Int, preview: String) async -> Bool {
        guard let ref = await upload(name: "语音.wav", mime: "audio/wav", data: wav) else { return false }
        await attach(topic, limit: 1)
        let ent: [String: Any] = ["mime": "audio/wav", "ref": ref, "size": wav.count, "duration": ms, "preview": preview, "name": "语音.wav"]
        let content: [String: Any] = ["txt": " ", "fmt": [["at": 0, "len": 1, "key": 0]], "ent": [["tp": "AU", "data": ent]]]
        let r = await request(["pub": ["topic": topic, "noecho": false, "head": ["mime": "text/x-drafty"], "content": content,
                                       "extra": ["attachments": [ref]]]])
        return r != nil && code(r!) < 300
    }

    private func stand(_ topic: String, _ m: ChatMessage) {
        var l = messages[topic] ?? []
        l.append(m)
        messages[topic] = l
    }

    private func upload(name: String, mime: String, data: Data) async -> String? {
        guard let u = try? await Net.url("/v0/file/u/") else { return nil }
        let boundary = "tdh-" + UUID().uuidString
        var body = Data()
        let safe = name.replacingOccurrences(of: "\"", with: "'")
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(safe)\"\r\nContent-Type: \(mime)\r\n\r\n".utf8))
        body.append(data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        var r = URLRequest(url: u)
        r.httpMethod = "POST"
        r.timeoutInterval = 300
        r.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        r.setValue(apiKey, forHTTPHeaderField: "X-Tinode-APIKey")
        r.setValue("Token " + authToken, forHTTPHeaderField: "X-Tinode-Auth")
        r.httpBody = body
        guard let (d, _) = try? await Net.session.data(for: r),
              let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let c = j["ctrl"] as? [String: Any], code(c) < 300,
              let p = c["params"] as? [String: Any], let url = p["url"] as? String else { return nil }
        return url
    }

    /// A file's bytes from the chat's file store (or inline).
    func fetch(_ a: ChatAttachment) async -> Data? {
        if let d = a.inline, a.ref == nil { return d }
        guard let ref = a.ref else { return a.inline }
        return await fetchRef(ref)
    }

    func fetchRef(_ ref: String) async -> Data? {
        guard let u = try? await Net.url(ref) else { return nil }
        var r = URLRequest(url: u)
        r.timeoutInterval = 120
        r.setValue(apiKey, forHTTPHeaderField: "X-Tinode-APIKey")
        r.setValue("Token " + authToken, forHTTPHeaderField: "X-Tinode-Auth")
        guard let (d, resp) = try? await Net.session.data(for: r), (resp as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return d
    }

    // MARK: helpers

    private func photo(_ pub: [String: Any], key: String) -> UIImage? {
        guard let p = pub["photo"] as? [String: Any] else { return nil }
        if let s = p["data"] as? String, s.count > 64, let d = Data(base64Encoded: s), let img = UIImage(data: d) { return img }
        if let ref = p["ref"] as? String, ref.count > 4, ref != "\u{2421}", !photoRefs.contains(key + ref) {
            photoRefs.insert(key + ref)
            Task {
                guard let d = await fetchRef(ref), let img = UIImage(data: d) else { return }
                if let i = topics.firstIndex(where: { $0.topic == key }) { topics[i].photo = img }
                if var p = people[key] { p.photo = img; people[key] = p }
            }
        }
        return nil
    }

    private func date(_ v: Any?) -> Date? {
        guard let s = v as? String else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    static func message(_ d: [String: Any]) -> ChatMessage {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let ts = (d["ts"] as? String).flatMap { f.date(from: $0) ?? ISO8601DateFormatter().date(from: $0) } ?? Date()
        var text = ""
        var atts: [ChatAttachment] = []
        if let s = d["content"] as? String {
            text = s
        } else if let c = d["content"] as? [String: Any] {
            text = (c["txt"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            for e in c["ent"] as? [[String: Any]] ?? [] {
                let tp = e["tp"] as? String ?? ""
                guard ["EX", "IM", "AU"].contains(tp), let x = e["data"] as? [String: Any] else { continue }
                let val = (x["val"] as? String).flatMap { Data(base64Encoded: $0) }
                atts.append(ChatAttachment(kind: tp == "IM" ? .image : tp == "AU" ? .audio : .file,
                                           name: x["name"] as? String ?? (tp == "IM" ? "图片" : tp == "AU" ? "语音" : "文件"),
                                           mime: x["mime"] as? String ?? "", size: x["size"] as? Int ?? val?.count ?? 0,
                                           inline: val, ref: x["ref"] as? String,
                                           width: x["width"] as? Int ?? 0, height: x["height"] as? Int ?? 0,
                                           duration: x["duration"] as? Int ?? 0,
                                           preview: (x["preview"] as? String).flatMap { Data(base64Encoded: $0) }.map { [UInt8]($0) } ?? []))
            }
        }
        let head = d["head"] as? [String: Any] ?? [:]
        var m = ChatMessage(seq: d["seq"] as? Int ?? 0, from: d["from"] as? String ?? "", at: ts, text: text, attachments: atts)
        m.call = head["webrtc"] as? String
        m.callMs = (head["webrtc-duration"] as? Int) ?? 0
        if let r = head["replace"] as? String, let n = Int(r.trimmingCharacters(in: CharacterSet(charactersIn: ":"))) { m.replaces = n }
        if let ai = head["tdh_ai"] as? [String: Any] {
            m.ai = true
            m.aiKind = ai["kind"] as? String ?? "data"
            m.aiDeciders = ai["deciders"] as? [String] ?? []
        }
        if let ok = head["tdh_ai_ok"] as? [String: Any], let of = ok["of"] as? Int {
            m.aiOkOf = of
            m.aiOk = (ok["ok"] as? Bool) ?? true
        }
        if let c = head["tdh_card"] as? [String: Any], let title = c["title"] as? String, !title.isEmpty {
            var due: Date?
            if let n = c["due"] as? Double, n > 0 { due = Date(timeIntervalSince1970: n > 1e11 ? n / 1000 : n) }
            else if let s = c["due"] as? String, !s.isEmpty { due = ISO8601DateFormatter().date(from: s) }
            m.card = TaskCard(id: "\(c["id"] ?? "")", event: c["event"] as? String ?? "", title: title,
                              to: "\(c["to"] ?? "")", due: due, note: c["note"] as? String ?? "")
        }
        return m
    }

    static func preview(_ m: ChatMessage, group: Bool, who: String?, me: Bool) -> String {
        if m.call != nil { return "[语音通话]" }
        if let c = m.card { return "[任务卡] " + c.title }
        var s = m.text
        if let a = m.attachments.first {
            s = a.kind == .image ? "[图片]" : a.kind == .audio ? "[语音]" : "[文件] " + a.name
        }
        if group && !me, let who, !who.isEmpty { s = who + "：" + s }
        return s.replacingOccurrences(of: "\n", with: " ")
    }

    static func thumb(_ img: UIImage) -> Data? {
        let side: CGFloat = 64
        let scale = side / max(img.size.width, img.size.height, 1)
        let size = CGSize(width: max(1, img.size.width * scale), height: max(1, img.size.height * scale))
        let f = UIGraphicsImageRendererFormat()
        f.scale = 1
        return UIGraphicsImageRenderer(size: size, format: f).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
            .jpegData(compressionQuality: 0.6)
    }

    private func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? s }

    private func rawGet(_ path: String, timeout: TimeInterval = 20) async -> Data? {
        guard let u = try? await Net.url(path) else { return nil }
        var r = URLRequest(url: u)
        r.timeoutInterval = timeout
        guard let (d, resp) = try? await Net.session.data(for: r), let h = resp as? HTTPURLResponse, h.statusCode < 400 else { return nil }
        return d
    }

    private func rawPost(_ path: String, _ body: Data) async -> Data? {
        guard let u = try? await Net.url(path) else { return nil }
        var r = URLRequest(url: u)
        r.httpMethod = "POST"
        r.timeoutInterval = 20
        // Not a form: Tinode reads a form-typed POST as a form and calls the message malformed.
        r.setValue("text/plain", forHTTPHeaderField: "Content-Type")
        r.httpBody = body
        return try? await Net.session.data(for: r).0
    }
}
