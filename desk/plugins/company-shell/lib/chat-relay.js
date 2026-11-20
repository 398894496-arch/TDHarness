// company-chat-desk-v1: the company chat (Tinode on the site: its page under /chat/, its API under /v0/) for
// this desk's 聊天 panel and right-sidebar tab.
//
// The desk's window cannot reach the site itself (the site's certificate is not one the system trusts; the desk's
// own requests already skip that check, see proxyCompany), so this desk's host relays it: a small server on this
// machine only, on a port of its own. A port of its own is a separate origin, so the chat page shares nothing
// with the desk page (its storage, its tools): a message that broke out of the chat page would land in a page
// that can do nothing but chat.
//
// The person is already logged in to the desk. Opening the chat page, this relay logs in to the chat with the
// desk's login token (Tinode's REST login on the site accepts it, see server/people-api.py) and hands the page
// only the chat's own token, never the desk's.
//   - The page needs the relay's per-start key (?k=…), which only the desk page is told (/company/chat/where):
//     another account on this machine, or a web page in a browser, cannot get this person's chat token.
//   - Only the Host 127.0.0.1:<port> / localhost:<port> is served (no DNS rebinding), and only the chat page's
//     own origin may open the websocket.
//   - Another person logging in on this desk starts from empty chat storage, not the previous person's.
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, renameSync, statSync, unlinkSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";
import { gunzipSync } from "node:zlib";

// Fixed first, so the chat page keeps its storage between starts; any free port when all are taken.
const PORTS = [17811, 17812, 17813, 17814, 0];
const PASS_REQ = ["accept", "accept-language", "content-type", "content-length", "range", "if-none-match",
	"if-modified-since", "if-range", "x-tinode-apikey", "x-tinode-auth", "authorization"];
const PASS_RES = ["content-type", "content-length", "content-encoding", "cache-control", "etag", "last-modified",
	"content-disposition", "content-range", "accept-ranges", "expires", "vary"];

// Connections to the site are kept and reused: away from the office every new TLS connection costs seconds.
const AGENTS = {
	"http:": new http.Agent({ keepAlive: true, maxSockets: 24 }),
	"https:": new https.Agent({ keepAlive: true, maxSockets: 24, rejectUnauthorized: false }),
};

function tlsOpts(u, fresh) {
	return {
		hostname: u.hostname,
		port: u.port || (u.protocol === "http:" ? 80 : 443),
		rejectUnauthorized: false,
		agent: fresh ? false : AGENTS[u.protocol === "http:" ? "http:" : "https:"],
	};
}

function libFor(u) {
	return u.protocol === "http:" ? http : https;
}

function fetchSite(base, pathName, method, body, headers, timeoutMs) {
	const u = new URL(pathName, base);
	return new Promise((resolve) => {
		const req = libFor(u).request(Object.assign(tlsOpts(u), {
			method,
			path: u.pathname + (u.search || ""),
			headers: Object.assign({ Accept: "*/*", "Accept-Encoding": "gzip" }, headers || {},
				body ? { "Content-Length": String(body.length) } : {}),
		}), (res) => {
			const chunks = [];
			res.on("data", (c) => chunks.push(c));
			res.on("end", () => {
				let buf = Buffer.concat(chunks);
				if (/gzip/i.test(String(res.headers["content-encoding"] || ""))) {
					try { buf = gunzipSync(buf); } catch { buf = Buffer.alloc(0); }
				}
				resolve({ status: res.statusCode || 502, body: buf, headers: res.headers });
			});
			res.on("error", () => resolve({ status: 502, body: Buffer.alloc(0), headers: {} }));
		});
		req.setTimeout(timeoutMs || 20000, () => req.destroy(new Error("timeout")));
		req.on("error", () => resolve({ status: 502, body: Buffer.alloc(0), headers: {} }));
		if (body) req.write(body);
		req.end();
	});
}

function lines(buf) {
	const out = [];
	for (const l of String(buf || "").split("\n")) {
		if (!l.trim()) continue;
		try { out.push(JSON.parse(l)); } catch { /* not ours */ }
	}
	return out;
}

// The web client's API key is the one its own bundle carries (Tinode's published web key, not a secret): read
// from the page this site serves, so it is whatever this site's release ships.
let apiKeyCache = "";
async function apiKey(base) {
	if (apiKeyCache) return apiKeyCache;
	const r = await fetchSite(base, "/chat/umd/index.prod.js", "GET", null, null, 20000);
	const m = r.status === 200 ? /"(AQ[A-Za-z0-9_-]{30})"/.exec(r.body.toString("utf8")) : null;
	if (m) apiKeyCache = m[1];
	return apiKeyCache;
}

