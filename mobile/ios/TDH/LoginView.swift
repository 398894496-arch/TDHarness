import SwiftUI

struct LoginView: View {
    @EnvironmentObject var session: Session
    @State private var useCode = true
    @State private var phone = ""
    @State private var code = ""
    @State private var user = ""
    @State private var password = ""
    @State private var remember = true
    @State private var busy = false
    @State private var message = ""
    @State private var countdown = 0

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                Spacer(minLength: 60)
                LavaDots()
                Text(Site.config.name).font(.largeTitle.bold())
                Text("TDHarness 公司助手").font(.subheadline).foregroundStyle(.secondary)

                Picker("", selection: $useCode) {
                    Text("验证码登录").tag(true)
                    Text("密码登录").tag(false)
                }
                .pickerStyle(.segmented)

                VStack(spacing: 12) {
                    if useCode {
                        field("手机号", text: $phone, kind: .phonePad)
                        HStack {
                            field("验证码", text: $code, kind: .numberPad)
                            Button(countdown > 0 ? "\(countdown) 秒" : "获取验证码") { Task { await askCode() } }
                                .disabled(busy || countdown > 0 || phoneDigits.count != 11)
                                .buttonStyle(.bordered)
                        }
                    } else {
                        field("账号", text: $user, kind: .asciiCapable)
                        SecureField("密码", text: $password)
                            .textContentType(.password)
                            .padding(12).background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
                    }
                    Toggle("这台手机 30 天内免登录", isOn: $remember).font(.footnote)
                }

                Button { Task { await go() } } label: {
                    Text(busy ? "正在登录…" : "登录").frame(maxWidth: .infinity).padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy || !ready)

                if !message.isEmpty || !session.note.isEmpty {
                    Text(message.isEmpty ? session.note : message)
                        .font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 28)
        }
        .background(LinearGradient(colors: [Color(red: 0.93, green: 0.95, blue: 1.0), Color(red: 1.0, green: 0.96, blue: 0.93)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing).ignoresSafeArea())
    }

    private var phoneDigits: String {
        var d = phone.filter(\.isNumber)
        if d.count == 13 && d.hasPrefix("86") { d.removeFirst(2) }
        return d
    }

    private var ready: Bool {
        useCode ? (phoneDigits.count == 11 && code.count >= 4) : (user.count >= 2 && password.count >= 4)
    }

    private func field(_ title: String, text: Binding<String>, kind: UIKeyboardType) -> some View {
        TextField(title, text: text)
            .keyboardType(kind)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .padding(12)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }

    private func askCode() async {
        busy = true
        message = ""
        if let err = await session.sendCode(phone: phoneDigits) {
            message = err
        } else {
            message = ""
            countdown = 60
            Task {
                while countdown > 0 {
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                    countdown -= 1
                }
            }
        }
        busy = false
    }

    private func go() async {
        busy = true
        message = ""
        let err = useCode
            ? await session.signIn(phone: phoneDigits, code: code.trimmingCharacters(in: .whitespaces), remember: remember)
            : await session.signIn(user: user.trimmingCharacters(in: .whitespaces).lowercased(), password: password, remember: remember)
        if let e = err { message = e }
        busy = false
    }
}
