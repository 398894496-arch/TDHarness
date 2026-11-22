#!/usr/bin/env python3
"""Proof for company-mail-v1 (server/mail_api.py): 邮箱 over a provider's IMAP and SMTP.

A small IMAP server and SMTP server of its own (TLS, on 127.0.0.1) stand in for the provider (腾讯企业邮箱 and the
like: folders named in modified UTF-7, \\Sent / \\Drafts / \\Trash flags, GBK subjects). Proved here:
- a person adds their own mailbox (a wrong password is refused, nothing kept); only an admin adds one for someone
  else; the password is not kept as written;
- the owner and the admins see a mailbox, nobody else (not listed, not read, not sent from);
- folders with roles, totals and unread; Chinese folder names; a list newest first, in pages; subjects in GBK;
- the agent reads text (an html-only mail too) without marking it read; the page marks it read, gets html without
  scripts and with its inline image;
- search by a Chinese word across the person's mailboxes; an attachment downloaded and saved to their own folder;
- a send is two calls: the first sends nothing and answers a preview and a code; the code is the person's own;
  the second sends exactly that message (Bcc not in its headers), keeps it in 已发送 and marks the original answered;
  a reply has Re: and In-Reply-To;
- a draft goes to 草稿箱; delete moves to 已删除; the log line has no subject.
"""
from __future__ import annotations

import base64
import email
import email.policy
import json
import os
import re
import socket
import socketserver
import ssl
import subprocess
import sys
import tempfile
import threading
import time
from email.message import EmailMessage
from email.policy import compat32
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "server"))
import mail_api  # noqa: E402

FAILS = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what)
    if not ok:
        FAILS.append(what)


USER, PASSWORD = "tian@yitongda.test", "client-only-pass"


def mk(subject, frm, to, text=None, html=None, att=None, date=None, raw_subject=None):
    m = EmailMessage()
    m["From"], m["To"] = frm, to
    if raw_subject is None:
        m["Subject"] = subject
    m["Date"] = date or email.utils.formatdate(localtime=True)
    m["Message-ID"] = email.utils.make_msgid(domain="client.test")
    if text is not None:
        m.set_content(text)
    if html is not None:
        if text is None:
            m.set_content(html, subtype="html")
        else:
            m.add_alternative(html, subtype="html")
        m.get_payload()[-1].add_related(b"\x89PNG fake", maintype="image", subtype="png", cid="<logo1>") if m.is_multipart() else None
    if att:
        m.add_attachment(att[1], maintype="application", subtype="pdf", filename=att[0])
    raw = m.as_bytes()
    if raw_subject is not None:
        raw = raw.replace(b"\nFrom:", b"\nSubject: " + raw_subject + b"\nFrom:", 1) if b"\nFrom:" in raw else b"Subject: " + raw_subject + b"\r\n" + raw
    return raw


def utf7(s):
    return mail_api.utf7_encode(s)


class Store:
    def __init__(self):
        self.mu = threading.Lock()
        self.folders = {}
        self.uidnext = {}
        for name, flags in (("INBOX", ""), ("Sent Messages", "\\Sent"), ("Drafts", "\\Drafts"),
                            ("Deleted Messages", "\\Trash"), ("Junk", "\\Junk"), (utf7("客户/烟台"), "")):
            self.folders[name] = {"flags": flags, "msgs": []}
            self.uidnext[name] = 1

    def add(self, folder, raw, flags=(), when=None):
        with self.mu:
            uid = self.uidnext[folder]
            self.uidnext[folder] += 1
            self.folders[folder]["msgs"].append({"uid": uid, "flags": set(flags), "raw": raw, "when": when or time.time()})
            return uid


STORE = Store()
SENT = []  # (from, rcpts, data)


def _atoms(s):
    out, i = [], 0
    while i < len(s):
        c = s[i]
        if c == " ":
            i += 1
        elif c == '"':
            j, buf = i + 1, []
            while s[j] != '"':
                if s[j] == "\\":
                    j += 1
                buf.append(s[j])
                j += 1
            out.append("".join(buf))
            i = j + 1
        elif c == "(":
            depth, j = 1, i + 1
            while depth:
                depth += {"(": 1, ")": -1}.get(s[j], 0)
                j += 1
            out.append(s[i:j])
            i = j
        else:
            j = i
            while j < len(s) and s[j] != " ":
                if s[j] == "[":
                    while s[j] != "]":
                        j += 1
                j += 1
            out.append(s[i:j])
            i = j
    return out


