---
name: company-knowledge
description: One company_knowledge lookup. route=search. On not-found, web_search once.
whenToUse: 查公司, 手册.
disable-model-invocation: true
---

# company-knowledge

不要读个人 vault，不要对 `D:/dsh/brain` 或别人部门全库 `rg`。不要再写一个检索 skill。

用模型工具 **`company_knowledge`**。桌子会带上登录令牌。不要 `curl` 8443，不要自己报账号，不要 `--account`。

**一问一搜。** 默认只调一次：

```
company_knowledge  route=search  query=<窄词>
```

`search` 已经含查阅层、手册、纠错、个人 `_memory`、共享 `_memory`。不要再并行打 `memory` / `experience` / `handbook` / `correction`。`status` 只在不知道这把椅子时用一次，收据有身份就停。

地图命中只看那一条 how，闭合就停，不要倒库。`not-found` 就 `web_search` 同一批名字一次。不要换 route，不要 bash 扫盘，不要一上来开天眼查。收据点名了 L0/L1 路径才 `evidence=true` 并带 `path`，而且只一次。公开 GitHub / npm / Remotion 这类不是公司事实：不要调本工具，直接 `web_search`。

权限划分见 `company-access`。怎么写入见 `company-memory`。写入走 `company_memory_write`，不要官方 `write` 打 `_shared`。

## 公司知识库在哪（company-kb-groups-v1）

公司盘 `_handbook/` 下分区，每个文件夹里的 `说明.md` 写着这里放什么、不放什么：

- `_handbook/_company/`：全公司共享知识，所有人能看、能放、能改。
- `_handbook/_<名字>/`：几个部门共用的区，例如「销售与行政财务」（客户信息、底价、成本），只有这些部门和管理员打得开、搜得到。
- `_handbook/<部门>/`：单独分区的部门（行政财务）自己的私密知识，只有本部门和管理员。

用户问「这个文件放哪」，按对应的 `说明.md` 告诉他放进哪个文件夹：Windows 是 `\\{{TDH_HOST}}\dsh-company\_handbook\...`，Mac 是 `~/company/_handbook/...`。客户信息、底价、成本不要放进 `_company`。

用户要你把文件或一段内容**存进知识库**，用 **`company_kb_save`**（company-kb-save-v1，服务器写入，不要用 `write` 往 `_handbook` 写）：

```
company_kb_save  zone=company|customers|private  folder=<分类文件夹，如 03 销售流程与政策>  path=<本机文件的绝对路径>  （或 content=<文字> name=<文件名.md>）
```

- 先按内容判断区：客户信息、底价、成本 → `customers`；财务制度、合同、人事薪酬、账户税务、行政证照 → `private`；其他公司通用的 → `company`。拿不准就问用户。
- `folder` 写错会返回可选的文件夹列表，照列表选一个再存。
- 同名文件默认不覆盖（返回 `exists`）；先问用户，同意了再加 `overwrite=true`（旧版会留在服务器上）。
- 存好后告诉用户放在哪个区、哪个文件夹。

## 规则

1. 别人的 `$personal/_memory` 搜不到，是权限，不是空。
2. `_shared/_memory` 全员可搜。
3. 别部门手册或经验被拒是正确结果。
4. 默认只查查阅层。全量 L0 是证据层，不默认打开。
5. 收据能闭合就停，不要倒库，不要再换 route。
6. 上传下达的文件在公司盘 inbox / projects，不在 `_memory`。