// One login over long polling: open a session, {hi}, {login basic "login:<desk token>"}; the answer to the login
// carries the chat token. Returns {token, expires, user} or null.
export async function chatLogin(base, login, deskToken) {
	if (!login || !deskToken) return null;
	const key = await apiKey(base);
	if (!key) return null;
	const lp = "/v0/channels/lp?apikey=" + encodeURIComponent(key);
	const open = await fetchSite(base, lp, "GET", null, null, 15000);
	let sid = "";
	for (const m of lines(open.body)) if (m.ctrl && m.ctrl.params && m.ctrl.params.sid) sid = m.ctrl.params.sid;
	if (!sid) return null;
	const at = lp + "&sid=" + encodeURIComponent(sid);
	async function send(msg, id) {
		// Not a form body: Tinode reads a form-typed POST as a form and calls the message malformed.
		const first = await fetchSite(base, at, "POST", Buffer.from(JSON.stringify(msg), "utf8"), { "Content-Type": "text/plain" }, 15000);
		let got = lines(first.body);
		const deadline = Date.now() + 15000;
		while (Date.now() < deadline) {
			for (const m of got) if (m.ctrl && m.ctrl.id === id) return m.ctrl;
			got = lines((await fetchSite(base, at, "GET", null, null, 15000)).body);
		}
		return null;
	}
	const hi = await send({ hi: { id: "1", ver: "0.25", ua: "TDH-desk/1.0" } }, "1");
	if (!hi || hi.code >= 300) return null;
	const secret = Buffer.from(login + ":" + deskToken, "utf8").toString("base64");
	const r = await send({ login: { id: "2", scheme: "basic", secret } }, "2");
	const p = (r && r.code < 300 && r.params) || null;
	if (!p || !p.token) return null;
	return { token: p.token, expires: p.expires, user: p.user };
}

// company-chat-mac-files-v1: the Mac desk's window (WKWebView) has no file chooser and does not save downloads,
// so on a Mac the chat page asks this relay instead: 选文件 opens macOS's own chooser (osascript) and hands the
// chosen files to the page; a download is written to ~/Downloads and shown in Finder. Only with the page's key,
// only files the person chose, only into Downloads. Windows' window (WebView2) does both itself.
const MAX_FILE = 200 * 1024 * 1024; // the chat's own limit (tinode.conf media.max_size)
const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
	".heic": "image/heic", ".pdf": "application/pdf", ".txt": "text/plain", ".csv": "text/csv", ".zip": "application/zip",
	".mp4": "video/mp4", ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
	".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".ppt": "application/vnd.ms-powerpoint", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation" };

// Runs in the chat page (Mac only), before its own scripts.
function macFileBridge() {
	var K = new URLSearchParams(location.search).get("k") || "";
	function q(p) { return p + (p.indexOf("?") < 0 ? "?" : "&") + "k=" + encodeURIComponent(K); }
	function note(text) {
		try {
			var d = document.createElement("div");
			d.textContent = text;
			d.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:8px 14px;border-radius:8px;font:13px -apple-system,sans-serif;z-index:2147483647;max-width:80%";
			document.body.appendChild(d);
			setTimeout(function () { d.remove(); }, 4000);
		} catch (e) { /* nothing to show it on */ }
	}
	// Saving: the chat builds a downloaded file as a blob and clicks a link to it (then revokes it at once), so each
	// blob is remembered for a minute; a link to anything else (an image's own address) is fetched by the page.
	var blobs = new Map();
	var make = URL.createObjectURL;
	URL.createObjectURL = function (o) {
		var u = make.call(URL, o);
		if (o instanceof Blob) {
			blobs.set(u, o);
			setTimeout(function () { blobs.delete(u); }, 60000);
		}
		return u;
	};
	function save(href, name) {
		var b = blobs.get(href);
		note("正在存到「下载」…");
		(b ? Promise.resolve(b) : fetch(href).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.blob(); }))
			.then(function (blob) {
				return fetch(q("/tdh/save?name=" + encodeURIComponent(name || "文件")), { method: "POST", body: blob });
			})
			.then(function (r) { return r.json(); })
			.then(function (j) { note(j.ok ? "已存到「下载」：" + j.name : "没存下来：" + (j.error || "")); }, function () { note("没存下来"); });
	}
	// Choosing: a click on a file input (or its label), or the page calling .click() on one.
	var busy = false;
	function pick(inp) {
		if (busy) return;
		busy = true;
		fetch(q("/tdh/pick?multiple=" + (inp.multiple ? 1 : 0)), { method: "POST" })
			.then(function (r) { return r.json(); })
			.then(function (j) {
				if (!j.ok) { if (j.error) note(j.error); return null; }
				return Promise.all(j.files.map(function (f) {
					return fetch(q("/tdh/picked?id=" + encodeURIComponent(f.id)))
						.then(function (r) { return r.blob(); })
						.then(function (b) { return new File([b], f.name, { type: f.type || b.type || "" }); });
				}));
			})
			.then(function (files) {
				if (!files || !files.length) return;
				var dt = new DataTransfer();
				files.forEach(function (f) { dt.items.add(f); });
				inp.files = dt.files;
				inp.dispatchEvent(new Event("change", { bubbles: true }));
			}, function () { note("文件没选成"); })
			.then(function () { busy = false; });
	}
	function fileInput(el) {
		if (!el || el.nodeType !== 1) return null;
		if (el.tagName === "INPUT" && el.type === "file") return el;
		var lab = el.closest ? el.closest("label") : null;
		var c = lab && (lab.control || (lab.htmlFor && document.getElementById(lab.htmlFor)));
		return c && c.tagName === "INPUT" && c.type === "file" ? c : null;
	}
	// One listener for both: a download link (clicked by the person, or by the page's own link.click(), which runs
	// this before the page revokes the blob) and a file input.
	document.addEventListener("click", function (e) {
		var t = e.target;
		var link = t && t.nodeType === 1 && t.closest ? t.closest("a[download]") : null;
		if (link && link.href) {
			e.preventDefault();
			e.stopPropagation();
			save(link.href, link.getAttribute("download"));
			return;
		}
		var inp = fileInput(t);
		if (!inp) return;
		e.preventDefault();
		e.stopPropagation();
		pick(inp);
	}, true);
	var iclick = HTMLInputElement.prototype.click;
	HTMLInputElement.prototype.click = function () {
		if (this.type === "file") { pick(this); return; }
		return iclick.apply(this, arguments);
	};
}

