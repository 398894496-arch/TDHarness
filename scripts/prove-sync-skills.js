#!/usr/bin/env node
// Prove desk/pack/common/sync-skills.js builds the desk's skills cache as the
// pack's own skills with the site's _skills laid over them: a site skill is
// added or replaces the bundled one of the same name whole, a skill gone from
// both is gone from the cache, and .replace-bundled keeps the old share-only
// rule. Throwaway folders only. Ends with SYNC_SKILLS_PROVE_OK=1.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const JS = path.join(__dirname, "..", "desk", "pack", "common", "sync-skills.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "tdh-sync-skills-"));

function check(cond, what) {
  if (!cond) {
    console.error("SYNC_SKILLS_PROVE_FAIL " + what);
    process.exit(1);
  }
}
function skill(dir, name, body, extra) {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, "SKILL.md"), "---\nname: " + name + "\n---\n" + body + "\n");
  for (const [f, t] of Object.entries(extra || {})) fs.writeFileSync(path.join(dir, name, f), t);
}
function run(args) {
  const r = spawnSync(process.execPath, [JS].concat(args), { encoding: "utf8" });
  const out = {};
  for (const line of String(r.stdout || "").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  out.status = r.status;
  return out;
}
function names(dir) {
  return fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, "SKILL.md"))).sort();
}
const read = (...p) => fs.readFileSync(path.join(...p), "utf8");

const seed = path.join(root, "pack", "skills");
const share = path.join(root, "share", "_skills");
const cache = path.join(root, "home", "skills");
const overlayYml = path.join(root, "overlay.yml");
skill(seed, "company-ticket", "bundled ticket");
skill(seed, "company-web", "bundled web", { "old-notes.md": "only in the bundled copy" });
skill(seed, "company-knowledge", "bundled knowledge");
fs.mkdirSync(share, { recursive: true });
fs.writeFileSync(overlayYml, "skills:\n  bundledSkillDir: __DESK_SKILLS__\n  customSkillDirs:\n    - Z:/_skills\n");

// An empty site _skills: the bundled ones, as before.
let o = run(["--cache", cache, "--seed", seed, "--share", share, "--overlay", overlayYml]);
check(o.status === 0 && names(cache).join() === "company-knowledge,company-ticket,company-web", "bundled only " + names(cache));
check(o.SKILLS_OVERLAY === "1" && read(overlayYml).indexOf(cache) >= 0 && read(overlayYml).indexOf("_skills") < 0, "overlay points at the cache");

// An extension pack adds skills and replaces one bundled skill; the bundled ones stay.
skill(share, "mfg-quote", "site quote");
skill(share, "company-web", "site web");
o = run(["--cache", cache, "--seed", seed, "--share", share]);
check(o.SKILLS_SRC === "seed+share" && o.SKILLS_BUNDLED === "3" && o.SKILLS_SITE === "2", "sources " + JSON.stringify(o));
check(names(cache).join() === "company-knowledge,company-ticket,company-web,mfg-quote", "layered " + names(cache));
check(read(cache, "company-web", "SKILL.md").indexOf("site web") >= 0, "the site's company-web wins");
check(!fs.existsSync(path.join(cache, "company-web", "old-notes.md")), "no stale file from the bundled copy");
check(read(cache, "company-ticket", "SKILL.md").indexOf("bundled ticket") >= 0, "bundled company-ticket kept");

// A skill removed from the site and from the pack leaves the cache.
fs.rmSync(path.join(share, "mfg-quote"), { recursive: true });
fs.rmSync(path.join(seed, "company-knowledge"), { recursive: true });
o = run(["--cache", cache, "--seed", seed, "--share", share]);
check(names(cache).join() === "company-ticket,company-web", "removed skills gone " + names(cache));

// .replace-bundled: the site's skills only, the old rule.
fs.writeFileSync(path.join(share, ".replace-bundled"), "");
o = run(["--cache", cache, "--seed", seed, "--share", share]);
check(names(cache).join() === "company-web" && o.SKILLS_BUNDLED === "0", "replace-bundled " + names(cache));
check(!fs.existsSync(path.join(cache, ".replace-bundled")), "the marker is not copied");

// No share at all: the bundled ones.
o = run(["--cache", cache, "--seed", seed]);
check(o.SKILLS_SRC === seed && names(cache).join() === "company-ticket,company-web", "no share " + JSON.stringify(o));

fs.rmSync(root, { recursive: true, force: true });
console.log("SYNC_SKILLS_PROVE_OK=1");
