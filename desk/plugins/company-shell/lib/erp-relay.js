// company-erp-desk-v2: ERPNext inside the desk's window (the user, 2026-11-21: "能不能直接在TDH里打开"; the browser
// did not open it either: the tailnet's rule for employees' devices lets the desk's 8443 through, not ERPNext's 443).
//
// As the chat (chat-relay.js), through this desk's host: a small server on this machine only, on a port of its own.
// It is on 127.0.0.1 as the desk's page is, so the two are one site and ERPNext's login cookie counts inside the
// desk's frame. Every request goes to the site's 8443: /tdh-sso/* (TDH's login for ERPNext) as /erp/tdh-sso/*, the
// rest as /erp/* (Caddy hands them to the people service's /company/sso/ and to ERPNext, server/erp/erp.caddy).
//   - Only the Host 127.0.0.1:<port> / localhost:<port> is served (no DNS rebinding).
//   - Only ERPNext's own cookies go to the site (127.0.0.1's other ports, the desk's and the chat's, share cookies
//     with this one); on the way back they lose Secure and Domain (this is http on 127.0.0.1), nothing else changes.
//   - A Location at ERPNext's own address comes back here; nothing keeps the page out of a frame (X-Frame-Options, a
//     Content-Security-Policy); Origin and Referer are ERPNext's own on the way there (its websocket checks Origin).
// The relay keeps nothing: no cookie, no token. The frame's first address is the one-time login link the desk's host
// gets for this person (erpOpen's ticket), turned into this relay's /tdh-sso/start?t=….
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

const PORTS = [17821, 17822, 17823, 17824, 0];
// ERPNext's cookies (frappe.auth.CookieManager), the TDH login's (server/erp_sso.py COOKIE).
export const ERP_COOKIES = new Set(["sid", "system_user", "full_name", "user_id", "user_image", "user_lang", "preferred_language", "tdh_sso"]);
const DROP_REQ = new Set(["host", "connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "cookie", "origin", "referer",
	"te", "trailer", "proxy-authorization"]);
const DROP_RES = new Set(["x-frame-options", "content-security-policy", "content-security-policy-report-only", "strict-transport-security",
	"connection", "keep-alive", "transfer-encoding", "alt-svc", "set-cookie", "location"]);
const AGENT = new https.Agent({ keepAlive: true, maxSockets: 24, rejectUnauthorized: false });
const START_RE = /^\/tdh-sso\/start\?t=[A-Za-z0-9_-]{8,80}$/;

// company-erp-dark-v1 (the user, 2026-11-24: 「工件也好 ERP 也好，切换夜晚模式以后背景色一样变成深色」): ERPNext's own
// pages get a few lines at the top of <head>: they put ERPNext's own dark or light theme on (html[data-theme], as its
// user menu does, for this frame only, nothing saved in ERPNext) as the desk tells them (a message from the desk's
// page, kept for the frame's next pages in sessionStorage), and at night the page's own background gives way to the
// desk's gradient behind the frame.
export const THEME_SHIM = "<script>(function(){var h=document.documentElement,k=\"tdh-theme\",w=\"\";" +
	"function put(){if(w&&h.getAttribute(\"data-theme\")!==w){h.setAttribute(\"data-theme\",w);h.setAttribute(\"data-theme-mode\",w)}}" +
	"function set(t){if(t!==\"dark\"&&t!==\"light\")return;w=t;try{sessionStorage.setItem(k,t)}catch(e){}put()}" +
	"try{set(sessionStorage.getItem(k))}catch(e){}" +
	"try{new MutationObserver(put).observe(h,{attributes:true,attributeFilter:[\"data-theme\"]})}catch(e){}" +
	"addEventListener(\"message\",function(e){if(e.source===parent&&e.data&&e.data.type===\"tdh-theme\")set(e.data.theme)});" +
	"h.setAttribute(\"data-tdh-embed\",\"\")})();</script>" +
	"<style>html[data-tdh-embed][data-theme=dark],html[data-tdh-embed][data-theme=dark] body{background:transparent!important}</style>";