const CHOOSE = [
	"on run argv",
	"tell me to activate",
	"try",
	"if item 1 of argv is \"1\" then",
	"set fs to choose file with prompt (item 2 of argv) with multiple selections allowed",
	"else",
	"set fs to {choose file with prompt (item 2 of argv)}",
	"end if",
	"on error number -128",
	"return \"\"",
	"end try",
	"set out to \"\"",
	"repeat with f in fs",
	"set out to out & POSIX path of f & linefeed",
	"end repeat",
	"return out",
	"end run",
];

// macOS's own file chooser; resolves to the chosen paths ([] when cancelled).
function chooseOnMac(multiple) {
	const args = [];
	for (const line of CHOOSE) args.push("-e", line);
	args.push(multiple ? "1" : "0", "选择要发到聊天里的文件");
	return new Promise((resolve) => {
		execFile("osascript", args, { timeout: 10 * 60 * 1000, maxBuffer: 1 << 20 }, (err, out) => {
			if (err) { resolve([]); return; }
			resolve(String(out || "").split("\n").map((s) => s.trim()).filter(Boolean));
		});
	});
}

function safeName(name) {
	let n = path.basename(String(name || "").replace(/\\/g, "/"));
	n = n.replace(/[\u0000-\u001f\u007f:]/g, "").replace(/^\.+/, "").trim();
	if (n.length > 180) {
		const ext = path.extname(n).slice(0, 20);
		n = n.slice(0, 180 - ext.length) + ext;
	}
	return n || "文件";
}

function freePath(dir, name) {
	const ext = path.extname(name);
	const stem = name.slice(0, name.length - ext.length);
	let p = path.join(dir, name);
	for (let i = 1; existsSync(p) && i < 1000; i++) p = path.join(dir, stem + " (" + i + ")" + ext);
	return p;
}

// company-chat-notify-v1 -----------------------------------------------------------------------------------------
// A long-polling session to the site that hands every message that is not the answer it waits for to `onOther`.
function lpSession(base, key) {
	const lp = "/v0/channels/lp?apikey=" + encodeURIComponent(key);
	let at = "";
	let n = 0;
	const s = {
		async open() {
			const r = await fetchSite(base, lp, "GET", null, null, 15000);
			for (const m of lines(r.body)) if (m.ctrl && m.ctrl.params && m.ctrl.params.sid) at = lp + "&sid=" + encodeURIComponent(m.ctrl.params.sid);
			return !!at;
		},
		// Waits until the site has something to say (Tinode holds the request); a failed or refused poll throws.
		async poll(ms) {
			const r = await fetchSite(base, at, "GET", null, null, ms || 120000);
			if (r.status >= 300) throw new Error("lp " + r.status);
			return lines(r.body);
		},
		async send(msg, onOther) {
			const id = String(++n);
			msg[Object.keys(msg)[0]].id = id;
			const first = await fetchSite(base, at, "POST", Buffer.from(JSON.stringify(msg), "utf8"), { "Content-Type": "text/plain" }, 15000);
			if (first.status >= 300) throw new Error("lp " + first.status);
			let got = lines(first.body);
			const deadline = Date.now() + 15000;
			while (Date.now() < deadline) {
				let hit = null;
				for (const m of got) {
					if (m.ctrl && m.ctrl.id === id) hit = m.ctrl;
					else onOther(m);
				}
				if (hit) return hit;
				got = await s.poll(15000);
			}
			return null;
		},
	};
	return s;
}

