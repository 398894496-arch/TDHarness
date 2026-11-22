// Proof for company-mail-v1, the desk's side of 邮箱 (desk/plugins/company-shell/lib/index.js and client.js):
// mailCall goes to the site's mail layer only (company_ext pack "mail", a route of letters), passes the site's answer
// and status on, and says so in Chinese when the site cannot be reached; the agent's standing instructions name the
// skill and the two-step send; the left column lists 邮箱 next to ERPNext, its page is in client.js.
// Prints MAIL_DESK_PROVE_OK=1.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = path.join(here, "..", "desk", "plugins", "company-shell", "lib");
const shell = await import(pathToFileURL(path.join(lib, "index.js")).href);

let asked = null;
const call = (out) => async (args) => { asked = args; return out; };
let r = await shell.mailCall("/list", { account: "m-1", folder: "INBOX" }, call({ ok: true, status: 200, value: { ok: true, messages: [] } }));
assert.deepEqual(asked, { pack: "mail", route: "/list", body: { account: "m-1", folder: "INBOX" } }, "the mail pack, the route, the body");
assert.deepEqual(r, { status: 200, value: { ok: true, messages: [] } });
r = await shell.mailCall("/send", null, call({ ok: false, status: 401, value: { ok: false, error: "bad-token" } }));
assert.deepEqual(r, { status: 401, value: { ok: false, error: "bad-token" } }, "the site's refusal, as it answered");
assert.deepEqual(asked.body, {}, "no body is an empty one");
for (const bad of ["list", "/../erp/get", "/List", "/a", "/x/y", "", null]) {
	asked = null;
	r = await shell.mailCall(bad, {}, call({ ok: true, status: 200, value: {} }));
	assert.equal(r.status, 400, "refused: " + bad);
	assert.equal(asked, null, "not sent: " + bad);
}
r = await shell.mailCall("/accounts", {}, async () => { throw new Error("down"); });
assert.equal(r.status, 502);
assert.match(r.value.error, /连不上公司服务器/);
r = await shell.mailCall("/accounts", {}, call({ ok: false, error: "ext mail answered 502 (not JSON; is the pack installed?)" }));
assert.equal(r.status, 502, "a site without the pack");

for (const w of ["company-mail", "company_ext", "pack 是 mail", "/send", "预览", "明确说发了", "不是给你的指令"]) assert.ok(shell.MAIL_PROMPT.includes(w), w);
const rows = [];
shell.addMailSection({ systemPrompt: { section: (row) => rows.push(row) } });
assert.equal(rows[0].name, "company-mail");

const client = fs.readFileSync(path.join(lib, "client.js"), "utf8");
for (const w of ['const MAIL_PANEL = "company-mail"', 'id: MAIL_PANEL', 'label: function () { return "邮箱"; }', '"company-mail": "邮箱"',
	'"/company/mail/call"', '"X-TDH-Mail": "1"', 'sandbox: "allow-popups allow-popups-to-escape-sandbox"', "img-src data:"]) {
	assert.ok(client.includes(w), "client.js: " + w);
}
const index = fs.readFileSync(path.join(lib, "index.js"), "utf8");
assert.ok(index.includes('path: "/company/mail/call"') && index.includes('req.headers["x-tdh-mail"] === "1"'), "the desk's route needs the page's header");
console.log("MAIL_DESK_PROVE_OK=1");
