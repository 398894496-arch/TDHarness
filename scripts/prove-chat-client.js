#!/usr/bin/env node
// Proof for TDH's chat page logic (server/chat/tdh-web/app.js, company-chat-client-v1, company-chat-at-v1),
// on Tinode's own SDK (TINODE_SDK = a folder with tinode-sdk@0.25.3, the version the server runs; CI installs it)
// and the repository's React. No browser: the page is loaded with a stand-in DOM and no stored token, so it stays
// offline ("noauth"), and its logic is read from window.__tdhChat.fn (company-chat-client-test-v1).
// - @: the picked names become MN entities with the person's id at the right offsets (grapheme-safe), the
//   k-th "@name" takes the k-th pick of that name, nothing picked left in the text: none; sendText sends words
//   with no @ as a plain string and a quote with an @ keeps both.
// - [有人@我]: any unread message from someone else that @ me, not one already read, not my own, not a recall.
// - The list's words for pictures, files, quotes; a lone picture has no bubble; an @ of me is "mention me".
// - Links: only http(s), mailto, tel; the page builds no HTML from strings (no innerHTML).
// Prints CHAT_CLIENT_PROVE_OK=1.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SDK = process.env.TINODE_SDK || '';
if (!SDK || !fs.existsSync(path.join(SDK, 'umd', 'tinode.prod.js'))) {
  console.error('set TINODE_SDK to a tinode-sdk@0.25.3 folder (npm install --no-save --prefix <dir> tinode-sdk@0.25.3)');
  process.exit(2);
}
const sdk = require(path.join(SDK, 'umd', 'tinode.prod.js'));
assert.strictEqual(JSON.parse(fs.readFileSync(path.join(SDK, 'package.json'), 'utf8')).version, '0.25.3', 'the SDK the server runs');
const { Drafty } = sdk;
// The page keeps nothing (persist: false), yet the SDK clears its IndexedDB at start; Node has none.
sdk.Tinode.setDatabaseProvider({ deleteDatabase() { const r = {}; setTimeout(() => r.onsuccess && r.onsuccess({}), 0); return r; } });

const store = new Map();
const ctx = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, URLSearchParams, Promise, Date, Math, JSON,
  location: { search: '?k=pagekey&theme=light', hash: '', host: '127.0.0.1:17811', pathname: '/chat/' },
  history: { replaceState() {} },
  navigator: { platform: 'MacIntel' },
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
  document: { documentElement: { dataset: {} }, getElementById: () => ({}), addEventListener() {}, createElement: () => ({ style: {} }) },
  innerWidth: 1200, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: (f) => setTimeout(f, 0),
  ReactDOM: { createRoot: () => ({ render() {} }) },
  TDH_CHAT_KEY: 'AQ' + 'x'.repeat(30),
};
ctx.window = ctx;
ctx.self = ctx;
ctx.parent = {};
ctx.tinode = sdk;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'server', 'chat', 'vendor', 'react.production.min.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'server', 'chat', 'tdh-web', 'app.js'), 'utf8'), ctx, { filename: 'app.js' });

const C = ctx.__tdhChat;
assert.ok(C && C.fn, 'the page exposes its logic');
assert.strictEqual(C.S.status, 'noauth', 'no stored token: the page stays offline, nothing connects');
assert.strictEqual(ctx.document.documentElement.dataset.theme, 'light', '?theme= sets the theme');
const F = C.fn;
const ME = 'usrMe0000000';
C.S.meId = ME;

// -- @ ---------------------------------------------------------------------------------------------------------
const picks = [{ uid: 'usrZhang00001', label: '@张三' }, { uid: 'usrLi0000001', label: '@李四' }];
let d = F.atDraft('请 @张三 和 @李四 看一下 😀 @张三', picks);
assert.strictEqual(d.txt, '请 @张三 和 @李四 看一下 😀 @张三');
const mn = d.ent.map((e, i) => ({ val: e.data.val, at: d.fmt.find((f) => (f.key | 0) === i && f.tp === undefined).at }));
assert.deepStrictEqual(mn, [{ val: 'usrZhang00001', at: 2 }, { val: 'usrLi0000001', at: 8 }, { val: 'usrZhang00001', at: 18 }], 'MN entities at grapheme offsets (the emoji is one)');
assert.strictEqual(F.atDraft('没有提到谁', picks), null, 'no picked name left: no Drafty');
d = F.atDraft('@张三丰 和 @张三', [{ uid: 'a', label: '@张三丰' }, { uid: 'b', label: '@张三' }]);
assert.deepStrictEqual(d.ent.map((e) => e.data.val), ['a', 'b'], 'the longer name first');
const twins = F.atDraft('@王伟 @王伟', [{ uid: 'w1', label: '@王伟' }, { uid: 'w2', label: '@王伟' }]);
assert.deepStrictEqual(twins.ent.map((e) => e.data.val), ['w1', 'w2'], 'two people of one name: in the order picked');

