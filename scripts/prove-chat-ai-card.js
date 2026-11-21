#!/usr/bin/env node
// Proof for TDH 助手's answers on the chat page (company-chat-assist-v1), in a real DOM (jsdom) with the repository's
// React and Tinode's own SDK (TINODE_SDK, JSDOM: as for prove-chat-composer.js).
// - An answer (head tdh_ai) is drawn as TDH 助手, not as the person who posted it, with its words and no prefix.
// - The person named to confirm has 确认无误 and 有误; a click sends the confirmation (head tdh_ai_ok, of the answer).
// - Anyone else sees 等 <name> 确认; once confirmed, everyone sees ✓ <name> 确认无误 and the confirmation is a note.
// - A confirmation from anyone but the person named does not count.
// - A proposed task card (company-chat-tasks-v1, kind task, deciders): 记下 and 不用 for the person who said it and the
//   owner, 等 … 决定 for anyone else; the first answer of one of them counts; the card made is a TDH 助手 · 任务卡 note.
// - What TDH cannot answer (cannot) is a card with nothing to confirm.
// - The chat list tells everyone the chat is read.
// Prints CHAT_AI_CARD_PROVE_OK=1.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SDK = process.env.TINODE_SDK || '';
const JSDOM_DIR = process.env.JSDOM || '';
if (!SDK || !fs.existsSync(path.join(SDK, 'umd', 'tinode.prod.js')) || !JSDOM_DIR || !fs.existsSync(path.join(JSDOM_DIR, 'package.json'))) {
  console.error('set TINODE_SDK to a tinode-sdk@0.25.3 folder and JSDOM to a jsdom@25.0.1 folder');
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
const src = fs.readFileSync(path.join(ROOT, 'server', 'chat', 'tdh-web', 'app.js'), 'utf8');
w.eval(src);
const C = w.__tdhChat;
const F = C.fn;
assert.ok(F.Messages && F.aiOf && F.aiConfirmation, 'the page exposes its message list');

const BOSS = 'usrBoss000001';
const FIN = 'usrFin0000001';
const NAMES = { [BOSS]: '田总', [FIN]: '郭迎' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = (min) => new Date(Date.UTC(2026, 10, 21, 1, min)).toISOString();
const question = { seq: 1, from: BOSS, ts: ts(0), content: '今天银行余额是多少？' };
const answer = { seq: 2, from: FIN, ts: ts(0), head: { tdh_ai: { v: 1, of: 1, kind: 'cash', confirm: FIN }, reply: '1' },
  content: '【TDH 助手】壹通达余额 人民币 1,000.00（账本记到 11-20）' };

function topic(list, sent) {
  return {
    name: FIN === C.S.meId ? BOSS : FIN, isGroupType: () => false, isP2PType: () => true, isSubscribed: () => true,
    _messages: { forEach: (f) => list.forEach(f) }, minMsgSeq: () => 1, msgReadCount: () => 1, latestMsgVersion: () => null,
    userDesc: (uid) => (NAMES[uid] ? { public: { fn: NAMES[uid] } } : null),
    createMessage: (content) => ({ content, head: null }), publishDraft: (pub) => { sent.push(pub); return Promise.resolve(); },
  };
}

async function render(me, list) {
  C.S.meId = me;
  C.S.myName = NAMES[me];
  const sent = [];
  const box = w.document.createElement('div');
  w.document.body.appendChild(box);
  const root = w.ReactDOM.createRoot(box);
  root.render(w.React.createElement(F.Messages, { topic: topic(list, sent) }));
  await wait(60);
  return { box, root, sent };
}

(async () => {
  // The person asked: the card, and the two buttons.
  let v = await render(FIN, [question, answer]);
  const card = v.box.querySelector('.m.ai');
  assert.ok(card, 'the answer is a TDH 助手 card');
  assert.ok(!card.classList.contains('me'), 'drawn as TDH 助手, not as the person who posted it');
  assert.strictEqual(card.querySelector('.ai-av').textContent, 'TDH');
  assert.ok(card.querySelector('.who').textContent.startsWith('TDH 助手'));
  assert.strictEqual(card.querySelector('.b').textContent, '壹通达余额 人民币 1,000.00（账本记到 11-20）', 'its words, no prefix');
  const ok = card.querySelector('button.ai-ok');
  assert.ok(ok && card.querySelector('button.ai-bad'), 'the person asked has 确认无误 and 有误');
  ok.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(v.sent.length, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(v.sent[0].head)), { tdh_ai_ok: { of: 2, ok: true }, reply: '2' }, 'the confirmation names the answer');
  assert.strictEqual(v.sent[0].content, '确认无误');
  v.root.unmount();

  // The asker: waiting for 郭迎; a "confirmation" from the asker himself does not count.
  const forged = { seq: 3, from: BOSS, ts: ts(1), head: { tdh_ai_ok: { of: 2, ok: true } }, content: '确认无误' };
  v = await render(BOSS, [question, answer, forged]);
  assert.ok(!v.box.querySelector('.m.ai button'), 'no buttons for anyone else');
  assert.strictEqual(v.box.querySelector('.m.ai .ai-foot').textContent, '等 郭迎 确认', 'waiting for the person asked');
  assert.ok(!Array.from(v.box.querySelectorAll('.note')).some((n) => /确认了/.test(n.textContent)), 'a confirmation that does not count leaves no note');
  v.root.unmount();

  // Confirmed.
  const conf = { seq: 3, from: FIN, ts: ts(1), head: { tdh_ai_ok: { of: 2, ok: true }, reply: '2' }, content: '确认无误' };
  v = await render(BOSS, [question, answer, conf]);
  assert.strictEqual(v.box.querySelector('.m.ai .ai-foot.ok').textContent, '✓ 郭迎 确认无误');
  assert.ok(Array.from(v.box.querySelectorAll('.note')).some((n) => n.textContent === '郭迎 确认了 TDH 助手的数据'), 'the confirmation is a note');
  v.root.unmount();
  const wrong = { seq: 3, from: FIN, ts: ts(1), head: { tdh_ai_ok: { of: 2, ok: false } }, content: '这条数据有误，我来核对' };
  v = await render(BOSS, [question, answer, wrong]);
  assert.strictEqual(v.box.querySelector('.m.ai .ai-foot.bad').textContent, '✗ 郭迎：有误，正在核对');
  v.root.unmount();

  // A proposed task card.
  const ask = { seq: 4, from: BOSS, ts: ts(2), content: '@郭迎 周五前把11月发票开了' };
  const prop = { seq: 5, from: FIN, ts: ts(2), head: { tdh_ai: { v: 1, of: 4, kind: 'task', deciders: [BOSS, FIN] }, reply: '4' },
    content: '【TDH 助手】要记成任务卡吗？\n负责人：郭迎\n事情：开 11 月发票\n截止：11-27 周五' };
  v = await render(BOSS, [ask, prop]);
  let pc = v.box.querySelectorAll('.m.ai');
  assert.strictEqual(pc.length, 1);
  assert.strictEqual(pc[0].querySelector('.who').textContent, 'TDH 助手 · 任务卡');
  assert.ok(pc[0].querySelector('.b').textContent.startsWith('要记成任务卡吗？'));
  assert.deepStrictEqual(Array.from(pc[0].querySelectorAll('button')).map((b) => b.textContent), ['记下', '不用'], 'the person who said it decides');
  pc[0].querySelector('button.ai-ok').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(v.sent[0].head)), { tdh_ai_ok: { of: 5, ok: true }, reply: '5' });
  assert.strictEqual(v.sent[0].content, '记下');
  v.root.unmount();
  v = await render('usrOther00001', [ask, prop]);
  assert.strictEqual(v.box.querySelector('.m.ai .ai-foot').textContent, '等 田总 或 郭迎 决定', 'anyone else waits');
  v.root.unmount();
  const no = { seq: 6, from: FIN, ts: ts(3), head: { tdh_ai_ok: { of: 5, ok: false } }, content: '不用记' };
  const yes = { seq: 7, from: BOSS, ts: ts(3), head: { tdh_ai_ok: { of: 5, ok: true } }, content: '记下' };
  const made = { seq: 8, from: FIN, ts: ts(3), head: { tdh_ai: { v: 1, of: 5, kind: 'task-made' } },
    content: '【TDH 助手】已记成任务卡「开 11 月发票」：负责人 郭迎，截止 11-27 周五。到期前我会在聊天里提醒。' };
  v = await render(BOSS, [ask, prop, no, yes, made]);
  pc = v.box.querySelectorAll('.m.ai');
  assert.strictEqual(pc[0].querySelector('.ai-foot').textContent, '郭迎：不用记', 'the first answer counts');
  const notes = Array.from(v.box.querySelectorAll('.note')).map((n) => n.textContent);
  assert.ok(notes.includes('郭迎 说不用记') && !notes.some((n) => n.startsWith('田总')), 'only the answer that counts leaves a note: ' + notes);
  assert.strictEqual(pc[1].querySelector('.who').textContent, 'TDH 助手 · 任务卡');
  assert.ok(!pc[1].querySelector('.ai-foot') && !pc[1].querySelector('button'), 'the card made: a note, nothing to click');
  v.root.unmount();

  // What TDH cannot answer: a card with nothing to confirm.
  const cant = { seq: 9, from: FIN, ts: ts(4), head: { tdh_ai: { v: 1, of: 1, kind: 'cash', cannot: true }, reply: '1' },
    content: '【TDH 助手】TDH 查不到今天的待付款事项，缺付款计划，请财务把付款清单拖进 TDH 对话。' };
  v = await render(FIN, [question, cant]);
  assert.strictEqual(v.box.querySelector('.m.ai .b').textContent, 'TDH 查不到今天的待付款事项，缺付款计划，请财务把付款清单拖进 TDH 对话。');
  assert.ok(!v.box.querySelector('.m.ai button') && !v.box.querySelector('.m.ai .ai-foot'), 'nothing to confirm');
  v.root.unmount();

  // An ordinary message stays ordinary.
  assert.strictEqual(F.aiOf(question), null);
  assert.ok(/assist-note/.test(src) && /TDH 助手会读公司聊天/.test(src), 'the chat list says the chat is read');
  assert.ok(src.indexOf('还没有聊天') < src.indexOf('TDH 助手会读公司聊天'), 'under the list, not on top');
  console.log('CHAT_AI_CARD_PROVE_OK=1');
  w.close();
  process.exit(0);
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
