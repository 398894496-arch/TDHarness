// company-phone-legal-v1 (the user, 2026-11-25: 「做一个标准的免责 服务协议和隐私政策」): the three documents, agreed to
// on the sign-in page (not ticked for the person) and readable any time from 设置 → 关于. What the privacy policy says
// is what this app and the company server do: the phone number, the chats, calls and their minutes, the AI, the
// notifications through Apple, the sign-in text messages through Alibaba Cloud.
import SwiftUI

enum LegalDoc: String, Identifiable, CaseIterable {
    case terms, privacy, disclaimer
    var id: String { rawValue }

    var title: String {
        switch self {
        case .terms: return "服务协议"
        case .privacy: return "隐私政策"
        case .disclaimer: return "免责声明"
        }
    }

    static let updated = "2026 年 11 月 25 日"

    /// The text: a line starting "## " is a heading, "· " a list item, anything else a paragraph.
    var body: String {
        switch self {
        case .terms: return Self.termsText
        case .privacy: return Self.privacyText
        case .disclaimer: return Self.disclaimerText
        }
    }

    private static let termsText = """
    欢迎使用 TDH。本协议是你与山东壹通达（以下简称"公司"或"我们"）之间关于使用 TDH 移动应用及相关服务（以下简称"本服务"）的约定。请你在登录前仔细阅读；勾选同意并登录，即表示你已阅读、理解并接受本协议的全部内容。

    ## 一、服务说明
    TDH 是公司提供给内部员工使用的工作应用，包括 AI 助手、同事聊天、语音消息与通话、通话纪要、文档与工件查看、消息通知等功能。本服务仅供公司在职员工及经公司授权的人员用于工作，不面向公众提供。

    ## 二、账号
    · 你的账号由公司依据员工花名册开通，使用登记在花名册中的手机号通过短信验证码登录。
    · 你应妥善保管手机和账号，不得出借、转让或与他人共用。因保管不当造成的损失由你自行承担。
    · 登录后，除非你主动退出，这台设备将保持登录状态。手机丢失或更换时，请及时联系管理员停用该设备的登录。
    · 员工离职或岗位变动时，公司可以调整或停用相应账号。

    ## 三、使用规范
    你在使用本服务时应遵守法律法规和公司规章制度，不得：
    · 发布或传播违法、侵权、淫秽、暴力、诽谤或其他不当内容；
    · 将公司的商业秘密、客户资料和其他内部信息泄露给无权知悉的人；
    · 利用本服务从事与工作无关的商业活动，或干扰、破坏本服务的正常运行；
    · 试图绕过权限访问他人或公司未授权的数据。

    ## 四、内容与知识产权
    · 你在工作中通过本服务产生的聊天记录、文件、工件等内容，属于公司工作资料，按公司规定管理和使用。
    · 本服务的软件、界面和标识的相关权利归公司或相应权利人所有。未经许可，不得复制、修改、反向工程或用于其他用途。

    ## 五、AI 功能
    AI 助手和通话纪要由人工智能自动生成，可能存在错误或遗漏，仅供工作参考。重要事项请你自行核实，具体见《免责声明》。

    ## 六、测试版说明
    当前版本为测试版（Beta），功能和界面可能调整，也可能出现故障或数据显示异常。欢迎你把问题反馈给管理员。

    ## 七、服务的变更、中断与终止
    公司可以根据工作需要调整、升级、暂停或终止本服务的部分或全部功能。因系统维护、网络故障、不可抗力等原因导致服务中断的，公司会尽力及时恢复。

    ## 八、责任限制
    在法律允许的范围内，公司对因使用或无法使用本服务造成的间接损失不承担责任。你违反本协议或法律法规造成损失的，应依法承担相应责任。

    ## 九、协议的修改
    公司可以根据需要修改本协议。修改后的协议将在应用内公布，重大变更会以适当方式提示你。你继续使用本服务，即视为接受修改后的协议。

    ## 十、法律适用与争议解决
    本协议适用中华人民共和国法律。因本协议发生的争议，双方应友好协商；协商不成的，提交公司所在地有管辖权的人民法院处理。

    ## 十一、联系我们
    对本协议有任何疑问，请联系公司系统管理员。
    """

