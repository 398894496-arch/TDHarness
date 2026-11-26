# TDH 手机版（iOS）第一版

员工手机上的 TDH：登录、公司聊天（含语音消息和一对一通话）、TDH 助手对话。SwiftUI，iOS 17 起，只做 iPhone 竖屏。

## 有什么

| 页 | 做法 |
|---|---|
| 登录 | 和电脑端同一套接口：手机验证码（`/company/login/sms-code`、`/sms`）、账号密码（`/company/login`）、这台手机 30 天免登录（`/resume`，退出时 `/forget`）。钥匙串里只存设备 id 和免登录令牌；网关令牌只在内存里；服务器给电脑端的共享盘账号不保存。 |
| 聊天 | 电脑端同一个聊天页（Tinode）。App 内的本机中继 `ChatRelay`（127.0.0.1，固定端口 17811–17814，被占就随机）：页面和 Tinode 接口经它转到公司服务器；用网关令牌换聊天令牌后放进页面存储（页面拿不到网关令牌）；页面改用长轮询；语音转文字（`/tdh/voice`）和通话纪要的录音片段（`/tdh/call`）由它带着登录转给服务器。只接受 Host 为本机、只服务带本次启动钥匙的页面。 |
| 助手 | 公司网关 `/gw/v1/chat/completions` 流式对话，模型和推理强度取站点默认（`/gw/v1/company-models`）。对话只在内存里。读写公司文件、ERP、邮件仍在电脑端做。 |
| 我 | 账号、部门、当前连的服务器、退出登录。 |

公司服务器的证书不是手机自己信任的：所有 HTTPS 请求都在代码里校验，证书链必须到公司根证书、名字必须是站点主机名（`Net.swift` 的 `PinnedTrust`）。

## 站点配置

`TDH/Site.json` 每个站点单独生成，**不进仓库**：

```bash
./make-site.sh TDH tdharness.local 8443 company-ca.crt tdharness.local 10.66.0.2
```

参数：显示名、证书里的主机名、端口、公司根证书（服务器 `D:\dsh\runtime\company-ca.crt`），后面是按顺序尝试的地址（同时探测，先应答的用）。地址也可以写完整 URL（`http://127.0.0.1:4199`，本机测试用）。

## 编译和在模拟器里跑

```bash
xcodebuild -project TDH.xcodeproj -scheme TDH -destination 'generic/platform=iOS Simulator' -derivedDataPath build build
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/TDH.app
xcrun simctl launch booted cn.tdharness.mobile
```

调试版（只有 Debug 编译）可以用启动参数免点屏幕检查：`-tdhTestUser 账号 -tdhTestPass 密码`、`-tdhTestPhone 手机号 [-tdhTestCode 验证码]`、`-tdhSignOut YES`、`-tdhTab 0|1|2`、`-tdhAsk "问题"`、`-tdhChatProbe YES`（不登录，只起中继）。只对本机测试服务用测试账号。

## 还没有的（下一步）

- **在外面用**：手机不装隧道，出了公司网要青岛服务器开一个只放行登录、聊天、助手的公网入口（IP + 公司根证书，不备案），再把地址加进 `Site.json`。
- **通话穿透**：服务器现在只给 STUN（`iceServers`），手机走 4G 和公司电脑之间可能打不通，要在青岛加 TURN。
- **推送**：App 不在前台时收不到新消息和来电提醒（要 APNs + 服务器端发推送）。
- **TestFlight**：要在 Xcode 里登录开发者账号（`PRODUCT_BUNDLE_IDENTIFIER = cn.tdharness.mobile`，可改）后归档上传。
- 截图、聊天里下载文件到手机（`/tdh/shot`、`/tdh/save`）暂不支持。
