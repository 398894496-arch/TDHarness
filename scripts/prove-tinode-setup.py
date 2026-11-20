#!/usr/bin/env python3
"""Proof for server/chat/tinode-setup.py's page fixes (company-chat-tinode-v1, v2), on stand-ins of Tinode's own files.

- index.html: CDN libraries and fonts come from static/vendor; the two scripts are asked for under this revision's URL
  (a browser that kept a broken copy fetches them again); a second run changes nothing.
- TDH's look (company-chat-look-v1): tdh-chat.css right after Tinode's own sheet, once.
- umd/index.prod.js: the chunks (language, views) load from "umd/" beside the page, not "/umd/" at the site's root,
  where under /chat/ they 404 and the page stays blank (11-20); a second run changes nothing; a release that moved
  the public path stops setup instead of passing silently.
- TDH's own chat page (company-chat-client-v1) into static/tdh/ with the web key read from Tinode's page.
- company-chat-home-v1: /chat/ is TDH's page, Tinode's kept as tinode.html; "tinode" puts it back; idempotent.
Prints TINODE_SETUP_PROVE_OK=1.
"""
import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("tinode_setup", HERE.parent / "server" / "chat" / "tinode-setup.py")
ts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ts)

HTML = """<!DOCTYPE html><html><head>
<link rel="stylesheet" href="css/base.min.css" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Roboto:300,400,400i,500,700,700i" />
<link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons" />
<script crossorigin="anonymous" src="https://polyfill-fastly.io/v3/polyfill.min.js?features=Intl.Segmenter"></script>
<script crossorigin="anonymous" src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js"></script>
<script crossorigin="anonymous" src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
<script crossorigin="anonymous" src="https://cdn.jsdelivr.net/npm/react-intl@7.1.6/react-intl.iife.min.js"></script>
<script crossorigin="anonymous" src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
</head><body><script src="umd/tinode.prod.js"></script>
<script src="umd/index.prod.js"></script></body></html>"""
JS = 'o.u=function(e){return e+".prod.js"},o.p="/umd/",function(){var e={57:0};'


def check(cond, what):
    if not cond:
        raise SystemExit("TINODE_SETUP_PROVE_FAIL " + what)


# The revision as main() sets it ("tdh-" and hex, 11-20: a second run under it found no script before this check).
ts.SCRIPT_REV = ts.content_rev(HERE.parent / "server" / "chat")
check(ts.SCRIPT_REV.startswith("tdh-"), "a content revision: " + ts.SCRIPT_REV)
h = ts.look(ts.bust(ts.page(HTML)))
check("cdn.jsdelivr" not in h and "fonts.googleapis" not in h and "polyfill" not in h, "no CDN left: " + h)
check('src="umd/index.prod.js?v=%s"' % ts.SCRIPT_REV in h and 'src="umd/tinode.prod.js?v=%s"' % ts.SCRIPT_REV in h, "scripts under this revision's URL")
check(ts.look(ts.bust(ts.page(h))) == h, "index.html: a second run changes nothing")
# A page left by an earlier revision (the old fixed one, or another content one) takes the new one.
for old in ("tdh4", "tdh-0123456789"):
    keep = ts.SCRIPT_REV
    ts.SCRIPT_REV = old
    prev = ts.look(ts.bust(ts.page(HTML)))
    ts.SCRIPT_REV = keep
    check(ts.look(ts.bust(ts.page(prev))) == h, "index.html from revision %s takes this one" % old)
check(h.count('href="tdh-chat.css?v=%s"' % ts.SCRIPT_REV) == 1 and h.index("css/base.min.css") < h.index("tdh-chat.css"), "TDH's sheet once, after Tinode's own")
check((Path(__file__).resolve().parent.parent / "server" / "chat" / "tdh-chat.css").read_text(encoding="utf-8").count("company-chat-look-v1") == 1, "the sheet is in the repository")
j = ts.bundle(JS)
check('.p="umd/"' in j and '.p="/umd/"' not in j, "chunks from umd/ beside the page: " + j)
check(ts.bundle(j) == j, "the bundle: a second run changes nothing")
try:
    ts.bundle('o.p="/static/js/",')
    check(False, "a moved public path stops setup")
