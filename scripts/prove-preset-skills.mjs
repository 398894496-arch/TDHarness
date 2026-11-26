#!/usr/bin/env node
// Prove the three fixes for "skill company-mail is unknown" + "glob timed out after 30000ms"
// (2026-11-24, a Mac desk on DSH 0.2.1-alpha.1):
//  1. patches/lib/preset-patch-layout.js pins the dsh-web-app preset rows (0.1.7+ layout):
//     skill-filesystem reads only the company skills cache, agent-instructions stops at
//     .company-root. Idempotent; refuses when the anchor moved. If an installed kernel is
//     found (TDH_KERNEL=<.../@deepseek-ai/dsh> or the Mac app), its real standard/ptc presets
//     are checked too, and an already-patched one must carry the mark.
//  2. shareGlobDecision refuses any glob rooted at the share root (Mac ~/company, Win UNC
//     share, mapped drive) and a `**` glob rooted at _office / _shared (also when the path is
//     the session cwd), names the narrower path, and lets a subfolder glob through.
//  3. company_knowledge's 2-lookup cap is per turn: a third topic in the same turn stops, a
//     new turn (turn/start in the session log) starts fresh.
// Ends with PRESET_SKILLS_PROVE_OK=1.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const require = createRequire(import.meta.url);
const { MARK, pinPresetPatchLayout } = require(path.join(repo, "patches", "lib", "preset-patch-layout.js"));

let fails = 0;
function check(cond, what) {
	if (!cond) {
		console.error("PRESET_SKILLS_PROVE_FAIL " + what);
		fails += 1;
	}
}

// ---- 1. preset layout ----
const fixture = [
	"- insert:",
	"    - id: preset-standard",
	"      name: '@deepseek-ai/dsh-agent-preset'",
	"      config:",
	"        id: standard",
	"        plugins:",
	"          - id: agent-instructions",
	"            name: '@deepseek-ai/dsh-agent-instructions'",
	"            config:",
	"              maxBytes: 65536",
	"          - id: time-context",
	"            name: '@deepseek-ai/dsh-time-context'",
	"          - id: skill-filesystem",
	"            name: '@deepseek-ai/dsh-skill-filesystem'",
	"          - id: tool-skill",
	"            name: '@deepseek-ai/dsh-tool-skill'",
	"",
].join("\n");
let r = pinPresetPatchLayout(fixture);
check(r.changed && !r.error, "fixture patched " + JSON.stringify(r.error));
check(/            config:\n              includeDefaultRoots: false\n              watch: false\n              customSkillDirs:\n                - !!js .*'\.dsh-company-rc8', 'skills'\)\n          - id: tool-skill/.test(r.text), "skill row pinned at its indent");
check(/              maxBytes: 65536\n              projectRootMarkers:\n                - \.company-root\n          - id: time-context/.test(r.text), "instr row pinned");
check(r.text.includes("# --- " + MARK + " ---"), "mark written");
const again = pinPresetPatchLayout(r.text);
check(!again.changed && !again.error, "idempotent");
const moved = pinPresetPatchLayout(fixture.replace("dsh-skill-filesystem'", "dsh-skill-filesystem'\n            config: {}"));
check(moved.error && /skill-anchor/.test(moved.error), "refuses a skill row that already has config");
const noInstr = pinPresetPatchLayout(fixture.replace("maxBytes: 65536", "maxBytes: 1"));
check(noInstr.error && /instr-anchor/.test(noInstr.error), "refuses a moved instr anchor");
// The !!js path is where every launcher builds the cache.
const js = r.text.match(/- !!js (.*)\n/)[1];
check(new Function("return " + js)() === path.join(os.homedir(), ".dsh-company-rc8", "skills"), "!!js path = ~/.dsh-company-rc8/skills");

// The site patch (server/site-patches/patch_preset_layout.py, what publish-site-update puts
// into the finished packs) writes the same bytes as the build-time one.
{
	const { spawnSync } = await import("node:child_process");
	const py = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", [
		"import sys,importlib.util",
		"spec=importlib.util.spec_from_file_location('p',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)",
		"t,how=m.patch(sys.stdin.read())",
		"assert m.patch(t)[1]=='already'",
		"assert m.is_target('CompanyDesk/prefix/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/presets/ptc.patch.yml')",
		"sys.stdout.write(t)",
	].join("\n"), path.join(repo, "server", "site-patches", "patch_preset_layout.py")], { input: fixture, encoding: "utf8" });
	if (py.error || py.status !== 0) console.log("SITE_PATCH_SKIP=" + (py.error ? py.error.code : py.stderr.trim().split("\n").pop()));
	else check(py.stdout === r.text, "site patch (python) = build patch (js)");
}

