// Proof for company-chat-desk-v1, the desk side of 聊天 (desk/plugins/company-shell/lib/client.js): loaded with a
// stand-in kernel (every service answers anything), the shell
//   - adds 聊天 to the left column (sidebar.panellist "company-chat") and its page (main, keyed "company-chat");
//   - once the right sidebar's tab registry is there, registers the 聊天 tab type (kept mounted) and its body
//     under the same id; company-chat-dock-v1: no longer on the right sidebar's start page;
//   - the page asks this desk's host where the chat is (/company/chat/where) and shows it in an iframe; when the
//     host has no relay it says so and offers 重试;
//   - company-chat-notify-v1: the desk asks its host for the unread count (badge on 聊天); a new message while the
//     chat is not on screen pops up in the window (打开 opens the chat panel); while the window is in the
//     background the host is asked for the system's notification; old messages from before the page loaded are
//     not announced.
//   - company-erp-desk-v1/v2: ERPNext under 聊天 (sidebar.panellist "company-erp", order after 聊天, for every role) and
//     its page (main, keyed "company-erp"): ERPNext in a frame at the address this desk's host gives (POST
//     /company/erp/where), no browser button; before v2 it asked this desk's host to open ERPNext (POST /company/erp/open with the
//     desk page's header) and says it is open, with 再打开一次; a site that is not set up or a stale login say so,
//     with 重试.
//   - company-chat-dock-v1: 聊天 locked in a column of its own at the window's right edge (工作区 | AI 对话 |
//     侧边栏 opened when needed | 聊天): from a 1100px window up the shell draws the chat on document.body (a portal
//     from the window's overlay), marks <html> so #root gives up the chat's width and the kernel's frame lays its
//     three columns out in the rest (a fullscreen right sidebar stops at the chat), and while it is there the left
//     column does not list 聊天, a 聊天 shown in the main area goes back to the conversation, an old right-sidebar
//     聊天 tab closes itself and no popup comes over it; a narrower window has no column and 聊天 is back in the
//     left column. The frame folds the workspace under 1024px of its own width: once each time it goes narrow
//     only for the chat's column, the shell opens the workspace again; one the person folded stays folded.
// Prints CHAT_DESK_PROVE_OK=1.
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const CLIENT = path.join(__dirname, "..", "desk", "plugins", "company-shell", "lib", "client.js");

// Anything: callable, constructible, every property is itself.
const anything = new Proxy(function () {}, {
	get(t, k) {
		if (k === Symbol.toPrimitive) return () => "";
		if (k === "then") return undefined;
		if (k === Symbol.iterator) return function* () {};
		if (k === "length") return 0;
		return anything;
	},
	apply() { return anything; },
	construct() { return anything; },
});

// A React that records elements and runs hooks once, in order.
let hookState = [];
let hookAt = 0;
const effects = [];
const React = {
	createElement(type, props, ...children) { return { type, props: props || {}, children: children.flat() }; },
	useState(init) {
		const i = hookAt++;
		if (!(i in hookState)) hookState[i] = typeof init === "function" ? init() : init;
		return [hookState[i], (v) => { hookState[i] = v; }];
	},
	useEffect(fn) { effects.push(fn); },
	useLayoutEffect() {},
	useRef(v) { return { current: v }; },
	useMemo(fn) { return fn(); },
	useCallback(fn) { return fn; },
	useSyncExternalStore(sub, get) { return get(); },
	Fragment: "Fragment",
};

