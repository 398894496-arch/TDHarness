---
name: company-web
description: How this complete agent splits public pages and OpenCLI click.
whenToUse: 公开网, 打开网址, 浏览器.
---

# company-web

完整 Agent 的网和点选怎么分工。点选已换成 OpenCLI。不要调 `ego_*` / `browser_*`。不要加 Playwright。

## 1. 公司知识

手册、纠错、部门规定、公司是谁 → 先 `company-knowledge` 一次 `route=search`。`not-found` 再 `web_search` 同一批名字。不要一上来打开天眼查 / 企查查，不要对 brain 全库 `rg`。公开 GitHub / npm / Remotion 不要走公司知识。

## 2. 公开网页（`web_search` / `web_fetch`）

模型工具名只有 `web_search` / `web_fetch`。不要另发明工具名，不要在员工机跑 agent-reach / Exa / mcporter。

- 查公开事实、文档、当前版本：`web_search` 一次，`queries` 只放一条。服务器上由 Agent Reach 分路（网页走 Exa，中文问题同时查 360、必应中国）。摘要够用就回答，不要再搜、不要开浏览器。
- 要权威出处（标准号、法规、论文、官方指南）、要多个来源核对的：查询词以「深搜 」开头，由 GPT 联网检索，约 20–40 秒，给结论和来源。问标准号、法规、论文时服务器会自动走深搜。
- 只要缺一个数字才 `web_fetch` 那一条 URL。不要 `web_fetch` 搜页。不要开 `ego_*`。GitHub、B 站、YouTube、V2EX 的链接，服务器用 Agent Reach 按站点读出正文。
- 出网只打公司 `8450/search` 和 `8450/fetch`。Cookie 不上 8450。Agent Reach 和引擎都在服务器上跑。

分路：英文、技术问题 **Agent Reach 网页（Exa）→ Exa → Bing**；中文问题 **Agent Reach 网页 + 360 + 必应中国** 一起查；GitHub **Agent Reach GitHub → GitHub API → Bing**；B 站、YouTube 先走 Agent Reach 的对应通道。官方 DeepSeek 搜默认关。

## 3. 站点用规（哪只手）

| 要做的事 | 用手 | 不要 |
|---|---|---|
| 公开文档、官网、无 cookie 的页 | `web_search` / `web_fetch` → 8450 | 不要为此开浏览器 |
| 公司 `8443` 登录 / 下载 / 知识门 | 客户端登录窗、`/client/`、`company_knowledge` | 不要点选 8443 |
| 点已开的日常网页、走登录态流程 | OpenCLI 2.0（`opencli browser --session work open <url>`；会话名写在 `--session` 后面） | 不要调 `ego_*` / `browser_*` |
| 工具表没有 OpenCLI / `opencli` 不在 PATH | HOST 工具 `opencli` `action=ensure` | 不要找旧点选手，不要装 Playwright |

## 4. 代装 OpenCLI

员工机还没有这只手时，调 HOST 工具 `opencli`，不要只丢 npm 命令给人。不要改 overlay。不要把 OpenCLI 打进 zip。

1. `opencli` `action=ensure`：客户端自带 OpenCLI 2.0.3，一般直接就有；格子里没有才 `npm install @jackwener/opencli@2.0.3`（`OPENCLI_BIN` 可覆盖）
2. `opencli` `action=doctor`（格子里等同 `opencli doctor`）
3. Chrome 扩展不能静默装，要员工点一次。先用客户端自带的扩展，不依赖能不能上 Google（国内多数电脑打不开应用商店）：
   - `doctor` 结果里的 `extensionDir` 就是自带扩展的文件夹（客户端安装目录下的 `opencli/extension`），把这个路径原样发给员工；
   - 请员工在 Chrome（或 Edge）地址栏打开 `chrome://extensions`（Edge 是 `edge://extensions`），打开右上角「开发者模式」，点「加载已解压的扩展程序」，选这个文件夹；
   - 能打开 Google 的电脑也可以直接装商店版：`https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk`，点「添加」。
   装好后再跑一次 `doctor`，看到扩展已连接（`extensionConnected` 为真）才算好。
4. 关桌，开新会话。之后用 `opencli browser --session <名字> <命令>`（bash / 侧栏终端）。2.0 的结果都是 JSON：`{"ok":true,"data":…}`，失败是 `{"ok":false,"error":…}`。
5. `doctor` 说扩展版本旧了（`extension-outdated`）：客户端更新换了新扩展，请员工在 `chrome://extensions` 里点 OpenCLI 的刷新按钮

公开搜仍然只走 8450，不要用 OpenCLI 当搜索引擎。被挡的 `ego_*` / `browser_*` 会回 `click-retired`，下一步是 `opencli` `action=ensure`。

## 公司边界

- 员工桌装 `*codex-oauth*` / ChatGPT 搜、Playwright MCP 全家桶、`dsh-web-ui-all`
- 在员工机上用 bash 调 `mcporter` / `agent-reach` 当公司搜索（它装在服务器上，`web_search` 已经走它）
- 把官方 `web-search-deepseek` 重新打开，或让客户端直打上游搜索域名
- 把员工 Cookie 送到办公 Win 或 8450
- 再调 `ego_*` / `browser_*`（已换掉）
