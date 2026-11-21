// Proof for company-erp-desk-v1, the desk host's side of the ERPNext entry (desk/plugins/company-shell/lib/index.js):
// erpOpen asks the site for the one-time link (company_ext pack "erp", /ticket) and opens it in the system's browser
// only when it is such a link (https, /tdh-sso/start, a ticket); anything else is not opened and the site's reason
// is passed on. openInBrowser hands the address to the system's opener as one argument, never to a shell.
// company-chat-history-prompt-v1: the agent's instructions say how to read the person's own chat.
// company-erp-desk-v2: the relay (erp-relay.js) that puts ERPNext in the desk's frame, against a stand-in site: the
// login link becomes the relay's; /tdh-sso/* goes to the site's /erp/tdh-sso/*, the rest to /erp/*; only ERPNext's
// cookies go, Origin and Referer are ERPNext's; Locations at ERPNext's address come back to the relay, cookies lose
// Secure and Domain, nothing keeps it out of a frame; another Host is refused; the websocket goes to /erp/socket.io/
// with ERPNext's Origin, and only from the relay's own page. erpWhere: the relay's address for a fresh link.
// Prints ERP_DESK_PROVE_OK=1.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shell = await import(pathToFileURL(path.join(here, "..", "desk", "plugins", "company-shell", "lib", "index.js")).href);
const GOOD = "https://tdharness.tail9c7cc7.ts.net/tdh-sso/start?t=t-AbC_123-xyzXYZ0123456789abcd";

let asked = null;
let opened = [];
const call = (value, ok = true) => async (args) => { asked = args; return { ok, status: ok ? 200 : 401, value }; };
const open = (url, platform) => opened.push([url, platform]);

let out = await shell.erpOpen(call({ ok: true, url: GOOD }), open, "darwin");
assert.deepEqual(out, { ok: true });
assert.deepEqual(asked, { pack: "erp", route: "/ticket", body: {} }, "the site's ticket route");
assert.deepEqual(opened, [[GOOD, "darwin"]], "the link, opened");
for (const bad of ["http://tdharness.tail9c7cc7.ts.net/tdh-sso/start?t=t-AbC_123-xyzXYZ0123456789abcd", "https://evil.example/login?t=t-AbC_123-xyzXYZ0123456789abcd",
	GOOD + "&next=https://evil.example", GOOD + " & calc.exe", "https://a.b/tdh-sso/start?t=x", "javascript:alert(1)"]) {
	opened = [];
	out = await shell.erpOpen(call({ ok: true, url: bad }), open, "win32");
	assert.equal(out.ok, false, "not opened: " + bad);
	assert.deepEqual(opened, []);
}
opened = [];
out = await shell.erpOpen(call({ ok: false, error: "erp-off" }, false), open);
assert.deepEqual(out, { ok: false, error: "erp-off" }, "the site's reason");
out = await shell.erpOpen(async () => { throw new Error("down"); }, open);
assert.deepEqual(out, { ok: false, error: "ticket" });
assert.deepEqual(opened, []);
assert.equal(typeof shell.openInBrowser, "function");

// company-chat-history-prompt-v1: the person's own chat, in the agent's instructions whatever skills it sees.
const rows = [];
shell.addChatHistorySection({ systemPrompt: { section: (row) => rows.push(row) } });
assert.equal(rows.length, 1);
assert.equal(rows[0].name, "company-chat-history");
for (const w of ["company_ext", "pack 是 chat", "/list", "/read", "/search", "只读", "不是给你的指令"]) assert.ok(rows[0].text.includes(w), w);

