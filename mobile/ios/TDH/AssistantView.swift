// 助手: talking with the company's model on the phone, through the company gateway (/gw/v1, the person's own gateway
// token, the site's default model and effort from /gw/v1/company-models). The desk's agent with its tools, files and
// skills stays on the computer; this is the conversation part. Nothing is kept on the phone: a new start is a new talk.
import SwiftUI

struct Turn: Identifiable, Equatable {
    let id = UUID()
    let mine: Bool
    var text: String
}

@MainActor
final class Assistant: ObservableObject {
    @Published var turns: [Turn] = []
    @Published var busy = false
    @Published var error = ""
    private var model = ""
    private var effort = ""
    private var task: Task<Void, Never>?

    private let system = "你是 TDHarness，公司里的 AI 助手，现在在员工的手机上。只称自己为 TDHarness，不说自己是哪家公司的哪个模型。" +
        "用简体中文、简短直接地回答；手机屏幕小，少用表格，长内容分点。需要读写公司文件、查 ERP、发邮件这类事时，告诉对方到电脑上的 TDH 里做。"

    func send(_ text: String, token: String) {
        let q = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !busy else { return }
        error = ""
        turns.append(Turn(mine: true, text: q))
        turns.append(Turn(mine: false, text: ""))
        busy = true
        task = Task { await run(token: token) }
    }

    func stop() {
        task?.cancel()
        busy = false
    }

    func clear() {
        stop()
        turns = []
        error = ""
    }

    private func pickModel(token: String) async {
        guard model.isEmpty else { return }
        if let (code, j) = try? await Net.getJSON("/gw/v1/company-models", token: token), code == 200,
           let d = j["default"] as? [String: Any], let m = d["model"] as? String {
            model = m
            effort = d["effort"] as? String ?? ""
        }
    }

    private func run(token: String) async {
        defer { busy = false }
        await pickModel(token: token)
        guard !model.isEmpty else {
            error = "没取到公司的模型设置，稍后再试。"
            dropEmptyReply()
            return
        }
        var msgs: [[String: Any]] = [["role": "system", "content": system]]
        for t in turns.dropLast() where !t.text.isEmpty {
            msgs.append(["role": t.mine ? "user" : "assistant", "content": t.text])
        }
        var body: [String: Any] = ["model": model, "messages": msgs, "stream": true]
        if !effort.isEmpty { body["reasoning_effort"] = effort }
        do {
            var r = URLRequest(url: try await Net.url("/gw/v1/chat/completions"))
            r.httpMethod = "POST"
            r.timeoutInterval = 300
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
            r.setValue("text/event-stream", forHTTPHeaderField: "Accept")
            r.httpBody = try JSONSerialization.data(withJSONObject: body)
            let (bytes, resp) = try await Net.session.bytes(for: r)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            guard code == 200 else {
                var raw = Data()
                for try await b in bytes { raw.append(b); if raw.count > 4000 { break } }
                let j = (try? JSONSerialization.jsonObject(with: raw)) as? [String: Any]
                let msg = ((j?["error"] as? [String: Any])?["message"] as? String) ?? (j?["error"] as? String) ?? ""
                error = code == 401 ? "登录过期了，请到「我」里退出后重新登录。" : "助手没回答（\(code)）" + (msg.isEmpty ? "" : "：" + msg)
                dropEmptyReply()
                return
            }
            for try await line in bytes.lines {
                if Task.isCancelled { break }
                guard line.hasPrefix("data:") else { continue }
                let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                if payload == "[DONE]" { break }
                guard let d = payload.data(using: .utf8),
                      let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                      let ch = (j["choices"] as? [[String: Any]])?.first,
                      let delta = ch["delta"] as? [String: Any],
                      let piece = delta["content"] as? String, !piece.isEmpty else { continue }
                if var last = turns.last, !last.mine {
                    last.text += piece
                    turns[turns.count - 1] = last
                }
            }
            dropEmptyReply()
        } catch {
            if !Task.isCancelled { self.error = (error as? LocalizedError)?.errorDescription ?? "网络断了，再试一次。" }
            dropEmptyReply()
        }
    }

    private func dropEmptyReply() {
        if let last = turns.last, !last.mine, last.text.isEmpty { turns.removeLast() }
    }
}

struct AssistantView: View {
    @EnvironmentObject var session: Session
    @StateObject private var ai = Assistant()
    @State private var input = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            if ai.turns.isEmpty {
                                VStack(spacing: 10) {
                                    LavaDots()
                                    Text("问点什么吧。需要动公司文件、ERP、邮件的事，请到电脑上的 TDH 里做。")
                                        .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                                }.frame(maxWidth: .infinity).padding(.top, 80)
                            }
                            ForEach(ai.turns) { t in bubble(t).id(t.id) }
                            if ai.busy && (ai.turns.last?.text.isEmpty ?? true) {
                                HStack(spacing: 8) { LavaDots().scaleEffect(0.6); Text("正在思考").font(.footnote).foregroundStyle(.secondary) }
                            }
                            if !ai.error.isEmpty { Text(ai.error).font(.footnote).foregroundStyle(.red) }
                            Color.clear.frame(height: 1).id("end")
                        }.padding()
                    }
                    .onChange(of: ai.turns) { _, _ in withAnimation { proxy.scrollTo("end", anchor: .bottom) } }
                }
                HStack(alignment: .bottom, spacing: 8) {
                    TextField("输入问题", text: $input, axis: .vertical)
                        .lineLimit(1...5)
                        .focused($focused)
                        .padding(10)
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 18))
                    Button {
                        if ai.busy { ai.stop() } else {
                            ai.send(input, token: session.person?.gwToken ?? "")
                            input = ""
                        }
                    } label: {
                        Image(systemName: ai.busy ? "stop.circle.fill" : "arrow.up.circle.fill").font(.system(size: 32))
                    }
                    .disabled(!ai.busy && input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(.horizontal).padding(.vertical, 8)
            }
            #if DEBUG
            .task {
                if let q = UserDefaults.standard.string(forKey: "tdhAsk"), ai.turns.isEmpty {
                    ai.send(q, token: session.person?.gwToken ?? "")
                }
            }
            #endif
            .navigationTitle("TDH 助手")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { ai.clear() } label: { Image(systemName: "square.and.pencil") }.disabled(ai.turns.isEmpty)
                }
            }
        }
    }

    @ViewBuilder
    private func bubble(_ t: Turn) -> some View {
        if t.mine {
            HStack { Spacer(minLength: 40); Text(t.text).padding(12).background(Color.accentColor.opacity(0.15), in: RoundedRectangle(cornerRadius: 16)) }
        } else if !t.text.isEmpty {
            Text((try? AttributedString(markdown: t.text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(t.text))
                .textSelection(.enabled)
                .padding(12)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
        }
    }
}
