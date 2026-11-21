// Proof for company-erp-desk-v1, the desk host's side of the ERPNext entry (desk/plugins/company-shell/lib/index.js):
// erpOpen asks the site for the one-time link (company_ext pack "erp", /ticket) and opens it in the system's browser
// only when it is such a link (https, /tdh-sso/start, a ticket); anything else is not opened and the site's reason
// is passed on. openInBrowser hands the address to the system's opener as one argument, never to a shell.
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
console.log("ERP_DESK_PROVE_OK=1");
