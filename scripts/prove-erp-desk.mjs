// Proof for company-erp-desk-v1, the desk host's side of the ERPNext entry (desk/plugins/company-shell/lib/index.js):
// erpOpen asks the site for the one-time link (company_ext pack "erp", /ticket) and opens it in the system's browser
// only when it is such a link (https, /tdh-sso/start, a ticket); anything else is not opened and the site's reason
// is passed on. openInBrowser hands the address to the system's opener as one argument, never to a shell.
// company-chat-history-prompt-v1: the agent's instructions say how to read the person's own chat.
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
console.log("ERP_DESK_PROVE_OK=1");