    private static let privacyText = """
    山东壹通达（以下简称"公司"或"我们"）重视你的个人信息保护。本政策说明 TDH 移动应用（以下简称"本应用"）如何收集、使用、存储、共享和保护你的个人信息，以及你享有的权利。请在使用前仔细阅读。

    ## 一、我们收集的信息
    · 账号信息：手机号；以及公司花名册中的姓名、部门、角色。用于识别你的身份和展示通讯录。
    · 设备信息：为实现"保持登录"而生成的设备标识；为发送消息通知而由苹果分配的推送令牌。
    · 头像：你主动拍摄或选择的头像照片。
    · 工作内容：你发送或接收的聊天文字、图片、文件、语音消息；你与 AI 助手的对话及交给 AI 处理的文件。
    · 语音通话：通话进行中，双方的通话音频会上传到公司服务器转写成文字，并由 AI 生成通话纪要发到聊天中。开始通话即表示你知悉这一点；通话界面也会提示"本通话将转写"。
    · 语音转文字：使用"按住说话"时，语音由苹果系统的语音识别功能转成文字。

    ## 二、我们如何使用这些信息
    · 提供登录、聊天、通话、AI 助手、通话纪要、文档查看和消息通知等功能；
    · 保障账号与系统安全，排查故障；
    · 符合法律法规的要求。
    我们不会把你的信息用于广告推送，也不会出售你的个人信息。

    ## 三、系统权限
    以下权限只在你使用相关功能时申请，你可以随时在手机"设置"中关闭，关闭后相应功能将无法使用，但不影响其他功能：
    · 麦克风：发语音消息、语音通话、按住说话；
    · 语音识别：把你说的话转成文字；
    · 相机：拍头像、拍照片发送；
    · 照片：选择照片发送或设为头像；
    · 通知：接收新消息和 AI 回复的提醒；
    · 本地网络：在公司内网直接连接公司服务器。

    ## 四、委托处理与共享
    为实现上述功能，我们会在必要范围内使用以下服务提供方：
    · 阿里云短信服务：向你的手机号发送登录验证码；
    · 苹果推送服务（APNs）：发送消息通知，通知中包含发送人名称和消息摘要；
    · 苹果语音识别：把语音转成文字；
    · 公司接入的大模型服务提供方：处理你交给 AI 助手的内容和通话转写文字，以生成回答和纪要。
    除上述情形、法律法规要求或有权机关依法调取外，我们不会向公司以外的第三方提供你的个人信息。在公司内部，聊天内容只有聊天的成员可以查看；管理员可依据公司规定进行必要的管理。

    ## 五、存储与安全
    · 你的信息存储在公司自有的服务器上，位于中华人民共和国境内。
    · 我们采取访问控制、传输加密、权限分级等措施保护你的信息。
    · 我们在实现上述目的所需的期限内保存你的信息，法律法规另有规定或公司档案管理另有要求的除外。超出期限后，我们会删除或匿名化处理。

    ## 六、安全事件
    如发生个人信息安全事件，我们会按照法律法规的要求及时告知你，并采取补救措施。

    ## 七、你的权利
    · 查阅与更正：你可以在应用中查看自己的资料，如需更正请联系管理员；
    · 删除：你可以删除自己这边的聊天记录；其他删除请求可联系管理员；
    · 撤回同意：你可以在手机系统设置中关闭相应权限；
    · 注销：员工离职或需要注销账号时，可联系管理员办理。
    我们会在 15 个工作日内答复你的请求。

    ## 八、未成年人
    本应用仅面向公司员工，不面向未满 18 周岁的未成年人。

    ## 九、本政策的更新
    我们可能根据业务调整或法律要求更新本政策。更新后会在应用内公布，重大变更会以适当方式提示你。

    ## 十、联系我们
    对本政策或你的个人信息有任何疑问、意见或投诉，请联系公司系统管理员。
    """

    private static let disclaimerText = """
    ## 一、AI 生成内容
    TDH 中的 AI 助手回答、通话纪要、文档整理等内容由人工智能自动生成。人工智能可能理解错误、遗漏信息或给出不准确的结论，生成内容不代表公司的立场或决定，也不构成法律、财务、医疗等专业意见。涉及金额、合同、报价、生产安排、对外答复等重要事项，请你在使用前自行核实，并按公司流程确认。因直接采用未经核实的 AI 内容造成的后果，由使用者自行承担。

    ## 二、通话纪要
    通话纪要根据语音转写自动整理。转写可能受口音、噪声、网络等因素影响而不完整或有误，以通话双方的实际沟通为准。

    ## 三、测试版
    当前版本为测试版（Beta），可能存在功能缺陷、显示异常、消息延迟或数据同步不及时等情况。请勿将本应用作为重要信息的唯一保存方式。

    ## 四、服务可用性
    本服务依赖公司服务器、网络及苹果等第三方服务。因网络故障、系统维护、第三方服务中断或不可抗力导致的服务中断、消息或通知延迟，公司将尽力恢复，但不承担由此产生的间接损失。

    ## 五、用户内容
    用户通过本服务发布的内容由发布者自行负责。公司不对用户之间传递内容的真实性、准确性作出保证。

    ## 六、其他
    本声明未尽事宜，适用《服务协议》和《隐私政策》。如有疑问，请联系公司系统管理员。
    """
}

/// One document, readable: headings, list items and paragraphs, on the app's ground.
struct LegalView: View {
    let doc: LegalDoc

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text(doc.title).font(.title2.weight(.bold)).foregroundStyle(Color.ink)
                Text("更新日期：" + LegalDoc.updated).font(.footnote).foregroundStyle(.secondary).padding(.bottom, 6)
                ForEach(Array(doc.body.components(separatedBy: "\n").enumerated()), id: \.offset) { _, raw in
                    let line = raw.trimmingCharacters(in: .whitespaces)
                    if line.hasPrefix("## ") {
                        Text(String(line.dropFirst(3))).font(.headline).foregroundStyle(Color.ink).padding(.top, 10)
                    } else if line.hasPrefix("· ") {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text("•").foregroundStyle(.secondary)
                            Text(String(line.dropFirst(2)))
                        }
                        .font(.subheadline).foregroundStyle(Color.ink.opacity(0.85))
                    } else if !line.isEmpty {
                        Text(line).font(.subheadline).foregroundStyle(Color.ink.opacity(0.85)).lineSpacing(3)
                    }
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.ground)
        .navigationTitle(doc.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// A document from the sign-in page: its own sheet with a close button.
struct LegalSheet: View {
    let doc: LegalDoc
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            LegalView(doc: doc)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { dismiss() } label: { Image(systemName: "xmark") }.accessibilityLabel("关闭")
                    }
                }
        }
    }
}
