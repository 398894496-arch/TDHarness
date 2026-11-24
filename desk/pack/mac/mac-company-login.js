#!/usr/bin/env node
// Roster POST like Win AppHost. IPv4 only. Bundled node. No python3 / CLT.
"use strict";

const dns = require("dns");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const { URL } = require("url");
// company-mac-offlan-resolve-v1: the server's name away from the office too (start.command preloads it as well).
try { require(path.join(__dirname, "mac-resolve.js")); } catch { /* an older pack without it */ }

function macWork(winPath) {
  const pth = String(winPath || "").replace(/\\/g, "/").trim();
  const key = "dsh/company";
  const i = pth.toLowerCase().indexOf(key);
  if (i < 0) return "";
  const rel = pth.slice(i + key.length).replace(/^\/+/, "");
  const root = path.join(os.homedir(), "company");
  return rel ? path.join(root, rel) : root;
}

function write(dest, text, mode) {
  fs.writeFileSync(dest, text, { encoding: "utf8" });
  if (mode) fs.chmodSync(dest, mode);
}

// Exit codes start.command tells apart (company-mac-offlan-resolve-v1); before, every failure read as a wrong password:
//   3 the server was not reached (name not found, no connection, timeout)   4 account or password wrong
//   5 too many failed tries (15 minutes)   6 the server answered something else   2 this script's own setup
const UNREACHED = 3;
const BAD_LOGIN = 4;
const TOO_MANY = 5;
const ODD = 6;
function fail(msg, code) {
  process.stderr.write(String(msg) + "\n");
  process.exit(code || 2);
}

const urlRaw = process.env.LOGIN_URL;
const tokPath = process.env.TOKFILE;
// company-login-sms-v1 / company-login-remember-v1: LOGIN_MODE password (LOGIN_USER, LOGIN_PASS), sms-code (LOGIN_PHONE:
// ask for a text code), sms (LOGIN_PHONE, LOGIN_CODE), resume (the remembered device token in remember.token), forget
// (退出登录: the token forgotten on the server and here). A sign-in asks to be remembered on this Mac (device.id, as
// desk-lease.js keeps it) unless LOGIN_REMEMBER=0. More exit codes: 7 codes are off at this site, 8 the remembered
// sign-in is over (expired, forgotten, another device). A line HINT=<words> says what the server said, for the dialog.
const SMS_OFF = 7;
const EXPIRED = 8;
const mode = process.env.LOGIN_MODE || "password";
if (!urlRaw || !tokPath) fail("login-env-missing");
const rc8 = path.dirname(tokPath);
const rememberPath = path.join(rc8, "remember.token");

function deviceId() {
  const p = path.join(rc8, "device.id");
  let id = "";
  try { id = fs.readFileSync(p, "utf8").trim(); } catch { /* first time */ }
  if (/^[A-Za-z0-9._-]{8,80}$/.test(id)) return id;
  id = "dev-" + require("crypto").randomBytes(8).toString("hex");
  fs.mkdirSync(rc8, { recursive: true });
  write(p, id + "\n", 0o600);
  return id;
}

let u;
try {
  u = new URL(urlRaw);
} catch {
  fail("login-url-bad");
}
const base = (u.pathname || "/company/login").replace(/\/+$/, "");
let route = base;
let payload;
const remember = process.env.LOGIN_REMEMBER !== "0";
if (mode === "password") {
  if (!process.env.LOGIN_USER || !process.env.LOGIN_PASS) fail("login-env-missing");
  payload = { username: process.env.LOGIN_USER, password: process.env.LOGIN_PASS };
} else if (mode === "sms-code") {
  route = base + "/sms-code";
  payload = { phone: process.env.LOGIN_PHONE || "" };
} else if (mode === "sms") {
  route = base + "/sms";
  payload = { phone: process.env.LOGIN_PHONE || "", code: process.env.LOGIN_CODE || "" };
} else if (mode === "resume" || mode === "forget") {
  route = base + "/" + mode;
  let tok = "";
  try { tok = fs.readFileSync(rememberPath, "utf8").trim(); } catch { /* none */ }
  if (mode === "forget") try { fs.unlinkSync(rememberPath); } catch { /* none */ }
  if (!/^tdhr_[0-9a-f]{32}$/.test(tok)) {
    if (mode === "forget") process.exit(0);
    fail("login-no-remember", EXPIRED);
  }
  payload = { token: tok };
} else {
  fail("login-mode-bad");
}
if (mode === "password" || mode === "sms" || mode === "resume") {
  payload.device_id = deviceId();
  if (mode !== "resume" && remember) payload.remember = true;
}
const body = JSON.stringify(payload);
const port = Number(u.port || 443);