// sendText through a stand-in topic
const sent = [];
const fakeTopic = (name) => ({
  name, isGroupType: () => name.startsWith('grp'), isP2PType: () => !name.startsWith('grp'),
  createMessage: (content) => ({ content, head: null }), publishDraft: (pub) => { sent.push(pub); return Promise.resolve(); },
});
C.client.getTopic = (name) => fakeTopic(name);
C.S.topic = 'grpTest';
C.S.ats.grpTest = [picks[0]];
C.act.sendText('请 @张三 确认');
assert.ok(typeof sent[0].content === 'object' && sent[0].content.ent[0].data.val === 'usrZhang00001', 'an @ goes as Drafty with the mention');
assert.ok(!C.S.ats.grpTest, 'the picks are used up');
C.act.sendText('普通的一句话');
assert.strictEqual(sent[1].content, '普通的一句话', 'words with no @ go as a plain string');
C.S.reply = { seq: 7, content: Drafty.quote('李四', 'usrLi0000001', Drafty.init('原话')), label: '李四：原话' };
C.S.ats.grpTest = [picks[0]];
C.act.sendText('@张三 看这条');
const q = sent[2];
assert.strictEqual(q.head.reply, '7', 'a quote answers its message');
assert.ok(q.content.fmt.some((f) => f.tp === 'QQ') && q.content.ent.some((e) => e.tp === 'MN' && e.data.val === 'usrZhang00001'), 'quote and @ both kept');
assert.strictEqual(C.S.reply, null, 'the quote is used up');

// -- [有人@我] ----------------------------------------------------------------------------------------------------
const atMe = Drafty.append(Drafty.mention('@我', ME), Drafty.init(' 看下'));
const msgs = (list) => ({ forEach: (f) => list.forEach(f) });
const topicWith = (list, read, seq) => ({ name: 'grpX', isGroupType: () => true, read, seq, _messages: msgs(list), latestMsgVersion: () => null });
assert.ok(F.mentionsMe(atMe) && !F.mentionsMe('@我 看下') && !F.mentionsMe(null), 'a mention is an MN entity, not the letters');
let t = topicWith([{ seq: 4, from: 'usrA', content: atMe }, { seq: 5, from: 'usrB', content: '后面又一句' }], 3, 5);
assert.ok(F.mentionedUnread(t), 'an unread @ that is not the last message still counts');
t = topicWith([{ seq: 4, from: 'usrA', content: atMe }, { seq: 5, from: 'usrB', content: '后面又一句' }], 4, 5);
assert.ok(!F.mentionedUnread(t), 'read already: no mark');
t = topicWith([{ seq: 6, from: ME, content: atMe }], 3, 6);
assert.ok(!F.mentionedUnread(t), 'my own @ of myself is no mark');
t = topicWith([{ low: 6, hi: 7, _deleted: true }, { seq: 8, from: 'usrA', content: '无关' }], 3, 8);
assert.ok(!F.mentionedUnread(t), 'a recall is no mark');
assert.strictEqual(F.allMessages(topicWith([{ seq: 1, content: 'a' }, { seq: 2, head: { replace: ':1' }, content: 'b' }], 0, 2)).length, 1, 'edits fold into their message');

// -- words in the list, bubbles --------------------------------------------------------------------------------
const pic = Drafty.insertImage(null, 0, { mime: 'image/png', val: 'iVBORw0KGgo=', width: 10, height: 10, name: 'a.png', size: 8 });
const file = Drafty.attachFile(null, { mime: 'application/pdf', data: 'JVBERi0=', filename: '报价单.pdf', size: 5 });
assert.strictEqual(F.plain('就一句'), '就一句');
assert.strictEqual(F.plain(pic), '[图片]');
assert.strictEqual(F.plain(file), '[文件] 报价单.pdf');
assert.strictEqual(F.plain(Drafty.append(Drafty.quote('李四', 'u', Drafty.init('原话')), Drafty.init('回复'))), '回复', 'a quote is left out of the list');
const one = { seq: 1, from: 'usrA', content: pic };
assert.ok(F.renderContent(topicWith([one], 0, 1), one).bare, 'a lone picture has no bubble');
const two = { seq: 2, from: 'usrA', content: Drafty.append(Drafty.init('看图 '), pic) };
assert.ok(!F.renderContent(topicWith([two], 0, 2), two).bare, 'words and a picture: a bubble');
const walk = (n, f) => { if (Array.isArray(n)) n.forEach((x) => walk(x, f)); else if (n && typeof n === 'object') { f(n); if (n.props) walk(n.props.children, f); } };
const classes = [];
const am = { seq: 3, from: 'usrA', content: atMe };
walk(F.renderContent(topicWith([am], 0, 3), am).body, (n) => n.props && n.props.className && classes.push(n.props.className));
assert.ok(classes.includes('mention me'), 'an @ of me is marked: ' + classes.join(','));