def _set(spec, msgs):
    want = set()
    for part in spec.split(","):
        if ":" in part:
            a, b = part.split(":")
            hi = max([m["uid"] for m in msgs] + [0]) if b == "*" else int(b)
            want.update(range(int(a), hi + 1))
        else:
            want.add(int(part))
    return [m for m in msgs if m["uid"] in want]


class Imap(socketserver.StreamRequestHandler):
    def send(self, line):
        self.wfile.write(line if isinstance(line, bytes) else line.encode("utf-8"))
        self.wfile.write(b"\r\n") if not (isinstance(line, bytes) and line.endswith(b"\r\n")) else None

    def handle(self):
        self.sel = None
        self.send("* OK fake IMAP ready")
        while True:
            raw = self.rfile.readline()
            if not raw:
                return
            line = raw.decode("utf-8").rstrip("\r\n")
            lit = re.search(r"\{(\d+)\}$", line)
            data = b""
            if lit:
                self.send("+ go ahead")
                data = self.rfile.read(int(lit.group(1)))
                self.rfile.readline()
                line = line[:lit.start()].rstrip()
            tag, _, rest = line.partition(" ")
            cmd, _, args = rest.partition(" ")
            cmd = cmd.upper()
            if cmd == "UID":
                sub, _, args = args.partition(" ")
                cmd = "UID " + sub.upper()
            try:
                if self.do(tag, cmd, args, data) == "bye":
                    return
            except Exception as exc:  # noqa: BLE001
                self.send("%s BAD %s" % (tag, exc))

    def do(self, tag, cmd, args, data):
        a = _atoms(args)
        if cmd == "CAPABILITY":
            self.send("* CAPABILITY IMAP4rev1 ID MOVE UIDPLUS AUTH=PLAIN")
        elif cmd == "LOGIN":
            if a[0] != USER or a[1] != PASSWORD:
                self.send(tag + " NO [AUTHENTICATIONFAILED] LOGIN Login error password error")
                return
            self.send("* CAPABILITY IMAP4rev1 ID MOVE UIDPLUS")
        elif cmd == "ID":
            self.send('* ID ("name" "fake")')
        elif cmd == "LIST":
            for name, f in STORE.folders.items():
                self.send('* LIST (\\HasNoChildren%s) "/" "%s"' % ((" " + f["flags"]) if f["flags"] else "", name))
        elif cmd == "STATUS":
            msgs = STORE.folders[a[0]]["msgs"]
            self.send('* STATUS "%s" (MESSAGES %d UNSEEN %d)' % (a[0], len(msgs), sum(1 for m in msgs if "\\Seen" not in m["flags"])))
        elif cmd in ("SELECT", "EXAMINE"):
            self.sel = a[0]
            self.send("* %d EXISTS" % len(STORE.folders[self.sel]["msgs"]))
            self.send("%s OK [%s] done" % (tag, "READ-WRITE" if cmd == "SELECT" else "READ-ONLY"))
            return
        elif cmd == "UID SEARCH":
            msgs = list(STORE.folders[self.sel]["msgs"])
            i = 0
            while i < len(a):
                k = a[i].upper()
                if k == "UNSEEN":
                    msgs = [m for m in msgs if "\\Seen" not in m["flags"]]
                elif k == "SINCE":
                    t = time.mktime(time.strptime(a[i + 1], "%d-%b-%Y"))
                    msgs = [m for m in msgs if m["when"] >= t]
                    i += 1
                elif k == "HEADER":
                    field, val = a[i + 1], a[i + 2]
                    msgs = [m for m in msgs if val in str(email.message_from_bytes(m["raw"], policy=compat32).get(field) or "")]
                    i += 2
                i += 1
            self.send("* SEARCH " + " ".join(str(m["uid"]) for m in msgs))
        elif cmd == "UID FETCH":
            msgs = STORE.folders[self.sel]["msgs"]
            items = args.split(" ", 1)[1]
            for n, m in enumerate(_set(a[0], msgs), 1):
                head = "* %d FETCH (UID %d FLAGS (%s) RFC822.SIZE %d" % (n, m["uid"], " ".join(sorted(m["flags"])), len(m["raw"]))
                if "HEADER.FIELDS" in items:
                    fields = re.search(r"HEADER\.FIELDS \(([^)]*)\)", items).group(1).lower().split()
                    hdrs, keep = m["raw"].split(b"\n\n", 1)[0] if b"\r\n\r\n" not in m["raw"] else m["raw"].split(b"\r\n\r\n", 1)[0], []
                    cur = None
                    for ln in re.split(rb"\r?\n", hdrs):
                        if ln[:1] in (b" ", b"\t") and cur is not None:
                            if cur:
                                keep.append(ln)
                            continue
                        cur = ln.split(b":", 1)[0].decode("latin-1").lower() in fields
                        if cur:
                            keep.append(ln)
                    body = b"\r\n".join(keep) + b"\r\n\r\n"
                    self.wfile.write((head + " BODY[HEADER.FIELDS (%s)] {%d}\r\n" % (" ".join(fields).upper(), len(body))).encode())
                    self.wfile.write(body + b")\r\n")
                elif "BODY.PEEK[]" in items:
                    self.wfile.write((head + " BODY[] {%d}\r\n" % len(m["raw"])).encode())
                    self.wfile.write(m["raw"] + b")\r\n")
                else:
                    self.send(head + ")")
        elif cmd == "UID STORE":
            for m in _set(a[0], STORE.folders[self.sel]["msgs"]):
                flags = set(a[2].strip("()").split())
                if a[1].startswith("+"):
                    m["flags"] |= flags
                else:
                    m["flags"] -= flags
        elif cmd in ("UID MOVE", "UID COPY"):
            got = _set(a[0], STORE.folders[self.sel]["msgs"])
            for m in got:
                STORE.add(a[1], m["raw"], m["flags"], m["when"])
            if cmd == "UID MOVE":
                STORE.folders[self.sel]["msgs"] = [m for m in STORE.folders[self.sel]["msgs"] if m not in got]
        elif cmd in ("UID EXPUNGE", "EXPUNGE"):
            STORE.folders[self.sel]["msgs"] = [m for m in STORE.folders[self.sel]["msgs"] if "\\Deleted" not in m["flags"]]
        elif cmd == "APPEND":
            flags = a[1].strip("()").split() if len(a) > 1 and a[1].startswith("(") else []
            uid = STORE.add(a[0], data, flags)
            self.send("%s OK [APPENDUID 1 %d] done" % (tag, uid))
            return
        elif cmd == "LOGOUT":
            self.send("* BYE")
            self.send(tag + " OK bye")
            return "bye"
        else:
            self.send(tag + " BAD unknown " + cmd)
            return
        self.send(tag + " OK done")


