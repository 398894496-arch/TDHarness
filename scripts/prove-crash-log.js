#!/usr/bin/env node
// Proof for company-crash-log-v1 and company-watchdog-v1 (2026-11-20: the gateway died on an error
// nobody caught, left no trace, and stayed down because its task starts only at boot).
// - server/crash-log.js: an uncaught error and an unhandled rejection each leave time, kind and
//   stack in <dir>/<name>-crash.log, and the process still exits with code 1; a clean exit writes nothing.
// - gw-lite.js and knowledge-search.js install it before anything else; people-api.py hooks sys.excepthook.
// - server/watchdog.ps1 is ASCII, knows every service's task and port, waits for two closed checks,
//   honours the maintenance flag; scripts/setup-server.ps1 registers TDH-Watchdog and writes the flag
//   while it swaps the services, then removes it.
// Prints CRASH_LOG_PROVE_OK=1.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'server', 'crash-log.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crash-log-'));

function run(code) {
  return spawnSync(process.execPath, ['-e', 'require(' + JSON.stringify(LIB) + ').install("svc", ' + JSON.stringify(dir) + ');' + code], { encoding: 'utf8' });
}
const log = () => { try { return fs.readFileSync(path.join(dir, 'svc-crash.log'), 'utf8'); } catch (e) { return ''; } };

let r = run('setTimeout(() => { throw new Error("boom-uncaught") }, 5)');
assert.strictEqual(r.status, 1, 'an uncaught error still ends the process with 1');
assert.match(log(), /uncaughtException pid \d+\nError: boom-uncaught\n\s+at /, 'kind, pid and stack written');

r = run('Promise.reject(new Error("boom-rejected"))');
assert.strictEqual(r.status, 1, 'an unhandled rejection still ends the process');
assert.match(log(), /unhandledRejection pid \d+\nError: boom-rejected/, 'a rejection is written as one');

const before = log();
r = run('setTimeout(() => {}, 5)');
assert.strictEqual(r.status, 0);
assert.strictEqual(log(), before, 'a clean exit writes nothing');
r = run('process.exitCode = 3');
assert.strictEqual(r.status, 3);
assert.match(log(), /exit code 3 pid \d+/, 'another failing exit leaves at least its code');

const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
for (const [f, name] of [['server/gw-lite.js', 'gw-lite'], ['server/knowledge-search.js', 'knowledge-search']]) {
  const t = src(f);
  const at = t.indexOf("require('./crash-log.js').install('" + name + "')");
  assert.ok(at > 0, f + ' installs the crash log');
  assert.ok(at < t.indexOf("require('fs')"), f + ' installs it before anything else is loaded');
}
const py = src('server/people-api.py');
assert.ok(/def _crash_log\(kind, value, tb\):[\s\S]*people-api-crash\.log[\s\S]*sys\.__excepthook__/.test(py), 'people-api logs, then the default hook');
assert.ok(/if __name__ == "__main__":\n    sys\.excepthook = _crash_log\n    main\(\)/.test(py), 'people-api hooks it before main');

const wd = src('server/watchdog.ps1');
assert.ok(/^[\x00-\x7F]*$/.test(wd), 'watchdog.ps1 is ASCII (PowerShell 5.1)');
for (const [task, port] of [['Autostart-Gateway', 8450], ['Autostart-KnowledgeSearch', 4182], ['Autostart-PeopleApi', 4181],
  ['Autostart-Caddy-8443', 8443], ['Autostart-Tinode', 6060], ['TDH-CLIProxyAPI', 8317], ['TDH-Mfg-Api', 4190]]) {
  assert.ok(wd.includes("@{ task = '" + task + "'; port = " + port + ' }'), 'watchdog checks ' + task + ' on ' + port);
}
const gw = src('server/gw-lite.js');
assert.ok(gw.includes('TDH_GW_PORT || 8450'), 'the gateway port the watchdog checks is the gateway default');
assert.ok(src('server/people-api.py').includes('TDH_PEOPLE_PORT") or 4181'), 'the people port');
assert.ok(src('server/knowledge-search.js').includes('TDH_KNOW_PORT || 4182'), 'the knowledge port');
assert.ok(/\$miss -lt 2/.test(wd) && /maintenance\.flag/.test(wd) && /AddHours\(-1\)/.test(wd), 'two checks; the flag counts for an hour');
assert.ok(/'Running'\) \{ & schtasks\.exe \/End/.test(wd), 'a task still Running but not listening is ended first');
assert.ok(/Disabled/.test(wd), 'a disabled task is left alone');

const setup = src('scripts/setup-server.ps1');
const flagAt = setup.indexOf('[IO.File]::WriteAllText($maintFlag');
const firstEnd = setup.indexOf("& schtasks.exe /End /TN $tn");
assert.ok(flagAt > 0 && flagAt < firstEnd, 'the flag is written before the services are stopped');
assert.ok(setup.indexOf('Remove-Item -LiteralPath $maintFlag') > setup.indexOf("Write-Task 'Autostart-Gateway'"), 'and removed at the end');
assert.ok(/Register-ScheduledTask -TaskName 'TDH-Watchdog'/.test(setup) && /RepetitionInterval \(New-TimeSpan -Minutes 2\)/.test(setup), 'TDH-Watchdog every 2 minutes');
assert.ok(/^[\x00-\x7F]*$/.test(setup), 'setup-server.ps1 stays ASCII');

fs.rmSync(dir, { recursive: true, force: true });
console.log('CRASH_LOG_PROVE_OK=1');
