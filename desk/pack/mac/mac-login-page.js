#!/usr/bin/env node
// company-login-page-v1 (the user, 2026-11-24: 「登录窗口好丑」): the Mac's sign-in as a page in the app's own window
// instead of a row of system dialogs. start.command runs this when the shell can show it (TDH_SHELL_LOGIN_PAGE=1):
// it serves login.html on 127.0.0.1 (a random port and a random path), tells the shell where (desk-login.url, then
// desk-boot.status "login"), and does each step with mac-company-login.js, which stays the one place that talks to
// the server and writes the sign-in files. Exit 0 signed in, 2 the person closed the window, 9 the page could not start
// (start.command then falls back to the dialogs).
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = __dirname;
const urlRaw = process.env.LOGIN_URL || "";
const tokPath = process.env.TOKFILE || "";
if (!urlRaw || !tokPath) process.exit(9);
const rc8 = path.dirname(tokPath);
const urlFile = path.join(rc8, "desk-login.url");
const statusFile = path.join(rc8, "desk-boot.status");

let page = "";
// Beside this file in a pack; in the repository it is desk/pack/common/login.html.
for (const f of [path.join(ROOT, "login.html"), path.join(ROOT, "..", "common", "login.html")]) {
	try { page = fs.readFileSync(f, "utf8"); break; } catch { /* the next */ }
}
if (!page) process.exit(9);

const key = crypto.randomBytes(16).toString("hex");
const prefix = "/" + key + "/";

function readLine(name, re) {
	try {
		const v = fs.readFileSync(path.join(rc8, name), "utf8").split(/\r?\n/)[0].trim();
		return re.test(v) ? v : "";
	} catch { return ""; }
}

// The words start.command's login_why used for each exit code of mac-company-login.js.
const UNREACHED = "连不上公司服务器。在公司请连公司的 Wi-Fi；不在公司请先打开右上角的 Tailscale，确认已连上，再试一次。";
function why(rc, hint, own) {
	if (rc === 3) return UNREACHED;
	if (rc === 4) return hint || own;
	if (rc === 5) return hint || "登录失败次数太多，请 15 分钟后再试，或找管理员。";
	if (rc === 7) return "公司还没开通手机验证码，请用账号和密码登录。";
	return hint || own || "服务器没有正常回应，请稍后再试；一直这样请找管理员。";
}

function runLogin(env) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [path.join(ROOT, "mac-company-login.js")], {
			env: Object.assign({}, process.env, { LOGIN_URL: urlRaw, TOKFILE: tokPath }, env),
			stdio: ["ignore", "pipe", "ignore"],
		});
		let out = "";
		child.stdout.on("data", (c) => { out += c; });
		const kill = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, 45000);
		child.on("close", (code) => {
			clearTimeout(kill);
			const hint = ((out.match(/^HINT=(.*)$/m) || [])[1] || "").replace(/["\\]/g, "").trim();
			resolve({ rc: code == null ? 6 : code, hint, out });
		});
		child.on("error", () => { clearTimeout(kill); resolve({ rc: 2, hint: "", out: "" }); });
	});
}

let finishing = false;
function finish(code) {
	if (finishing) return;
	finishing = true;
	try { fs.unlinkSync(urlFile); } catch { /* gone */ }
	// Back to the shell's own words while the desk starts; start.command writes its own states from here on.
	if (code === 0) try { fs.writeFileSync(statusFile, "starting\n"); } catch { /* start.command writes it too */ }
	setTimeout(() => process.exit(code), 250);
}