const HTML_MAX = 8 * 1024 * 1024;

// A page load (not an API call, not a file): the only answers the shim goes into.
export function wantsPage(req, pathname) {
	if (req.method !== "GET") return false;
	if (!/text\/html/i.test(String(req.headers.accept || ""))) return false;
	return !/^\/(api|assets|files|private|socket\.io)\//.test(pathname);
}

export function withShim(html) {
	const m = /<head\b[^>]*>/i.exec(html);
	if (!m) return html;
	const k = m.index + m[0].length;
	return html.slice(0, k) + THEME_SHIM + html.slice(k);
}

function libFor(u) {
	return u.protocol === "http:" ? http : https;
}

export function onlyErpCookies(header) {
	return String(header || "").split(";").map((s) => s.trim()).filter((s) => ERP_COOKIES.has(s.split("=", 1)[0].trim())).join("; ");
}

// A Set-Cookie for 127.0.0.1 over http: no Secure, no Domain.
export function localCookie(line) {
	return String(line).split(";").map((s) => s.trim()).filter((s) => s && !/^(secure|domain=.*)$/i.test(s)).join("; ");
}

// Where a Location the site gave goes: ERPNext's own address (its https name, or the site's 8443 under /erp) comes
// back to this relay as a path; anything else stays as it is.
export function localLocation(loc, erp, site) {
	let u;
	try {
		u = new URL(String(loc), erp || site);
	} catch {
		return "";
	}
	const e = erp ? new URL(erp) : null;
	const s = new URL(site);
	if (e && u.origin === e.origin) return u.pathname + u.search + u.hash;
	if (u.origin === s.origin && (u.pathname === "/erp" || u.pathname.indexOf("/erp/") === 0)) {
		return (u.pathname.slice(4) || "/") + u.search + u.hash;
	}
	return u.href;
}

// The site's path for one of this relay's.
export function upstreamPath(p) {
	return "/erp" + (p.charAt(0) === "/" ? p : "/" + p);
}

