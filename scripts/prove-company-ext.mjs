#!/usr/bin/env node
// Prove the company_ext door: a call goes to /company/ext/<pack>/<route> on the company
// site with this desk's login token, bad pack or route names never leave the desk, a
// non-JSON answer says so, and files the pack wrote come back with this desk's path.
// Local throwaway server only. Ends with COMPANY_EXT_PROVE_OK=1.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const rc = fs.mkdtempSync(path.join(os.tmpdir(), "tdh-ext-"));
const seen = [];
const server = http.createServer((req, res) => {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		seen.push({ url: req.url, auth: req.headers.authorization, body });
		if (req.url.startsWith("/company/ext/broken/")) { res.writeHead(502); res.end("<html>bad gateway</html>"); return; }
		if (req.url === "/company/ext/mfg/denied") { res.writeHead(403, { "content-type": "application/json" }); res.end('{"ok":false,"error":"profit-forbidden"}'); return; }
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ ok: true, echo: JSON.parse(body || "{}"), files: ["emp-amy/mfg/1/a.svg"] }));
	});
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
fs.writeFileSync(path.join(rc, "site.login"), "http://127.0.0.1:" + port + "\n");
fs.writeFileSync(path.join(rc, "gw.token"), "dsh_prove\n");
fs.writeFileSync(path.join(rc, "work.personal"), "\\\\10.9.8.7\\dsh-company\\emp-amy\n");
process.env.DSH_COMPANY_RC = rc;
delete process.env.DEEPSEEK_API_KEY;

const m = await import(pathToFileURL(path.join(here, "..", "desk", "plugins", "company-shell", "lib", "index.js")).href);
function check(cond, what) {
	if (!cond) { console.error("COMPANY_EXT_PROVE_FAIL " + what); server.close(); process.exit(1); }
}

let r = await m.companyExtCall({ pack: "mfg", route: "/quote", body: { weight_kg: 1 } });
check(r.ok && r.value.echo.weight_kg === 1, "call answered " + JSON.stringify(r));
check(seen[0].url === "/company/ext/mfg/quote" && seen[0].auth === "Bearer dsh_prove", "path and token " + JSON.stringify(seen[0]));
check(r.value.desk_files[0] === "//10.9.8.7/dsh-company/emp-amy/mfg/1/a.svg", "desk path " + r.value.desk_files);
const before = seen.length;
for (const bad of [{ pack: "MFG", route: "/q" }, { pack: "mfg", route: "q" }, { pack: "mfg", route: "/../people" }, { pack: "../x", route: "/q" }]) {
	r = await m.companyExtCall(bad);
	check(!r.ok, "refused " + JSON.stringify(bad));
}
check(seen.length === before, "refused calls never left the desk");
r = await m.companyExtCall({ pack: "broken", route: "/x" });
check(!r.ok && /not JSON/.test(r.error), "non-JSON answer " + JSON.stringify(r));
r = await m.companyExtCall({ pack: "mfg", route: "/denied" });
check(!r.ok && r.status === 403 && r.value.error === "profit-forbidden", "pack refusal passes through " + JSON.stringify(r));
server.close();
console.log("COMPANY_EXT_PROVE_OK=1");