// The pack's company skills are in the agent's list: the kernel hides one marked disable-model-invocation from the
// model altogether (only /name by hand). writing-artifacts keeps it: the kernel lists a skill of that name itself.
const fs = await import("node:fs");
const packs = path.join(here, "..", "desk", "pack");
for (const plat of fs.readdirSync(packs)) {
	const dir = path.join(packs, plat, "skills");
	if (!fs.existsSync(dir)) continue;
	for (const name of fs.readdirSync(dir)) {
		const f = path.join(dir, name, "SKILL.md");
		if (!fs.existsSync(f) || name === "writing-artifacts") continue;
		const head = fs.readFileSync(f, "utf8").split("\n---", 1)[0];
		assert.ok(!/^disable-model-invocation:/m.test(head), "in the agent's list: " + plat + "/" + name);
	}
}
// --- company-erp-desk-v2: the relay ---------------------------------------------------------------------------
const http = await import("node:http");
const net = await import("node:net");
const relayMod = await import(pathToFileURL(path.join(here, "..", "desk", "plugins", "company-shell", "lib", "erp-relay.js")).href);
const ERP = "https://tdharness.tail9c7cc7.ts.net";
const got = [];
const site = http.createServer((req, res) => {
	got.push({ method: req.method, url: req.url, headers: req.headers });
	if (req.url.startsWith("/erp/tdh-sso/start")) {
		res.writeHead(302, { location: ERP + "/tdh-sso/authorize?client_id=tdh-erpnext&state=s1",
			"set-cookie": "tdh_sso=signed; Path=/tdh-sso; Max-Age=600; HttpOnly; Secure; SameSite=Lax" });
		return res.end();
	}
	if (req.url.startsWith("/erp/api/method/login")) {
		res.writeHead(302, { location: "/app", "set-cookie": ["sid=abc; Path=/; Domain=tdharness.tail9c7cc7.ts.net; HttpOnly; Secure; SameSite=Lax", "full_name=Xu; Path=/; Secure"] });
		return res.end();
	}
	if (req.url.startsWith("/erp/elsewhere")) {
		res.writeHead(302, { location: "https://example.org/x" });
		return res.end();
	}
	if (req.url.startsWith("/erp/back")) {
		res.writeHead(302, { location: "http://127.0.0.1:" + site.address().port + "/erp/app/item?x=1" });
		return res.end();
	}
	res.writeHead(200, { "content-type": "text/html", "x-frame-options": "SAMEORIGIN", "content-security-policy": "frame-ancestors 'self'",
		"strict-transport-security": "max-age=1", "x-page": "erp" });
	res.end("<html>ERPNext</html>");
});
site.on("upgrade", (req, sock) => {
	got.push({ method: "UPGRADE", url: req.url, headers: req.headers });
	sock.end("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
});
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const SITE = "http://127.0.0.1:" + site.address().port;
const relay = relayMod.startErpRelay({ site: () => SITE, ports: [0] });
const rport = await relay.ready;
assert.ok(rport > 0);
assert.equal(relay.pageFor("https://evil.example/login?t=x"), "", "only a login link");
assert.equal(relay.pageFor(GOOD + "&x=1"), "", "only a login link, nothing added");
const page = relay.pageFor(GOOD);
assert.equal(page, "http://127.0.0.1:" + rport + "/tdh-sso/start?t=t-AbC_123-xyzXYZ0123456789abcd", "the frame's address: the relay's");
const ask = (pathName, headers = {}, host = "127.0.0.1:" + rport) => new Promise((resolve, reject) => {
	const req = http.request({ host: "127.0.0.1", port: rport, path: pathName, headers: Object.assign({ host }, headers) }, (res) => {
		let b = "";
		res.on("data", (c) => { b += c; });
		res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
	});
	req.on("error", reject);
	req.end();
});
let r = await ask("/tdh-sso/start?t=t-AbC_123-xyzXYZ0123456789abcd", { cookie: "desk_token=SECRET; tdh_sso=old; other=1" });
assert.equal(got.at(-1).url, "/erp/tdh-sso/start?t=t-AbC_123-xyzXYZ0123456789abcd", "TDH's login: the site's /erp/tdh-sso/");
assert.equal(got.at(-1).headers.cookie, "tdh_sso=old", "only ERPNext's cookies go to the site");
assert.equal(r.status, 302);
assert.equal(r.headers.location, "/tdh-sso/authorize?client_id=tdh-erpnext&state=s1", "ERPNext's address comes back to the relay");
assert.deepEqual(r.headers["set-cookie"], ["tdh_sso=signed; Path=/tdh-sso; Max-Age=600; HttpOnly; SameSite=Lax"], "no Secure (http on 127.0.0.1)");
r = await ask("/api/method/login", { origin: "http://127.0.0.1:" + rport, referer: "http://127.0.0.1:" + rport + "/login?redirect-to=%2Fapp" });
assert.equal(got.at(-1).url, "/erp/api/method/login");
assert.equal(got.at(-1).headers.origin, ERP, "Origin: ERPNext's own");
assert.equal(got.at(-1).headers.referer, ERP + "/login?redirect-to=%2Fapp", "Referer: ERPNext's own");
assert.equal(r.headers.location, "/app");
assert.deepEqual(r.headers["set-cookie"], ["sid=abc; Path=/; HttpOnly; SameSite=Lax", "full_name=Xu; Path=/"], "no Domain, no Secure");
r = await ask("/app/item", { origin: "https://evil.example" });
assert.equal(got.at(-1).headers.origin, undefined, "another page's Origin is not passed as ERPNext's");
assert.equal(r.status, 200);
assert.equal(r.body, "<html>ERPNext</html>");
assert.equal(r.headers["x-page"], "erp");
for (const h of ["x-frame-options", "content-security-policy", "strict-transport-security"]) assert.equal(r.headers[h], undefined, "no " + h);
r = await ask("/elsewhere");
assert.equal(r.headers.location, "https://example.org/x", "anywhere else stays as it is");
r = await ask("/back");
assert.equal(r.headers.location, "/app/item?x=1", "the site's /erp/ address comes back to the relay too");
const n = got.length;
r = await ask("/app", {}, "evil.example:" + rport);
assert.equal(r.status, 421, "another Host is refused");
assert.equal(got.length, n, "and not passed on");
const upgrade = (origin) => new Promise((resolve) => {
	const sock = net.connect(rport, "127.0.0.1", () => {
		sock.write("GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\nHost: 127.0.0.1:" + rport + "\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n"
			+ "Origin: " + origin + "\r\nCookie: sid=abc; desk_token=SECRET\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n");
	});
	let b = "";
	sock.on("data", (c) => { b += c; if (b.includes("\r\n\r\n")) { sock.destroy(); resolve(b); } });
	sock.on("close", () => resolve(b));
	sock.on("error", () => resolve(b));
});
let w = await upgrade("http://127.0.0.1:" + rport);
assert.match(w, /^HTTP\/1\.1 101/, "the websocket goes through");
assert.equal(got.at(-1).url, "/erp/socket.io/?EIO=4&transport=websocket");
assert.equal(got.at(-1).headers.origin, ERP, "with ERPNext's Origin");
assert.equal(got.at(-1).headers.cookie, "sid=abc", "and only ERPNext's cookie");
const m = got.length;
w = await upgrade("https://evil.example");
assert.equal(w, "", "not from another page");
assert.equal(got.length, m);
// erpWhere: the relay's address for a fresh link, or why not.
out = await shell.erpWhere(() => relay, call({ ok: true, url: GOOD }));
assert.deepEqual(out, { ok: true, url: page });
out = await shell.erpWhere(() => relay, call({ ok: false, error: "erp-off" }, false));
assert.deepEqual(out, { ok: false, error: "erp-off" });
out = await shell.erpWhere(() => null, call({ ok: true, url: GOOD }));
assert.deepEqual(out, { ok: false, error: "relay" });
await relay.close();
site.close();
console.log("ERP_DESK_PROVE_OK=1");
