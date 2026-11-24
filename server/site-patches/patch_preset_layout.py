"""会话预设读公司技能缓存、说明文件只找到公司盘为止（company-preset-patch-layout-v1，幂等）。

内核 0.1.7 起，会话预设是 dsh-web-app/presets/<名>.patch.yml 里的一行，并把 profile 层的
skill-filesystem / agent-instructions 关掉；桌面 overlay 改的还是 profile 层那两行，所以会话里：
- 技能目录只列 ~/.agents/skills 等默认位置，没有任何 company-* 技能，`skill company-mail` 报
  「unknown or no longer available」，模型转去公司盘上 `glob **/company-mail/SKILL.md`，30 秒超时
  （2026-11-24，Mac 桌面，session-098b9187）；每次调 skill 还会从公司盘 cwd 往上找 .agents/skills；
- 说明文件没有 .company-root 边界，从公司盘一直找到 $HOME/AGENTS.md、CLAUDE.md。
这里改预设自己的两行：技能只读本机公司技能缓存（主目录/.dsh-company-rc8/skills，start.command、
start.ps1、AppHost 都建在这里，用 !!js 现算，不需要启动器改内核里的占位符）；说明文件找到 .company-root 为止。
与 patches/lib/preset-patch-layout.js 同一套改法（打包时用那个，成品包用这个）。
"""
import re

MARK = "company-preset-patch-layout-v1"
TARGETS = (
    "@deepseek-ai/dsh-web-app/presets/standard.patch.yml",
    "@deepseek-ai/dsh-web-app/presets/ptc.patch.yml",
)
SKILLS_DIR_JS = (
    "!!js process.getBuiltinModule('node:path').join("
    "process.getBuiltinModule('node:os').homedir(), '.dsh-company-rc8', 'skills')"
)

SKILL_RE = re.compile(
    r"^( +)- id: skill-filesystem\n\1  name: '@deepseek-ai/dsh-skill-filesystem'\n(?!\1  config:)",
    re.M,
)
INSTR_RE = re.compile(
    r"^( +)- id: agent-instructions\n\1  name: '@deepseek-ai/dsh-agent-instructions'\n"
    r"\1  config:\n\1    maxBytes: 65536\n(?!\1    projectRootMarkers:)",
    re.M,
)


def is_target(rel: str) -> bool:
    return rel.replace("\\", "/").endswith(TARGETS)


def patch(t: str):
    if MARK in t:
        return t, "already"
    n_skill = len(SKILL_RE.findall(t))
    n_instr = len(INSTR_RE.findall(t))
    if n_skill != 1:
        raise SystemExit("preset-layout-skill-anchor count=%d" % n_skill)
    if n_instr != 1:
        raise SystemExit("preset-layout-instr-anchor count=%d" % n_instr)

    def skill(m):
        ind = m.group(1)
        return (
            m.group(0)
            + ind + "  config:\n"
            + ind + "    includeDefaultRoots: false\n"
            + ind + "    watch: false\n"
            + ind + "    customSkillDirs:\n"
            + ind + "      - " + SKILLS_DIR_JS + "\n"
        )

    def instr(m):
        ind = m.group(1)
        return m.group(0) + ind + "    projectRootMarkers:\n" + ind + "      - .company-root\n"

    t = SKILL_RE.sub(skill, t, count=1)
    t = INSTR_RE.sub(instr, t, count=1)
    t = t.rstrip() + "\n# --- " + MARK + " ---\n"
    return t, "patched"
