---
name: company-desktop
description: Operating Mac desktop apps (Jianying and others) with the bundled Cua Driver.
whenToUse: 剪映, 桌面软件, 点界面, 导出, 打开软件, 窗口.
---

# company-desktop（Mac）

Mac 客户端自带 Cua Driver。客户端启动时会把它装到「应用程序」里，名字是 CuaDriver。它在后台操作员工这台 Mac 上的桌面软件：不抢鼠标，也不把窗口拉到前台。网页仍然用 OpenCLI（见 `company-web`），命令仍然用自己的 shell。

## 1. 第一次用：先查权限

先调 `{"action":"check_permissions","args":{"prompt":false}}`，看「辅助功能」（accessibility）和「屏幕录制」（screen_recording）开了没有。缺了就带员工开，每次只说一步，等员工说做完了再说下一步：

1. 打开「系统设置 → 隐私与安全性 → 辅助功能」，把 **CuaDriver** 的开关打开。列表里没有，就点左下角「+」，从「应用程序」里选 CuaDriver。
2. 同一页往下找「屏幕录制」（新系统叫「屏幕与系统录音」），同样打开 CuaDriver。
3. 再调一次 `check_permissions`（`prompt:false`）确认。系统提示要重新打开时，不用退出 TDHarness，CuaDriver 会自己重启。

工具报错说找不到 `/Applications/CuaDriver.app`：说明这台 Mac 不让客户端往「应用程序」里装东西。请员工找管理员，或者自己把 TDHarness 安装目录里 `cua-driver/CuaDriver.app` 拖进「应用程序」，然后重新打开 TDHarness。

不要让员工把密码告诉你。员工不想开权限就停，不要绕过去。

## 2. 工具

只有一个工具 `mcp__cua__desktop`：`action` 填动作名，`args` 填这个动作的参数。参数说不清时，先调 `get_guide` 看官方说明（例如 `{"action":"get_guide","args":{"topic":"batching"}}`）。

- **找窗口**：`list_apps`、`list_windows` 拿到 `pid` 和 `window_id`。软件没开就用 `launch_app`（`bundle_id` 或 `name`），它在后台打开，不抢前台。
- **看界面**：`get_window_state`（`pid`、`window_id`）同时给界面树和截图，每一行 `[N]` 用 `<snapshot_id>:N` 当 `element_token`。界面大时加 `query` 只看相关的行。再看一次时加 `since:"latest"`，只返回变化的部分。看局部细节用 `zoom`。
- **动作**：`click` / `double_click` / `right_click` / `type_text` / `set_value` / `press_key` / `hotkey` / `scroll` / `drag`。能用 `element_token` 就不要用坐标。坐标是 `get_window_state` 截图里的窗口内像素。菜单栏用 `invoke_menu`。
- **连做几步**：用 `run_steps`，`steps` 里每一步是 `{tool, args}`，最后加 `observe:{}`，一次调用就能做完并看到结果。
- **核对**：`verify_state`。出问题先跑 `health_report`。
- **窗口位置**：`bring_to_front`（会抢前台，先跟员工说一声）、`set_window_frame`。

网页、录屏、自动更新这些动作不提供。点不了系统密码框。每次工具调用 60 秒上限，长操作拆成多步。

## 3. 每一步的规矩

1. 动作前先 `get_window_state` 看当前状态，动作后再看一次（或用 `run_steps` 加 `observe`），确认变了、变对了。
2. 点错了：`hotkey` 发 `cmd+z` 撤回，再看一次。连续两次点不准就停下，告诉员工，不要乱试。
3. 会改文件或发出去的动作，先问员工，得到「可以」再做：导出、保存覆盖、删除、发送消息、提交表单。
4. 员工自己正在用的窗口，要切到前台之前先说一声。不要读和本任务无关的聊天窗口内容。

## 4. 剪映专业版

- 剪映很可能是自绘界面：界面树里读不出按钮时，用 `get_window_state` 的截图看画面，按坐标点（自绘界面要在前台才点得准，先 `bring_to_front` 并跟员工说一声）。
- 剪辑本身（切、删、排轨道、字幕、配乐）走口播工具写草稿：更快，切点精确到帧。点界面只做草稿做不到的事：剪映在线素材和 AI 功能、打开草稿检查、播放、导出。
- 写某个草稿之前，这个草稿不能在剪映里开着，剪映保存时会覆盖外面的改动。
- 时间线上用快捷键比拖鼠标准：`cmd+b` 分割，`q` 删播放头左边，`w` 删播放头右边，`delete` 删选中，空格播放/暂停，左右方向键逐帧，`cmd+z` 撤销。快捷键以剪映菜单里显示的为准。
- 导出：右上角「导出」。先把导出设置读出来给员工看，员工确认后再点最后的导出。导出要等，隔一会儿看一次进度，不要一直点。
