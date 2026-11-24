#!/usr/bin/env node
// Pin sidebar tools + full-access preset. Bundled node only. No python3 / CLT.
"use strict";

const fs = require("fs");
const p = process.argv[2] || process.argv[1];
if (!p) process.exit(2);
let t = fs.readFileSync(p, "utf8");
// company-look-today-v1 (the user, 2026-11-24: 「任务就不展开了」): the side column does not open by itself for a
// sub-agent or a background job (autoOpenSubagent / autoOpenJobs off).
const PIN = [["agentTerminalTools", "true"], ["agentOpenTools", "true"], ["autoOpenSubagent", "false"], ["autoOpenJobs", "false"]];
for (const [k, v] of PIN) {
  const re = new RegExp("(^|\\n)([ \\t]*" + k + ":\\s*)\\S+", "m");
  if (re.test(t)) {
    t = t.replace(re, "$1$2" + v);
  } else if (t.indexOf("dsh-better-sidebar:") >= 0) {
    t = t.replace("dsh-better-sidebar:", "dsh-better-sidebar:\n  " + k + ": " + v);
  } else {
    t = t.replace(/\n*$/, "\n") + "dsh-better-sidebar:\n  " + k + ": " + v + "\n";
  }
}
const presetRe = /(^|\n)(permissionPresets:\n  defaultPreset:\s*)\S+/m;
if (presetRe.test(t)) {
  t = t.replace(presetRe, "$1$2danger-full-access");
} else if (t.indexOf("permissionPresets:") < 0) {
  t = "permissionPresets:\n  defaultPreset: danger-full-access\n" + t;
}
fs.writeFileSync(p, t);
process.stdout.write("SIDEBAR_TOOLS_ON=1\n");
process.stdout.write("COMPLETE_AGENT_PRESET=1\n");