let exp0 = null;
function load(o) {
o = o || {};
let mod = null;
const intervals = [];
const sandbox = {
	window: Object.assign({ __ModuleLoader__: { load: (m) => { mod = m; } } }, o.window || {}),
	document: o.document || anything,
	navigator: anything,
	localStorage: anything,
	location: anything,
	setTimeout: () => 0,
	clearTimeout: () => {},
	setInterval: (fn) => { intervals.push(fn); return intervals.length; },
	clearInterval: () => {},
	console,
	URL,
	Math,
	JSON,
	Promise,
	Date,
	fetch: o.fetch || (() => new Promise(() => {})),
};
vm.runInNewContext(fs.readFileSync(CLIENT, "utf8"), sandbox, { filename: "client.js" });
assert.ok(mod, "client.js registers its module");
const exp = mod.factory((name) => (name === "react" ? React : name === "react-dom" && o.reactDom ? o.reactDom : anything));
exp0 = exp;
// company-panels-for-all-v1: an employee's left column has 工件、定时任务、聊天; only 插件 is the admin's.
{
	const rows = [{ id: "plugins" }, { id: "artifacts" }, { id: "schedules" }, { id: "company-chat" }];
	assert.deepEqual(Array.from(exp.panelsForRole("employee", rows), (r) => r.id), ["artifacts", "schedules", "company-chat"], "an employee sees all but 插件");
	assert.deepEqual(Array.from(exp.panelsForRole("director", rows), (r) => r.id), ["artifacts", "schedules", "company-chat"]);
	assert.deepEqual(Array.from(exp.panelsForRole("admin", rows), (r) => r.id), ["plugins", "artifacts", "schedules", "company-chat"], "the admin sees 插件 too");
	assert.deepEqual(Array.from(exp.panelsForRole("employee", null)), []);
	assert.ok(/const shownPanels = panelsForDesk\(shellRole, panels, chatDock\);/.test(fs.readFileSync(CLIENT, "utf8")), "the left column uses it");
	// company-session-restore-v1: an archived session's row has 还原, which unarchives it through the workspaces service.
	const src = fs.readFileSync(CLIENT, "utf8");
	assert.ok(/return ctx\.workspaces\.unarchiveSession\(sessionId\);/.test(src) && /className: "cs-restore"/.test(src)
		&& /\? "没还原，再点一次" : "还原"/.test(src) && /event\.stopPropagation\(\);/.test(src), "archived rows can be restored");
	assert.deepEqual(Array.from(exp.panelsForDesk("employee", rows, false), (r) => r.id), ["artifacts", "schedules", "company-chat"]);
}
const regs = [];
const tabTypes = [];
let injected = null;
function slots() {
	return new Proxy({}, {
		get(t, k) {
			if (k === "inject") return (name, fn) => { const r = fn(); if (r && typeof r.next === "function") r.next(); };
			if (k === "register") return (opts, Comp) => { regs.push({ opts, Comp }); return () => {}; };
			if (k === "entriesOfSlot") return () => [];
			return anything;
		},
	});
}
const ctx = new Proxy({}, {
	get(t, k) {
		if (k === "slots") return slots();
		if (k === "effect") return (fn) => fn();
		if (k === "inject") return (names, cb) => {
			if (Array.from(names).indexOf("sidebarRightTabs") >= 0) injected = names; // the theme button waits for "theme" (company-look-today-v1)
			cb(new Proxy({}, {
				get(t2, k2) {
					if (k2 === "slots") return slots();
					if (k2 === "effect") return (fn) => fn();
					if (k2 === "sidebarRightTabs") return { register: (def) => { tabTypes.push(def); return () => {}; } };
					return anything;
				},
			}));
		};
		if (k === "get") return () => undefined;
		if (k === "layout" && o.layout) return o.layout;
		return anything;
	},
});
exp.apply(ctx);
return { sandbox, regs, tabTypes, injected, intervals, exp };
}
const { sandbox, regs, tabTypes, injected } = load();

const panel = regs.find((r) => r.opts.name === "sidebar.panellist" && r.opts.id === "company-chat");
assert.ok(panel, "聊天 in the left column");
assert.equal(panel.opts.label(), "聊天");
const flat = (n) => { while (n && typeof n.type === "function") n = n.type(n.props); return n; };
const icon = flat(panel.Comp({ size: 18 }));
assert.equal(icon.type, "svg", "no unread: just the icon");
assert.equal(icon.props.width, 18);
const main = regs.find((r) => r.opts.name === "main" && r.opts.key === "company-chat");
assert.ok(main, "the 聊天 page in the main area");

