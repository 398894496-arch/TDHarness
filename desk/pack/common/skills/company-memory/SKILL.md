---
name: company-memory
description: Write company-disk memory. Load only when writing.
whenToUse: 记住, 写入记忆.
---

# company-memory

TDHarness 的永久记忆在公司盘上，不在本机 `memory`，也不在任何人自己电脑上的笔记软件里。

**不分个人和团队，全公司一个共享记忆**（company-memory-shared-v1）。谁让你「记住」，都写进共享记忆，全员的搜索都能找到。只有一个例外：行政财务这类单独分区的部门，写进它自己部门的记忆，别的部门看不到。分到哪里由服务器按账号决定，你不用选。

| 区 | 位置 | 谁写 | 谁搜 |
|---|---|---|---|
| 共享记忆 | 公司盘 `_shared/_memory/` | 全员（经服务器写入） | 全员 |
| 单独分区部门的记忆 | `_handbook/<部门>/_memory/` | 该部门的人（经服务器写入） | 只有该部门 |
| 以前的个人记忆 | `$personal/_memory/` | 不再写 | 只有本人还能搜到 |

每天夜里服务器还会把当天的对话蒸馏成经验，写进同一个共享记忆（单独分区的部门进它自己的）。

不要读别人的目录。不要对 `_memory` 做 `ls` / `rg`。检索走 `company_knowledge`。

## 分层

- `01-projects` 正在推进
- `02-methods` 验证过、下次还能用
- `03-evidence` 原文和证据
- `04-reviews` 做完了怎么评价
- `05-logs` 当天发生了什么（不自动等于结果）
- `90-system/corrections.md` 纠错；最新的压过旧的

高可信才能当行动依据。没来源、新闻、猜测，先核再写。

## 开场

查公司事实用 `company-knowledge`，不要为本技能再搜一遍。写入才加载本包。收据能闭合就停。不要 curl 8443，不要自己报账号。

查找用 `route=search`（共享记忆、本部门记忆、以前的个人记忆和查阅层都在里面）。

## 写入

用户确认、纠错、或验收过的做法，马上写入，不要等夜里的蒸馏。不要用官方 `write` 写记忆。

用宿主工具 **`company_memory_write`**（服务器写入，不用选区）：

```
company_memory_write  layer=01-projects|02-methods|03-evidence|04-reviews|05-logs|90-system  name=<ascii-slug>  content=<markdown>  mode=replace|append
```

- 方法 → `02-methods/<ascii-slug>`
- 证据 → `03-evidence`
- 当天流水 → `05-logs/<yyyy-mm-dd>`，`mode=append`
- 纠错 → `90-system` + `name=corrections`，`mode=append`

写之前先 `company_knowledge route=search` 看有没有同一件事的页：有就在那一页上改（`replace` 整页重写）或追加，不要另起一页。正文写清适用条件和限制、来源（谁、哪次对话、什么文件）。工具会补 `title` `status` `source_ref` `author` `verified_at`。

全公司都会读到你写的：只写以后别人也用得上的做法、事实和纠错，不写个人隐私、密码、客户的私密信息。

**客户信息、底价、成本不进共享记忆**（company-kb-groups-v1）。用户是销售部或行政财务部的人，要你记住客户资料、具体客户的报价、底价、成本、毛利、折扣权限，就加 `zone=customers`：服务器写进「销售与行政财务」区，只有这两个部门和管理员搜得到。别的部门的人要记这类东西，服务器会拒绝（`not-in-zone`），告诉他交给销售或行政财务。工资、合同、税务这类行政财务的事，行政财务的人照常写（默认就进本部门）。

## 不要做

- 不要把记忆写进 `_skills`、handbook 正文、别人的目录（记忆只走 `company_memory_write`）
- 不要找本机 `memory` / `memory_recall`（这台桌没有）。不要把 `.dsh-desk` 对话当永久记忆
- 不要把谁本机的笔记库当员工记忆
- 不要一次总结就写成全公司真理