class Smtp(socketserver.StreamRequestHandler):
    def handle(self):
        w = lambda s: self.wfile.write((s + "\r\n").encode())  # noqa: E731
        w("220 fake ESMTP")
        frm, rcpts, authed = "", [], False
        while True:
            line = self.rfile.readline().decode("utf-8", "replace").rstrip("\r\n")
            if not line:
                return
            up = line.upper()
            if up.startswith(("EHLO", "HELO")):
                w("250-fake")
                w("250 AUTH PLAIN LOGIN")
            elif up.startswith("AUTH PLAIN"):
                parts = base64.b64decode(line.split(" ", 2)[2]).split(b"\0")
                authed = parts[1].decode() == USER and parts[2].decode() == PASSWORD
                w("235 ok" if authed else "535 Error: authentication failed")
            elif up.startswith("MAIL FROM"):
                frm = line.split(":", 1)[1].strip(" <>")
                w("250 ok" if authed else "530 auth first")
            elif up.startswith("RCPT TO"):
                rcpts.append(line.split(":", 1)[1].strip(" <>"))
                w("250 ok")
            elif up == "DATA":
                w("354 go")
                buf = []
                while True:
                    ln = self.rfile.readline()
                    if ln in (b".\r\n", b".\n"):
                        break
                    buf.append(ln[1:] if ln.startswith(b"..") else ln)
                SENT.append((frm, rcpts, b"".join(buf)))
                rcpts = []
                w("250 queued")
            elif up == "QUIT":
                w("221 bye")
                return
            else:
                w("250 ok")


class TLSServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, handler, ctx):
        super().__init__(("127.0.0.1", 0), handler)
        self.ctx = ctx

    def get_request(self):
        sock, addr = super().get_request()
        return self.ctx.wrap_socket(sock, server_side=True), addr


def main():
    tmp = Path(tempfile.mkdtemp(prefix="prove-mail-"))
    key, crt = tmp / "k.pem", tmp / "c.pem"
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(key), "-out", str(crt),
                    "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], check=True, capture_output=True)
    sctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    sctx.load_cert_chain(str(crt), str(key))
    imap, smtp = TLSServer(Imap, sctx), TLSServer(Smtp, sctx)
    for s in (imap, smtp):
        threading.Thread(target=s.serve_forever, daemon=True).start()
    cctx = ssl.create_default_context(cafile=str(crt))
    mail_api._ssl = lambda: cctx

    old = time.time() - 40 * 86400
    STORE.add("INBOX", mk("去年的旧邮件", "old@client.test", USER, text="old"), {"\\Seen"}, when=old)
    gbk = b"=?gb2312?B?" + base64.b64encode("塞尔维亚 PU 筛板报价".encode("gb2312")) + b"?="
    u_quote = STORE.add("INBOX", mk(None, "Marko <marko@client.test>", USER, text="请报 PU 筛板价格。\n谢谢", raw_subject=gbk))
    u_html = STORE.add("INBOX", mk("新订单 PO-2026-118", "Daniel <daniel@client.test>", USER + ", guo@yitongda.test",
                                    text=None, html='<p>你好，</p><p>附件是<b>新订单</b>。<script>alert(1)</script><img src="cid:logo1"></p>',
                                    att=("PO-2026-118.pdf", b"%PDF-1.4 fake")))
    # the inline image of the html mail, as a related part
    msgs = STORE.folders["INBOX"]["msgs"]
    m = email.message_from_bytes(msgs[-1]["raw"])
    rel = EmailMessage()
    rel["From"], rel["To"], rel["Subject"] = m["From"], m["To"], m["Subject"]
    rel["Date"], rel["Message-ID"] = m["Date"], m["Message-ID"]
    rel.set_content('<p>你好，</p><p>附件是<b>新订单</b>。<script>alert(1)</script><img src="cid:logo1" onerror="x()"></p>', subtype="html")
    rel.add_related(b"\x89PNG fake", maintype="image", subtype="png", cid="<logo1>")
    rel.add_attachment(b"%PDF-1.4 fake", maintype="application", subtype="pdf", filename="PO-2026-118.pdf")
    msgs[-1]["raw"] = rel.as_bytes()
    for i in range(5):
        STORE.add("INBOX", mk("周报 %d" % i, "hr@yitongda.test", USER, text="周报"), {"\\Seen"})

    runtime, company = tmp / "runtime", tmp / "company"
    for d in ("emp-tian", "emp-pan", "emp-boss", "_office"):
        (company / d).mkdir(parents=True)
    (company / "emp-tian" / "报价单.xlsx").write_bytes(b"xlsx")
    (company / "_office" / "合同.pdf").write_bytes(b"pdf")
    people = {
        "tian": {"login": "tian", "name": "田总", "role": "employee", "status": "active", "personal": str(company / "emp-tian")},
        "pan": {"login": "pan", "name": "小潘", "role": "employee", "status": "active", "personal": str(company / "emp-pan")},
        "boss": {"login": "boss", "name": "管理员", "role": "admin", "status": "active", "personal": str(company / "emp-boss")},
    }

    def call(who, route, body=None):
        return mail_api.handle(route, body or {}, people[who], people, runtime, company)

    box = {"provider": "custom", "imap_host": "127.0.0.1", "imap_port": imap.server_address[1],
           "smtp_host": "127.0.0.1", "smtp_port": smtp.server_address[1]}

    st, b = call("tian", "accounts")
    check(st == 200 and b["accounts"] == [] and [o["login"] for o in b["owners"]] == ["tian"] and any(p["id"] == "exmail" for p in b["presets"]),
          "no mailboxes yet; an employee may add only their own; 腾讯企业邮箱 is a preset")
    st, b = call("tian", "add", dict(box, address=USER, password="wrong"))
    check(st == 401 and "客户端专用密码" in b["error"] and not (runtime / mail_api.STORE_NAME).exists(), "a wrong password is refused and nothing is kept")
    st, b = call("tian", "add", dict(box, address=USER, password=PASSWORD, owner="pan"))
    check(st == 403, "an employee cannot add a mailbox for someone else")
    st, b = call("tian", "add", dict(box, address=USER, password=PASSWORD))
    check(st == 200 and b["account"]["owner"] == "tian" and "secret" not in b["account"], "the owner adds their own mailbox")
    acct = b["account"]["id"]
    stored = (runtime / mail_api.STORE_NAME).read_text(encoding="utf-8")
    check(PASSWORD not in stored, "the password is not kept as written")
    st, b = call("tian", "add", dict(box, address=USER, password=PASSWORD))
    check(st == 400, "the same mailbox is not added twice")

    st, b = call("pan", "accounts")
    check(b["accounts"] == [], "another employee does not see it")
    st, b = call("pan", "list", {"account": acct})
    check(st == 404, "nor list it")
    st, b = call("pan", "send", {"account": acct, "to": "x@client.test", "subject": "x", "text": "x"})
    check(st == 404 and not SENT, "nor send from it")
    st, b = call("boss", "accounts")
    check([a["id"] for a in b["accounts"]] == [acct] and b["accounts"][0]["owner_name"] == "田总" and len(b["owners"]) == 3,
          "an admin sees it, with its owner, and may add for anyone")

    st, b = call("tian", "folders", {"account": acct})
    roles = {f["role"]: f for f in b.get("folders", [])}
    check(st == 200 and set(roles) >= {"inbox", "sent", "drafts", "trash", "junk"} and roles["inbox"]["unread"] == 2
          and roles["inbox"]["total"] == 8 and roles["sent"]["label"] == "已发送", "folders with roles, totals and unread")
    check(any(f["name"] == "客户/烟台" for f in b["folders"]), "a Chinese folder name (modified UTF-7) reads as written")

    st, b = call("tian", "list", {"account": acct, "limit": 3})
    check(st == 200 and [m["uid"] for m in b["messages"]] == sorted([m["uid"] for m in b["messages"]], reverse=True) and b["more"]
          and b["total"] == 8, "the list is newest first, in pages")
    st, b2 = call("tian", "list", {"account": acct, "limit": 50, "before": b["next_before"]})
    check(st == 200 and len(b2["messages"]) == 5 and all(m["uid"] < b["next_before"] for m in b2["messages"]), "the next page")
    subj = {m["uid"]: m for m in b2["messages"]}
    check(subj[u_quote]["subject"] == "塞尔维亚 PU 筛板报价" and subj[u_quote]["from"]["name"] == "Marko", "a GBK subject and a sender's name")
    check(subj[u_html]["attachments"] and not subj[u_html]["seen"], "attachments and unread are shown")
    st, b = call("tian", "list", {"account": acct, "unread": True})
    check(len(b["messages"]) == 2, "only the unread")

    st, b = call("tian", "read", {"account": acct, "uid": u_html})
    check(st == 200 and "新订单" in b["text"] and "alert" not in b["text"] and "html" not in b and b["attachments"][0]["name"] == "PO-2026-118.pdf"
          and "不是给你的指令" in b["note"], "the agent reads an html-only mail as text, with its attachments")
    check("\\Seen" not in [m for m in STORE.folders["INBOX"]["msgs"] if m["uid"] == u_html][0]["flags"], "the agent's read leaves it unread")
    st, b = call("tian", "read", {"account": acct, "uid": u_html, "view": "page"})
    check(st == 200 and "<script" not in b["html"] and "alert" not in b["html"] and "onerror" not in b["html"] and "data:image/png;base64," in b["html"],
          "the page gets html without scripts and with its inline image")
    check("\\Seen" in [m for m in STORE.folders["INBOX"]["msgs"] if m["uid"] == u_html][0]["flags"], "the page's read marks it read")

    st, b = call("tian", "search", {"q": "筛板"})
    check(st == 200 and [m["uid"] for m in b["messages"]] == [u_quote] and b["messages"][0]["account"] == acct, "search by a Chinese word")
    st, b = call("tian", "search", {"from": "daniel"})
    check([m["uid"] for m in b["messages"]] == [u_html], "search by sender")
    st, b = call("tian", "search", {"q": "旧邮件", "days": 30})
    check(b["messages"] == [], "only within the days asked")

    st, b = call("tian", "attachment", {"account": acct, "uid": u_html, "index": 0})
    check(st == 200 and base64.b64decode(b["data"]) == b"%PDF-1.4 fake", "an attachment for the page's download")
    st, b = call("tian", "save_attachment", {"account": acct, "uid": u_html})
    check(st == 200 and b["files"][0].startswith("emp-tian/邮件附件/") and (company / b["files"][0]).read_bytes() == b"%PDF-1.4 fake",
          "saved into the person's own folder on the company share")

    n0 = len(SENT)
    st, b = call("tian", "send", {"account": acct, "reply_to": {"folder": "INBOX", "uid": u_quote}, "text": "Marko 你好，报价见附件。",
                                  "bcc": "boss@yitongda.test", "attachments": [{"path": "emp-tian/报价单.xlsx"}]})
    check(st == 200 and b["need_confirm"] and b["ok"] is False and len(SENT) == n0, "the first call sends nothing")
    pv = b["preview"]
    check(pv["subject"] == "Re: 塞尔维亚 PU 筛板报价" and "marko@client.test" in pv["to"] and pv["attachments"] == ["报价单.xlsx"]
          and "> 请报 PU 筛板价格" in pv["text"], "its preview: Re:, the sender, the quote, the attachment")
    code = b["confirm"]
    st, b2 = call("pan", "send", {"confirm": code})
    check(st == 409 and len(SENT) == n0, "the code is the person's own")
    st, b2 = call("tian", "send", {"confirm": code})
    check(st == 200 and b2["sent"] and len(SENT) == n0 + 1, "the second call sends")
    frm, rcpts, data = SENT[-1]
    sm = email.message_from_bytes(data, policy=compat32)
    check(frm == USER and set(rcpts) == {"marko@client.test", "boss@yitongda.test"} and "boss@" not in data.decode("utf-8", "replace")
          and sm["In-Reply-To"], "exactly that message: Bcc gets it but is not in its headers; In-Reply-To is set")
    body = email.message_from_bytes(data, policy=email.policy.default).get_body(("plain",))
    check(all(b < 128 for b in data) and "报价见附件" in body.get_content(), "the message is 7-bit (base64 text), its Chinese intact")
    check(len(STORE.folders["Sent Messages"]["msgs"]) == 1 and b2["kept_in"] == "Sent Messages", "kept in 已发送")
    check("\\Answered" in [m for m in STORE.folders["INBOX"]["msgs"] if m["uid"] == u_quote][0]["flags"], "the original is marked answered")
    st, b3 = call("tian", "send", {"confirm": code})
    check(st == 409 and len(SENT) == n0 + 1, "a code sends once")
    st, b = call("tian", "send", {"account": acct, "to": "a@client.test", "subject": "x", "attachments": [{"path": "_office/合同.pdf"}]})
    check(st == 403, "an employee attaches only files of their own folder")

    st, b = call("tian", "draft", {"account": acct, "to": "daniel@client.test", "subject": "订单确认", "text": "草稿"})
    check(st == 200 and b["folder"] == "Drafts" and "\\Draft" in STORE.folders["Drafts"]["msgs"][-1]["flags"], "a draft goes to 草稿箱")
    st, b = call("tian", "move", {"account": acct, "uids": [u_html], "to": "trash"})
    check(st == 200 and b["to"] == "Deleted Messages" and not [m for m in STORE.folders["INBOX"]["msgs"] if m["uid"] == u_html]
          and len(STORE.folders["Deleted Messages"]["msgs"]) == 1, "delete moves to 已删除")
    st, b = call("tian", "flag", {"account": acct, "uids": [u_quote], "seen": False})
    check(st == 200 and "\\Seen" not in [m for m in STORE.folders["INBOX"]["msgs"] if m["uid"] == u_quote][0]["flags"], "mark unread")

    line = mail_api.log_line("tian", "read", {"account": acct, "uid": u_quote}, 200, {"subject": "塞尔维亚 PU 筛板报价"})
    check("筛板" not in line and acct in line, "the log line has no subject")
    st, b = call("tian", "remove", {"account": acct})
    check(st == 200 and call("tian", "accounts")[1]["accounts"] == [], "removed from TDH (the mail stays with the provider)")
    print("\n%d failed" % len(FAILS) if FAILS else "\nall passed")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
