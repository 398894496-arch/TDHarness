#!/usr/bin/env node
// Proof for company-artifact-theme-v1 (server/site-patches/patch_artifact_theme.py) on the real kernel file:
// a copy of dsh-client-ui-sidebar-documentpreview/lib/client.js from KERNEL_PREFIX (an `npm install -g
// @deepseek-ai/dsh --prefix` tree) gets the patch; it applies once, still parses, and the frame code passes the
// desk's choice in and rebuilds on change. The rewrite itself, run from the patched file: a page's
// (prefers-color-scheme: dark / light) in <style>, media attributes and style sheets follows the desk's light /
// dark choice; prose that mentions it is left alone; color-scheme: light dark becomes the desk's one; scripts
// asking matchMedia get the desk's answer; without a choice nothing changes. Ends with ARTIFACT_THEME_PROVE_OK=1.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const prefix = process.env.KERNEL_PREFIX;
if (!prefix) { console.log('ARTIFACT_THEME_PROVE_FAIL set KERNEL_PREFIX to an npm prefix holding @deepseek-ai/dsh'); process.exit(1); }
const rel = path.join('@deepseek-ai', 'dsh-client-ui-sidebar-documentpreview', 'lib', 'client.js');
const src = [path.join(prefix, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', rel), path.join(prefix, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', rel)].find((f) => fs.existsSync(f));
if (!src) { console.log('ARTIFACT_THEME_PROVE_FAIL no ' + rel + ' under ' + prefix); process.exit(1); }

const box = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-arttheme-'));
const file = path.join(box, 'client.js');
fs.copyFileSync(src, file);
const patcher = path.join(__dirname, '..', 'server', 'site-patches', 'patch_artifact_theme.py');
const run = () => execFileSync('python3', ['-c', [
  'import importlib.util, sys',
  's = importlib.util.spec_from_file_location("p", sys.argv[1]); m = importlib.util.module_from_spec(s); s.loader.exec_module(m)',
  't = open(sys.argv[2], encoding="utf-8").read(); t2, how = m.patch(t)',
  'open(sys.argv[2], "w", encoding="utf-8").write(t2); print(how)',
].join('\n'), patcher, file], { encoding: 'utf8' }).trim();
assert.strictEqual(run(), 'patched', 'the patch applies to the pinned kernel');
assert.strictEqual(run(), 'already', 'a second run changes nothing');
execFileSync(process.execPath, ['--check', file]);
const text = fs.readFileSync(file, 'utf8');
assert.ok(text.includes('const html = createHtmlDocument(bundle, companyDark);'), 'the interactive frame is built for the desk\'s choice');
assert.ok(/signal,\n\t\t\t\tcompanyDark\n\t\t\t\]\);/.test(text), 'and rebuilt when it changes');
assert.ok(text.includes('return companyThemeHtml(createBasicHtmlDocument(data), companyDark, false);') && text.includes('}, [data, companyDark]);'), 'the static frame too');
assert.ok(text.includes('companyThemeCss(decodeText(asset.data), companyDark)'), 'style sheets beside the page too');

// The helpers, run as they are in the patched file.
const start = text.indexOf('// company-artifact-theme-v1 helpers start');
const end = text.indexOf('// company-artifact-theme-v1 helpers end');
assert.ok(start > 0 && end > start, 'helper block present');
const react = { useSyncExternalStore: () => false };
const h = new Function('react', text.slice(start, end) + '\nreturn { companyThemeCss, companyThemeHtml, companyThemeShim };')(react);

const page = '<!doctype html><html><head><meta charset="utf-8"><style>:root{--bg:#fff;--fg:#111;color-scheme: light dark}@media (prefers-color-scheme: dark){:root{--bg:#111;--fg:#eee}}@media screen and (prefers-color-scheme:light){p{x:1}}</style>'
  + '<link rel="stylesheet" media="(prefers-color-scheme: dark)" href="d.css"></head><body><p>写法是 (prefers-color-scheme: dark)</p></body></html>';
const light = h.companyThemeHtml(page, false, false);
const dark = h.companyThemeHtml(page, true, false);
assert.ok(light.includes('@media (max-width:0px){:root{--bg:#111') && light.includes('@media screen and (min-width:0px){p'), 'light desk: the dark block off, the light block on: ' + light);
assert.ok(dark.includes('@media (min-width:0px){:root{--bg:#111') && dark.includes('@media screen and (max-width:0px){p'), 'dark desk: the dark block on, the light block off: ' + dark);
assert.ok(light.includes('media="(max-width:0px)"') && dark.includes('media="(min-width:0px)"'), 'media attributes follow too');
assert.ok(light.includes('color-scheme: light}') && dark.includes('color-scheme: dark}'), 'color-scheme: light dark becomes the desk\'s one');
assert.ok(light.includes('<p>写法是 (prefers-color-scheme: dark)</p>') && dark.includes('<p>写法是 (prefers-color-scheme: dark)</p>'), 'prose is left alone');
assert.ok(!light.includes('<script>'), 'the static frame gets no script');
assert.strictEqual(h.companyThemeHtml(page, undefined, true), page, 'without the desk\'s choice nothing changes');
assert.strictEqual(h.companyThemeCss('@media (prefers-color-scheme: dark){a{b:c}}', undefined), '@media (prefers-color-scheme: dark){a{b:c}}');
assert.strictEqual(h.companyThemeCss('@media (PREFERS-COLOR-SCHEME : Dark){a{b:c}}', true), '@media (min-width:0px){a{b:c}}', 'any spelling');

// Interactive frame: the matchMedia answer comes first in <head>, before the page's own scripts; a page without
// <head> gets it after <html> or <!doctype> (never before the doctype: that would put the page in quirks mode).
const withShim = h.companyThemeHtml(page, false, true);
assert.ok(withShim.startsWith('<!doctype html><html><head><script>(()=>{const dark=false;'), 'the answer comes first in <head>: ' + withShim.slice(0, 80));
assert.ok(h.companyThemeHtml('<!doctype html><body>x</body>', true, true).startsWith('<!doctype html><script>'), 'after the doctype');
assert.ok(h.companyThemeHtml('<header>x</header>', true, true).startsWith('<script>'), '<header> is not <head>');
for (const deskDark of [false, true]) {
  const shim = h.companyThemeShim(deskDark).replace(/^<script>/, '').replace(/<\/script>$/, '');
  const asked = [];
  const window = { matchMedia: (q) => { asked.push(q); return { media: q, matches: q === '(min-width:0px)' }; } };
  new Function('window', shim)(window);
  assert.strictEqual(window.matchMedia('(prefers-color-scheme: dark)').matches, deskDark, 'matchMedia dark follows the desk (' + deskDark + ')');
  assert.strictEqual(window.matchMedia('(prefers-color-scheme: light)').matches, !deskDark, 'matchMedia light follows the desk (' + deskDark + ')');
  assert.strictEqual(window.matchMedia('(min-width: 600px)').media, '(min-width: 600px)', 'other queries pass through');
}
fs.rmSync(box, { recursive: true, force: true });
console.log('ARTIFACT_THEME_PROVE_OK=1');
