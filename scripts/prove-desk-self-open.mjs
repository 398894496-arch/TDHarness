#!/usr/bin/env node
// Proof for company-desk-self-open-v1 (desk/plugins/company-shell/lib/index.js): the agent may not
// open this desk's own page (127.0.0.1:17803) in a browser by sidebar_open, the opencli tool or a
// bash `opencli browser open` / `open`, because that took the desk down mid-turn. Reading it over
// HTTP (curl), other local ports and public pages still go through. No desk, no browser.
// Ends with DESK_SELF_OPEN_PROVE_OK=1.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shell = await import(pathToFileURL(path.join(here, "..", "desk", "plugins", "company-shell", "lib", "index.js")).href);
const { isOwnDeskUrl, opensOwnDesk, wrapWebCompanyName } = shell;

for (const u of ["http://127.0.0.1:17803", "http://127.0.0.1:17803/", "127.0.0.1:17803/?token=x", "http://localhost:17803/#/s", "http://[::1]:17803", "http://0.0.0.0:17803"]) {
	assert.ok(isOwnDeskUrl(u), "own desk: " + u);
}
for (const u of ["http://127.0.0.1:3000", "https://example.org", "http://192.168.1.80:17803", "https://tdharness.local:8443/", "", "not a url"]) {
	assert.ok(!isOwnDeskUrl(u), "not own desk: " + u);
}

assert.ok(opensOwnDesk("sidebar_open", { target: "http://127.0.0.1:17803", title: "x" }));
assert.ok(!opensOwnDesk("sidebar_open", { target: "https://example.org" }));
assert.ok(!opensOwnDesk("sidebar_open", { target: "/Users/x/report.html" }));
assert.ok(opensOwnDesk("opencli", { action: "run", argv: ["browser", "--session", "a", "--window", "background", "open", "http://127.0.0.1:17803/"] }));
assert.ok(!opensOwnDesk("opencli", { action: "run", argv: ["browser", "--session", "a", "open", "https://example.org"] }));
assert.ok(!opensOwnDesk("opencli", { action: "doctor" }));
assert.ok(opensOwnDesk("bash", { command: "opencli browser --session work open http://127.0.0.1:17803" }));
assert.ok(opensOwnDesk("bash", { command: "date; open 'http://localhost:17803/'" }));
assert.ok(!opensOwnDesk("bash", { command: "curl --max-time 4 -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:17803/" }));
assert.ok(!opensOwnDesk("bash", { command: "lsof -nP -iTCP:17803 -sTCP:LISTEN" }));
assert.ok(!opensOwnDesk("bash", { command: "opencli browser --session work open https://example.org" }));
assert.ok(!opensOwnDesk("bash", { command: "npm start -- --port 3000 && open http://127.0.0.1:3000" }));

// Through the wrapper the desk installs on its tool registry.
const registered = new Map();
const tools = { register(def) { registered.set(def.name, def); return () => {}; } };
wrapWebCompanyName(tools);
const ran = [];
for (const name of ["sidebar_open", "opencli", "bash", "read"]) {
	tools.register({ name, execute: async (args) => { ran.push(name); return { ok: true, args }; } });
}
await assert.rejects(registered.get("sidebar_open").execute({ target: "http://127.0.0.1:17803" }), /desk-self-open/);
await assert.rejects(registered.get("opencli").execute({ action: "run", argv: ["browser", "open", "http://127.0.0.1:17803"] }), /desk-self-open/);
await assert.rejects(registered.get("bash").execute({ command: "opencli browser open http://127.0.0.1:17803/" }), /desk-self-open/);
assert.deepEqual(ran, [], "a refused open never reaches the tool");
assert.equal((await registered.get("sidebar_open").execute({ target: "https://example.org" })).ok, true);
assert.equal((await registered.get("bash").execute({ command: "curl -sS http://127.0.0.1:17803/" })).ok, true);
assert.equal((await registered.get("read").execute({ file_path: "/x" })).ok, true);
assert.deepEqual(ran, ["sidebar_open", "bash", "read"]);

console.log("DESK_SELF_OPEN_PROVE_OK=1");