except SystemExit as e:
    check("anchor-public-path" in str(e), "a moved public path stops setup: " + str(e))
# TDH's chat page (company-chat-client-v1) into static/tdh/: this revision's URLs, the key Tinode's own page carries.
import tempfile
box = Path(tempfile.mkdtemp(prefix="tdh-web-"))
(box / "umd").mkdir()
(box / "umd" / "index.prod.js").write_text('s.d(t,["Lq",0,"AQ' + "k" * 30 + '"]);', encoding="utf-8")
ts.web(box, HERE.parent / "server" / "chat" / "tdh-web")
idx = (box / "tdh" / "index.html").read_text(encoding="utf-8")
check("__REV__" not in idx and ("app.js?v=%s" % ts.SCRIPT_REV) in idx and "../umd/tinode.prod.js" in idx, "the page under this revision's URLs, beside Tinode's SDK")
check((box / "tdh" / "config.js").read_text(encoding="utf-8") == 'window.TDH_CHAT_KEY = "AQ%s";\n' % ("k" * 30), "the key from Tinode's own page")
check(all((box / "tdh" / n).is_file() for n in ("app.js", "app.css")), "the app and its sheet")
try:
    (box / "umd" / "index.prod.js").write_text("no key here", encoding="utf-8")
    ts.web(box, HERE.parent / "server" / "chat" / "tdh-web")
    check(False, "no key: setup stops")
except SystemExit as e:
    check("no-api-key" in str(e), "no key: setup stops: " + str(e))
# company-chat-home-v1: /chat/ is TDH's page, Tinode's kept beside it as tinode.html; "tinode" puts it back.
home = Path(tempfile.mkdtemp(prefix="tdh-home-"))
(home / "umd").mkdir()
(home / "umd" / "index.prod.js").write_text('s.d(t,["Lq",0,"AQ' + "k" * 30 + '"]);', encoding="utf-8")
(home / "index.html").write_text(HTML, encoding="utf-8")  # a fresh release: Tinode's page at /chat/
src = HERE.parent / "server" / "chat" / "tdh-web"
ts.pages(home, src, "tdh")
idx = (home / "index.html").read_text(encoding="utf-8")
kept = (home / "tinode.html").read_text(encoding="utf-8")
check("company-chat-client-v1" in idx and 'src="tdh/app.js?v=' in idx and 'src="umd/tinode.prod.js?v=' in idx and 'src="vendor/react' in idx
      and 'href="tdh/app.css?v=' in idx and "../" not in idx, "/chat/ is TDH's page, its files under tdh/: " + idx[:300])
check("tdh-chat.css" in kept and "cdn.jsdelivr" not in kept, "Tinode's own page kept beside it, patched as before")
ts.pages(home, src, "tdh")
check((home / "index.html").read_text(encoding="utf-8") == idx and (home / "tinode.html").read_text(encoding="utf-8") == kept, "a second run changes nothing")
ts.pages(home, src, "tinode")
check((home / "index.html").read_text(encoding="utf-8") == kept, "home tinode: Tinode's page back at /chat/")
ts.pages(home, src, "tdh")
check((home / "index.html").read_text(encoding="utf-8") == idx, "and TDH's again")
(home / "tinode.html").unlink()
try:
    ts.pages(home, src, "tdh")
    check(False, "Tinode's page gone and /chat/ TDH's: setup stops")
except SystemExit as e:
    check("no-tinode-page" in str(e), "Tinode's page gone and /chat/ TDH's: setup stops: " + str(e))
r1 = ts.content_rev(HERE.parent / "server" / "chat")
check(r1.startswith("tdh-") and len(r1) == 14 and r1 == ts.content_rev(HERE.parent / "server" / "chat"), "the scripts' version comes from their content: " + r1)
print("TINODE_SETUP_PROVE_OK=1")