assert.deepEqual(Array.from(injected || []), ["slots", "sidebarRightTabs"], "waits for the right sidebar's tab registry");
assert.equal(tabTypes.length, 1);
const def = tabTypes[0];
assert.equal(def.id, "company-chat");
assert.equal(def.kind, "company-chat");
assert.equal(def.keepMounted, true, "the chat stays connected while other tabs are shown");
assert.equal(def.title(), "聊天");
assert.equal(def.guide, undefined, "not on the right sidebar's start page: 聊天 has its own column");
const body = regs.find((r) => r.opts.name === "sidebar.right.pane.tab" && r.opts.key === "company-chat");
assert.ok(body, "the tab's body under the type's id");

// The page: while it asks, a line; with an address, the iframe; when the host has no relay, 重试.
function render(Comp, fetchImpl, box) {
	hookState = [];
	effects.length = 0;
	hookAt = 0;
	(box || sandbox).fetch = fetchImpl;
	let tree = Comp({});
	while (tree && typeof tree.type === "function") { hookAt = 0; tree = tree.type(tree.props); }
	return tree;
}
function rerender(Comp) {
	hookAt = 0;
	let tree = Comp({});
	while (tree && typeof tree.type === "function") { hookAt = 0; tree = tree.type(tree.props); }
	return tree;
}
// The element whose text is 打开 (the stand-in kernel has no Button of its own, so it is found by its text).
const byText = (n, want) => {
	if (!n || typeof n !== "object") return null;
	if ((n.children || []).join("") === want) return n;
	for (const c of n.children || []) { const hit = byText(c, want); if (hit) return hit; }
	return null;
};
const text = (n) => (n == null ? "" : typeof n === "string" ? n : (n.children || []).map(text).join(""));
const find = (n, type) => (!n || typeof n !== "object" ? null : n.type === type ? n : (n.children || []).map((c) => find(c, type)).find(Boolean) || null);

