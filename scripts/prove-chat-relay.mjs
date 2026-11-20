// Proof for company-chat-desk-v1: the desk's chat relay (desk/plugins/company-shell/lib/chat-relay.js) against a
// stand-in site (the chat page under /chat/, Tinode's long polling and websocket under /v0/).
//   - the chat page needs the relay's per-start key, and only the Host 127.0.0.1:<port> is served;
//   - the page comes back with the chat token of the person at this desk (logged in with the desk's login
//     token, which never reaches the page), and the relay as its server;
//   - another person at the same desk: the page starts from empty storage;
//   - static files, long polling and the websocket go through; a websocket from another origin is refused;
//   - with no desk login the page still opens (Tinode's own login form), without a token;
//   - company-chat-mac-files-v1 (the Mac's window has no file chooser and saves no downloads): with the file
//     bridge on, the page carries it (valid script); choosing hands over only the chosen files, each once; saving
//     writes only into Downloads under a clean, unused name and shows it; all of it needs the page's key.
//   - company-chat-notify-v1: the relay watches the person's chats ("me", with the chat token): the unread count
//     from the contact list, a new message from someone else counts and is named (a new chat's name is fetched),
//     one's own message does not count, reading elsewhere takes it off.
// Prints CHAT_RELAY_PROVE_OK=1.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { startChatRelay } = await import(pathToFileURL(path.join(HERE, "..", "desk", "plugins", "company-shell", "lib", "chat-relay.js")).href);
const KEY = "AQ" + "k".repeat(30);
const DESK_TOKEN = "dsh_" + "d".repeat(32);

// --- the stand-in site ---------------------------------------------------------------------------------------
const sessions = new Map();
const logins = [];
const watchers = new Set(); // sessions attached to "me"
let meSubs = [
	{ topic: "usrTDH", public: { fn: "tdh" }, seq: 5, read: 3 },
	{ topic: "grpABC", public: { fn: "报价群" }, seq: 10, read: 10 },
];
function push(sid, m) {
	sessions.get(sid).push(m);
}
const site = http.createServer((req, res) => {
	const u = new URL(req.url, "http://x");
	if (u.pathname === "/chat/") {
		res.writeHead(200, { "content-type": "text/html" });
		res.end('<!doctype html><html><head><script src="vendor/react.production.min.js"></script></head><body></body></html>');
		return;
	}
	if (u.pathname === "/chat/umd/index.prod.js") {
		res.writeHead(200, { "content-type": "text/javascript" });
		res.end('s.d(t,["Lq",0,"' + KEY + '"]);');
		return;
	}
	if (u.pathname === "/v0/channels/lp") {
		assert.equal(u.searchParams.get("apikey"), KEY);
		const sid = u.searchParams.get("sid");
		const out = (lines) => { res.writeHead(200); res.end(lines.map((l) => JSON.stringify(l)).join("\n")); };
		if (!sid) {
			const id = "sid" + sessions.size;
			sessions.set(id, []);
			out([{ ctrl: { params: { sid: id }, code: 201 } }]);
			return;
		}
		if (req.method === "GET") {
			// Long polling: hold an empty answer a little, as Tinode holds it until there is news.
			const answer = () => { const q = sessions.get(sid); sessions.set(sid, []); out(q); };
			if (sessions.get(sid).length) answer();
			else setTimeout(answer, 150);
			return;
		}
		const chunks = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => {
			assert.ok(!/form/.test(String(req.headers["content-type"] || "")), "not a form body");
			const msg = JSON.parse(Buffer.concat(chunks).toString());
			const kind = Object.keys(msg)[0];
			const body = msg[kind];
			let ctrl = { id: body.id, code: 200 };
			if (kind === "login" && body.scheme === "token") {
				const ok = /^chat-token-of-/.test(body.secret);
				ctrl = ok ? { id: body.id, code: 200, params: { user: "usr" + body.secret.slice(14) } } : { id: body.id, code: 401 };
			} else if (kind === "sub" && body.topic === "me") {
				watchers.add(sid);
				push(sid, { ctrl });
				push(sid, { meta: { topic: "me", sub: meSubs } });
				out([]);
				return;
			} else if (kind === "get" && body.topic === "me") {
				push(sid, { meta: { topic: "me", sub: meSubs } });
			} else if (kind === "login") {
				const [login, pw] = Buffer.from(body.secret, "base64").toString().split(":");
				logins.push(login);
				ctrl = pw === DESK_TOKEN
					? { id: body.id, code: 200, params: { user: "usr" + login, token: "chat-token-of-" + login, expires: new Date(Date.now() + 14 * 86400e3).toISOString() } }
					: { id: body.id, code: 401 };
			}
			sessions.get(sid).push({ ctrl });
			out([]);
		});
		return;
	}
	if (u.pathname === "/v0/file/s/a.txt") {
		res.writeHead(200, { "content-type": "text/plain", "content-disposition": "attachment" });
		res.end("file body " + (req.headers["x-tinode-auth"] || ""));
		return;
	}
	res.writeHead(404);
	res.end();
});
site.on("upgrade", (req, sock) => {
	// A websocket that answers every text frame with "echo:<text>" (frames under 126 bytes are enough here).
	const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
	sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
	sock.on("data", (buf) => {
		const len = buf[1] & 0x7f;
		const mask = buf.subarray(2, 6);
		const data = Buffer.from(buf.subarray(6, 6 + len).map((b, i) => b ^ mask[i % 4]));
		const reply = Buffer.from("echo:" + data.toString() + " origin=" + req.headers.origin);
		sock.write(Buffer.concat([Buffer.from([0x81, reply.length]), reply]));
	});
});
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const SITE = "http://127.0.0.1:" + site.address().port;

