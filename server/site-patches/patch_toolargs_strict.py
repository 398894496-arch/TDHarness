"""工具参数结束时严格解析（company-toolargs-strict-v1，幂等）。

内核 @earendil-works/pi-ai 的 openai-completions 适配器，在一个工具调用流完时用 parseStreamingJson
定参数。这个函数会退到「补全没写完的 JSON」，再不行就给空对象 {}。回答在工具调用中途被截断（输出到
上限、连接断了）时，工具就带着半截参数执行了：写文件只写进去一半，命令少了后半段。

现在：参数能被严格解析，或者只修字符串里的不规范写法（裸换行、错误转义，parseJsonWithRepair 做的
事）就能解析，照常执行；只能靠补全才解析得出来，就说明参数被截断了，这一轮按出错结束，报错里写明
是哪个工具，什么都不执行。参数为空照旧是 {}（有的工具没有参数）。
"""
MARK = "company-toolargs-strict-v1"

IMPORT_OLD = 'import { parseStreamingJson } from "../utils/json-parse.js";\n'
IMPORT_NEW = 'import { parseStreamingJson, parseJsonWithRepair } from "../utils/json-parse.js";\n'

FINAL_OLD = (
    "                    else {\n"
    "                        block.arguments = parseStreamingJson(block.partialArgs);\n"
    "                    }\n"
    "                    // Finalize in-place and strip the scratch buffers so replay only\n"
)
FINAL_NEW = (
    "                    else {\n"
    "                        // " + MARK + ": complete JSON only. A call cut off mid-arguments is not run.\n"
    "                        const companyRaw = block.partialArgs ?? \"\";\n"
    "                        let companyArgs;\n"
    "                        try {\n"
    "                            companyArgs = companyRaw.trim() === \"\" ? {} : parseJsonWithRepair(companyRaw);\n"
    "                        }\n"
    "                        catch {\n"
    "                            companyArgs = undefined;\n"
    "                        }\n"
    "                        if (companyArgs === null || typeof companyArgs !== \"object\" || Array.isArray(companyArgs)) {\n"
    "                            block.arguments = parseStreamingJson(block.partialArgs);\n"
    "                            block.companyArgsCut = true;\n"
    "                        }\n"
    "                        else {\n"
    "                            block.arguments = companyArgs;\n"
    "                        }\n"
    "                    }\n"
    "                    // Finalize in-place and strip the scratch buffers so replay only\n"
)

DONE_OLD = (
    "            if ((compat.supportsFinishReason && !hasFinishReason) || output.stopReason === \"pending\") {\n"
    "                throw new Error(\"Stream ended without finish_reason\");\n"
    "            }\n"
    "            stream.push({ type: \"done\", reason: output.stopReason, message: output });\n"
)
DONE_NEW = (
    "            if ((compat.supportsFinishReason && !hasFinishReason) || output.stopReason === \"pending\") {\n"
    "                throw new Error(\"Stream ended without finish_reason\");\n"
    "            }\n"
    "            // " + MARK + ": a tool call whose arguments were cut off ends the turn as an error.\n"
    "            const companyCut = output.content.filter((b) => b.type === \"toolCall\" && b.companyArgsCut);\n"
    "            for (const b of output.content) delete b.companyArgsCut;\n"
    "            if (companyCut.length) {\n"
    "                throw new Error(\"Tool call arguments were cut off before they were complete (\" + companyCut.map((b) => b.name || \"tool\").join(\", \") + \"; stop reason \" + output.stopReason + \"). Nothing was run. Ask again, or split the work into smaller calls.\");\n"
    "            }\n"
    "            stream.push({ type: \"done\", reason: output.stopReason, message: output });\n"
)

TARGET = "@earendil-works/pi-ai/dist/api/openai-completions.js"


def patch(t: str):
    if MARK in t:
        return t, "already"
    for old in (IMPORT_OLD, FINAL_OLD, DONE_OLD):
        if t.count(old) != 1:
            raise SystemExit("toolargs-anchor-missing:" + old.strip().splitlines()[0][:60])
    t = t.replace(IMPORT_OLD, IMPORT_NEW, 1).replace(FINAL_OLD, FINAL_NEW, 1).replace(DONE_OLD, DONE_NEW, 1)
    return t, "patched"
