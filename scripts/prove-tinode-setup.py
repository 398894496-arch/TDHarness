#!/usr/bin/env python3
"""Proof for server/chat/tinode-setup.py's page fixes (company-chat-tinode-v1, v2), on stand-ins of Tinode's own files.

- index.html: CDN libraries and fonts come from static/vendor; the two scripts are asked for under this revision's URL
  (a browser that kept a broken copy fetches them again); a second run changes nothing.
- umd/index.prod.js: the chunks (language, views) load from "umd/" beside the page, not "/umd/" at the site's root,
  where under /chat/ they 404 and the page stays blank (11-20); a second run changes nothing; a release that moved
  the public path stops setup instead of passing silently.
Prints TINODE_SETUP_PROVE_OK=1.
"""
import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("tinode_setup", HERE.parent / "server" / "chat" / "tinode-setup.py")
ts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ts)

HTML = """<!DOCTYPE html><html><head>
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


h = ts.bust(ts.page(HTML))
check("cdn.jsdelivr" not in h and "fonts.googleapis" not in h and "polyfill" not in h, "no CDN left: " + h)
check('src="umd/index.prod.js?v=%s"' % ts.SCRIPT_REV in h and 'src="umd/tinode.prod.js?v=%s"' % ts.SCRIPT_REV in h, "scripts under this revision's URL")
check(ts.bust(ts.page(h)) == h, "index.html: a second run changes nothing")
j = ts.bundle(JS)
check('.p="umd/"' in j and '.p="/umd/"' not in j, "chunks from umd/ beside the page: " + j)
check(ts.bundle(j) == j, "the bundle: a second run changes nothing")
try:
    ts.bundle('o.p="/static/js/",')
    check(False, "a moved public path stops setup")
except SystemExit as e:
    check("anchor-public-path" in str(e), "a moved public path stops setup: " + str(e))
print("TINODE_SETUP_PROVE_OK=1")
