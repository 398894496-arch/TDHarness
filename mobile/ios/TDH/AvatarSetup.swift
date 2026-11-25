// company-chat-avatar-v1 (the user, 2026-11-25: 「手机登录 我要求一定要上传头像 否则这个聊天窗口好丑啊」): after sign-in, a person
// whose chat card has no picture is asked for one before anything else — from the photo library or the camera, cut
// to a square, small enough to sit on the card itself. There is no skipping it; signing out is the only other way.
import PhotosUI
import SwiftUI
import UIKit

struct AvatarSetupView: View {
    @EnvironmentObject var session: Session
    @State private var item: PhotosPickerItem?
    @State private var image: UIImage?
    @State private var camera = false
    @State private var busy = false
    @State private var error = ""
    @State private var done = false

    var body: some View {
        ZStack {
            DeskBackground()
            VStack(spacing: 0) {
                LavaDots().padding(.top, 56)
                Text(done ? "头像已设置好" : "上传一张你的头像")
                    .font(.title2.weight(.semibold))
                    .padding(.top, 20)
                    .contentTransition(.opacity)
                Text("同事在聊天里靠头像认出你。设置好以后才能开始使用。")
                    .font(.footnote).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.top, 6).padding(.horizontal, 32)

                ZStack {
                    Circle()
                        .fill(.white.opacity(0.7))
                        .overlay(Circle().strokeBorder(style: StrokeStyle(lineWidth: 2, dash: image == nil ? [7, 6] : [])).foregroundStyle(Color.accentColor.opacity(0.5)))
                    if let image {
                        Image(uiImage: image).resizable().scaledToFill().clipShape(Circle())
                            .transition(.scale(scale: 0.8).combined(with: .opacity))
                    } else {
                        Image(systemName: "person.fill").font(.system(size: 64)).foregroundStyle(.secondary.opacity(0.5))
                    }
                    if done {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 40)).foregroundStyle(.white, .green)
                            .offset(x: 62, y: 62)
                            .transition(.scale(scale: 0.3).combined(with: .opacity))
                    }
                }
                .frame(width: 180, height: 180)
                .shadow(color: .black.opacity(0.08), radius: 20, y: 8)
                .padding(.top, 36)
                .animation(.spring(response: 0.5, dampingFraction: 0.7), value: image != nil)
                .animation(.spring(response: 0.45, dampingFraction: 0.6), value: done)

                if !error.isEmpty {
                    Text(error).font(.footnote).foregroundStyle(.red).padding(.top, 14)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 24)
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 12) {
                if image != nil && !done {
                    Button { Task { await upload() } } label: {
                        Text(busy ? "正在上传…" : "用这张").font(.body.weight(.semibold)).frame(maxWidth: .infinity).frame(height: 50)
                    }
                    .buttonStyle(.borderedProminent).buttonBorderShape(.capsule).disabled(busy)
                }
                if !done {
                    HStack(spacing: 12) {
                        PhotosPicker(selection: $item, matching: .images) {
                            Label(image == nil ? "从相册选" : "换一张", systemImage: "photo.on.rectangle")
                                .frame(maxWidth: .infinity).frame(height: 48)
                        }
                        .buttonStyle(image == nil ? AnyPrimitiveButtonStyle(.borderedProminent) : AnyPrimitiveButtonStyle(.bordered))
                        .buttonBorderShape(.capsule)
                        if UIImagePickerController.isSourceTypeAvailable(.camera) {
                            Button { camera = true } label: {
                                Label("拍照", systemImage: "camera").frame(maxWidth: .infinity).frame(height: 48)
                            }
                            .buttonStyle(.bordered).buttonBorderShape(.capsule)
                        }
                    }
                    .disabled(busy)
                    Button("退出登录") { Task { await session.signOut() } }
                        .font(.footnote).foregroundStyle(.secondary).padding(.top, 4)
                }
            }
            .padding(.horizontal, 24).padding(.bottom, 10)
        }
        .onChange(of: item) { _, it in
            guard let it else { return }
            Task {
                if let d = try? await it.loadTransferable(type: Data.self), let img = UIImage(data: d) {
                    error = ""
                    image = img
                }
            }
        }
        .fullScreenCover(isPresented: $camera) {
            CameraPicker { img in image = img; error = "" }.ignoresSafeArea()
        }
    }

    private func upload() async {
        guard let img = image, let jpeg = Self.avatarJPEG(img) else { return }
        busy = true
        error = ""
        let ok = await session.setAvatar(jpeg)
        busy = false
        if ok {
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            withAnimation { done = true }
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            withAnimation(.spring(response: 0.5, dampingFraction: 0.85)) { session.needsAvatar = false }
        } else {
            error = "头像没传上去，检查一下网络再试一次"
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
    }

    /// The middle square, 256 × 256, as JPEG small enough for the card (the chat keeps it inline).
    static func avatarJPEG(_ img: UIImage) -> Data? {
        let side: CGFloat = 256
        let w = img.size.width, h = img.size.height
        guard w > 0, h > 0 else { return nil }
        let scale = side / min(w, h)
        let size = CGSize(width: w * scale, height: h * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let out = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { _ in
            img.draw(in: CGRect(x: (side - size.width) / 2, y: (side - size.height) / 2, width: size.width, height: size.height))
        }
        var q: CGFloat = 0.85
        var data = out.jpegData(compressionQuality: q)
        while let d = data, d.count > 48 * 1024, q > 0.4 {
            q -= 0.1
            data = out.jpegData(compressionQuality: q)
        }
        return data
    }
}

/// Either of two button styles, picked at run time.
struct AnyPrimitiveButtonStyle: PrimitiveButtonStyle {
    private let make: (Configuration) -> AnyView
    init<S: PrimitiveButtonStyle>(_ s: S) { make = { AnyView(s.makeBody(configuration: $0)) } }
    func makeBody(configuration: Configuration) -> some View { make(configuration) }
}

/// The system camera, front-facing first, for one picture.
struct CameraPicker: UIViewControllerRepresentable {
    let picked: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let p = UIImagePickerController()
        p.sourceType = .camera
        if UIImagePickerController.isCameraDeviceAvailable(.front) { p.cameraDevice = .front }
        p.allowsEditing = true
        p.delegate = context.coordinator
        return p
    }

    func updateUIViewController(_ c: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ p: CameraPicker) { parent = p }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let img = (info[.editedImage] ?? info[.originalImage]) as? UIImage { parent.picked(img) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}
