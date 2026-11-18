#!/usr/bin/env node
// Boot: build the local skills cache, then point overlay/preset at it.
// The cache is the pack's own skills (--seed) with the site's _skills on the
// share (--share) laid over them: a site skill is added, or replaces the bundled
// one of the same name, so an extension pack adds its skills without copying
// (and later going stale on) the bundled company-* ones. A file named
// .replace-bundled in the share's _skills keeps the old rule: when the share has
// any skill, only the share's are used.
// The session catalog must not scan the share (SMB list is ~1s) or cwd/_skills
// (personal clone goes stale: missing company-access / old company-web).
"use strict";

const fs = require("fs");
const path = require("path");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback || "";
}

function copyTree(src, dest) {
  if (!src || !fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name === ".DS_Store" || ent.name.startsWith("._")) continue;
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) n += copyTree(from, to);
    else {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      n += 1;
    }
  }
  return n;
}

function rewriteCatalog(file, cache) {
  if (!file || !fs.existsSync(file)) return false;
  let t = fs.readFileSync(file, "utf8");
  const prev = t;
  t = t.split("__DESK_SKILLS__").join(cache);
  t = t.replace(/bundledSkillDir:[^\n]*/g, "bundledSkillDir: " + cache);
  t = t.replace(/(customSkillDirs:\r?\n)(?:[ \t]*- [^\n]*\r?\n)+/g, "$1      - " + cache + "\n");
  t = t.replace(/^[ \t]*- [^\n]*\/_skills[ \t]*\r?\n/gm, "");
  t = t.replace(/^[ \t]*- _skills[ \t]*\r?\n/gm, "");
  if (t === prev) return false;
  fs.writeFileSync(file, t);
  return true;
}

function countSkills(dir) {
  if (!dir || !fs.existsSync(dir)) return 0;
  let n = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (fs.existsSync(path.join(dir, ent.name, "SKILL.md"))) n += 1;
  }
  return n;
}

const cache = path.resolve(arg("--cache"));
const share = arg("--share") ? path.resolve(arg("--share")) : "";
const seed = arg("--seed") ? path.resolve(arg("--seed")) : "";
const overlay = arg("--overlay");
const preset = arg("--preset");
if (!cache) {
  process.stderr.write("usage: sync-skills.js --cache DIR [--share DIR] [--seed DIR] [--overlay FILE] [--preset FILE]\n");
  process.exit(2);
}

function rmTree(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

// Lay src over dest: each top-level folder replaces the one of the same name
// whole (no stale files left from the bundled version), files are copied over.
function layOver(src, dest) {
  let n = 0;
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name === ".DS_Store" || ent.name.startsWith("._") || ent.name === ".replace-bundled") continue;
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      rmTree(to);
      n += copyTree(from, to);
    } else {
      fs.copyFileSync(from, to);
      n += 1;
    }
  }
  return n;
}

const shareN = share && fs.existsSync(share) ? countSkills(share) : 0;
const seedN = seed && fs.existsSync(seed) ? countSkills(seed) : 0;
const replaceBundled = shareN >= 1 && fs.existsSync(path.join(share, ".replace-bundled"));
const useSeed = seedN >= 1 && !replaceBundled;
const useShare = shareN >= 1;
let copied = 0;
let srcName = "none";
if (useSeed || useShare) {
  // Build next to the cache and swap, so a copy that fails half way leaves the
  // last good cache in place (and a skill removed upstream does not linger).
  const next = cache + ".next";
  rmTree(next);
  fs.mkdirSync(next, { recursive: true });
  if (useSeed) copied += copyTree(seed, next);
  if (useShare) copied += layOver(share, next);
  if (countSkills(next) >= 1) {
    try {
      rmTree(cache);
      fs.renameSync(next, cache);
    } catch {
      // Something holds the old cache open: lay the new one over it instead.
      fs.mkdirSync(cache, { recursive: true });
      layOver(next, cache);
      rmTree(next);
    }
  } else {
    rmTree(next);
  }
  srcName = useSeed && useShare ? "seed+share" : (useShare ? share : seed);
}
fs.mkdirSync(cache, { recursive: true });
const n = countSkills(cache);
process.stdout.write("SKILLS_CACHE=" + cache + "\n");
process.stdout.write("SKILLS_SRC=" + srcName + "\n");
process.stdout.write("SKILLS_BUNDLED=" + (useSeed ? seedN : 0) + "\n");
process.stdout.write("SKILLS_SITE=" + shareN + (replaceBundled ? " (replace-bundled)" : "") + "\n");
process.stdout.write("SKILLS_COPIED=" + copied + "\n");
process.stdout.write("SKILLS_COUNT=" + n + "\n");
if (overlay) process.stdout.write("SKILLS_OVERLAY=" + (rewriteCatalog(overlay, cache) ? "1" : "0") + "\n");
if (preset) process.stdout.write("SKILLS_PRESET=" + (rewriteCatalog(preset, cache) ? "1" : "0") + "\n");
if (n < 1) process.exit(2);