// The system's own notification (TDH's window is in the background). Mac: osascript; Windows: a toast through
// Windows PowerShell's registered app id (no app id of TDH's own yet). At most one every 3 seconds.
let lastNotify = 0;
export function systemNotify(title, body) {
	const now = Date.now();
	if (now - lastNotify < 3000) return false;
	lastNotify = now;
	const t = String(title || "").slice(0, 80);
	const b = String(body || "").slice(0, 200);
	if (process.platform === "darwin") {
		execFile("osascript", ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", t, b], () => {});
		return true;
	}
	if (process.platform === "win32") {
		const ps = "[void][Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime];" +
			"[void][Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime];" +
			"$e=[Security.SecurityElement];$x=New-Object Windows.Data.Xml.Dom.XmlDocument;" +
			"$x.LoadXml('<toast><visual><binding template=\"ToastGeneric\"><text>'+$e::Escape($env:TDH_NT)+'</text><text>'+$e::Escape($env:TDH_NB)+'</text></binding></visual></toast>');" +
			"[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))";
		execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps],
			{ windowsHide: true, env: Object.assign({}, process.env, { TDH_NT: t, TDH_NB: b }) }, () => {});
		return true;
	}
	return false;
}

// company-chat-shot-v1: 截图 in the chat takes a screenshot with the system's own tool on this computer, as the
// keyboard shortcut would: the Mac's region selection (screencapture -i), Windows' snipping overlay (ms-screenclip:,
// then the picture it leaves on the clipboard). The picture goes back to the page, which holds it in the input box.
function captureOnMac(out) {
	return new Promise((resolve) => {
		execFile("screencapture", ["-i", "-x", out], { timeout: 5 * 60 * 1000 }, () => {
			try { resolve(statSync(out).size > 0); } catch { resolve(false); }
		});
	});
}
const WIN_SHOT = [
	"Add-Type -AssemblyName System.Windows.Forms, System.Drawing",
	"Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class TdhClip { [DllImport(\"user32.dll\")] public static extern uint GetClipboardSequenceNumber(); }'",
	"$seq = [TdhClip]::GetClipboardSequenceNumber()",
	"Start-Process 'ms-screenclip:'",
	"$t0 = Get-Date",
	"while (((Get-Date) - $t0).TotalSeconds -lt 120) {",
	"  Start-Sleep -Milliseconds 300",
	"  if ([TdhClip]::GetClipboardSequenceNumber() -ne $seq) {",
	"    Start-Sleep -Milliseconds 300",
	"    if ([System.Windows.Forms.Clipboard]::ContainsImage()) { [System.Windows.Forms.Clipboard]::GetImage().Save($env:TDH_SHOT_OUT, [System.Drawing.Imaging.ImageFormat]::Png); exit 0 }",
	"    $seq = [TdhClip]::GetClipboardSequenceNumber()",
	"  }",
	"  if (((Get-Date) - $t0).TotalSeconds -gt 3 -and -not (Get-Process ScreenClippingHost, SnippingTool -ErrorAction SilentlyContinue)) { exit 2 }",
	"}",
	"exit 1",
].join("\n");
function captureOnWindows(out) {
	return new Promise((resolve) => {
		execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-Command", WIN_SHOT],
			{ windowsHide: true, timeout: 3 * 60 * 1000, env: Object.assign({}, process.env, { TDH_SHOT_OUT: out }) }, () => {
				try { resolve(statSync(out).size > 0); } catch { resolve(false); }
			});
	});
}

function bootScript(login, tok, files, shot) {
	// Runs before the chat page's own scripts: the person's chat token in the page's storage (it logs in by itself
	// from there), the relay as its server. A different person than last time: empty storage first.
	// The values are data: "<" escaped inside them, so nothing in them can end the script element.
	const data = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
	const js = "(function(){var u=" + data(login || "") + ",t=" + data(tok ? { token: tok.token, expires: tok.expires } : null) + ";" +
		"try{var s=window.localStorage;" +
		"if(u&&s.getItem('tdh-chat-user')!==u){s.clear();try{indexedDB.deleteDatabase('tinode-web')}catch(e){}s.setItem('tdh-chat-user',u)}" +
		"if(t){s.setItem('keep-logged-in','true');s.setItem('auth-token',JSON.stringify(t))}" +
		"var c={};try{c=JSON.parse(s.getItem('settings')||'{}')||{}}catch(e){}" +
		"c.serverAddress=location.host;c.secureConnection=false;s.setItem('settings',JSON.stringify(c))" +
		"}catch(e){}})();" +
		(shot ? "window.TDH_SHOT=1;" : "") +
		(files ? "try{(" + BRIDGE + ")()}catch(e){}" : "");
	return "<script>" + js + "</script>";
}

