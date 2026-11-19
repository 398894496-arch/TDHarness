---
name: company-desktop
description: Operating Windows desktop apps (Jianying and others) with the bundled Cua Driver.
whenToUse: 剪映, 桌面软件, 点界面, 导出, 打开软件, 窗口.
disable-model-invocation: true
---

# company-desktop（Windows）

Windows 客户端自带 Cua Driver（`cua-driver\`）。它在后台操作员工这台电脑上的桌面软件：不抢鼠标，也不把窗口拉到前台，员工可以同时干自己的活。网页仍然用 OpenCLI（见 `company-web`），命令仍然用自己的 shell。

## 1. 工具

只有一个工具 `mcp__cua__desktop`：`action` 填动作名，`args` 填这个动作的参数。参数说不清时，先调 `get_guide` 看官方说明（例如 `{"action":"get_guide","args":{"topic":"batching"}}`）。

- **找窗口**：`list_apps`、`list_windows` 拿到 `pid` 和 `window_id`。软件没开就用 `launch_app`。
- **看界面**：`get_window_state`（`pid`、`window_id`）同时给界面树和截图，每一行 `[N]` 用 `<snapshot_id>:N` 当 `element_token`。界面大时加 `query` 只看相关的行。再看一次时加 `since:"latest"`，只返回变化的部分。看局部细节用 `zoom`。
- **动作**：`click` / `double_click` / `right_click` / `type_text` / `set_value` / `press_key` / `hotkey` / `scroll` / `drag`。能用 `element_token` 就不要用坐标。坐标是 `get_window_state` 截图里的窗口内像素。
- **连做几步**：用 `run_steps`，`steps` 里每一步是 `{tool, args}`，最后加 `observe:{}`，一次调用就能做完并看到结果。
- **核对**：`verify_state`。出问题先跑 `health_report`。
- **窗口位置**：`bring_to_front`（会抢前台，先跟员工说一声）、`set_window_frame`。

网页、录屏、自动更新这些动作不提供。点不了管理员权限弹窗（UAC），也不输入密码。每次工具调用 60 秒上限，长操作拆成多步。

## 2. 每一步的规矩

1. 动作前先 `get_window_state` 看当前状态，动作后再看一次（或用 `run_steps` 加 `observe`），确认变了、变对了。
2. 点错了：`hotkey` 发 `ctrl+z` 撤回，再看一次。连续两次点不准就停下，告诉员工，不要乱试。
3. 会改文件或发出去的动作，先问员工，得到「可以」再做：导出、保存覆盖、删除、发送消息、提交表单。
4. 员工自己正在用的窗口，要切到前台之前先说一声。不要读和本任务无关的聊天窗口内容。
5. 需要登录的，请员工自己登。

## 3. 剪映专业版

- 剪映是自绘界面，界面树里只认得出整个窗口，认不出里面的按钮。用 `get_window_state` 的截图看画面，按坐标点（自绘界面要在前台才点得准，先 `bring_to_front` 并跟员工说一声）。
- 剪辑本身（切、删、排轨道、字幕、配乐）走 koubo 写草稿：更快，切点精确到帧，可以批量出多个版本。点界面只做草稿做不到的事：剪映在线素材和 AI 功能（智能包装、模板、特效、数字人）、打开草稿检查、播放、导出。
- koubo 写某个草稿之前，这个草稿不能在剪映里开着，剪映保存时会把外面的改动覆盖掉。先回到剪映首页，或者关掉这个草稿。
- 时间线上用快捷键比拖鼠标准：`ctrl+b` 分割，`q` 删播放头左边，`w` 删播放头右边，`delete` 删选中，空格播放/暂停，`left` / `right` 逐帧，`ctrl+z` 撤销。放播放头：先读时间尺刻度换算出像素位置，点时间尺，再看预览下方的时间码核对。
- 导出：右上角蓝色「导出」。先把导出设置（名称、位置、分辨率、帧率）读出来给员工看，员工确认后再点最后的导出。导出要等，隔一会儿看一次进度，不要一直点。