(async () => {
	let asked = "";
	let tree = render(main.Comp, (url) => {
		asked = url;
		return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, url: "http://127.0.0.1:17811/chat/?k=abc" }) });
	});
	assert.match(text(tree), /正在打开聊天/);
	effects.forEach((fn) => fn());
	await new Promise((r) => setImmediate(r));
	await new Promise((r) => setImmediate(r));
	assert.equal(asked, "/company/chat/where", "asks this desk's host");
	tree = rerender(main.Comp);
	const frame = find(tree, "iframe");
	assert.ok(frame, "the chat in an iframe");
	assert.match(frame.props.src, /^http:\/\/127\.0\.0\.1:17811\/chat\/\?k=abc&theme=(light|dark)&look=today$/, "the chat page, in the desk's light or dark and the 今天 look");
	assert.match(frame.props.allow, /microphone/, "voice messages can record");

	// The address is asked once: the right-sidebar tab shows the same chat at once.
	tree = render(body.Comp, () => { throw new Error("asked again"); });
	assert.equal(find(tree, "iframe"), null, "first paint, before the effect");
	effects.forEach((fn) => fn());
	await new Promise((r) => setImmediate(r));
	tree = rerender(body.Comp);
	assert.match(find(tree, "iframe").props.src, /^http:\/\/127\.0\.0\.1:17811\/chat\/\?k=abc&theme=/);

	// Another start of the desk, whose host has no relay: it says so and offers 重试.
	const fresh = load();
	const freshBody = fresh.regs.find((r) => r.opts.name === "sidebar.right.pane.tab" && r.opts.key === "company-chat");
	tree = render(freshBody.Comp, () => Promise.resolve({ ok: false, json: () => Promise.resolve({ ok: false, error: "relay" }) }), fresh.sandbox);
	effects.forEach((fn) => fn());
	await new Promise((r) => setImmediate(r));
	await new Promise((r) => setImmediate(r));
	tree = rerender(freshBody.Comp);
	assert.match(text(tree), /聊天没打开/);
	assert.match(text(tree), /重试/);
	// --- reminders ---------------------------------------------------------------------------------------------
	const polls = [];
	const notified = [];
	const selected = [];
	const answers = [
		{ ok: true, live: true, count: 2, seq: 3, events: [{ id: 3, topic: "usrA", from: "旧消息", group: false }] },
		{ ok: true, live: true, count: 3, seq: 4, events: [{ id: 4, topic: "usrLFH", from: "梁风禾", group: false }] },
		{ ok: true, live: true, count: 4, seq: 6, events: [{ id: 5, topic: "grpX", from: "报价群", group: true }, { id: 6, topic: "grpX", from: "报价群", group: true }] },
	];
	const json = (j) => Promise.resolve({ ok: true, json: () => Promise.resolve(j) });
	const doc = new Proxy({}, { get(t2, k) {
		if (k === "hasFocus") return () => false;
		if (k === "visibilityState") return "visible";
		return anything;
	} });
	const r = load({
		document: doc,
		layout: new Proxy({}, { get(t2, k) { return k === "selectPanel" ? (id) => selected.push(id) : anything; } }),
		fetch: (url, opt) => {
			if (String(url).indexOf("/company/chat/unread") === 0) {
				polls.push({ url, header: opt && opt.headers && opt.headers["X-TDH-Chat"] });
				return json(answers.shift() || { ok: true, count: 4, seq: 6, events: [] });
			}
			if (url === "/company/chat/notify") {
				notified.push(JSON.parse(opt.body));
				return json({ ok: true });
			}
			return new Promise(() => {});
		},
	});
	const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((res) => setImmediate(res)); };
	await settle();
	assert.equal(polls.length, 1, "asks its host at once");
	assert.equal(polls[0].header, "1", "with the desk page's own header");
	assert.equal(r.intervals.length >= 1, true, "and again every few seconds");
	const rPanel = r.regs.find((x) => x.opts.name === "sidebar.panellist" && x.opts.id === "company-chat");
	const toastReg = r.regs.find((x) => x.opts.name === "shell.overlay" && x.opts.id === "company-chat-toast");
	assert.ok(toastReg, "a popup in the window's overlay");
	const badgeOf = () => { hookAt = 0; const n = rPanel.Comp({ size: 18 }); return n.props && n.props["data-company-chat-unread"]; };
	assert.equal(badgeOf(), "2", "the badge shows the unread count");
	const popup = () => { hookState = []; effects.length = 0; hookAt = 0; return toastReg.Comp(toastReg.opts.inject()); };
	assert.equal(popup(), null, "messages from before the page loaded are not announced");
	assert.deepEqual(notified, []);

	r.intervals.forEach((fn) => fn()); // the shell has other timers too; the chat poll is one of them
	await settle();
	assert.equal(badgeOf(), "3");
	let pop = popup();
	assert.ok(pop, "a new message pops up while the chat is not on screen");
	assert.match(text(pop), /梁风禾 发来新消息/);
	assert.deepEqual(notified, [{ title: "TDH 聊天", body: "梁风禾 发来新消息" }], "the window is in the background: the system's notification");
	const open = byText(pop, "打开");
	open.props.onClick();
	assert.deepEqual(selected, ["company-chat"], "打开 opens the chat panel");
	assert.equal(popup(), null, "and the popup goes");

	r.intervals.forEach((fn) => fn()); // the shell has other timers too; the chat poll is one of them
	await settle();
	pop = popup();
	assert.match(text(pop), /「报价群」有新消息（共 2 条）/, "a group, several at once");
	assert.equal(badgeOf(), "4");
	// company-erp-desk-v1
	const erpPanel = regs.find((x) => x.opts.name === "sidebar.panellist" && x.opts.id === "company-erp");
	const chatPanel = regs.find((x) => x.opts.name === "sidebar.panellist" && x.opts.id === "company-chat");
	assert.ok(erpPanel && erpPanel.opts.label() === "ERPNext", "ERPNext in the left column");
	assert.ok(erpPanel.opts.order > chatPanel.opts.order, "under 聊天");
	assert.equal(flat(erpPanel.Comp({ size: 18 })).type, "svg");
	assert.deepEqual(Array.from(exp0.panelsForRole("employee", [{ id: "plugins" }, { id: "company-chat" }, { id: "company-erp" }]), (r) => r.id),
		["company-chat", "company-erp"], "every role has ERPNext");
	const erpMain = regs.find((x) => x.opts.name === "main" && x.opts.key === "company-erp");
	assert.ok(erpMain, "its page in the main area");
	// company-erp-desk-v2: in this page, in a frame at the relay's address; the browser one click away.
	const FRAME = "http://127.0.0.1:17821/tdh-sso/start?t=t-AbC_123-xyzXYZ0123456789abcd";
	const erpAsk = [];
	tree = render(erpMain.Comp, (url, opts) => {
		erpAsk.push({ url, opts });
		return Promise.resolve({ ok: true, json: () => Promise.resolve(url === "/company/erp/where" ? { ok: true, url: FRAME } : { ok: true }) });
	});
	assert.match(text(tree), /正在用你的 TDH 账号打开 ERPNext/);
	effects.forEach((fn) => fn());
	await new Promise((r) => setImmediate(r));
	await new Promise((r) => setImmediate(r));
	assert.equal(erpAsk[0].url, "/company/erp/where", "asks this desk's host for the frame's address");
	assert.equal(erpAsk[0].opts.method, "POST");
	assert.equal(erpAsk[0].opts.headers["X-TDH-ERP"], "1", "with the desk page's header");
	tree = rerender(erpMain.Comp);
	assert.equal(find(tree, "iframe").props.src, FRAME, "ERPNext in this page's frame");
	assert.ok(!byText(tree, "在浏览器里打开") && !/浏览器/.test(text(tree)), "no button for the browser (the user: 不要这个按钮)");
	assert.ok(byText(tree, "重新打开"), "it can be opened again");
	byText(tree, "重新打开").props.onClick();
	tree = rerender(erpMain.Comp);
	effects.forEach((fn) => fn());
	await new Promise((r) => setImmediate(r));
	await new Promise((r) => setImmediate(r));
	assert.ok(erpAsk.length > 1 && erpAsk.every((a) => a.url === "/company/erp/where"), "重新打开 asks for a fresh address, never the browser: " + erpAsk.map((a) => a.url));
	for (const [error, says] of [["erp-off", /ERPNext 还没接好/], ["bad-token", /TDH 的登录过期了/], ["", /连不上公司服务器/]]) {
		tree = render(erpMain.Comp, () => Promise.resolve({ ok: false, json: () => Promise.resolve({ ok: false, error }) }));
		effects.forEach((fn) => fn());
		await new Promise((r) => setImmediate(r));
		await new Promise((r) => setImmediate(r));
		tree = rerender(erpMain.Comp);
		assert.match(text(tree), says, "says why: " + error);
		assert.ok(byText(tree, "重试"));
	}

	// --- company-chat-dock-v1 ----------------------------------------------------------------------------------
	const SRC = fs.readFileSync(CLIENT, "utf8");
	const MEDIA = (SRC.match(/const CHAT_DOCK_MEDIA = "([^"]+)";/) || [])[1];
	assert.equal(MEDIA, "(min-width: 1100px)", "the column from a 1100px window up");
	assert.match(SRC, /"@media " \+ CHAT_DOCK_MEDIA \+ " \{",/, "the CSS reads the same query as the column");
	assert.match(SRC, /html\[data-company-chat-dock\] #root \{ box-sizing: border-box; padding-right: var\(--company-chat-dock-width\); \}/,
		"#root gives up the chat's width: the kernel's frame measures itself and lays its three columns out in the rest");
	assert.match(SRC, /html\[data-company-chat-dock\] \[data-sidebar-right-panel=fullscreen\] \{ max-width: calc\(100vw - var\(--company-chat-dock-width\)\); \}/,
		"a fullscreen right sidebar stops at the chat");
	assert.match(SRC, /html\[data-company-chat-dock\] \{ --company-chat-dock-width: " \+ CHAT_DOCK_WIDTH \+ "; \}/);
	assert.equal((SRC.match(/const CHAT_DOCK_WIDTH = "([^"]+)";/) || [])[1], "clamp(300px, 26vw, 400px)");
	assert.match(SRC, /const chatDock = React\.useSyncExternalStore\(chatDockSubscribe, chatDocked\);\n\t*const shownPanels = panelsForDesk/,
		"the left column follows the column");

	function dockDesk(wide) {
		const attrs = {};
		const body = { tag: "body" };
		const mq = { matches: wide, addEventListener() {}, removeEventListener() {} };
		const asked = [];
		const picked = [];
		const toggled = [];
		let active = null;
		const docD = new Proxy({}, { get(t2, k) {
			if (k === "documentElement") return { setAttribute: (a, v) => { attrs[a] = String(v); }, removeAttribute: (a) => { delete attrs[a]; }, hasAttribute: (a) => a in attrs, style: anything, classList: anything };
			if (k === "body") return body;
			if (k === "querySelector") return () => null;
			if (k === "hasFocus") return () => false;
			if (k === "visibilityState") return "visible";
			return anything;
		} });
		const answersD = [
			{ ok: true, count: 1, seq: 1, events: [] },
			{ ok: true, count: 2, seq: 2, events: [{ id: 2, topic: "usrA", from: "梁风禾", group: false }] },
		];
		const notifiedD = [];
		const d = load({
			document: docD,
			window: { matchMedia: (q) => { asked.push(q); return mq; } },
			reactDom: { createPortal: (child, container) => ({ type: "portal", props: { container }, children: [child] }) },
			layout: new Proxy({}, { get(t2, k) {
				if (k === "selectPanel") return (id) => { picked.push(id); active = id; };
				if (k === "toggleSidebar") return () => toggled.push(1);
				if (k === "panelInfo") return { getSnapshot: () => ({ activePanelId: active }), subscribe: () => () => {} };
				return anything;
			} }),
			fetch: (url, opt) => {
				if (String(url).indexOf("/company/chat/unread") === 0) return json(answersD.shift() || { ok: true, count: 2, seq: 2, events: [] });
				if (url === "/company/chat/notify") { notifiedD.push(JSON.parse(opt.body)); return json({ ok: true }); }
				return new Promise(() => {});
			},
		});
		const reg = d.regs.find((x) => x.opts.name === "shell.overlay" && x.opts.id === "company-chat-dock");
		return { d, reg, attrs, body, asked, picked, toggled, notifiedD, setActive: (id) => { active = id; } };
	}
	const paint = (reg) => { hookState = []; effects.length = 0; hookAt = 0; return reg.Comp(reg.opts.inject()); };

	// A wide window: the column, on document.body.
	const W = dockDesk(true);
	assert.ok(W.reg, "the column comes from the window's overlay");
	W.setActive("company-chat"); // 聊天 was open in the main area (a narrow window, widened since)
	const dockTree = paint(W.reg);
	assert.ok(W.asked.includes(MEDIA), "asks the window the same query as the CSS");
	assert.equal(dockTree.type, "portal", "drawn outside the kernel's frame");
	assert.equal(dockTree.props.container, W.body, "on document.body");
	const aside = dockTree.children[0];
	assert.equal(aside.type, "aside");
	assert.equal(aside.props.className, "cs-chat-dock cs-look-dock");
	assert.equal(aside.props["aria-label"], "聊天");
	// company-dock-grip-v1: the left edge's handle comes first (drag to widen, double-click to put it back).
	assert.equal(aside.children[0].props.className, "cs-dock-grip");
	assert.equal(typeof aside.children[0].props.onPointerDown, "function");
	assert.equal(typeof aside.children[0].props.onDoubleClick, "function");
	// company-look-today-v1: 今天 / 聊天 on top; the chat page stays mounted under 今天 (hidden), so it keeps ringing.
	const tabsD = aside.children[1].children[0].children.slice(1);
	assert.deepEqual(tabsD.map((b) => b.props["data-page"]), ["today", "chat", "art"], "今天, 聊天 and 工件 (company-dock-art-v1: the kernel's right column)");
	assert.equal(tabsD[0].props["aria-selected"], true, "opens on 今天");
	const dockBody = aside.children[2];
	assert.equal(dockBody.children[0].type.name, "TodayPane");
	assert.equal(dockBody.children[1], null, "工件's list only on 工件 (company-dock-art-v2)");
	assert.equal(dockBody.children[2], null, "its 全部工件 bar only over an open artifact");
	const chatBox = dockBody.children[3];
	assert.equal(chatBox.props.style.visibility, "hidden", "the chat page waits, mounted");
	assert.equal(chatBox.children[0].type.name, "ChatFrame", "the same chat page as everywhere else");
	assert.equal(W.attrs["data-company-chat-dock"], undefined, "nothing given up before it is on screen");
	const cleanups = effects.slice().map((fn) => fn());
	assert.equal(W.attrs["data-company-chat-dock"], "1", "on screen: #root gives up its width");
	assert.deepEqual(W.picked, [null], "the 聊天 in the main area goes back to the conversation: one chat, not two");
	const rowsD = [{ id: "plugins" }, { id: "schedules" }, { id: "company-chat" }, { id: "company-erp" }];
	assert.deepEqual(Array.from(W.d.exp.panelsForDesk("employee", rowsD, true), (r) => r.id), ["schedules", "company-erp"], "the left column does not list 聊天 a second time");
	assert.deepEqual(Array.from(W.d.exp.panelsForDesk("admin", rowsD, true), (r) => r.id), ["plugins", "schedules", "company-erp"]);

	// An old right-sidebar 聊天 tab, brought back with a session's layout, closes itself while the column is there.
	const tabBody = W.d.regs.find((x) => x.opts.name === "sidebar.right.pane.tab" && x.opts.key === "company-chat");
	let closedTabs = 0;
	hookState = []; effects.length = 0; hookAt = 0;
	const tabOut = tabBody.Comp({ useTabInfo: () => ({ tab: { actions: { close: () => { closedTabs++; } } } }) });
	assert.equal(tabOut, null, "no second chat in the right sidebar");
	effects.forEach((fn) => fn());
	assert.equal(closedTabs, 1, "the tab closes (the last one closes the sidebar with it)");

	// A new message while the column is there: no popup over it; the window in the background still notifies.
	await settle();
	W.d.intervals.forEach((fn) => fn());
	await settle();
	const toastW = W.d.regs.find((x) => x.opts.name === "shell.overlay" && x.opts.id === "company-chat-toast");
	assert.equal(paint(toastW), null, "no popup over the chat's own column");
	assert.deepEqual(W.notifiedD, [{ title: "TDH 聊天", body: "梁风禾 发来新消息" }]);

	// The column goes (the window narrowed): #root has its width back, the old tab is the chat again.
	cleanups.forEach((fn) => typeof fn === "function" && fn());
	assert.equal(W.attrs["data-company-chat-dock"], undefined);
	hookState = []; effects.length = 0; hookAt = 0;
	assert.equal(tabBody.Comp({}).type.name, "ChatFrame", "without the column the old tab is the chat again");

	// A narrow window: no column at all.
	const N = dockDesk(false);
	assert.equal(paint(N.reg), null, "under 1100px: no column");
	effects.forEach((fn) => fn());
	assert.equal(N.attrs["data-company-chat-dock"], undefined, "and #root keeps its whole width");
	assert.deepEqual(N.picked, []);

	// The workspace column: the kernel folds it under 1024px of the frame's own width.
	const keepT = [];
	let keep = W.d.exp.workspaceKeeper(() => keepT.push(1));
	keep(1280, false);           // the frame before the column took its width
	keep(947, false);            // narrow, the kernel has not folded it yet: wait
	assert.equal(keepT.length, 0);
	keep(947, true);             // folded only for the chat's column (a 1280px window): opened again, once
	assert.equal(keepT.length, 1);
	keep(947, false);
	keep(947, true);             // the person folds it (or the right sidebar opens): stays folded
	keep(900, true);
	assert.equal(keepT.length, 1);
	keep(1100, false);           // wide again, open
	keep(960, true);             // narrow again: opened again
	assert.equal(keepT.length, 2);
	keepT.length = 0;
	keep = W.d.exp.workspaceKeeper(() => keepT.push(1));
	keep(1200, true);            // folded by the person while the frame was wide
	keep(980, true);
	assert.equal(keepT.length, 0, "a workspace the person folded stays folded");
	keep = W.d.exp.workspaceKeeper(() => keepT.push(1));
	keep(0, true);
	assert.equal(keepT.length, 0, "a frame not laid out yet is no measure");
	assert.equal(W.toggled.length, 0, "no frame in this stand-in page: nothing toggled");
	console.log("CHAT_DESK_PROVE_OK=1");
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
