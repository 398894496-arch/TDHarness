// Proof for company-chat-desk-v1, the desk side of 聊天 (desk/plugins/company-shell/lib/client.js): loaded with a
// stand-in kernel (every service answers anything), the shell
//   - adds 聊天 to the left column (sidebar.panellist "company-chat") and its page (main, keyed "company-chat");
//   - once the right sidebar's tab registry is there, registers the 聊天 tab type (kept mounted, on the start
//     page) and its body under the same id;
//   - the page asks this desk's host where the chat is (/company/chat/where) and shows it in an iframe; when the
//     host has no relay it says so and offers 重试.
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

function load() {
let mod = null;
const sandbox = {
	window: { __ModuleLoader__: { load: (m) => { mod = m; } } },
	document: anything,
	navigator: anything,
	localStorage: anything,
	location: anything,
	setTimeout: () => 0,
	clearTimeout: () => {},
	setInterval: () => 0,
	clearInterval: () => {},
	console,
	URL,
	Math,
	JSON,
	Promise,
	Date,
	fetch: () => new Promise(() => {}),
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
		return anything;
	},
});
exp.apply(ctx);
return { sandbox, regs, tabTypes, injected };
}
const { sandbox, regs, tabTypes, injected } = load();

const panel = regs.find((r) => r.opts.name === "sidebar.panellist" && r.opts.id === "company-chat");
assert.ok(panel, "聊天 in the left column");
assert.equal(panel.opts.label(), "聊天");
const icon = panel.Comp({ size: 18 });
assert.equal(icon.type, "svg");
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
	assert.equal(frame.props.src, "http://127.0.0.1:17811/chat/?k=abc");
	assert.match(frame.props.allow, /microphone/, "voice messages can record");

	// The address is asked once: the right-sidebar tab shows the same chat at once.
	tree = render(body.Comp, () => { throw new Error("asked again"); });
	assert.equal(find(tree, "iframe"), null, "first paint, before the effect");
	effects.forEach((fn) => fn());
	await new Promise((r) => setImmediate(r));
	tree = rerender(body.Comp);
	assert.equal(find(tree, "iframe").props.src, "http://127.0.0.1:17811/chat/?k=abc");

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
	console.log("CHAT_DESK_PROVE_OK=1");
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
