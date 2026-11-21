#!/usr/bin/env node
// Proof for the chat page's input box and search box with a Chinese input method (company-chat-ime-v1), in a real DOM (jsdom) with
// the repository's React and React DOM and Tinode's own SDK (TINODE_SDK = a tinode-sdk@0.25.3 folder, JSDOM = a
// jsdom@25.0.1 folder; CI installs both).
// While pinyin is being composed the browser changes the box on every key. React puts a controlled box back to the
// text it last drew as soon as the event is over, so the box must be drawn with the new text within the same event:
// a box that waits for the next frame is put back mid-composition, the input method breaks, and the letters stay in
// the text ("ddada zda zi打字", twice; 2026-11-21).
// Prints CHAT_COMPOSER_PROVE_OK=1.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SDK = process.env.TINODE_SDK || '';
const JSDOM_DIR = process.env.JSDOM || '';
if (!SDK || !fs.existsSync(path.join(SDK, 'umd', 'tinode.prod.js')) || !JSDOM_DIR || !fs.existsSync(path.join(JSDOM_DIR, 'package.json'))) {
  console.error('set TINODE_SDK to a tinode-sdk@0.25.3 folder and JSDOM to a jsdom@25.0.1 folder (npm install --no-save --prefix <dir> tinode-sdk@0.25.3 jsdom@25.0.1)');
  process.exit(2);
}
const { JSDOM } = require(JSDOM_DIR);
const sdk = require(path.join(SDK, 'umd', 'tinode.prod.js'));
sdk.Tinode.setDatabaseProvider({ deleteDatabase() { const r = {}; setTimeout(() => r.onsuccess && r.onsuccess({}), 0); return r; } });

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
  url: 'https://tdh.example/chat/tdh/?k=pagekey&theme=light', runScripts: 'outside-only', pretendToBeVisual: true,
});
const w = dom.window;
w.tinode = sdk;
w.TDH_CHAT_KEY = 'AQ' + 'x'.repeat(30);
w.eval(fs.readFileSync(path.join(ROOT, 'server', 'chat', 'vendor', 'react.production.min.js'), 'utf8'));
w.eval(fs.readFileSync(path.join(ROOT, 'server', 'chat', 'vendor', 'react-dom.production.min.js'), 'utf8'));
w.eval(fs.readFileSync(path.join(ROOT, 'server', 'chat', 'tdh-web', 'app.js'), 'utf8'));
const C = w.__tdhChat;
assert.ok(C && C.fn && C.fn.Composer, 'the page exposes its input box');
assert.strictEqual(C.S.status, 'noauth', 'no stored token: the page stays offline');

const keys = [];
const topic = (name) => ({
  name, isGroupType: () => name.startsWith('grp'), isP2PType: () => !name.startsWith('grp'), isSubscribed: () => true,
  noteKeyPress: () => keys.push(name), userDesc: () => null,
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const setValue = Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set;

async function compose(name) {
  const box = w.document.createElement('div');
  w.document.body.appendChild(box);
  const root = w.ReactDOM.createRoot(box);
  root.render(w.React.createElement(C.fn.Composer, { topic: topic(name) }));
  await wait(50);
  const ta = box.querySelector('textarea');
  assert.ok(ta, 'the input box is drawn');
  ta.focus();
  // 拼音 "da zi" composed into 打字, the way a browser reports it: composition, then an input event for each key.
  ta.dispatchEvent(new w.CompositionEvent('compositionstart', { bubbles: true, data: '' }));
  for (const step of ['d', 'da', 'da z', 'da zi']) {
    setValue.call(ta, step);
    ta.dispatchEvent(new w.CompositionEvent('compositionupdate', { bubbles: true, data: step }));
    ta.dispatchEvent(new w.InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText', data: step }));
    assert.strictEqual(ta.value, step, 'while composing, the box keeps what the input method put there (' + name + ', "' + step + '")');
  }
  setValue.call(ta, '打字');
  ta.dispatchEvent(new w.InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText', data: '打字' }));
  ta.dispatchEvent(new w.CompositionEvent('compositionend', { bubbles: true, data: '打字' }));
  assert.strictEqual(ta.value, '打字');
  await wait(50);
  assert.strictEqual(ta.value, '打字', 'after the next frame, still only the composed words');
  assert.strictEqual(C.S.drafts[name], '打字', 'the draft has the composed words, no letters');
  // Plain typing after it, two keys within one frame: neither is lost.
  setValue.call(ta, '打字a');
  ta.dispatchEvent(new w.InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'a' }));
  setValue.call(ta, '打字ab');
  ta.dispatchEvent(new w.InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'b' }));
  await wait(50);
  assert.strictEqual(ta.value, '打字ab', 'two quick keys both stay');
  assert.strictEqual(C.S.drafts[name], '打字ab');
  root.unmount();
}

// The search box above the list: the same, while a name is composed.
async function search() {
  const box = w.document.createElement('div');
  w.document.body.appendChild(box);
  const root = w.ReactDOM.createRoot(box);
  root.render(w.React.createElement(C.fn.Search));
  await wait(50);
  const input = box.querySelector('input');
  const set = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set;
  input.focus();
  input.dispatchEvent(new w.CompositionEvent('compositionstart', { bubbles: true, data: '' }));
  for (const step of ['z', 'zh', 'zhang']) {
    set.call(input, step);
    input.dispatchEvent(new w.InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText', data: step }));
    assert.strictEqual(input.value, step, 'the search box keeps what the input method put there ("' + step + '")');
  }
  set.call(input, '张');
  input.dispatchEvent(new w.InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText', data: '张' }));
  input.dispatchEvent(new w.CompositionEvent('compositionend', { bubbles: true, data: '张' }));
  await wait(50);
  assert.strictEqual(input.value, '张');
  assert.strictEqual(C.S.search, '张', 'the list is searched for the composed name');
  root.unmount();
}

(async () => {
  await compose('usrPeer000001');
  await compose('grpTeam00001');
  await search();
  assert.ok(keys.length >= 1, 'the other side is told someone is typing');
  console.log('CHAT_COMPOSER_PROVE_OK=1');
  w.close();
  process.exit(0);
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
