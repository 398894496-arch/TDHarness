# TDH 手机版（Android）第一版

员工安卓手机上的 TDH：登录、AI 助手（服务器上的工作台）、公司聊天、历史对话、文档。Kotlin + Jetpack Compose，Android 8.0（API 26）起。鸿蒙 4 及以下的华为手机也能装；纯血鸿蒙（HarmonyOS NEXT）需要单独的鸿蒙版，这一版不包括。

## 怎么做的

和 iPhone 版走同一条路，网页部分直接复用服务器现成的页面：

| 页 | 做法 |
|---|---|
| 登录 | 手机验证码（`/company/login/sms-code`、`/sms`）或账号密码（`/company/login`），这台手机记住登录（`/company/login/resume`）。 |
| AI | 员工自己在服务器上的工作台（`server/desk_hub.js`）。网页视图加载 App 内本机中转 `Relay`（127.0.0.1:17803 起）的页面，中转把每个连接转到 `https://<站点>/desk-hub/...` 并带上登录令牌。页面认出手机（`company-phone-layout-v1`）后只显示对话。 |
| 历史 | 页面通过 `window.tdhPhone` 报来的会话列表，原生列表；长按删除。 |
| 聊天 | 工作台自带的聊天页（`/company/chat/where` 给出地址），同一个中转，WebSocket 原样转发。 |
| 文档 | `tdhPhone.artifacts()` 列出 AI 做的文档，点开看，「交给 AI」开新对话。 |
| 设置 | 登录名、部门、角色、版本、协议、退出登录。 |

安全：
- 出手机的流量全是 HTTPS，证书在代码里校验：证书链必须到站点的公司 CA（和云入口 CA），名字必须是站点主机名，不用手机系统的证书库（`Site.kt`）。
- 同一台安卓手机上的其他 App 也能访问 127.0.0.1，所以中转只接受带本次运行随机 Cookie `tdh_k` 的连接（只设在本 App 的网页视图里），这个 Cookie 不会转给服务器。

后台消息：国内安卓手机没有 Google 推送，各厂商推送要分别注册账号。这一版用前台服务 `ChatWatch`（通知栏常驻「TDH 正在接收消息」），每 8 秒向工作台问一次未读（`/company/chat/unread`），有新消息就弹通知。

## 站点配置

和 iPhone 版用同一个文件：`mobile/ios/make-site.sh` 生成的 `Site.json` 复制为 `app/src/main/assets/site.json`，**不进仓库**。

## 编译

需要 JDK 17 和 Android SDK（platform 35、build-tools 35）。

```bash
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties
./gradlew :app:assembleDebug
```

发布包要签名：在本目录放 `keystore.properties`（不进仓库），写 `storeFile`、`storePassword`、`keyAlias`、`keyPassword`。**签名密钥必须一直保留**：以后的更新包必须用同一把密钥签，换了密钥员工手机上就装不上更新。

```bash
./gradlew :app:assembleRelease -PtdhVersionCode=2026112601
```

调试包可以用测试账号直接登录（不用收验证码）：

```bash
adb shell am start -n cn.tdharness.mobile/.MainActivity --es tdhTestDevice <设备ID> --es tdhTestRemember <记住登录令牌>
```

## 还没做

- 按住说话（国内安卓手机大多没有系统语音识别；可以用输入法自带的语音输入）。
- 厂商推送（华为、小米、OPPO、vivo），需要各家开发者账号。
- 一对一语音通话。