export function startErpRelay(opts) {
	const site = typeof opts.site === "function" ? opts.site : () => opts.site;
	let erp = opts.erp || "";               // ERPNext's own address (https://<erp host>), from the login link
	let port = 0;
	const sockets = new Set();

	function hostOk(req) {
		const h = String(req.headers.host || "");
		return port > 0 && (h === "127.0.0.1:" + port || h === "localhost:" + port);
	}

	function plain(res, status, text) {
		res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
		res.end(text);
	}

	function theirs(value) {
		// Origin / Referer as ERPNext would see them from its own page.
		if (!value || !erp) return "";
		try {
			const u = new URL(String(value));
			if (u.host !== "127.0.0.1:" + port && u.host !== "localhost:" + port) return "";
			return new URL(u.pathname + u.search, erp).href;
		} catch {
			return "";
		}
	}

	function headersFor(req) {
		const h = {};
		for (const [k, v] of Object.entries(req.headers)) if (!DROP_REQ.has(k)) h[k] = v;
		const c = onlyErpCookies(req.headers.cookie);
		if (c) h.cookie = c;
		const o = theirs(req.headers.origin);
		if (o) h.origin = new URL(o).origin;
		const r = theirs(req.headers.referer);
		if (r) h.referer = r;
		return h;
	}

	function relay(req, res, u) {
		const base = site();
		const up = new URL(upstreamPath(u.pathname) + u.search, base);
		const page = wantsPage(req, u.pathname);
		const headers = headersFor(req);
		// The page comes back plain so the shim can go in (a page is small; files and API answers stay compressed).
		if (page) headers["accept-encoding"] = "identity";
		const out = libFor(up).request({
			hostname: up.hostname,
			port: up.port || 443,
			method: req.method,
			path: up.pathname + up.search,
			headers,
			agent: up.protocol === "https:" ? AGENT : undefined,
			rejectUnauthorized: false,
		}, (ures) => {
			const h = {};
			for (const [k, v] of Object.entries(ures.headers)) if (!DROP_RES.has(k)) h[k] = v;
			const sc = ures.headers["set-cookie"];
			if (sc) h["set-cookie"] = (Array.isArray(sc) ? sc : [sc]).map(localCookie);
			if (ures.headers.location) {
				const loc = localLocation(ures.headers.location, erp, base);
				if (loc) h.location = loc;
			}
			const enc = String(ures.headers["content-encoding"] || "identity").toLowerCase();
			const len = Number(ures.headers["content-length"] || 0);
			if (page && /text\/html/i.test(String(ures.headers["content-type"] || "")) && enc === "identity" && len <= HTML_MAX) {
				const parts = [];
				let size = 0;
				let over = false;
				ures.on("data", (c) => {
					if (over) return;
					size += c.length;
					if (size > HTML_MAX) { over = true; ures.destroy(); res.destroy(); return; }
					parts.push(c);
				});
				ures.on("end", () => {
					if (over) return;
					const body = Buffer.from(withShim(Buffer.concat(parts).toString("utf8")), "utf8");
					delete h["content-length"];
					delete h["etag"];
					h["content-length"] = String(body.length);
					res.writeHead(ures.statusCode || 502, h);
					res.end(body);
				});
				ures.on("error", () => res.destroy());
				return;
			}
			res.writeHead(ures.statusCode || 502, h);
			ures.pipe(res);
		});
		out.setTimeout(180000, () => out.destroy(new Error("timeout")));
		out.on("error", () => {
			if (!res.headersSent) plain(res, 502, "ERPNext 没连上：这台电脑连不上公司服务器，或 ERPNext 没在运行。");
			else res.destroy();
		});
		res.on("close", () => out.destroy());
		req.pipe(out);
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
		relay(req, res, u);
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
		if (!hostOk(req) || !own || u.pathname.indexOf("/socket.io/") !== 0 || !erp) {
			sock.destroy();
			return;
		}
		const up = new URL(upstreamPath(u.pathname) + u.search, site());
		const headers = { Connection: "Upgrade", Upgrade: "websocket", Origin: new URL(erp).origin };
		for (const k of ["sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions", "sec-websocket-protocol", "user-agent"]) {
			if (req.headers[k] != null) headers[k] = req.headers[k];
		}
		const c = onlyErpCookies(req.headers.cookie);
		if (c) headers.Cookie = c;
		const out = libFor(up).request({ hostname: up.hostname, port: up.port || 443, method: "GET", path: up.pathname + up.search, headers,
			agent: false, rejectUnauthorized: false });
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
		for (const p of opts.ports || PORTS) {
			const ok = await new Promise((resolve) => {
				const onErr = () => { server.off("listening", onOk); resolve(false); };
				const onOk = () => { server.off("error", onErr); resolve(true); };
				server.once("error", onErr);
				server.once("listening", onOk);
				server.listen(p, "127.0.0.1");
			});
			if (ok) {
				port = server.address().port;
				return port;
			}
		}
		return 0;
	})();
	server.on("error", () => { /* after listening: nothing to do but keep serving */ });

	return {
		ready,
		// The frame's address for a one-time login link (https://<erp host>/tdh-sso/start?t=…): this relay's.
		pageFor(link) {
			let u;
			try {
				u = new URL(String(link));
			} catch {
				return "";
			}
			if (u.protocol !== "https:" || !START_RE.test(u.pathname + u.search) || port <= 0) return "";
			erp = u.origin;
			return "http://127.0.0.1:" + port + u.pathname + u.search;
		},
		close() {
			for (const s of sockets) s.destroy();
			return new Promise((resolve) => server.close(() => resolve()));
		},
	};
}
