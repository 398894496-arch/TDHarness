// company-desk-hub-v1: this computer's door to its person's desk on the company server (server/desk_hub.js).
//
// The desk window keeps loading http://127.0.0.1:<port>/ as it always has (the kernel then treats it as its own
// loopback page: settings saved, no certificate the computer must trust). This relay passes every request and
// WebSocket to https://<site>/desk-hub/... with the person's sign-in token, the company CA checking the server; the
// token never reaches the page.
//
//   node desk-hub-relay.js --site https://tdharness.local:8443 [--connect <ip>] [--port 17803]
//                          [--token-file ~/.dsh-company-rc8/gw.token] [--ca company-ca.crt]
//   --connect: dial this address (the office LAN, the tunnel) while the certificate and Host stay the site's name.
// Prints RELAY_LISTEN=<port> once listening. Only Host 127.0.0.1:<port> / localhost:<port> is answered.
"use strict";
const http = require("http");
const https = require("https");
const tls = require("tls");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

function arg(n, d) { const i = process.argv.indexOf("--" + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; }
const SITE = new URL(arg("site", ""));
const PORT = Number(arg("port", "17803"));
const CONNECT = arg("connect", "");
const TOKEN_FILE = arg("token-file", path.join(os.homedir(), ".dsh-company-rc8", "gw.token"));
const CA_FILE = arg("ca", path.join(__dirname, "company-ca.crt"));
const PREFIX = "/desk-hub";

const ca = fs.existsSync(CA_FILE) ? [fs.readFileSync(CA_FILE)] : undefined;
const sitePort = Number(SITE.port || 443);
const dial = CONNECT || SITE.hostname;
const agent = new https.Agent({ keepAlive: true, maxSockets: 32, ca, servername: SITE.hostname });

function token() {
  try { return fs.readFileSync(TOKEN_FILE, "utf8").replace(/[\r\n]+/g, "").trim(); } catch { return ""; }
}
function hostOk(req) {
  const h = String(req.headers.host || "");
  return h === "127.0.0.1:" + PORT || h === "localhost:" + PORT;
}
const DROP = new Set(["host", "connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "authorization"]);
function headersFor(req) {
  const h = {};
  for (const [k, v] of Object.entries(req.headers)) if (!DROP.has(k)) h[k] = v;
  h.host = SITE.host;
  h.authorization = "Bearer " + token();
  return h;
}

// ---- company-local-reveal-v1 ------------------------------------------------------------------------------------
// The desk runs on the company server, so its own 「在文件管理器中显示」 opened a window on the server, and its downloads
// went through a path the server could not read (the user, 2026-11-26: 「直接不给下载按钮了 直接给一个从文件夹打开的按钮」).
// The page asks this relay instead: POST /_tdh/reveal {path}. The path is the desk's — the share's own name
// (\\<host>\dsh-company\...) or the server's folder behind it (/_hub/status "company") — and is shown here, on the
// share as this computer has it mounted: Windows \\<site host>\dsh-company\..., the Mac COMPANY_SMB_MNT (~/company).
// Nothing outside the share is shown. The custom header keeps other sites' pages out (it needs a CORS preflight, which
// this relay never grants).
const SHARE = "dsh-company";
const MAC_MNT = process.env.COMPANY_SMB_MNT || path.join(os.homedir(), "company");
let companyRoot = "";
function hubStatus() {
  return new Promise((resolve) => {
    const r = https.request({ host: dial, port: sitePort, servername: SITE.hostname, agent, method: "GET", path: PREFIX + "/_hub/status",
      headers: { host: SITE.host, authorization: "Bearer " + token(), accept: "application/json" }, timeout: 8000 }, (res) => {
      const c = []; res.on("data", (x) => c.push(x));
      res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(c).toString("utf8"))); } catch { resolve(null); } });
    });
    r.on("error", () => resolve(null));
    r.on("timeout", () => { r.destroy(); resolve(null); });
    r.end();
  });
}
// The part of a desk path below the share, as ["emp-x", "file.png"]; null when it is not on the share.
function shareParts(p, root) {
  const s = String(p || "").replace(/\//g, "\\");
  let rest = null;
  const unc = /^\\\\[^\\]+\\([^\\]+)(?=\\|$)/.exec(s);
  if (unc && unc[1].toLowerCase() === SHARE) rest = s.slice(unc[0].length);
  else if (root) {
    const r = String(root).replace(/\//g, "\\").replace(/\\+$/, "");
    if (s.toLowerCase() === r.toLowerCase() || s.toLowerCase().startsWith(r.toLowerCase() + "\\")) rest = s.slice(r.length);
  }
  if (rest === null) return null;
  const parts = rest.split("\\").filter(Boolean);
  if (parts.some((x) => x === "." || x === ".." || /[\0"<>|?*:]/.test(x))) return null;
  return parts;
}
function localShare(parts) {
  return process.platform === "win32" ? "\\\\" + SITE.hostname + "\\" + SHARE + (parts.length ? "\\" + parts.join("\\") : "") : path.join(MAC_MNT, ...parts);
}
function exists(p) { return new Promise((resolve) => fs.stat(p, (e, st) => resolve(e ? null : st))); }
async function reveal(desk) {
  let parts = shareParts(desk, companyRoot);
  if (!parts) {
    const st = await hubStatus();
    if (st && typeof st.company === "string") companyRoot = st.company;
    parts = shareParts(desk, companyRoot);
  }
  if (!parts) return { ok: false, why: "not-on-share" };
  // The file itself selected; when it is gone, the nearest folder that is there.
  let target = localShare(parts);
  let st = await exists(target);
  let select = !!(st && !st.isDirectory());
  while (!st && parts.length) { parts = parts.slice(0, -1); target = localShare(parts); st = await exists(target); }
  if (!st) return { ok: false, why: "share-unreachable" };
  if (process.platform === "win32") {
    const argLine = select ? '/select,"' + target + '"' : '"' + target + '"';
    spawn("explorer.exe", [argLine], { detached: true, stdio: "ignore", windowsHide: false, windowsVerbatimArguments: true }).on("error", () => {}).unref();
  } else if (process.platform === "darwin") {
    spawn("/usr/bin/open", select ? ["-R", target] : [target], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  } else return { ok: false, why: "platform" };
  return { ok: true };
}
function revealRoute(req, res) {
  const answer = (code, obj) => {
    const b = Buffer.from(JSON.stringify(Object.assign({ tdhLocal: true }, obj)));
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": b.length, "Cache-Control": "no-store" });
    res.end(b);
  };
  const origin = req.headers.origin;
  if (req.method !== "POST" || req.headers["x-tdh-local"] !== "1" ||
      (origin && origin !== "http://127.0.0.1:" + PORT && origin !== "http://localhost:" + PORT)) { answer(403, { ok: false, why: "forbidden" }); return; }
  const c = []; let n = 0;
  req.on("data", (x) => { n += x.length; if (n <= 16384) c.push(x); });
  req.on("end", async () => {
    let desk = "";
    try { desk = String(JSON.parse(Buffer.concat(c).toString("utf8")).path || ""); } catch {}
    if (!desk || n > 16384) { answer(400, { ok: false, why: "no-path" }); return; }
    try {
      const r = await reveal(desk);
      process.stdout.write("REVEAL " + (r.ok ? "ok" : r.why) + "\n");
      answer(200, r);
    } catch (e) { answer(200, { ok: false, why: "error" }); }
  });
}

// ---- company-erp-hub-v1 ------------------------------------------------------------------------------------------
// ERPNext in the desk's frame (the user, 2026-11-27: 「ERP也挂了」): the desk on the server answers the frame's address
// with its own ERP relay, http://127.0.0.1:<port>/… on the SERVER — nothing on this computer. This relay listens on a
// second port of its own for ERPNext (a site of its own: ERPNext's pages ask for /app, /api, /assets at the root) and
// passes everything there to the hub's /_erp/, which hands it to that relay on the server (server/desk_hub.js); the
// frame's address is changed to this port as it passes.
const ERP_PORTS = [17831, 17832, 17833, 17834, 0];
let erpPort = 0;
function erpHostOk(req) {
  const h = String(req.headers.host || "");
  return erpPort > 0 && (h === "127.0.0.1:" + erpPort || h === "localhost:" + erpPort);
}
function erpWhere(req, res) {
  // Plain, to be read here.
  const wh = headersFor(req);
  delete wh["accept-encoding"];
  const up = https.request({ host: dial, port: sitePort, servername: SITE.hostname, agent, method: req.method, path: PREFIX + req.url, headers: wh }, (ures) => {
    const c = []; let n = 0;
    ures.on("data", (x) => { n += x.length; if (n <= 65536) c.push(x); });
    ures.on("end", () => {
      let body = Buffer.concat(c);
      try {
        const j = JSON.parse(body.toString("utf8"));
        if (j && j.ok && typeof j.url === "string" && erpPort > 0) {
          j.url = j.url.replace(/^http:\/\/127\.0\.0\.1:\d+\//, "http://127.0.0.1:" + erpPort + "/");
          body = Buffer.from(JSON.stringify(j));
        }
      } catch {}
      const h = Object.assign({}, ures.headers);
      delete h["transfer-encoding"];
      h["content-length"] = String(body.length);
      res.writeHead(ures.statusCode || 502, h);
      res.end(body);
    });
    ures.on("error", () => res.destroy());
  });
  up.on("error", (e) => {
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("连不上公司服务器（" + (e.code || e.message) + "）");
  });
  req.pipe(up);
}
const erpSrv = http.createServer((req, res) => {
  if (!erpHostOk(req)) { res.writeHead(421); res.end("wrong host"); return; }
  const up = https.request({ host: dial, port: sitePort, servername: SITE.hostname, agent, method: req.method, path: PREFIX + "/_erp" + req.url, headers: headersFor(req) }, (ures) => {
    const h = Object.assign({}, ures.headers);
    if (h.location && h.location.startsWith(PREFIX + "/_erp/")) h.location = h.location.slice(PREFIX.length + 5);
    res.writeHead(ures.statusCode || 502, h);
    ures.pipe(res);
  });
  up.setTimeout(180000, () => up.destroy());
  up.on("error", (e) => {
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ERP 没连上（" + (e.code || e.message) + "），请点「重新打开」");
  });
  res.on("close", () => up.destroy());
  req.pipe(up);
});
erpSrv.requestTimeout = 0;
erpSrv.on("upgrade", (req, sock, head) => {
  sock.on("error", () => {});
  if (!erpHostOk(req) || String(req.url || "").indexOf("/socket.io/") !== 0) { sock.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
  const up = tls.connect({ host: dial, port: sitePort, servername: SITE.hostname, ca }, () => {
    const h = headersFor(req);
    h.connection = "Upgrade";
    h.upgrade = req.headers.upgrade || "websocket";
    let s = req.method + " " + PREFIX + "/_erp" + req.url + " HTTP/1.1\r\n";
    for (const [k, v] of Object.entries(h)) for (const vv of [].concat(v)) s += k + ": " + vv + "\r\n";
    up.write(s + "\r\n");
    if (head && head.length) up.write(head);
    up.pipe(sock); sock.pipe(up);
  });
  up.on("error", () => sock.destroy());
  sock.on("close", () => up.destroy());
});
(async () => {
  for (const p of ERP_PORTS) {
    const ok = await new Promise((resolve) => {
      const onErr = () => { erpSrv.off("listening", onOk); resolve(false); };
      const onOk = () => { erpSrv.off("error", onErr); resolve(true); };
      erpSrv.once("error", onErr);
      erpSrv.once("listening", onOk);
      erpSrv.listen(p, "127.0.0.1");
    });
    if (ok) { erpPort = erpSrv.address().port; process.stdout.write("RELAY_ERP=" + erpPort + "\n"); return; }
  }
})();
erpSrv.on("error", () => {});

const srv = http.createServer((req, res) => {
  if (!hostOk(req)) { res.writeHead(403); res.end("forbidden"); return; }
  if (req.url === "/_tdh/reveal") { revealRoute(req, res); return; }
  if (req.method === "POST" && req.url === "/company/erp/where") { erpWhere(req, res); return; }
  const up = https.request({ host: dial, port: sitePort, servername: SITE.hostname, agent, method: req.method, path: PREFIX + req.url, headers: headersFor(req) }, (ures) => {
    const h = Object.assign({}, ures.headers);
    if (h.location && h.location.startsWith(PREFIX + "/")) h.location = h.location.slice(PREFIX.length);
    res.writeHead(ures.statusCode || 502, h);
    ures.pipe(res);
  });
  up.on("error", (e) => {
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("连不上公司服务器（" + (e.code || e.message) + "）");
  });
  res.on("close", () => up.destroy());
  req.pipe(up);
});

srv.on("upgrade", (req, sock, head) => {
  sock.on("error", () => {});
  if (!hostOk(req)) { sock.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
  const up = tls.connect({ host: dial, port: sitePort, servername: SITE.hostname, ca }, () => {
    const h = headersFor(req);
    h.connection = "Upgrade";
    h.upgrade = req.headers.upgrade || "websocket";
    let s = req.method + " " + PREFIX + req.url + " HTTP/1.1\r\n";
    for (const [k, v] of Object.entries(h)) for (const vv of [].concat(v)) s += k + ": " + vv + "\r\n";
    up.write(s + "\r\n");
    if (head && head.length) up.write(head);
    up.pipe(sock); sock.pipe(up);
  });
  up.on("error", () => sock.destroy());
  sock.on("close", () => up.destroy());
});

srv.listen(PORT, "127.0.0.1", () => process.stdout.write("RELAY_LISTEN=" + srv.address().port + "\n"));
