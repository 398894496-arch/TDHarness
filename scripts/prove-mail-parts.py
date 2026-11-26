#!/usr/bin/env python3
"""Proof for company-mail-8bit-header-v1 and company-mail-attachment-rule-v1 (server/mail_api.py).

2026-11-24, the desk's own four-part check of 邮箱:
- a sender's name came back as U+FFFD (「管理员郝小凡为你开通了公共邮箱」 from exmail.weixin.qq.com): a From
  header in raw 8-bit bytes (UTF-8 or GBK) went through compat32's unknown-8bit Header and str() of it;
- a mail listed 「有附件」 showed none in the detail, and the other way round: the list looked only at a top
  multipart/mixed, the detail counted named signature pictures.
Proved here: names in raw UTF-8 / GBK / encoded-words / with a comma; the list (from a BODYSTRUCTURE) and the
detail (from the parts) agree on body-only, alternative + signature picture, a real attachment, a forwarded
mail; a picture the body never shows stays an attachment in the detail; a FETCH answer whose BODYSTRUCTURE
comes after the header literal is still read. Ends with MAIL_PARTS_PROVE_OK=1.
"""
import base64
import email
import importlib.util
import sys
from email.message import EmailMessage
from email.policy import compat32
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("mail_api", ROOT / "server" / "mail_api.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

fails = 0


def check(cond, what):
    global fails
    print(("ok   " if cond else "FAIL ") + what)
    if not cond:
        fails += 1


def frm(raw: bytes):
    return m.addrs(email.message_from_bytes(raw, policy=compat32).get("From"))


# ---- names ----
check(frm('From: "郝小凡" <a@x.com>\r\n\r\n'.encode("gbk")) == [{"name": "郝小凡", "address": "a@x.com"}], "raw GBK name")
check(frm("From: 企业微信 <a@x.com>\r\n\r\n".encode("utf-8")) == [{"name": "企业微信", "address": "a@x.com"}], "raw UTF-8 name")
ew = base64.b64encode("张三, 销售部".encode("gbk")).decode()
check(frm(("From: =?gbk?B?%s?= <z@x.com>, b@y.com\r\n\r\n" % ew).encode()) ==
      [{"name": "张三, 销售部", "address": "z@x.com"}, {"name": "", "address": "b@y.com"}], "a decoded comma is not a second address")
check(frm(b"From: =?UTF-8?Q?Ren=C3=A9?= <r@x.com>\r\n\r\n")[0]["name"] == "René", "encoded-word")
check(frm(b'From: "Bob Smith" <bob@x.com>\r\n\r\n')[0]["name"] == "Bob Smith", "plain ASCII")
raw = ("From: 企业微信 <a@x.com>\r\nSubject: =?UTF-8?B?%s?=\r\nContent-Type: text/plain\r\n\r\nhi" %
       base64.b64encode("管理员郝小凡为你开通了公共邮箱".encode()).decode()).encode()
s = m._summary(1, "UID 1 RFC822.SIZE 10", raw)
check("�" not in s["from"]["name"] and s["subject"] == "管理员郝小凡为你开通了公共邮箱", "the 2026-11-24 sample: no U+FFFD")

# ---- attachments: the same rule in the list and the detail ----
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 40


def body_only():
    e = EmailMessage()
    e["From"], e["Subject"] = "a@x.com", "t"
    e.set_content("hello")
    e.add_alternative("<p>hello</p>", subtype="html")
    e.make_mixed()  # a top multipart/mixed with nothing attached (what some mailers send)
    return e


def signature():
    e = EmailMessage()
    e["From"], e["Subject"] = "a@x.com", "t"
    e.set_content("hi")
    e.add_alternative('<p>hi</p><img src="cid:sig001@x">', subtype="html")
    html = e.get_payload()[1]
    html.add_related(PNG, maintype="image", subtype="png", cid="<sig001@x>", filename="image001.png", disposition="inline")
    return e


def with_pdf():
    e = EmailMessage()
    e["From"], e["Subject"] = "a@x.com", "t"
    e.set_content("see pdf")
    e.add_attachment(b"%PDF-1.4", maintype="application", subtype="pdf", filename="报价单.pdf")
    return e


def unshown_photo():
    e = signature()
    e.get_payload()[1].add_related(PNG, maintype="image", subtype="png", cid="<photo@x>", filename="现场.png", disposition="inline")
    return e


def detail(e):
    return [a["name"] for a in m.parse(e.as_bytes())["attachments"]]


check(detail(body_only()) == [], "detail: mixed with only a body has no attachment")
check(detail(signature()) == [], "detail: a signature picture the body shows is not an attachment")
check(detail(with_pdf()) == ["报价单.pdf"], "detail: the pdf is")
check(detail(unshown_photo()) == ["现场.png"], "detail: a picture the body never shows stays an attachment")
fwd = EmailMessage()
fwd["From"], fwd["Subject"] = "a@x.com", "fw"
fwd.set_content("fyi")
fwd.add_attachment(with_pdf())
check("报价单.pdf" in detail(fwd), "detail: a forwarded mail's attachment counts")

# BODYSTRUCTUREs as Tencent / Dovecot write them for the same shapes.
BS = {
    "body_only": '(((("TEXT" "PLAIN" ("CHARSET" "utf-8") NIL NIL "7BIT" 6 1 NIL NIL NIL NIL)'
                 '("TEXT" "HTML" ("CHARSET" "utf-8") NIL NIL "7BIT" 13 1 NIL NIL NIL NIL) "ALTERNATIVE" '
                 '("BOUNDARY" "b2") NIL NIL NIL) "MIXED" ("BOUNDARY" "b1") NIL NIL NIL))',
    "signature": '(("TEXT" "PLAIN" ("CHARSET" "utf-8") NIL NIL "7BIT" 3 1 NIL NIL NIL NIL)'
                 '(("TEXT" "HTML" ("CHARSET" "utf-8") NIL NIL "7BIT" 40 1 NIL NIL NIL NIL)'
                 '("IMAGE" "PNG" ("NAME" "image001.png") "<sig001@x>" NIL "BASE64" 64 NIL ("INLINE" ("FILENAME" "image001.png")) NIL NIL)'
                 ' "RELATED" ("BOUNDARY" "b3") NIL NIL NIL) "ALTERNATIVE" ("BOUNDARY" "b2") NIL NIL NIL)',
    "with_pdf": '(("TEXT" "PLAIN" ("CHARSET" "utf-8") NIL NIL "7BIT" 8 1 NIL NIL NIL NIL)'
                '("APPLICATION" "PDF" ("NAME" "=?utf-8?b?5oql5Lu35Y2VLnBkZg==?=") NIL NIL "BASE64" 12 NIL '
                '("ATTACHMENT" ("FILENAME*" "utf-8\'\'%E6%8A%A5%E4%BB%B7%E5%8D%95.pdf")) NIL NIL) "MIXED" ("BOUNDARY" "b1") NIL NIL NIL)',
    "no_name_octet": '(("TEXT" "PLAIN" ("CHARSET" "utf-8") NIL NIL "7BIT" 8 1)("APPLICATION" "OCTET-STREAM" NIL NIL NIL "BASE64" 12) "MIXED")',
    "plain": '("TEXT" "PLAIN" ("CHARSET" "gbk") NIL NIL "BASE64" 120 2 NIL NIL NIL NIL)',
}
want = {"body_only": False, "signature": False, "with_pdf": True, "no_name_octet": True, "plain": False}
for k, bs in BS.items():
    meta = "1 (UID 7 FLAGS (\\Seen) RFC822.SIZE 900 BODYSTRUCTURE " + bs + " BODY[HEADER.FIELDS (FROM)] {20}"
    check(m._bs_has_attachment(meta) is want[k], "list: " + k + " -> " + str(want[k]))
check(m._list_attachments("1 (UID 7 BODYSTRUCTURE {12}", "multipart/mixed") is True, "an unreadable BODYSTRUCTURE falls back to multipart/mixed")
check(m._list_attachments("1 (UID 7 FLAGS ()", "text/plain") is False, "no BODYSTRUCTURE: the old rule")


# ---- FETCH answer with BODYSTRUCTURE after the literal ----
class FakeConn:
    def uid(self, *a):
        return "OK", [(b"1 (UID 7 FLAGS (\\Seen) BODY[HEADER.FIELDS (FROM)] {9}", b"From: a\r\n"),
                      b" BODYSTRUCTURE " + BS["with_pdf"].encode() + b")"]


box = m.Box.__new__(m.Box)
box.c = FakeConn()
got = box.fetch([7], m.HEAD)
check(len(got) == 1 and m._bs_has_attachment(got[0][1]) is True, "BODYSTRUCTURE after the header literal is still read")

if fails:
    sys.exit(1)
print("MAIL_PARTS_PROVE_OK=1")
