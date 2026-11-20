#!/usr/bin/env node
// Proof for company-model-menu-blur-v1 (server/site-patches/patch_model_menu_blur.py) against the kernel's own
// dsh-client-ui-model-selection/lib/client.js (KERNEL_PREFIX: an installed kernel prefix): the patch applies once,
// a second run says already, the file still parses; and the new onBlur, run with stand-ins for the menu and the
// document, keeps the menu open when the focused row was removed by a pane switch (and hands focus to the checked
// item) or when focus is back inside, and closes it when focus really left (to an element outside, or with the
// blurred element still there). Ends with MODEL_MENU_BLUR_PROVE_OK=1.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PATCHES = path.join(ROOT, 'server', 'site-patches');
const prefix = process.env.KERNEL_PREFIX;
if (!prefix) { console.log('MODEL_MENU_BLUR_PROVE_SKIP=no-KERNEL_PREFIX'); process.exit(0); }
const py = process.env.PROVE_PY || 'python3';
const rel = '@deepseek-ai/dsh-client-ui-model-selection/lib/client.js';
function find(dir, depth) {
  // The file sits in some node_modules/@deepseek-ai under the prefix (nested under dsh in an installed kernel).
  const direct = path.join(dir, rel);
  if (fs.existsSync(direct)) return direct;
  if (depth > 6) return '';
  let es = [];
  try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return ''; }
  for (const e of es) {
    if (!e.isDirectory() || e.name === 'lib' || e.name === 'src' || e.name === 'dist') continue;
    const hit = find(path.join(dir, e.name), depth + 1);
    if (hit) return hit;
  }
  return '';
}

(async () => {
  const src = find(prefix, 0);
  assert.ok(src, 'kernel file not found under ' + prefix);
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-menublur-'));
  try {
    const f = path.join(T, 'client.js');
    fs.copyFileSync(src, f);
    const run = () => spawnSync(py, [path.join(PATCHES, 'patch_model_menu_blur.py'), f], { encoding: 'utf8' });
    let r = run();
    assert.strictEqual(r.stdout.trim(), 'patched', 'first run patches: ' + r.stdout + r.stderr);
    r = run();
    assert.strictEqual(r.stdout.trim(), 'already', 'second run: ' + r.stdout + r.stderr);
    const cj = path.join(T, 'client.mjs');
    fs.copyFileSync(f, cj);
    const chk = spawnSync(process.execPath, ['--check', cj], { encoding: 'utf8' });
    assert.strictEqual(chk.status, 0, 'patched file parses: ' + chk.stderr);
    assert.strictEqual(fs.readFileSync(f, 'utf8').split('company-model-menu-blur-v1').length, 2, 'patched once');

    // The new onBlur, with stand-ins.
    const block = spawnSync(py, ['-c', 'import sys; sys.path.insert(0, sys.argv[1]); import patch_model_menu_blur as m; sys.stdout.write(m.NEW)', PATCHES], { encoding: 'utf8' }).stdout;
    class Node {
      constructor(name, parent) { this.name = name; this.parent = parent || null; this.connected = true; this.kids = []; if (parent) parent.kids.push(this); this.focused = 0; }
      get isConnected() { return this.connected && (!this.parent || this.parent.isConnected); }
      contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
      querySelector(sel) { const all = []; (function walk(n) { for (const k of n.kids) { all.push(k); walk(k); } })(this); return all.find((n) => (/aria-checked/.test(sel) ? n.checked : n.button) && !n.disabled) || null; }
      focus() { this.focused += 1; doc.activeElement = this; }
    }
    const doc = { activeElement: null };
    const body = new Node('body');
    const root = new Node('root', body);
    const menu = new Node('menu', body);
    const make = (closed) => new Function('rootRef', 'menuRef', 'close', 'document', 'Node', 'setTimeout', block + '\nreturn onBlur;')(
      { current: root }, { current: menu }, () => { closed.n += 1; }, doc, Node, setTimeout);
    const tick = () => new Promise((res) => setTimeout(res, 5));
    const outside = new Node('outside', body);

    // 1. focus moves to another item in the menu: nothing
    let c = { n: 0 }; let item = new Node('item', menu); item.button = true;
    make(c)({ relatedTarget: item, target: new Node('row', menu) }); await tick();
    assert.strictEqual(c.n, 0, 'focus to another item in the menu: still open');
    // 2. focus moves to something outside: close at once
    c = { n: 0 }; make(c)({ relatedTarget: outside, target: item }); assert.strictEqual(c.n, 1, 'focus to an element outside: closed');
    // 3. the pane switch removes the focused row: open, focus to the checked item
    c = { n: 0 }; const row = new Node('row', menu); row.button = true; const checked = new Node('checked', menu); checked.button = true; checked.checked = true;
    doc.activeElement = body;
    make(c)({ relatedTarget: null, target: row }); row.connected = false; await tick();
    assert.strictEqual(c.n, 0, 'the removed row: still open');
    assert.ok(checked.focused === 1 && doc.activeElement === checked, 'and the checked item has focus');
    // 4. focus went nowhere but the blurred element is still there (the window lost focus): close
    c = { n: 0 }; doc.activeElement = body; const stays = new Node('stays', menu);
    make(c)({ relatedTarget: null, target: stays }); await tick();
    assert.strictEqual(c.n, 1, 'focus gone with the element still there: closed');
    // 5. focus came back inside before the check: open
    c = { n: 0 }; doc.activeElement = body; const again = new Node('again', menu);
    make(c)({ relatedTarget: null, target: again }); doc.activeElement = item; await tick();
    assert.strictEqual(c.n, 0, 'focus back inside: still open');
    console.log('MODEL_MENU_BLUR_PROVE_OK=1');
  } catch (e) {
    console.error('MODEL_MENU_BLUR_PROVE_FAIL ' + (e && e.message ? e.message : e));
    process.exitCode = 1;
  } finally {
    fs.rmSync(T, { recursive: true, force: true });
  }
})();
