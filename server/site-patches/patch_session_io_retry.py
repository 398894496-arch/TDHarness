"""对话记录写共享盘时，连接暂断不再让这一轮失败（company-session-io-retry-v1，幂等）。

内核的 dsh-session-persistence-jsonl 每追加一批事件就打开对话记录文件、写入、落盘；失败就截回原长度再报错。
对话记录在公司共享盘上：共享盘断一下（Mac 重连 Wi-Fi、SMB 重连），写入报 EIO，截回也报 EIO，这一轮就停了，
界面上是「failed to roll back append ... EIO」（2026-11-19，田总的 Mac：16:07:23 SMB 重连，旧文件句柄没接上）。

现在：遇到连接类的读写错误（EIO、ETIMEDOUT、ENOTCONN 等），每 5 秒重试一次、最多一分钟：先把文件截回这一批之前的
长度（没写进去就不动），再重新打开、整批写入。别的错误、或一分钟还没恢复，照旧截回并报错。
"""
MARK = "company-session-io-retry-v1"
TARGET = "@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js"

OLD = '\tasync appendLines(meta, events) {\n\t\tconst content = await this.encodeEventBatch(events);\n\t\tconst path = logPath(this.root, meta.cwd, meta.id, this.compression);\n\t\tconst handle = await open(path, "a");\n\t\tlet closed = false;\n\t\tconst closeAppendHandle = async () => {\n\t\t\tif (closed) return;\n\t\t\tclosed = true;\n\t\t\tawait handle.close();\n\t\t};\n\t\ttry {\n\t\t\tconst { size: before } = await handle.stat();\n\t\t\ttry {\n\t\t\t\tawait handle.writeFile(content);\n\t\t\t\tawait handle.sync();\n\t\t\t} catch (error) {\n\t\t\t\ttry {\n\t\t\t\t\tawait closeAppendHandle();\n\t\t\t\t\tawait this.rollbackAppend(path, before);\n\t\t\t\t} catch (rollbackError) {\n\t\t\t\t\tthrow new AggregateError([error, rollbackError], `failed to roll back append to "${path}"`);\n\t\t\t\t}\n\t\t\t\tthrow error;\n\t\t\t}\n\t\t} finally {\n\t\t\tawait closeAppendHandle();\n\t\t}\n\t}\n'
NEW = '\tasync appendLines(meta, events) {\n\t\tconst content = await this.encodeEventBatch(events);\n\t\tconst path = logPath(this.root, meta.cwd, meta.id, this.compression);\n\t\t// company-session-io-retry-v1: the log lives on the company share. When the share drops for a moment\n\t\t// (a Mac re-joining Wi-Fi, an SMB reconnect), writing fails with EIO and so does the rollback, and the\n\t\t// whole turn ended (2026-11-19, TDH). A transient I/O error now waits for the share: every 5 s, for up\n\t\t// to a minute, the log is cut back to its size before this batch and the batch written again.\n\t\tconst companyOpen = this.companyOpenForTest || open;\n\t\tconst companyTransient = (e) => {\n\t\t\tconst all = e && Array.isArray(e.errors) ? e.errors : [e];\n\t\t\treturn all.length > 0 && all.every((x) => x && ["EIO", "ETIMEDOUT", "ENOTCONN", "ECONNRESET", "ESTALE", "EBADF", "EHOSTDOWN", "EHOSTUNREACH", "ENETDOWN", "ENETUNREACH", "EAGAIN", "ENXIO"].includes(x.code));\n\t\t};\n\t\tlet before = -1;\n\t\tfor (let attempt = 1;; attempt++) {\n\t\t\tlet handle;\n\t\t\ttry {\n\t\t\t\tif (before >= 0) await this.companyCutBack(companyOpen, path, before);\n\t\t\t\thandle = await companyOpen(path, "a");\n\t\t\t\tconst { size } = await handle.stat();\n\t\t\t\tif (before < 0) before = size;\n\t\t\t\tawait handle.writeFile(content);\n\t\t\t\tawait handle.sync();\n\t\t\t\tawait handle.close();\n\t\t\t\thandle = void 0;\n\t\t\t\treturn;\n\t\t\t} catch (error) {\n\t\t\t\tif (handle) try {\n\t\t\t\t\tawait handle.close();\n\t\t\t\t} catch {}\n\t\t\t\tif (companyTransient(error) && attempt < 13) {\n\t\t\t\t\tawait new Promise((resolve) => setTimeout(resolve, this.companyRetryMs ?? 5e3));\n\t\t\t\t\tcontinue;\n\t\t\t\t}\n\t\t\t\tif (before < 0) throw error;\n\t\t\t\ttry {\n\t\t\t\t\tawait this.companyCutBack(companyOpen, path, before);\n\t\t\t\t} catch (rollbackError) {\n\t\t\t\t\tthrow new AggregateError([error, rollbackError], `failed to roll back append to "${path}"`);\n\t\t\t\t}\n\t\t\t\tthrow error;\n\t\t\t}\n\t\t}\n\t}\n\tasync companyCutBack(openFn, path, size) {\n\t\tconst handle = await openFn(path, "r+");\n\t\ttry {\n\t\t\tif ((await handle.stat()).size !== size) {\n\t\t\t\tawait handle.truncate(size);\n\t\t\t\tawait handle.sync();\n\t\t\t}\n\t\t} finally {\n\t\t\tawait handle.close();\n\t\t}\n\t}\n'


def patch(t: str):
    if MARK in t:
        return t, "already"
    if t.count(OLD) != 1:
        raise SystemExit("session-io-anchor-missing count=%d" % t.count(OLD))
    return t.replace(OLD, NEW, 1), "patched"