// The bridge's own source, checked once: it must not close the script element it is put in.
const BRIDGE = macFileBridge.toString();
if (/<\/script/i.test(BRIDGE)) throw new Error("chat-relay: the file bridge closes its script element");

/**
 * Start the relay. `site()` is the site's base URL, `deskToken()` and `login()` this desk's login.
 * Returns { url(): string | "", close(): Promise }.
 */
export function startChatRelay(opts) {
	const site = opts.site;
	const deskToken = opts.deskToken;
	const loginName = opts.login;
	const pageKey = randomBytes(18).toString("base64url");
	// The Mac file bridge (see macFileBridge): on by default on a Mac; tests hand in their own chooser.
	const fb = opts.files === undefined ? (process.platform === "darwin" ? {} : null) : opts.files;
	const files = fb && {
		choose: fb.choose || chooseOnMac,
		downloads: fb.downloads || path.join(os.homedir(), "Downloads"),
		reveal: fb.reveal || ((p) => { execFile("open", ["-R", p], () => {}); }),
	};
	// Screenshots (see captureOnMac): on by default on a Mac and on Windows; tests hand in their own capturer.
	const sh = opts.shot === undefined
		? (process.platform === "darwin" ? { capture: captureOnMac } : process.platform === "win32" ? { capture: captureOnWindows } : null)
		: opts.shot;
	const shot = sh && { capture: sh.capture || captureOnMac };
	let shooting = false;
	const picked = new Map();
	let port = 0;
	let cache = { who: "", tok: null };
	const sockets = new Set();
	let warm = null;

	// company-chat-notify-v1: the person's unread count and new messages, watched from this desk's host so the desk
	// can show them while the chat page is closed. A session of its own (long polling, the chat token) on "me":
	// Tinode tells it about every new message in a chat it is not attached to ("msg", with who sent it; one's own
	// messages carry no sender and are read already) and about reading done elsewhere ("read").
	const watchOn = opts.watch !== false;
	const log = typeof opts.log === "function" ? opts.log : () => {};
	const unread = { me: "", topics: new Map(), count: 0, seq: 0, events: [], live: false };
	let stopped = false;
	let watching = false;
	let watchTimer = null;
	function recount() {
		let c = 0;
		for (const tp of unread.topics.values()) c += Math.max(0, (tp.seq || 0) - (tp.read || 0));
		unread.count = c;
	}
	function onWatch(m, st) {
		if (m.meta && m.meta.topic === "me" && Array.isArray(m.meta.sub)) {
			for (const s of m.meta.sub) {
				if (!s || !s.topic || s.deleted) continue;
				const old = unread.topics.get(s.topic) || {};
				unread.topics.set(s.topic, {
					name: (s.public && s.public.fn) || old.name || "",
					seq: Math.max(s.seq || 0, old.seq || 0),
					read: Math.max(s.read || 0, old.read || 0),
				});
			}
			recount();
			return;
		}
		const p = m.pres;
		if (!p || p.topic !== "me" || !p.src) return;
		let tp = unread.topics.get(p.src);
		if (p.what === "msg") {
			if (!tp) {
				tp = { name: "", seq: 0, read: 0 };
				unread.topics.set(p.src, tp);
				st.refresh = true;
			}
			tp.seq = Math.max(tp.seq, p.seq || 0);
			// One's own message (no sender named): Tinode marks it read for the sender without saying so.
			if (!p.act) tp.read = Math.max(tp.read, p.seq || 0);
			if (p.act) {
				unread.seq += 1;
				unread.events.push({ id: unread.seq, topic: p.src, from: tp.name, group: p.src.indexOf("grp") === 0, at: Date.now() });
				if (unread.events.length > 20) unread.events.shift();
				st.named.push(unread.events[unread.events.length - 1]);
			}
		} else if (p.what === "read" && tp) {
			tp.read = Math.max(tp.read, p.seq || 0);
		} else if (p.what === "gone") {
			unread.topics.delete(p.src);
		} else if (p.what === "acs" || p.what === "upd") {
			st.refresh = true;
		}
		recount();
	}
	async function watchOnce() {
		const t = await tokenFor();
		if (!t.tok) { log("watch: no chat token"); return 60000; }
		const who = createHash("sha256").update(t.login + "\n" + deskToken()).digest("hex");
		const key = await apiKey(site());
		if (!key) { log("watch: no api key"); return 60000; }
		const s = lpSession(site(), key);
		if (!(await s.open())) { log("watch: no session"); return 30000; }
		const st = { refresh: false, named: [] };
		const on = (m) => onWatch(m, st);
		const hi = await s.send({ hi: { ver: "0.25", ua: "TDH-desk-notify/1.0" } }, on);
		if (!hi || hi.code >= 300) { log("watch: hi " + (hi && hi.code)); return 30000; }
		const lg = await s.send({ login: { scheme: "token", secret: t.tok.token } }, on);
		if (!lg || lg.code >= 300) {
			log("watch: login " + (lg && lg.code));
			if (lg && lg.code === 401) cache = { who: "", tok: null }; // an expired chat token: log in afresh
			return 10000;
		}
		unread.me = (lg.params && lg.params.user) || "";
		unread.topics.clear();
		const sub = await s.send({ sub: { topic: "me", get: { what: "sub" } } }, on);
		if (!sub || sub.code >= 300) { log("watch: sub me " + (sub && sub.code)); return 30000; }
		unread.live = true;
		log("watch: live, unread " + unread.count);
		try {
			while (!stopped) {
				if (st.refresh) {
					st.refresh = false;
					await s.send({ get: { topic: "me", what: "sub" } }, on);
				}
				// New topics get their names from the refresh: name the events that came without one.
				for (const ev of st.named.splice(0)) if (!ev.from && unread.topics.get(ev.topic)) ev.from = unread.topics.get(ev.topic).name;
				for (const m of await s.poll(120000)) on(m);
				const now = createHash("sha256").update(loginName() + "\n" + deskToken()).digest("hex");
				if (now !== who) break; // another person logged in at this desk
			}
		} finally {
			unread.live = false;
		}
		return 2000;
	}
	async function watchLoop() {
		if (watching || !watchOn) return;
		watching = true;
		while (!stopped) {
			let wait = 10000;
			try { wait = await watchOnce(); } catch (err) { log("watch: " + (err && err.message)); wait = 10000; }
			if (stopped) break;
			await new Promise((r) => {
				watchTimer = setTimeout(r, wait);
				if (watchTimer.unref) watchTimer.unref();
			});
		}
		watching = false;
	}

	async function tokenFor() {
		const login = loginName();
		const dt = deskToken();
		if (!login || !dt) return { login, tok: null };
		const who = createHash("sha256").update(login + "\n" + dt).digest("hex");
		const exp = cache.tok && Date.parse(cache.tok.expires);
		if (cache.who === who && exp && exp - Date.now() > 2 * 86400e3) return { login, tok: cache.tok };
		const tok = await chatLogin(site(), login, dt).catch(() => null);
		if (tok) cache = { who, tok };
		return { login, tok };
	}

	function hostOk(req) {
		const h = String(req.headers.host || "");
		return port > 0 && (h === "127.0.0.1:" + port || h === "localhost:" + port);
	}

	function plain(res, status, text) {
		res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
		res.end(text);
	}

	async function page(req, res, u) {
		if (u.searchParams.get("k") !== pageKey) {
			plain(res, 403, "请从 TDH 左栏或右侧栏的「聊天」打开。");
			return;
		}
		const [r, t] = await Promise.all([
			fetchSite(site(), "/chat/", "GET", null, null, 20000),
			tokenFor(),
		]);
		if (r.status !== 200) {
			plain(res, 502, "聊天服务器没连上（" + r.status + "）。");
			return;
		}
		let html = r.body.toString("utf8");
		const boot = bootScript(t.login, t.tok, !!files, !!shot);
		html = html.indexOf("<head>") >= 0 ? html.replace("<head>", "<head>\n" + boot) : boot + html;
		res.writeHead(200, {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store",
			"referrer-policy": "no-referrer",
		});
		res.end(html);
	}

	function relay(req, res, u) {
		const up = new URL(u.pathname + u.search, site());
		const headers = {};
		for (const k of PASS_REQ) if (req.headers[k] != null) headers[k] = req.headers[k];
		headers["accept-encoding"] = req.headers["accept-encoding"] || "identity";
		const out = libFor(up).request(Object.assign(tlsOpts(up), {
			method: req.method,
			path: up.pathname + (up.search || ""),
			headers,
		}), (ures) => {
			const h = {};
			for (const k of PASS_RES) if (ures.headers[k] != null) h[k] = ures.headers[k];
			if (ures.headers.location) {
				try {
					const loc = new URL(ures.headers.location, site());
					h.location = loc.origin === new URL(site()).origin ? loc.pathname + loc.search : loc.href;
				} catch { /* leave it out */ }
			}
			res.writeHead(ures.statusCode || 502, h);
			ures.pipe(res);
		});
		// Long polling holds a request open until there is something to say: no timeout here.
		out.on("error", () => {
			if (!res.headersSent) plain(res, 502, "聊天服务器没连上。");
			else res.destroy();
		});
		res.on("close", () => out.destroy());
		req.pipe(out);
	}

	function json(res, status, obj) {
		res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
		res.end(JSON.stringify(obj));
	}

	function dropOld() {
		for (const [id, v] of picked) {
			if (Date.now() - v.at > 10 * 60 * 1000) {
				picked.delete(id);
				if (v.temp) { try { unlinkSync(v.path); } catch { /* gone */ } }
			}
		}
	}

	async function fileRoute(req, res, u) {
		const p = u.pathname;
		if (p === "/tdh/shot" && req.method === "POST" && shot) {
			if (shooting) { json(res, 200, { ok: false, error: "正在截图" }); return; }
			shooting = true;
			const out = path.join(os.tmpdir(), "tdh-shot-" + randomBytes(8).toString("hex") + ".png");
			let ok = false;
			try { ok = await shot.capture(out); } catch { ok = false; } finally { shooting = false; }
			dropOld();
			if (!ok) {
				try { unlinkSync(out); } catch { /* none made */ }
				json(res, 200, { ok: false, cancelled: true });
				return;
			}
			const st = statSync(out);
			const id = randomBytes(12).toString("base64url");
			picked.set(id, { path: out, at: Date.now(), temp: true });
			const d = new Date();
			const two = (n) => (n < 10 ? "0" : "") + n;
			const name = "截图 " + d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + "-" + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds()) + ".png";
			json(res, 200, { ok: true, files: [{ id, name, size: st.size, type: "image/png" }] });
			return;
		}
		if (!files && p !== "/tdh/picked") { plain(res, 404, "not found"); return; }
		if (p === "/tdh/pick" && req.method === "POST") {
			const paths = await files.choose(u.searchParams.get("multiple") === "1");
			const out = [];
			const tooBig = [];
			for (const fp of paths) {
				let st = null;
				try { st = statSync(fp); } catch { continue; }
				if (!st.isFile()) continue;
				if (st.size > MAX_FILE) { tooBig.push(path.basename(fp)); continue; }
				const id = randomBytes(12).toString("base64url");
				picked.set(id, { path: fp, at: Date.now() });
				out.push({ id, name: path.basename(fp), size: st.size, type: TYPES[path.extname(fp).toLowerCase()] || "" });
			}
			dropOld();
			if (!out.length) {
				json(res, 200, { ok: false, error: tooBig.length ? "文件太大（单个最多 200 MB）：" + tooBig.join("、") : "" });
				return;
			}
			json(res, 200, { ok: true, files: out, tooBig });
			return;
		}
		if (p === "/tdh/picked" && req.method === "GET") {
			const v = picked.get(u.searchParams.get("id") || "");
			if (!v) { plain(res, 404, "not found"); return; }
			picked.delete(u.searchParams.get("id"));
			res.writeHead(200, { "content-type": TYPES[path.extname(v.path).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
			const rs = createReadStream(v.path);
			rs.on("error", () => res.destroy());
			// A screenshot is ours, made for this one hand-over: gone once it is handed over.
			if (v.temp) rs.on("close", () => { try { unlinkSync(v.path); } catch { /* gone */ } });
			rs.pipe(res);
			return;
		}
		if (p === "/tdh/save" && req.method === "POST") {
			const name = safeName(u.searchParams.get("name"));
			const dest = freePath(files.downloads, name);
			const part = dest + ".tdh-part";
			const out = createWriteStream(part);
			let size = 0;
			let over = false;
			await new Promise((resolve) => {
				req.on("data", (c) => {
					size += c.length;
					if (size > MAX_FILE && !over) { over = true; req.unpipe(out); out.end(); }
				});
				req.pipe(out);
				out.on("finish", resolve);
				out.on("error", resolve);
				req.on("error", resolve);
			});
			if (over || !existsSync(part)) {
				try { unlinkSync(part); } catch { /* not there */ }
				json(res, 200, { ok: false, error: over ? "文件太大" : "写不进「下载」" });
				return;
			}
			const final = freePath(files.downloads, name);
			renameSync(part, final);
			files.reveal(final);
			json(res, 200, { ok: true, name: path.basename(final) });
			return;
		}
		plain(res, 404, "not found");
	}

	const server = http.createServer((req, res) => {
		if (!hostOk(req)) {
			plain(res, 421, "wrong host");
			return;
		}
		let u;
		try {
			u = new URL(req.url || "/", "http://127.0.0.1");
		} catch {
			plain(res, 400, "bad url");
			return;
		}
		const p = u.pathname;
		if (p === "/" || p === "/chat") {
			res.writeHead(302, { location: "/chat/" + u.search, "cache-control": "no-store" });
			res.end();
			return;
		}
		if (p === "/chat/" || p === "/chat/index.html") {
			page(req, res, u).catch(() => { if (!res.headersSent) plain(res, 500, "聊天页面出错了。"); });
			return;
		}
		if (p.indexOf("/tdh/") === 0) {
			if (!(files || shot) || u.searchParams.get("k") !== pageKey) {
				plain(res, 403, "forbidden");
				return;
			}
			fileRoute(req, res, u).catch(() => { if (!res.headersSent) json(res, 500, { ok: false, error: "出错了" }); });
			return;
		}
		if ((p.indexOf("/chat/") === 0 && req.method === "GET") || p.indexOf("/v0/") === 0) {
			relay(req, res, u);
			return;
		}
		plain(res, 404, "not found");
	});
	server.requestTimeout = 0;
	server.headersTimeout = 60000;

	server.on("upgrade", (req, sock, head) => {
		let u;
		try {
			u = new URL(req.url || "/", "http://127.0.0.1");
		} catch {
			sock.destroy();
			return;
		}
		const origin = String(req.headers.origin || "");
		const own = origin === "http://127.0.0.1:" + port || origin === "http://localhost:" + port;
		if (!hostOk(req) || !own || u.pathname.indexOf("/v0/") !== 0) {
			sock.destroy();
			return;
		}
		const base = new URL(site());
		const up = new URL(u.pathname + u.search, base);
		const headers = {
			Connection: "Upgrade",
			Upgrade: "websocket",
			Origin: base.origin,
		};
		for (const k of ["sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions", "sec-websocket-protocol", "user-agent"]) {
			if (req.headers[k] != null) headers[k] = req.headers[k];
		}
		const out = libFor(up).request(Object.assign(tlsOpts(up, true), { method: "GET", path: up.pathname + (up.search || ""), headers }));
		out.on("upgrade", (ures, usock, uhead) => {
			let reply = "HTTP/1.1 101 Switching Protocols\r\n";
			for (let i = 0; i + 1 < ures.rawHeaders.length; i += 2) reply += ures.rawHeaders[i] + ": " + ures.rawHeaders[i + 1] + "\r\n";
			sock.write(reply + "\r\n");
			if (uhead && uhead.length) sock.write(uhead);
			if (head && head.length) usock.write(head);
			usock.setNoDelay(true);
			sock.setNoDelay(true);
			sockets.add(sock);
			sockets.add(usock);
			const end = () => { usock.destroy(); sock.destroy(); sockets.delete(sock); sockets.delete(usock); };
			usock.on("error", end);
			sock.on("error", end);
			usock.on("close", end);
			sock.on("close", end);
			usock.pipe(sock);
			sock.pipe(usock);
		});
		out.on("response", (ures) => {
			sock.end("HTTP/1.1 " + (ures.statusCode || 502) + " Upstream\r\nConnection: close\r\n\r\n");
			ures.resume();
		});
		out.on("error", () => sock.destroy());
		sock.on("error", () => out.destroy());
		out.end();
	});

	const ready = (async () => {
		for (const p of PORTS) {
			const ok = await new Promise((resolve) => {
				const onErr = () => { server.off("listening", onOk); resolve(false); };
				const onOk = () => { server.off("error", onErr); resolve(true); };
				server.once("error", onErr);
				server.once("listening", onOk);
				server.listen(p, "127.0.0.1");
			});
			if (ok) {
				port = server.address().port;
				// Log in ahead, so opening 聊天 does not wait for it (and the person is in the chat's directory
				// from their first start, not their first chat).
				warm = setTimeout(() => { tokenFor().catch(() => {}).then(() => { watchLoop(); }); }, opts.warmMs == null ? 15000 : opts.warmMs);
				if (warm.unref) warm.unref();
				return port;
			}
		}
		return 0;
	})();
	server.on("error", () => { /* after listening: nothing to do but keep serving */ });

	return {
		ready,
		url() {
			return port > 0 ? "http://127.0.0.1:" + port + "/chat/?k=" + pageKey : "";
		},
		// What the desk shows: the unread count and the new messages after `since` (ids only grow).
		unread(since) {
			const s = Number(since) || 0;
			return { ok: true, live: unread.live, count: unread.count, seq: unread.seq, events: unread.events.filter((e) => e.id > s) };
		},
		close() {
			stopped = true;
			if (watchTimer) clearTimeout(watchTimer);
			return new Promise((resolve) => {
				if (warm) clearTimeout(warm);
				for (const s of sockets) s.destroy();
				sockets.clear();
				try { server.closeAllConnections && server.closeAllConnections(); } catch { /* closing anyway */ }
				server.close(() => resolve());
			});
		},
	};
}
