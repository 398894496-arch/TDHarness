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

const srv = http.createServer((req, res) => {
  if (!hostOk(req)) { res.writeHead(403); res.end("forbidden"); return; }
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