// --- the relay ----------------------------------------------------------------------------------------------
let who = "lfh";
let deskToken = DESK_TOKEN;
const relay = startChatRelay({ site: () => SITE, deskToken: () => deskToken, login: () => who, files: null });
const port = await relay.ready;
assert.ok(port > 0, "the relay listens");
const pageUrl = new URL(relay.url());
assert.equal(pageUrl.hostname, "127.0.0.1");

function get(p, headers) {
	return new Promise((resolve) => {
		http.get({ host: "127.0.0.1", port, path: p, headers: Object.assign({ host: "127.0.0.1:" + port }, headers || {}) }, (r) => {
			const c = [];
			r.on("data", (d) => c.push(d));
			r.on("end", () => resolve({ status: r.statusCode, headers: r.headers, body: Buffer.concat(c).toString() }));
		});
	});
}
const boot = (html) => {
	const m = /var u=("[^"]*"),t=(null|\{[^;]*\});/.exec(html);
	return m ? { user: JSON.parse(m[1]), tok: JSON.parse(m[2]) } : null;
};

assert.equal((await get("/chat/")).status, 403, "no key: refused");
assert.equal((await get("/chat/?k=nope")).status, 403, "a wrong key: refused");
assert.equal((await get(pageUrl.pathname + pageUrl.search, { host: "attacker.example:" + port })).status, 421, "another Host (DNS rebinding): refused");

let page = await get(pageUrl.pathname + pageUrl.search);
assert.equal(page.status, 200);
let b = boot(page.body);
assert.ok(b, "the page carries the boot script: " + page.body.slice(0, 200));
assert.equal(b.user, "lfh");
assert.equal(b.tok.token, "chat-token-of-lfh", "the person's chat token");
assert.ok(!page.body.includes(DESK_TOKEN), "the desk's login token never reaches the page");
assert.ok(page.body.indexOf("tdh-chat-user") < page.body.indexOf("vendor/react"), "the boot script runs before the page's own scripts");
assert.match(page.body, /s\.clear\(\)/, "another person: empty storage first");
assert.match(page.body, /c\.serverAddress=location\.host/, "the relay is the page's server");
assert.equal(page.headers["cache-control"], "no-store");
assert.deepEqual(logins, ["lfh"]);

// The chat token is kept: a second open does not log in again.
page = await get(pageUrl.pathname + pageUrl.search);
assert.deepEqual(logins, ["lfh"], "the chat token is reused");

// Another person at this desk: their own token.
who = "tdh";
page = await get(pageUrl.pathname + pageUrl.search);
b = boot(page.body);
assert.equal(b.user, "tdh");
assert.equal(b.tok.token, "chat-token-of-tdh");

// No desk login: the page opens without a token (Tinode's login form).
deskToken = "";
page = await get(pageUrl.pathname + pageUrl.search);
assert.equal(page.status, 200);
assert.equal(boot(page.body).tok, null, "no desk login: no token");
deskToken = DESK_TOKEN;