const phoneOk = (p) => /^(\+?86)?1\d{10}$/.test(p);
const steps = {
	async hello() {
		const lastPhone = readLine("last.phone", /^\+?[0-9]{6,16}$/);
		return {
			ok: true,
			lastLogin: readLine("last.login", /^[A-Za-z0-9._@-]{1,64}$/),
			lastPhone,
			mode: lastPhone ? "sms" : readLine("last.login", /^[A-Za-z0-9._@-]{1,64}$/) ? "pwd" : "sms",
			msg: process.env.LOGIN_NOTE || "",
			bad: !!process.env.LOGIN_NOTE,
		};
	},
	async "sms-code"(d) {
		const phone = String(d.phone || "").replace(/[^0-9+]/g, "");
		if (!phoneOk(phone)) return { ok: false, msg: "请填 11 位手机号。" };
		const r = await runLogin({ LOGIN_MODE: "sms-code", LOGIN_PHONE: phone });
		if (r.rc === 0 && /SMS_SENT=1/.test(r.out)) return { ok: true };
		if (r.rc === 7) return { ok: false, smsOff: true, msg: why(7) };
		return { ok: false, msg: why(r.rc, r.hint, "手机号不对，请填 11 位手机号。") };
	},
	async sms(d) {
		const phone = String(d.phone || "").replace(/[^0-9+]/g, "");
		const code = String(d.code || "").replace(/\D/g, "");
		if (!phoneOk(phone) || !/^\d{4,8}$/.test(code)) return { ok: false, msg: "请填手机号和收到的验证码。" };
		const r = await runLogin({ LOGIN_MODE: "sms", LOGIN_PHONE: phone, LOGIN_CODE: code, LOGIN_REMEMBER: d.remember === false ? "0" : "1" });
		if (r.rc === 0) { finish(0); return { ok: true }; }
		return { ok: false, msg: why(r.rc, r.hint, "验证码不对或已过期，请重新获取。") };
	},
	async password(d) {
		const user = String(d.user || "").trim();
		const pass = String(d.pass || "");
		if (!/^[A-Za-z0-9._@-]{1,64}$/.test(user)) return { ok: false, msg: "账号只能是字母、数字和 . _ @ -。" };
		if (!pass || pass.length > 128) return { ok: false, msg: "请填密码。" };
		const r = await runLogin({ LOGIN_MODE: "password", LOGIN_USER: user, LOGIN_PASS: pass, LOGIN_REMEMBER: d.remember === false ? "0" : "1" });
		if (r.rc === 0) { finish(0); return { ok: true }; }
		return { ok: false, msg: why(r.rc, r.hint, "账号或密码不对，再试一次。") };
	},
};

let stepping = false;
const server = http.createServer((req, res) => {
	const send = (status, type, body) => {
		res.writeHead(status, {
			"Content-Type": type, "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
			"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
		});
		res.end(body);
	};
	// Only this Mac, only by its loopback name (no other site's page can reach it through a name that points here).
	const hostOk = /^127\.0\.0\.1:\d+$/.test(String(req.headers.host || ""));
	const u = String(req.url || "");
	if (!hostOk || u.indexOf(prefix) !== 0) return send(404, "text/plain; charset=utf-8", "not found");
	const rest = u.slice(prefix.length).split("?")[0];
	if (req.method === "GET" && rest === "") return send(200, "text/html; charset=utf-8", page);
	const m = /^api\/([a-z-]+)$/.exec(rest);
	if (req.method !== "POST" || !m || !steps[m[1]]) return send(404, "text/plain; charset=utf-8", "not found");
	if (!/^application\/json/i.test(String(req.headers["content-type"] || ""))) return send(415, "text/plain; charset=utf-8", "json only");
	let body = "";
	let big = false;
	req.on("data", (c) => { body += c; if (body.length > 4096) { big = true; req.destroy(); } });
	req.on("end", async () => {
		if (big) return;
		let d = {};
		try { d = JSON.parse(body || "{}") || {}; } catch { return send(400, "application/json", JSON.stringify({ ok: false, msg: "请求不对。" })); }
		if (m[1] !== "hello") {
			if (stepping || finishing) return send(200, "application/json", JSON.stringify({ ok: false, msg: "正在处理上一步，请稍等。" }));
			stepping = true;
		}
		let out;
		try { out = await steps[m[1]](d); } catch { out = { ok: false, msg: "本机登录出错了，请重新打开 TDHarness。" }; }
		if (m[1] !== "hello") stepping = false;
		d = null;
		send(200, "application/json; charset=utf-8", JSON.stringify(out));
	});
});

server.on("error", () => process.exit(9));
server.listen(0, "127.0.0.1", () => {
	const addr = "http://127.0.0.1:" + server.address().port + prefix;
	try {
		fs.mkdirSync(rc8, { recursive: true });
		fs.writeFileSync(urlFile, addr + "\n", { mode: 0o600 });
		fs.writeFileSync(statusFile, "login\n");
	} catch { process.exit(9); }
	process.stdout.write("LOGIN_PAGE=1\n");
});

// The window closed (the app quit, start.command with it): nobody is left to sign in.
const parent = process.ppid;
setInterval(() => {
	let alive = true;
	try { process.kill(parent, 0); } catch { alive = false; }
	if (!alive || process.ppid === 1) finish(2);
	let st = "";
	try { st = fs.readFileSync(statusFile, "utf8").trim(); } catch { /* none */ }
	if (st === "quit") finish(2);
}, 1500);