function hintOf(j) {
  const h = j && typeof j.hint === "string" ? j.hint.replace(/[\r\n"\\]/g, " ").slice(0, 120) : "";
  if (h) process.stdout.write("HINT=" + h + "\n");
}

function signedIn(hit) {
  fs.mkdirSync(rc8, { recursive: true });
  write(tokPath, String(hit.gw_token).trim() + "\n", 0o600);
  if (hit.smb_user && hit.smb_pass) {
    write(path.join(rc8, "smb.user"), String(hit.smb_user).trim() + "\n");
    write(path.join(rc8, "smb.pass"), String(hit.smb_pass).trim() + "\n", 0o600);
  }
  const pers = macWork(hit.personal);
  const org = macWork(hit.org);
  if (pers) write(path.join(rc8, "work.personal"), pers + "\n");
  if (org) write(path.join(rc8, "work.org"), org + "\n");
  if (hit.role) write(path.join(rc8, "login.role"), String(hit.role).trim() + "\n");
        if (hit.login) write(path.join(rc8, "login.name"), String(hit.login).trim() + "\n");
  // company-remember-login-v1: the account dialog offers the last account that signed in here (a name, not a password; kept on logout).
  if (hit.login) write(path.join(rc8, "last.login"), String(hit.login).trim() + "\n");
  if (mode === "sms" && payload.phone) write(path.join(rc8, "last.phone"), String(payload.phone).replace(/[^0-9+]/g, "") + "\n");
  // company-login-remember-v1: this Mac stays signed in for 30 days (退出登录 forgets it).
  if (hit.remember_token && /^tdhr_[0-9a-f]{32}$/.test(String(hit.remember_token))) write(rememberPath, String(hit.remember_token) + "\n", 0o600);
  process.stdout.write("LOGIN_OK=" + String(hit.login || "") + "\n");
}

dns.lookup(u.hostname, { family: 4 }, (err, addr) => {
  if (err) fail("login-unreached:" + (err.code || err.message || err), UNREACHED);
  const req = https.request(
    {
      hostname: addr,
      port,
      path: route,
      method: "POST",
      servername: u.hostname,
      headers: {
        Host: u.host,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        Connection: "close",
      },
      rejectUnauthorized: false,
      timeout: 20000,
    },
    (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        let hit = null;
        try {
          hit = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          hit = null;
        }
        if (res.statusCode >= 400) hintOf(hit);
        if (mode === "forget") process.exit(0);
        if (mode === "resume" && (res.statusCode === 401 || res.statusCode === 403)) {
          try { fs.unlinkSync(rememberPath); } catch { /* gone */ }
          fail("login-expired", EXPIRED);
        }
        if (res.statusCode === 401 || res.statusCode === 403) fail("login-http:" + res.statusCode, BAD_LOGIN);
        if (res.statusCode === 429) fail("login-http:429", TOO_MANY);
        if (res.statusCode === 503 && hit && hit.error === "sms-off") fail("login-sms-off", SMS_OFF);
        if (res.statusCode >= 400) fail("login-http:" + res.statusCode, ODD);
        if (!hit) fail("login-json", ODD);
        if (mode === "sms-code") {
          if (!hit.ok) fail("login-sms-code", ODD);
          process.stdout.write("SMS_SENT=1\n");
          process.exit(0);
        }
        if (!hit.ok || !hit.gw_token) {
          fail("login-" + String(hit.error || "no-token"), hit.error === "bad-login" ? BAD_LOGIN : ODD);
        }
        signedIn(hit);
        process.exit(0); // do not wait for a system lookup still pending (company-mac-offlan-resolve-v1)
      });
    }
  );
  req.on("timeout", () => {
    req.destroy();
    fail("login-timeout", UNREACHED);
  });
  req.on("error", (e) => fail("login-unreached:" + (e && (e.code || e.message) || e), UNREACHED));
  req.write(body);
  req.end();
});