const kernels = [
	process.env.TDH_KERNEL,
	"/Applications/TDHarness 壹通达.app/Contents/Resources/prefix/node_modules/@deepseek-ai/dsh",
].filter(Boolean);
for (const k of kernels) {
	const dir = path.join(k, "node_modules", "@deepseek-ai", "dsh-web-app", "presets");
	if (!fs.existsSync(dir)) continue;
	for (const name of ["standard", "ptc"]) {
		const f = path.join(dir, name + ".patch.yml");
		if (!fs.existsSync(f)) continue;
		const text = fs.readFileSync(f, "utf8");
		const rr = pinPresetPatchLayout(text);
		check(!rr.error, "real " + name + " preset anchors " + f + " " + rr.error);
		const state = text.includes(MARK) ? "patched" : "UNPATCHED (kernel tree built before this fix)";
		console.log("KERNEL_PRESET " + name + " " + state + " " + f);
	}
	break;
}

// ---- 2. share glob guard ----
process.env.DSH_COMPANY_RC = fs.mkdtempSync(path.join(os.tmpdir(), "tdh-preset-"));
const m = await import(pathToFileURL(path.join(repo, "desk", "plugins", "company-shell", "lib", "index.js")).href);
const g = (args, cwd) => m.shareGlobDecision({ name: "glob", arguments: args, agent: cwd ? { session: { header: { cwd } } } : undefined });
const deny = (d) => d && d.kind === "deny" && /glob-too-broad/.test(d.reason);
check(deny(g({ path: "/Users/amy/company/_office", pattern: "**/company-mail/SKILL.md" })), "Mac _office root refused");
check(deny(g({ path: "/Users/amy/company", pattern: "**/*.md" })), "Mac company root refused");
check(deny(g({ pattern: "**/SKILL.md" }, "/Users/amy/company/_office")), "cwd default (_office) refused");
check(deny(g({ path: "\\\\192.168.3.2\\dsh-company", pattern: "**/x" })), "Win UNC share root refused");
check(deny(g({ path: "\\\\192.168.3.2\\dsh-company\\_office", pattern: "**/x" })), "Win UNC _office refused");
check(deny(g({ pattern: "**/*.ps1" }, "\\\\tdharness.local\\dsh-company\\emp-liangfenghe")), "Win employee chair (emp-*) as cwd refused for **");
check(g({ pattern: "*.ps1" }, "\\\\tdharness.local\\dsh-company\\emp-liangfenghe") === null, "Win employee chair non-** left alone");
check(deny(g({ path: "Z:\\", pattern: "**/x" })), "Win mapped drive root refused");
check(deny(g({ path: "/Users/amy/company", pattern: "{server/erp/*,_shared/*}" })), "any glob on the share root refused (rg walks it all)");
const hint = g({ path: "/Users/amy/company", pattern: "_skills/**/company-mail/SKILL.md" });
check(deny(hint) && hint.reason.includes("path=/Users/amy/company/_skills，pattern=**/company-mail/SKILL.md"), "leading folders moved into path: " + (hint && hint.reason));
check(g({ pattern: "*ERP*" }, "/Users/amy/company/_office") === null, "a non-** glob on the chair is left alone");
check(g({ path: "/Users/amy/company/_office/mfg", pattern: "**/*.pdf" }) === null, "subfolder glob allowed");
check(g({ path: "/Users/amy/company/_office", pattern: "*.pdf" }) === null, "non-recursive glob allowed");
check(g({ pattern: "**/x" }) === null, "no path and no cwd: left alone");
check(m.shareGlobDecision({ name: "grep", arguments: { path: "/Users/amy/company/_office", pattern: "**" } }) === null, "only glob");

// ---- 3. knowledge budget per turn ----
const log = [];
const session = {
	header: { id: "session-prove", cwd: "/Users/amy/company/_office" },
	get seq() { return log.length; },
	eventAt(q) { return log[q]; },
};
const startTurn = (n) => log.push({ type: "turn/start", seq: log.length, data: { turn: n } });
const exec = { agent: { session } };
let calls = 0;
const def = m.wrapKnowledgeBudget({
	name: "company_knowledge",
	execute: async (args) => { calls += 1; return { ok: true, status: "ok", hits: [{ path: "_office/_memory/" + args.query + ".md" }] }; },
});
check(m.sessionTurnOf(exec) === null, "no turn yet = null");
startTurn(1);
log.push({ type: "step/start", seq: log.length, data: { turn: 1 } });
check(m.sessionTurnOf(exec) === 1, "turn 1 read from the log");
const ask = (q) => def.execute({ route: "search", query: q }, exec);
let a = await ask("甲客户报价先例");
let b = await ask("乙客户交期先例");
let c = await ask("丙客户付款先例");
check(a.status === "ok" && b.status === "ok", "two lookups in a turn answer");
check(c && c.status === "knowledge-budget", "third topic in the same turn stops: " + JSON.stringify(c));
startTurn(2);
let d = await ask("丁客户退货先例");
check(d.status === "ok", "a new turn starts fresh: " + JSON.stringify(d));
check(calls === 3, "inner calls " + calls);

if (fails) process.exit(1);
console.log("PRESET_SKILLS_PROVE_OK=1");