// Static files, long polling and files go through.
let r = await get("/chat/umd/index.prod.js");
assert.equal(r.status, 200);
assert.ok(r.body.includes(KEY));
r = await get("/v0/channels/lp?apikey=" + KEY);
assert.match(r.body, /"sid"/, "long polling goes through");
r = await get("/v0/file/s/a.txt", { "x-tinode-auth": "Token abc" });
assert.equal(r.body, "file body Token abc", "file downloads carry Tinode's auth header");
assert.equal(r.headers["content-disposition"], "attachment");
assert.equal((await get("/elsewhere")).status, 404);

// The websocket: through for the chat page's own origin, refused for any other.
const own = "http://127.0.0.1:" + port;
const ws = new WebSocket("ws://127.0.0.1:" + port + "/v0/channels?apikey=" + KEY, { headers: { origin: own } });
const echoed = await new Promise((resolve) => {
	ws.onopen = () => ws.send("hi");
	ws.onmessage = (ev) => { resolve(String(ev.data)); ws.close(); };
	ws.onerror = () => resolve("error");
	setTimeout(() => resolve("timeout"), 8000);
});
assert.equal(echoed, "echo:hi origin=" + SITE, "the websocket goes through, as from the site's own origin");
const foreign = new WebSocket("ws://127.0.0.1:" + port + "/v0/channels?apikey=" + KEY, { headers: { origin: "http://attacker.example" } });
const fr = await new Promise((resolve) => {
	foreign.onopen = () => resolve("opened");
	foreign.onerror = () => resolve("refused");
	setTimeout(() => resolve("timeout"), 8000);
});
assert.equal(fr, "refused", "a websocket from another origin is refused");

assert.ok(!page.body.includes("/tdh/save"), "no file bridge unless it is on");
assert.equal((await get("/tdh/pick?k=" + pageUrl.searchParams.get("k"))).status, 403, "bridge off: its routes refuse");
await relay.close();

// --- the Mac file bridge -------------------------------------------------------------------------------------
const box = fs.mkdtempSync(path.join(os.tmpdir(), "tdh-chatfiles-"));
const downloads = path.join(box, "Downloads");
fs.mkdirSync(downloads);
const chosen = path.join(box, "报价单.pdf");
fs.writeFileSync(chosen, "%PDF-1.4 test");
const revealed = [];
const mac = startChatRelay({ site: () => SITE, deskToken: () => DESK_TOKEN, login: () => "lfh",
	files: { choose: async (multiple) => (multiple ? [chosen, box] : [chosen]), downloads, reveal: (p) => revealed.push(p) } });
const mport = await mac.ready;
const mk = new URL(mac.url()).searchParams.get("k");
function mreq(method, p, body) {
	return new Promise((resolve) => {
		// A fresh connection: this relay may sit on the port the first one had, whose kept connections are dead.
		const q = http.request({ host: "127.0.0.1", port: mport, path: p, method, agent: false, headers: { host: "127.0.0.1:" + mport } }, (r) => {
			const c = [];
			r.on("data", (d) => c.push(d));
			r.on("end", () => resolve({ status: r.statusCode, headers: r.headers, body: Buffer.concat(c) }));
		});
		q.on("error", (e) => resolve({ status: 0, headers: {}, body: Buffer.from(String(e && e.code)) }));
		if (body) q.write(body);
		q.end();
	});
}
const mpage = (await mreq("GET", "/chat/?k=" + mk)).body.toString();
const script = /<script>([\s\S]*?)<\/script>/.exec(mpage)[1];
assert.ok(script.includes("/tdh/save") && script.includes("/tdh/pick"), "the page carries the file bridge");
new vm.Script(script, { filename: "boot.js" });
assert.equal((await mreq("POST", "/tdh/pick?multiple=1")).status, 403, "no key: refused");
let j = JSON.parse((await mreq("POST", "/tdh/pick?multiple=1&k=" + mk)).body.toString());
assert.equal(j.ok, true);
assert.deepEqual(j.files.map((f) => [f.name, f.size, f.type]), [["报价单.pdf", 13, "application/pdf"]], "only the chosen file (not a folder)");
let got = await mreq("GET", "/tdh/picked?id=" + encodeURIComponent(j.files[0].id) + "&k=" + mk);
assert.equal(got.body.toString(), "%PDF-1.4 test");
assert.equal((await mreq("GET", "/tdh/picked?id=" + encodeURIComponent(j.files[0].id) + "&k=" + mk)).status, 404, "each chosen file is handed over once");
assert.equal((await mreq("GET", "/tdh/picked?id=nope&k=" + mk)).status, 404, "nothing that was not chosen");
let s = JSON.parse((await mreq("POST", "/tdh/save?name=" + encodeURIComponent("../../etc/回执.txt") + "&k=" + mk, Buffer.from("saved body"))).body.toString());
assert.deepEqual(s, { ok: true, name: "回执.txt" }, "saved under its own name, never outside Downloads");
assert.equal(fs.readFileSync(path.join(downloads, "回执.txt"), "utf8"), "saved body");
s = JSON.parse((await mreq("POST", "/tdh/save?name=" + encodeURIComponent("回执.txt") + "&k=" + mk, Buffer.from("second"))).body.toString());
assert.equal(s.name, "回执 (1).txt", "an existing file is never overwritten");
s = JSON.parse((await mreq("POST", "/tdh/save?name=" + encodeURIComponent(".hidden") + "&k=" + mk, Buffer.from("x"))).body.toString());
assert.equal(s.name, "hidden", "no hidden files");
assert.deepEqual(fs.readdirSync(downloads).sort(), ["hidden", "回执 (1).txt", "回执.txt"], "nothing else written, no part files left");
assert.equal(revealed.length, 3, "each saved file is shown in Finder");
assert.equal((await mreq("POST", "/tdh/save?name=x.txt", Buffer.from("x"))).status, 403, "saving needs the key");
await mac.close();
fs.rmSync(box, { recursive: true, force: true });

