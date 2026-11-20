// Proof for company-chat-desk-v1, the desk side of 聊天 (desk/plugins/company-shell/lib/client.js): loaded with a
// stand-in kernel (every service answers anything), the shell
//   - adds 聊天 to the left column (sidebar.panellist "company-chat") and its page (main, keyed "company-chat");
//   - once the right sidebar's tab registry is there, registers the 聊天 tab type (kept mounted, on the start
//     page) and its body under the same id;
//   - the page asks this desk's host where the chat is (/company/chat/where) and shows it in an iframe; when the
//     host has no relay it says so and offers 重试;
//   - company-chat-notify-v1: the desk asks its host for the unread count (badge on 聊天); a new message while the
//     chat is not on screen pops up in the window (打开 opens the chat panel); while the window is in the
//     background the host is asked for the system's notification; old messages from before the page loaded are
//     not announced.
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
	useRef(v) { return { current: v }; },
	useMemo(fn) { return fn(); },
	useCallback(fn) { return fn; },
	useSyncExternalStore(sub, get) { return get(); },
	Fragment: "Fragment",
};

function load(o) {
o = o || {};
let mod = null;
const intervals = [];
const sandbox = {
	window: { __ModuleLoader__: { load: (m) => { mod = m; } } },
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
const exp = mod.factory((name) => (name === "react" ? React : anything));
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
			injected = names;
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
return { sandbox, regs, tabTypes, injected, intervals };
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
assert.equal(def.guide.length, 1);
assert.equal(def.guide[0].title(), "聊天");
assert.ok(def.guide[0].icon, "the start page shows its icon");
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
	assert.match(frame.props.src, /^http:\/\/127\.0\.0\.1:17811\/chat\/\?k=abc&theme=(light|dark)$/, "the chat page, in the desk's light or dark");
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
	console.log("CHAT_DESK_PROVE_OK=1");
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
