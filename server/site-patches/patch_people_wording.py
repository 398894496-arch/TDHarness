"""人员页和账号页（幂等）：
1) 「吊销令牌」改名「强制重新登录」，确认条写清账号和密码都不变；要让人彻底用不了是「停用」。
   老板实测把「吊销令牌」当成了删除。
2) 登录名上限 16 位：个人共享盘账号是 smb-<登录名>，Windows 用户名最长 20。
3) 账号页自己改密码：2026.11.19.11 起写在 company-shell 源码里（company-self-password-v1），
   这里只补一句老服务器的提示。
"""
import sys
from pathlib import Path

MARK = "@@people-wording-v1"

PAIRS = [
    ("btn",
     'seed ? null : btn("吊销令牌", {',
     'seed ? null : btn("强制重新登录", {'),
    ("ask",
     'text = p.login + " 当前的模型令牌立刻失效，下次登录会领新的。";',
     'text = p.login + " 要重新输入账号密码才能继续用，账号和密码都不变。要让他彻底用不了，请用「停用」。";'),
    ("go",
     'go = "确定吊销";',
     'go = "确定";'),
    ("ok",
     'okNote = "已吊销 " + p.login + " 的网关令牌";',
     'okNote = p.login + " 下次操作时要重新登录";'),
    ("foot",
     '种子管理员不能停用或降权，但可以吊销令牌。',
     '种子管理员不能停用、删除或降权，但可以强制重新登录。'),
    ("login",
     '登录名只能用小写字母、数字和 . _ -，2 到 32 位',
     '登录名只能用小写字母、数字和 . _ -，2 到 16 位'),
    ("err",
     '\t\t\tif (s.indexOf("password-same") >= 0) return "新密码和旧密码一样，换一个";\n',
     '\t\t\tif (s.indexOf("password-same") >= 0) return "新密码和旧密码一样，换一个";\n'
     '\t\t\t// ' + MARK + '\n'
     '\t\t\tif (s.indexOf("self-not-supported") >= 0) return "这台服务器还不支持在这里改，请找管理员";\n'),
]


def once(t, old, new, what):
    if t.count(old) != 1:
        raise SystemExit("anchor-people-wording-%s count=%d" % (what, t.count(old)))
    return t.replace(old, new, 1)


def patch(t: str) -> tuple[str, str]:
    if MARK in t:
        return t, "already"
    for what, old, new in PAIRS:
        t = once(t, old, new, what)
    return t, "patched-people-wording"


if __name__ == "__main__":
    for a in sys.argv[1:]:
        p = Path(a)
        raw = p.read_text(encoding="utf-8"); crlf = "\r\n" in raw
        t, how = patch(raw.replace("\r\n", "\n"))
        if how.startswith("patched"):
            p.write_text(t.replace("\n", "\r\n") if crlf else t, encoding="utf-8")
        print(a, how)
