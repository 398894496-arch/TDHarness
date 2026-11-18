"""company-shell 侧栏和首屏的站点品牌（幂等）。

品牌图只放在这台服务器上，不进仓库：D:\\dsh\\runtime\\brand\\（或环境变量 TDH_SITE_BRAND 指的目录）。
  wordmark.png  侧栏展开时的字标（横图，透明底；按遮罩画，颜色跟界面走）
  mark.png      侧栏收起和会话首屏的小标（方图，透明底）
  label.txt     品牌名（读屏用；没有字标时显示成文字）
有哪个就换哪个，一个都没有就什么都不改（保持仓库里的 TDH 图标和 TDHarness）。
"""
import base64
import os
import re
import struct
import sys
from pathlib import Path

DEFAULT_DIR = r"D:\dsh\runtime\brand"


def brand_dir():
    d = os.environ.get("TDH_SITE_BRAND") or DEFAULT_DIR
    p = Path(d)
    return p if p.is_dir() else None


def png_size(raw: bytes):
    if raw[:8] != b"\x89PNG\r\n\x1a\n" or raw[12:16] != b"IHDR":
        raise SystemExit("site-brand-not-png")
    return struct.unpack(">II", raw[16:24])


def _set(t: str, name: str, value: str) -> str:
    pat = re.compile(r"(\t\tconst " + name + r" = )(\"[^\"\n]*\"|[0-9.]+);")
    hits = pat.findall(t)
    if len(hits) != 1:
        raise SystemExit("anchor-%s count=%d" % (name, len(hits)))
    return pat.sub(lambda m: m.group(1) + value + ";", t, count=1)


def patch(t: str, d=None):
    d = d if d is not None else brand_dir()
    if d is None:
        return t, "no-site-brand"
    d = Path(d)
    before = t
    wm, mk, lb = d / "wordmark.png", d / "mark.png", d / "label.txt"
    if wm.is_file():
        raw = wm.read_bytes()
        w, h = png_size(raw)
        t = _set(t, "SITE_BRAND_WORDMARK", '"data:image/png;base64,' + base64.b64encode(raw).decode() + '"')
        t = _set(t, "SITE_BRAND_RATIO", ("%.4f" % (w / h)).rstrip("0").rstrip("."))
    if mk.is_file():
        raw = mk.read_bytes()
        png_size(raw)
        t = _set(t, "SITE_BRAND_MARK", '"data:image/png;base64,' + base64.b64encode(raw).decode() + '"')
    if lb.is_file():
        label = lb.read_text(encoding="utf-8").strip().splitlines()[0].strip() if lb.read_text(encoding="utf-8").strip() else ""
        if label:
            t = _set(t, "SITE_BRAND_LABEL", '"' + label.replace("\\", "").replace('"', "") + '"')
    return t, ("patched-site-brand" if t != before else "already")


if __name__ == "__main__":
    for a in sys.argv[1:]:
        p = Path(a)
        raw = p.read_text(encoding="utf-8")
        t, how = patch(raw)
        if how.startswith("patched"):
            p.write_text(t, encoding="utf-8")
        print(a, how)
