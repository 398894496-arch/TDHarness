#!/usr/bin/env python3
"""Proof for server/site-patches/patch_site_brand.py: a site's brand images on the server
(runtime\\brand) go into that site's desk pack, the repository keeps the TDH mark, and a site
without the folder is left as it is. Prints SITE_BRAND_PROVE_OK=1."""
import importlib.util
import re
import struct
import sys
import tempfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLIENT = ROOT / "desk" / "plugins" / "company-shell" / "lib" / "client.js"


def fail(why):
    print("SITE_BRAND_PROVE_FAIL=" + why)
    sys.exit(1)


def png(w, h):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    rows = b"".join(b"\x00" + b"\x00\x00\x00\xff" * w for _ in range(h))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


def value(t, name):
    m = re.search(r"\t\tconst " + name + r" = (\"[^\"\n]*\"|[0-9.]+);", t)
    return m.group(1) if m else None


spec = importlib.util.spec_from_file_location("b", ROOT / "server" / "site-patches" / "patch_site_brand.py")
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
src = CLIENT.read_text(encoding="utf-8")

# The repository: the TDH mark, no wordmark, the product name.
if not (value(src, "SITE_BRAND_MARK") or "").startswith('"data:image/png;base64,'):
    fail("repo-has-no-tdh-mark")
if value(src, "SITE_BRAND_WORDMARK") != '""' or value(src, "SITE_BRAND_LABEL") != '"TDHarness"':
    fail("repo-carries-a-site-brand")

with tempfile.TemporaryDirectory() as d:
    t, how = b.patch(src, Path(d) / "missing")
    if t != src:
        fail("no-folder-changed-the-file")
    t, how = b.patch(src, None) if b.brand_dir() is None else (src, "skip")
    if t != src:
        fail("no-folder-default-changed-the-file")
    bd = Path(d) / "brand"
    bd.mkdir()
    (bd / "wordmark.png").write_bytes(png(60, 9))
    (bd / "mark.png").write_bytes(png(9, 9))
    (bd / "label.txt").write_text("Some Studio\n", encoding="utf-8")
    t, how = b.patch(src, bd)
    if how != "patched-site-brand":
        fail("not-patched " + how)
    if not value(t, "SITE_BRAND_WORDMARK").startswith('"data:image/png;base64,'):
        fail("wordmark")
    if value(t, "SITE_BRAND_RATIO") != "6.6667":
        fail("ratio " + str(value(t, "SITE_BRAND_RATIO")))
    if value(t, "SITE_BRAND_MARK") == value(src, "SITE_BRAND_MARK"):
        fail("mark-unchanged")
    if value(t, "SITE_BRAND_LABEL") != '"Some Studio"':
        fail("label")
    t2, how2 = b.patch(t, bd)
    if t2 != t or how2 != "already":
        fail("not-idempotent " + how2)
    if value(src, "SITE_BRAND_COLOR") != "0" or value(t, "SITE_BRAND_COLOR") != "0":
        fail("colour-on-without-the-file")
    (bd / "color").write_text("", encoding="utf-8")       # a coloured logo: drawn as it is, not as a mask
    tc, _ = b.patch(src, bd)
    if value(tc, "SITE_BRAND_COLOR") != "1":
        fail("colour-file-ignored")
    (bd / "color").unlink()
    # Only the mark: the wordmark stays empty, so the wide sidebar shows mark + name.
    (bd / "wordmark.png").unlink()
    t3, _ = b.patch(src, bd)
    if value(t3, "SITE_BRAND_WORDMARK") != '""':
        fail("mark-only-set-a-wordmark")
    (bd / "mark.png").write_bytes(b"not a png")
    try:
        b.patch(src, bd)
        fail("accepted-a-non-png")
    except SystemExit as e:
        if "site-brand-not-png" not in str(e):
            raise

print("SITE_BRAND_PROVE_OK=1")
