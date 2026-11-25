// Sign-in, one question per screen (the way phone assistants do it): the phone number, then the six-digit code in six
// boxes. The code goes out by itself once eleven digits are in, and the sign-in goes by itself once six digits are in
// (iOS offers the code from Messages above the keyboard: textContentType oneTimeCode). The company password is the
// other way in, from the link at the bottom. The drops above the title are the desk's own lava lamp.
import SwiftUI

struct LoginView: View {
    private enum Step { case phone, code, password }
    private enum Field { case phone, code, user, password }

    @EnvironmentObject var session: Session
    @State private var step: Step = .phone
    @State private var phone = ""
    @State private var code = ""
    @State private var user = ""
    @State private var password = ""
    @State private var remember = true
    @State private var busy = false
    @State private var message = ""
    @State private var countdown = 0
    @State private var shake: CGFloat = 0
    @State private var sentTo = ""
    @FocusState private var focus: Field?

    var body: some View {
        ZStack(alignment: .topLeading) {
            DeskBackground()
            VStack(spacing: 0) {
                LavaDots()
                    .scaleEffect(busy ? 1.25 : 1)
                    .padding(.top, 72)
                Text(title)
                    .font(.title2.weight(.semibold))
                    .padding(.top, 22)
                    .contentTransition(.opacity)
                subtitle
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.top, 6)
                Group {
                    switch step {
                    case .phone: phoneField
                    case .code: codeBoxes
                    case .password: passwordFields
                    }
                }
                .padding(.top, 30)
                .modifier(Shake(amount: shake))
                below.padding(.top, 14)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: 460)
            .frame(maxWidth: .infinity)

            if step != .phone {
                Button { back() } label: {
                    Image(systemName: "chevron.left")
                        .font(.body.weight(.semibold))
                        .frame(width: 44, height: 44)
                        .background(.ultraThinMaterial, in: Circle())
                }
                .foregroundStyle(.primary)
                .padding(.leading, 16)
                .padding(.top, 8)
                .accessibilityLabel("返回")
                .transition(.opacity.combined(with: .scale(scale: 0.6)))
            }
        }
        .safeAreaInset(edge: .bottom) { bottomBar }
        .animation(.spring(response: 0.38, dampingFraction: 0.86), value: step)
        .animation(.spring(response: 0.45, dampingFraction: 0.7), value: busy)
        .onAppear {
            focus = .phone
            #if DEBUG
            // Debug builds: the code screen without sending a text (-tdhLoginPreview code).
            if UserDefaults.standard.string(forKey: "tdhLoginPreview") == "code" { phone = "18600000000"; sentTo = phone; step = .code; countdown = 60; focus = .code }
            #endif
        }
        .onChange(of: phone) { _, v in
            let d = Self.digits(v)
            if d != v { phone = d; return }
            if d.count == 11 && step == .phone && !busy && sentTo != d { Task { await askCode() } }
        }
        .onChange(of: code) { _, v in
            let d = String(v.filter(\.isNumber).prefix(6))
            if d != v { code = d; return }
            if d.count == 6 && !busy { Task { await signIn() } }
        }
    }

    // MARK: pieces

    private var title: String {
        switch step {
        case .phone: return "你的手机号是？"
        case .code: return "请输入验证码"
        case .password: return "用公司账号登录"
        }
    }

    @ViewBuilder private var subtitle: some View {
        switch step {
        case .phone:
            Text("公司花名册里登记的手机号")
        case .code:
            HStack(spacing: 6) {
                Text("已发送至 " + Self.masked(phone))
                Button("更换") { back() }.font(.footnote.weight(.medium))
            }
        case .password:
            Text("管理员发给你的账号和密码")
        }
    }

    private var phoneField: some View {
        HStack(spacing: 12) {
            Text("+86").font(.body.weight(.medium))
            Rectangle().fill(.secondary.opacity(0.35)).frame(width: 1, height: 20)
            TextField("请输入手机号", text: Binding(get: { Self.grouped(phone) }, set: { phone = Self.digits($0) }))
                .keyboardType(.numberPad)
                .textContentType(.telephoneNumber)
                .font(.body.monospacedDigit())
                .focused($focus, equals: .phone)
        }
        .padding(.horizontal, 22)
        .frame(height: 56)
        .background(Color.paper.opacity(0.88), in: Capsule())
        .shadow(color: .black.opacity(0.06), radius: 12, y: 4)
    }

    private var codeBoxes: some View {
        ZStack {
            TextField("", text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .focused($focus, equals: .code)
                .foregroundStyle(.clear)
                .tint(.clear)
                .frame(width: 1, height: 1)
                .opacity(0.02)
            HStack(spacing: 10) {
                ForEach(0..<6, id: \.self) { i in
                    let ch = i < code.count ? String(code[code.index(code.startIndex, offsetBy: i)]) : ""
                    let on = focus == .code && i == min(code.count, 5)
                    Text(ch)
                        .font(.title2.weight(.semibold).monospacedDigit())
                        .frame(maxWidth: .infinity)
                        .frame(height: 54)
                        .background(Color.paper.opacity(on || !ch.isEmpty ? 0.95 : 0.55), in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(on ? Color.accentColor.opacity(0.6) : .clear, lineWidth: 1.5))
                        .shadow(color: .black.opacity(on ? 0.08 : 0.03), radius: 8, y: 3)
                        .animation(.easeOut(duration: 0.15), value: code)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { focus = .code }
        }
    }

    private var passwordFields: some View {
        VStack(spacing: 0) {
            TextField("账号", text: $user)
                .textContentType(.username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focus, equals: .user)
                .submitLabel(.next)
                .onSubmit { focus = .password }
                .padding(.horizontal, 18).frame(height: 52)
            Divider().padding(.leading, 18)
            SecureField("密码", text: $password)
                .textContentType(.password)
                .focused($focus, equals: .password)
                .submitLabel(.go)
                .onSubmit { Task { await signIn() } }
                .padding(.horizontal, 18).frame(height: 52)
        }
        .background(Color.paper.opacity(0.9), in: RoundedRectangle(cornerRadius: 18))
        .shadow(color: .black.opacity(0.06), radius: 12, y: 4)
    }

    @ViewBuilder private var below: some View {
        VStack(spacing: 10) {
            if !message.isEmpty || !session.note.isEmpty {
                Text(message.isEmpty ? session.note : message)
                    .font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
            }
            if busy {
                Text(step == .phone ? "正在发送验证码…" : "正在登录…").font(.footnote).foregroundStyle(.secondary)
            } else if step == .code {
                if countdown > 0 {
                    Text("\(countdown)s 后可重新发送").font(.footnote).foregroundStyle(.secondary).monospacedDigit()
                } else {
                    Button("重新发送验证码") { Task { await askCode(again: true) } }.font(.footnote.weight(.medium))
                }
            }
        }
    }

    private var bottomBar: some View {
        VStack(spacing: 12) {
            if step != .code {
                Button { Task { step == .phone ? await askCode() : await signIn() } } label: {
                    Text(step == .phone ? "发送验证码" : "登录")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .disabled(busy || !ready)
            }
            HStack {
                Toggle(isOn: $remember) { Text("30 天内免登录").font(.footnote) }
                    .toggleStyle(CheckToggle())
                Spacer()
                Button(step == .password ? "用手机验证码登录" : "用账号密码登录") {
                    message = ""
                    step = step == .password ? .phone : .password
                    focus = step == .password ? .user : .phone
                }
                .font(.footnote)
            }
            .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 8)
        .frame(maxWidth: 460)
    }

    // MARK: actions

    private var ready: Bool {
        switch step {
        case .phone: return phone.count == 11
        case .code: return code.count == 6
        case .password: return user.trimmingCharacters(in: .whitespaces).count >= 2 && password.count >= 4
        }
    }

    private func back() {
        message = ""
        code = ""
        step = .phone
        focus = .phone
    }

    private func askCode(again: Bool = false) async {
        guard phone.count == 11, !busy else { return }
        busy = true
        message = ""
        let err = await session.sendCode(phone: phone)
        busy = false
        if let err {
            message = err
            sentTo = ""
            fail()
            return
        }
        sentTo = phone
        code = ""
        step = .code
        focus = .code
        countdown = 60
        Task {
            while countdown > 0 {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                countdown -= 1
            }
        }
    }

    private func signIn() async {
        guard ready, !busy else { return }
        busy = true
        message = ""
        focus = nil
        let err = step == .password
            ? await session.signIn(user: user.trimmingCharacters(in: .whitespaces).lowercased(), password: password, remember: remember)
            : await session.signIn(phone: phone, code: code, remember: remember)
        busy = false
        if let err {
            message = err
            if step == .code { code = "" ; focus = .code } else { focus = .password }
            fail()
        }
    }

    private func fail() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
        withAnimation(.spring(response: 0.42, dampingFraction: 0.32)) { shake += 1 }
    }

    // MARK: formatting

    static func digits(_ s: String) -> String {
        var d = s.filter(\.isNumber)
        if d.count >= 13 && d.hasPrefix("86") { d.removeFirst(2) }
        return String(d.prefix(11))
    }

    /// 186 8819 4198
    static func grouped(_ d: String) -> String {
        var out = ""
        for (i, c) in d.enumerated() {
            if i == 3 || i == 7 { out.append(" ") }
            out.append(c)
        }
        return out
    }

    /// 186 **** 4198
    static func masked(_ d: String) -> String {
        guard d.count == 11 else { return d }
        return String(d.prefix(3)) + " **** " + String(d.suffix(4))
    }
}

/// A shake left and right when the code or password is wrong.
private struct Shake: GeometryEffect {
    var amount: CGFloat
    var animatableData: CGFloat {
        get { amount }
        set { amount = newValue }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 9 * sin(amount * .pi * 6), y: 0))
    }
}

/// A small round check box in front of its label.
private struct CheckToggle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            HStack(spacing: 6) {
                Image(systemName: configuration.isOn ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(configuration.isOn ? Color.accentColor : .secondary)
                configuration.label
            }
        }
        .buttonStyle(.plain)
    }
}