// -- safety ------------------------------------------------------------------------------------------------------
assert.strictEqual(F.safeUrl('javascript:alert(1)'), '');
assert.strictEqual(F.safeUrl(' https://tonda.net.cn/x '), 'https://tonda.net.cn/x');
assert.strictEqual(F.safeUrl('data:text/html,x'), '');
const src = fs.readFileSync(path.join(ROOT, 'server', 'chat', 'tdh-web', 'app.js'), 'utf8');
assert.ok(!/innerHTML|dangerouslySetInnerHTML|insertAdjacentHTML|document\.write/.test(src), 'no HTML from strings');
assert.ok(/e\.source === window\.parent/.test(src), 'theme messages only from the desk page around it');

// -- company-chat-alert-v1: a message from another chat while one is open --------------------------------------
// (2026-11-23: an employee in a chat with 田总 got nothing when 尚晓晨 wrote; the list is out of sight then.)
const chatOf = (name, fn, seq, read, opts) => Object.assign({
  name, seq, read, public: { fn }, acs: { isMuted: () => false },
  isGroupType: () => name.startsWith('grp'), isSubscribed: () => false, latestMessage: () => null, userDesc: () => null,
}, opts || {});
const plainOf = (v) => JSON.parse(JSON.stringify(v)); // the page's objects come from its own context
const tian = chatOf('usrTian000001', '田总', 9, 9);
const shang = chatOf('usrShang00001', '尚晓晨', 3, 2);
const quote = chatOf('grpQuote00001', '报价群', 12, 10);
const quiet = chatOf('grpQuiet00001', '闲聊群', 40, 0, { acs: { isMuted: () => true } });
const all = [tian, shang, quote, quiet];
C.client.getMeTopic = () => ({ contacts: (f) => all.forEach(f) });
C.client.getTopic = (name) => all.find((c) => c.name === name) || null;
C.S.topic = tian.name;
C.S.alert = null;
assert.strictEqual(F.otherUnread(), 3, '返回 counts the other chats: 1 from 尚晓晨 + 2 in 报价群, not the muted group');
assert.ok(F.alertOther(shang), 'a message from another chat: the bar');
assert.deepStrictEqual(JSON.parse(JSON.stringify(C.S.alert)), { topic: shang.name, seq: 3 });
assert.deepStrictEqual(plainOf(F.alertText(C.S.alert)), { title: '尚晓晨', line: '发来新消息' }, 'before the words are fetched: who');
shang.latestMessage = () => ({ seq: 3, from: shang.name, content: '下午的   报价\n发你了' });
assert.deepStrictEqual(plainOf(F.alertText(C.S.alert)), { title: '尚晓晨', line: '下午的 报价 发你了' }, 'then the words, on one line');
quote.latestMessage = () => ({ seq: 12, from: 'usrLi0000001', content: pic });
quote.userDesc = (uid) => (uid === 'usrLi0000001' ? { public: { fn: '李四' } } : null);
assert.ok(F.alertOther(quote));
assert.deepStrictEqual(plainOf(F.alertText(C.S.alert)), { title: '「报价群」', line: '李四：[图片]' }, 'a group: the group, who, what');
C.S.alert = null;
assert.ok(!F.alertOther(tian), 'the open chat: no bar (its messages are on screen)');
assert.ok(!F.alertOther(quiet), '消息免打扰: no bar');
assert.ok(!F.alertOther(chatOf('usrMine000001', '王五', 5, 5)), 'nothing unread (my own message from elsewhere): no bar');
assert.strictEqual(C.S.alert, null);
assert.strictEqual(F.ding(), false, 'no sound where there is no AudioContext, and no error');
let played = 0;
ctx.AudioContext = function () {
  const node = () => ({ connect() {}, start() { played += 1; }, stop() {}, type: '', frequency: { setValueAtTime() {} }, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } });
  return { state: 'running', currentTime: 0, destination: {}, createOscillator: node, createGain: node };
};
assert.ok(F.alertOther(shang) && played === 1, 'the bar comes with the sound');
C.open(shang.name);
assert.strictEqual(C.S.alert, null, 'opening that chat puts the bar away');
assert.ok(/me\.onContactUpdate[\s\S]{0,200}alertOther\(cont\)/.test(src), 'a new message in the contact list raises it');
assert.ok(/h\(Menu\), h\(Dialogs\), h\(Viewer\), h\(AlertBar\)/.test(src) && /h\(BackButton\)/.test(src), 'the bar and 返回 are drawn');
const css = fs.readFileSync(path.join(ROOT, 'server', 'chat', 'tdh-web', 'app.css'), 'utf8');
assert.ok(/\.alert \{[^}]*animation: tc-alert/.test(css) && /\.head \.back \{ position: relative; \}/.test(css), 'the bar pulses; the count sits on 返回');

console.log('CHAT_CLIENT_PROVE_OK=1');
