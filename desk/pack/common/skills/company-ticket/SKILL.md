---
name: company-ticket
description: Company task cards on the shared disk.
whenToUse: 上传下达, 任务卡, 做完了, 验收.
disable-model-invocation: true
---

# company-ticket

任务卡的文件落在公司盘，不落 `DSH_HOME`，界面不写盘。格子读 `/company/mailbox`。对话里的「做完了」不是验收。

## 谁能下达

| 角色 | 能 issue 给谁 |
|---|---|
| 老板 | 任意员工 |
| 总监 | 本部门员工 |
| 员工 | **只能给自己**（自己给自己开一张待提交） |

员工不能给别人下达。员工侧栏「+」就是给自己 issue。employee can issue only to self.

## 路径（ASCII）

根：共享盘根（Win `\\<站点>\dsh-company`，Mac `$HOME/company`；服务器上是 `D:/dsh/company`）。本机探针树禁止。

- 任务文件夹：负责人个人文件夹下 `tasks/<ticket-id>/`（卡上「任务文件夹」给的就是这台电脑能打开的路径）。产出存进去就自动列为交付物。
- 上传：卡上「添加文件」存在 `_control/tickets/<ticket-id>/`，只能经卡读。
- 卡本身在服务器 `runtime/tickets.json`，员工桌上看不到这个文件，只经 `task_card` 工具和侧栏读写。

## 员工桌上怎么用

用 `task_card` 工具，不要 curl / POST 8443，不要跑仓库工单脚本。

- `get` / `list`：读卡。`update`：写汇报草稿（下达人可改任务内容）。`attach`：挂已有文件。
- `issue`：用户**明确说要给谁派活**时才用（「让小王周五前把报价发给客户」），带 `to`、`title`、`assignment`、`due`，下达后把谁、做什么、哪天截止复述给用户。员工只能给自己开卡，服务器会拒。
- `comment`：留言，不改变状态；来回沟通写这里，不要改任务内容。`due`：下达人改或清除截止日期。
- 改派、作废在卡上「跟进」里由下达人点；提交验收、审批只能由人在卡上点。

## 验收

- 绿/红只听控制面 `submit` 之后的状态（待审批 / 已通过 / 未通过）。
- 界面「提交验收」才会改 board。
- 不要把完成权写进对话。用户或模型说「做完了」而不点提交、不跑 submit，格子仍是待提交。

## 禁区

- 不要把别人部门的绝对路径当工作区。
- 不要改 `_control`、`_skills`、别人的 `emp-*`。
