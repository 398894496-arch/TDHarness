---
name: company-access
description: Split company shared memory and personal memory from shared skills and personal skills. Use when choosing a knowledge door, writing a skill, or deciding who can read what.
whenToUse: 权限, 共享 skill, 谁能看.
disable-model-invocation: true
---

# company-access

四格，不要混。TDHarness 里的记忆都在公司盘，按路径收口。

| 层 | 谁写 | 谁读 | 落点 | 门 |
|---|---|---|---|---|
| 共享记忆 | 全员经 `company_memory_write`（服务器写入） | 全员 | `_shared/_memory` + brain 查阅层 | 读 `company_knowledge`；官方 `write` / `edit` 打共享区会被拒 |
| 公司知识库 | 经 `company_kb_save`（服务器写入），或人在公司盘里直接放 | 按区，见下 | `_handbook/` | 读 `company_knowledge`，存 `company_kb_save` |
| 个人记忆 | 该员工自己的会话 | 只有这把椅子 | `$personal/_memory`（01–05 + 90） | `company_knowledge` `route=search` |
| 共享 skill | 产品底座 / 老板桌种到 `_skills` | 全员只读 | 共享盘根 `_skills` | 打开即用。do not call skill |
| 个人 skill | 该员工在自己工作区写 | 只有这人的工作区 | `$personal/.dsh/skills` | 不要写进 `_skills` |


## 公司知识库（company-kb-groups-v1）

| 区 | 谁能看、能放 | 放什么 |
|---|---|---|
| `_handbook/_company` 全公司共享知识 | 全员 | 公司介绍、产品与技术、销售流程与政策、生产与质量、制度与流程、模板、常见问答 |
| `_handbook/_<名字>` 几个部门共用的区（如销售与行政财务） | 只有这些部门和管理员 | 客户信息、底价与成本 |
| `_handbook/<部门>` 单独分区的部门（行政财务） | 只有本部门和管理员 | 财务制度、合同法务、人事薪酬、账户税务、行政事务 |

客户信息、底价、成本不进全公司共享，也不进共享记忆。别的区搜不到、打不开是权限，不是没有。

## 共享记忆

- 身份是桌子上的登录令牌。用 `company_knowledge`，不要 curl，不要自己报账号。
- `route`：只要 `search`。`status` 只在不知道这把椅子时用一次。不要再分 `memory` / `handbook` / `correction`。
- 别的部门 handbook / L2 被拒是正确结果。
- 共享区全员可搜。部门 L2 仍按部门，不是共享区。

## 个人记忆

- 每人一套，分层和共享区一样：项目 / 方法 / 证据 / 复盘 / 流水 / 纠错。
- 写在自己的 `$personal/_memory`。老板是 `_office/_memory`。
- session 日志**不上传**。正本在 `$personal/.dsh-desk`（和人的工作区同一块盘）。日更在 Win 上直接读这份蒸 L1。那是流水，不是个人方法页。
- 这台员工桌没有 `memory` / `memory_recall`。短记忆就是盘上的 `_memory`，用 `company_knowledge` 读。

## 共享 skill

- 只读。改法：改仓库 `scripts/p-exec-base/company/skills/`，办公 Win 跑 `win-skills-refresh.ps1`。
- 员工机对共享盘 `_skills` 写会被拒。

## 个人 skill

- 写在自己的工作区。目录 ASCII。
- 不要把个人 skill 拷进 `_skills` 给全员。
