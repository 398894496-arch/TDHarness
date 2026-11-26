# Android ↔ iPhone parity (company-android-parity-v1)

The user, 2026-11-26: 「你对齐iphone的版本！ 什么都别漏！！！！！」「视觉也要对齐哦！」. Every part of mobile/ios/TDH and where it
is on Android (1.3). 「Seen」: checked on the emulator against the iPhone's screens.

| # | iPhone (file) | What | Android | Seen |
|---|---|---|---|---|
| 1 | PhoneParts glass / frosted | Real frosted glass under bars (what scrolls under them blurred), cards with a bright rim | Look.kt `liquid()` (Haze) + UI.kt `EdgeBlur`; the AI page's own edges by backdrop-filter (Desk.edges) | yes |
| 2 | SF Symbols | gearshape, square.and.pencil, line.3.horizontal, clock.arrow.circlepath, sparkles, bubbles (filled), doc.text (filled), and the rest | Icons.kt `Sf` | yes |
| 3 | LoginView | +86 phone → 6 code boxes, agreement nudge, shake, back, Beta, lava | Login.kt | compiled (signing out not tried: no typing of the review code) |
| 4 | AvatarSetup | Required picture after sign-in (photos or camera, square 256 px), 更换头像 in settings, the roster's 128 px | Avatar.kt, Chat.setAvatar / checkAvatar | yes (upload done) |
| 5 | DeskTab | Gear · title (no emp-…) · 新对话; greeting and 4 cards; drops under the question | UI.kt AiPage / AIWelcome, Desk.titleOf | yes |
| 6 | PhoneParts PhoneComposer / HoldWave / PlusSheet | 「+」 · 按住说话 · keyboard; typing: the send drop beside it; the wave while held; 「+」: camera, latest photos, 全部照片, 上传文件, 选一个文档 | UI.kt PhoneComposer / HoldWave / PlusSheet / DocPickSheet, MainActivity Pick + Media | yes |
| 7 | Notices | Glass banners: a colleague's message, the AI's answer; tap opens it; swipe up; 4 s | Notices.kt, ChatWatch | compiled |
| 8 | PhonePages History | Large title, search, groups, swipe 归档/删除 (gradient tiles), 进行中, 有新回复 dot, 正在看的对话 outline, badge | UI.kt HistoryPage / SwipeRow, Desk.answered | yes |
| 9 | PhonePages Docs + PhoneShell ArtifactPager | Large title, search, pull to refresh, cards; pager (swipe), i / n, 转发, 交给 AI, ⋯ (用其他 App 打开) | UI.kt DocsPage / ArtifactPager / Menu | list yes (no docs on the test account) |
| 10 | PhoneShell ForwardPicker | Chips, 最近聊天 5 + 全部, search, check circles, 群 tag, note, 已转发给 … | UI.kt ForwardSheet | compiled |
| 11 | PhonePages PhoneSettings | Avatar, 更换头像, 部门/角色/登录名 with icons, 外观 segmented, 公司服务器/聊天/关于 TDH, legal, 退出登录 | UI.kt SettingsSheet / LegalPage | yes |
| 12 | ChatViews ChatListPage | One frosted card, pinned first with pin, swipe 置顶/删除, search: 联系人和群 + 聊天记录 (all, bold blue), ≡ menu | ChatUI.kt ChatListPage / ChatMenu, Chat.find | yes |
| 13 | ChatViews ContactsPage / NewGroupSheet | 群聊 then 同事（n）by pinyin; 建群: name, picked chips, check circles, 创建(n) | ChatUI.kt ContactsPage / NewGroupSheet, Chat.createGroup | yes (no group made) |
| 14 | ChatViews ChatRoom | ‹ · name · 📞; stamps; bubbles mine/paper; pictures; 查看更早的消息; composer with voice messages | ChatUI.kt ChatRoom | yes |
| 15 | FunctionCards | TDH 助手 cards by kind (AI_WORDS) with answers / waiting; answer notes; task cards; file cards (📎 docs) | ChatUI.kt AssistantCard / AnswerNote / TaskCardView / FileCard | compiled |
| 16 | ChatViews CallMinutesCard | Minutes laid out: 要点 / 定下的事 / 待办 with owners and due | ChatUI.kt CallMinutes / CallMinutesCard | compiled |
| 17 | PhoneShell ChatFileSheet | A chat file opened in place (picture, PDF pages, page/text), 转发, 交给 AI, ⋯ | ChatUI.kt ChatFileSheet / PdfPages | — |
| 18 | CallCenter / CallScreen / CallTones | Calls through the chat page (`__tdhChat.fn`), full-screen call, rings, tones, speaker | Calls.kt, Desk.chatWeb kept in the window | screens yes (simulated state; no real call placed) |
| 19 | PushCenter | Away: notifications for messages (open that chat) and AI answers (open that conversation); calls ringing | ChatWatch (+ people-api `ai-events`) | compiled; server part not deployed yet |
| 20 | TDHApp revive | Back to front: relay, page, chat checked | MainActivity onResume | as 1.2 |