// --- the unread watcher ---------------------------------------------------------------------------------------
const w = startChatRelay({ site: () => SITE, deskToken: () => DESK_TOKEN, login: () => "lfh", files: null, warmMs: 10 });
await w.ready;
const until = async (what, cond) => {
	for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 50));
	assert.ok(cond(), what + ": " + JSON.stringify(w.unread(0)));
};
await until("the watcher is on and has the contact list", () => w.unread(0).live && w.unread(0).count === 2);
const pres = (p) => { for (const sid of watchers) push(sid, { pres: Object.assign({ topic: "me" }, p) }); };
pres({ src: "grpABC", what: "msg", seq: 11, act: "usrTDH" });
await until("someone else's message in the group counts and is named", () => w.unread(0).count === 3 && w.unread(0).events.length === 1);
let ev = w.unread(0).events[0];
assert.deepEqual([ev.topic, ev.from, ev.group], ["grpABC", "报价群", true]);
pres({ src: "usrTDH", what: "msg", seq: 6 });
await new Promise((r) => setTimeout(r, 500));
// Sending marks the chat read up to one's own message (Tinode moves the sender's read pointer): tdh's 2 are gone.
assert.equal(w.unread(0).count, 1, "one's own message (no sender named) does not count, and reads the chat up to it");
assert.equal(w.unread(0).events.length, 1, "and is not announced");
pres({ src: "grpABC", what: "read", seq: 11 });
await until("reading elsewhere takes it off", () => w.unread(0).count === 0);
meSubs = meSubs.concat([{ topic: "grpNEW", public: { fn: "新群" }, seq: 1, read: 0 }]);
pres({ src: "grpNEW", what: "msg", seq: 1, act: "usrTDH" });
await until("a message in a chat the watcher did not know: named after a refresh", () => {
	const e = w.unread(0).events;
	return e.length === 2 && e[1].from === "新群" && w.unread(0).count === 1;
});
const seq = w.unread(0).seq;
assert.deepEqual(w.unread(seq).events, [], "nothing new after the last one seen");
assert.equal(w.unread(seq - 1).events.length, 1);
await w.close();

// Values in the boot script cannot end it.
const odd = startChatRelay({ site: () => SITE, deskToken: () => "", login: () => "a</script><b>", files: null });
const oport = await odd.ready;
const ok = new URL(odd.url()).searchParams.get("k");
const oddPage = await new Promise((resolve) => http.get({ host: "127.0.0.1", port: oport, path: "/chat/?k=" + ok, agent: false, headers: { host: "127.0.0.1:" + oport } }, (r) => {
	const c = []; r.on("data", (d) => c.push(d)); r.on("end", () => resolve(Buffer.concat(c).toString()));
}));
assert.ok(!oddPage.includes("a</script>"), "a login cannot close the script element");
await odd.close();
site.close();
console.log("CHAT_RELAY_PROVE_OK=1");
process.exit(0);
