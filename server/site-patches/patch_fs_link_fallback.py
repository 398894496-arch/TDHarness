"""在不支持硬链接的盘上也能新建文件（company-fs-link-fallback-v1，幂等）。

内核的 dsh-fs-local 新建文件时，先在旁边写好临时文件，再用硬链接 link(临时, 目标) 发布：目标已存在就失败，
不会覆盖别人同时建的同名文件。Mac 挂公司盘用的 smbfs 不支持硬链接，link 报 ENOTSUP，于是 write 在公司盘上
新建文件一律失败（2026-11-19 TDH 自检：覆盖已有文件、在本机目录新建、用 shell 新建都正常）。

现在：硬链接这种盘不支持（ENOTSUP / EOPNOTSUPP / ENOSYS / EXDEV / EPERM）时，改用独占复制
copyFile(临时, 目标, COPYFILE_EXCL)：目标已存在同样失败，照旧报「先读再改」，不覆盖。只换发布这一步，
临时文件、权限和清理都不变。
"""
MARK = "company-fs-link-fallback-v1"
TARGET = "@deepseek-ai/dsh-fs-local/lib/index.js"

OLD = (
    "\t\tif (createIfAbsent !== void 0) try {\n"
    "\t\t\tawait linkFile(tempPath, absolutePath);\n"
    "\t\t} catch (error) {\n"
)
NEW = (
    "\t\tif (createIfAbsent !== void 0) try {\n"
    "\t\t\ttry {\n"
    "\t\t\t\tawait linkFile(tempPath, absolutePath);\n"
    "\t\t\t} catch (linkError) {\n"
    "\t\t\t\t// " + MARK + ": a share without hard links (smbfs on a Mac) still gets a no-replace create.\n"
    "\t\t\t\tconst companyCode = linkError && linkError.code;\n"
    "\t\t\t\tif (![\"ENOTSUP\", \"EOPNOTSUPP\", \"ENOSYS\", \"EXDEV\", \"EPERM\"].includes(companyCode)) throw linkError;\n"
    "\t\t\t\tconst { copyFile: companyCopyFile, constants: companyFsConstants } = await import(\"node:fs\").then((m) => ({ copyFile: m.promises.copyFile, constants: m.constants }));\n"
    "\t\t\t\tawait companyCopyFile(tempPath, absolutePath, companyFsConstants.COPYFILE_EXCL);\n"
    "\t\t\t}\n"
    "\t\t} catch (error) {\n"
)


def patch(t: str):
    if MARK in t:
        return t, "already"
    if t.count(OLD) != 1:
        raise SystemExit("fs-link-anchor-missing count=%d" % t.count(OLD))
    return t.replace(OLD, NEW, 1), "patched"
