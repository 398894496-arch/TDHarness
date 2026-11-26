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
  atob, btoa,
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

// -- company-chat-voice-v1: voice messages --------------------------------------------------------------------
(async () => {
  // 48 kHz in, 16 kHz 16-bit mono WAV out.
  const half = new (vm.runInContext('Float32Array', ctx))(4800).fill(0.5);
  const wav = F.encodeWav([half], 48000, 16000);
  const v = new DataView(wav.buffer);
  const str = (a, n) => String.fromCharCode(...wav.slice(a, a + n));
  assert.strictEqual(str(0, 4) + str(8, 4) + str(12, 4) + str(36, 4), 'RIFFWAVEfmt data', 'a WAV file');
  assert.deepStrictEqual([v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true), v.getUint32(40, true)],
    [1, 1, 16000, 16, 3200], 'PCM, mono, 16 kHz, 16 bit, 1600 samples (0.1 s)');
  assert.strictEqual(wav.length, 44 + 3200);
  assert.ok(Math.abs(v.getInt16(44, true) - 16383) <= 1, 'the samples kept (0.5 -> 16383)');
  // The waveform Tinode carries.
  const pk = F.voicePeaks([0.1, 0.2, 0.4]);
  assert.deepStrictEqual(Array.from(F.voiceBars(pk)), [64, 128, 255], 'bars scaled to the loudest, 0..255');
  assert.ok(F.voiceBars(F.voicePeaks(new Array(500).fill(0.3))).length === 64, 'at most 64 bars');
  assert.deepStrictEqual(Array.from(F.voiceBars('%%%')), [], 'a bad waveform: none, no error');
  // The words from this desk's relay, asked again while the server is on it.
  const asked = [];
  let answer = { ok: true, pending: true };
  ctx.fetch = (u) => { asked.push(u); return Promise.resolve({ json: () => Promise.resolve(answer) }); };
  const ref = '/v0/file/s/VoiceOne111.wav';
  F.voiceText(ref);
  assert.ok(asked[0] === '/tdh/voice?k=pagekey&ref=' + encodeURIComponent(ref), 'asked with the page key: ' + asked[0]);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(C.S.voice[ref].wait && C.S.voice[ref].text == null, 'not yet: waits');
  assert.strictEqual(F.voiceText(ref), C.S.voice[ref]);
  assert.strictEqual(asked.length, 1, 'no second ask while waiting');
  answer = { ok: true, text: '明天上午十点开会。', ms: 2100 };
  await new Promise((r) => setTimeout(r, 4100));
  assert.strictEqual(asked.length, 2, 'asked again a few seconds later');
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(C.S.voice[ref].text, '明天上午十点开会。', 'then the words');
  // The bubble: play, waveform, length, words.
  const el = F.Voice({ data: { ref, duration: 2100, preview: pk, mime: 'audio/wav' } });
  const kids = [].concat(el.props.children).filter(Boolean);
  const text = (n) => (n == null ? '' : typeof n === 'string' || typeof n === 'number' ? String(n) : [].concat(n.props && n.props.children).map(text).join(''));
  assert.strictEqual(el.props.className, 'voice');
  assert.ok(text(kids[0]).includes('2″'), 'the length');
  assert.strictEqual(kids[1].props.className, 'vtext');
  assert.strictEqual(text(kids[1]), '明天上午十点开会。', 'the words under it');
  const busy = F.Voice({ data: { duration: 1500, _processing: true } });
  assert.ok(text(busy).includes('发送中') && [].concat(busy.props.children).filter(Boolean).length === 1, 'while it uploads: 发送中, no words yet');
  assert.ok(/case "AU": return h\(Voice, \{ key, data \}\);/.test(src), 'a voice message is drawn as one');
  assert.ok(/"data-voice-rec": "1"/.test(src) && /voiceStop\(true\)/.test(src) && /VOICE_MAX = 60/.test(src), 'the mic button, the bar, 60 s at most');
  assert.ok(/Drafty\.appendAudio\(null, \{ mime: "audio\/wav", duration: ms, preview: voicePeaks\(r\.peaks\)/.test(src), 'sent as Tinode audio with its waveform');
  // company-chat-voice-gist-v1: a long one's gist above its words.
  C.S.voice['/v0/file/s/Long.wav'] = { text: '很长的一段话。', gist: '明早十点开会' };
  const lg = [].concat(F.Voice({ data: { ref: '/v0/file/s/Long.wav', duration: 42000 } }).props.children).filter(Boolean);
  assert.ok(lg[1].props.className === 'vgist' && text(lg[1]) === '要点明早十点开会' && lg[2].props.className === 'vtext', 'the gist, then the words');

  // -- company-chat-call-v1: one-to-one voice calls ---------------------------------------------------------
  const signals = [];
  const topics = {};
  const callTopic = (name) => topics[name] || (topics[name] = {
    name, _attached: true, isGroupType: () => name.startsWith('grp'), isP2PType: () => name.startsWith('usr'),
    isSubscribed: () => true, latestMsgVersion: () => null, leave: () => Promise.resolve(),
    videoCall: (ev, seq, payload) => signals.push({ topic: name, ev, seq, payload }),
  });
  C.client.getTopic = callTopic;
  const now = Date.now();
  const vc = (o) => Object.assign({ topic: 'usrWang00001', from: 'usrWang00001', seq: 7, ts: new Date(now), head: { webrtc: 'started', aonly: true } }, o);
  assert.strictEqual(F.callIncoming(vc({ from: ME })), false, 'my own call does not ring here');
  assert.strictEqual(F.callIncoming(vc({ ts: new Date(now - 120000) })), false, 'an old one (a chat\'s history) does not ring');
  assert.strictEqual(F.callIncoming(vc({ topic: 'grpTeam', from: 'usrWang00001' })), false, 'not in a group');
  assert.strictEqual(F.callIncoming(vc({ head: { webrtc: 'finished' } })), false, 'one that is over does not ring');
  topics.usrWang00001 = null;
  callTopic('usrWang00001').latestMsgVersion = () => ({ head: { webrtc: 'missed' } });
  assert.strictEqual(F.callIncoming(vc()), false, 'one its replacing message says is over does not ring');
  topics.usrWang00001 = null;
  assert.strictEqual(F.callIncoming(vc()), true, 'a call to me rings');
  assert.deepStrictEqual(signals.at(-1), { topic: 'usrWang00001', ev: 'ringing', seq: 7, payload: undefined }, 'the caller hears it ring');
  assert.ok(C.S.call && C.S.call.state === 'ringing' && C.S.call.dir === 'in', 'the bar: ringing');
  const bar = F.CallBar();
  assert.ok(bar.props['data-call-state'] === 'ringing' && /拒绝/.test(text(bar)) && /接听/.test(text(bar)) && /邀请你语音通话/.test(text(bar)), 'ringing: 拒绝 / 接听');
  assert.strictEqual(F.callIncoming(vc()), false, 'the same call again: nothing new');
  assert.strictEqual(F.callIncoming(vc({ topic: 'usrLi00000001', from: 'usrLi00000001', seq: 3 })), false, 'a second call while one rings');
  assert.deepStrictEqual(signals.at(-1), { topic: 'usrLi00000001', ev: 'hang-up', seq: 3, payload: undefined }, 'is turned down');
  F.callInfo({ what: 'call', event: 'accept', topic: 'me', from: ME, seq: 7 });
  assert.strictEqual(F.call(), null, 'answered in another of my windows: this one stops ringing');
  assert.strictEqual(C.S.call, null, 'and shows nothing');
  // Ringing, then the caller hangs up.
  F.callIncoming(vc({ seq: 8 }));
  F.callInfo({ what: 'call', event: 'hang-up', topic: 'usrLi00000001', from: 'usrLi00000001', seq: 8 });
  assert.ok(F.call() && F.call().seq === 8, 'a hang-up for another chat changes nothing');
  F.callInfo({ what: 'call', event: 'hang-up', topic: 'usrWang00001', from: 'usrWang00001', seq: 8 });
  assert.ok(F.call() === null && C.S.call.state === 'ended' && C.S.call.why === '对方已取消', 'the caller hung up: 对方已取消');
  // Declining.
  F.callIncoming(vc({ seq: 9 }));
  F.callHangup('已拒绝');
  assert.deepStrictEqual(signals.at(-1), { topic: 'usrWang00001', ev: 'hang-up', seq: 9, payload: undefined }, '拒绝: hang-up to the caller');
  assert.strictEqual(C.S.call.why, '已拒绝');

  // This side's microphone in pieces at the pauses, during a call that is transcribed.
  F.callIncoming(vc({ seq: 10 }));
  const c = F.call();
  c.state = 'live';
  c.tx = true;
  c.cap = { rate: 16000, buf: [], pre: [], start: 0, len: 0, voiced: 0, quiet: 0, floor: 0.004 };
  const posts = [];
  ctx.fetch = (u, o) => { posts.push({ u, o }); return Promise.resolve({ json: () => Promise.resolve({ ok: true }) }); };
  const F32 = vm.runInContext('Float32Array', ctx);
  const frame = (amp) => { const f = new F32(4096); for (let i = 0; i < f.length; i++) f[i] = amp * Math.sin(i / 3); return f; };
  let at = now;
  const hear = (amp, n) => { for (let i = 0; i < n; i++) { at += 256; F.callHear(c, frame(amp), at); } };
  hear(0.001, 6);
  assert.strictEqual(c.cap.buf.length, 0, 'silence: nothing gathered');
  hear(0.2, 8);
  hear(0.001, 2);
  assert.strictEqual(posts.length, 0, 'a short pause inside a piece: still one piece');
  hear(0.2, 4);
  hear(0.001, 4);
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(posts.length, 1, 'a long pause ends the piece');
  const q = new URL('http://x' + posts[0].u).searchParams;
  assert.ok(q.get('k') === 'pagekey' && q.get('op') === 'piece' && q.get('peer') === 'usrWang00001' && q.get('seq') === '10', 'sent to the relay as this call\'s piece: ' + posts[0].u);
  const len = Number(q.get('ms'));
  assert.ok(len >= 4000 && len <= 5500 && Math.abs(Number(q.get('at')) - (now + 256 * 4)) <= 300, 'its length and when it began (with a little before): ' + len + ' ' + (Number(q.get('at')) - now));
  assert.ok(posts[0].o.method === 'POST' && posts[0].o.headers['Content-Type'] === 'audio/wav' && posts[0].o.body.length === 44 + Math.floor(4096 * 21) * 2, 'the body: 16 kHz WAV');
  hear(0.2, 1);
  hear(0.001, 5);
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(posts.length, 1, 'a click (too little voice): not sent');
  hear(0.2, 200);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(posts.length >= 2 && Number(new URL('http://x' + posts[1].u).searchParams.get('ms')) <= 51000, 'a long run of talk is cut at 50 seconds');
  const before = posts.length;
  c.cap.buf = [];
  c.muted = true;
  hear(0.2, 20);
  hear(0.001, 6);
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(posts.length, before, 'muted: nothing sent');
  c.muted = false;
  hear(0.2, 8);
  F.callHangup('');
  await new Promise((r) => setTimeout(r, 30));
  const ops = posts.slice(before).map((x) => new URL('http://x' + x.u).searchParams.get('op'));
  assert.deepStrictEqual(ops, ['piece', 'end'], 'hanging up sends the last piece, then the end: ' + ops);
  assert.deepStrictEqual(signals.at(-1), { topic: 'usrWang00001', ev: 'hang-up', seq: 10, payload: undefined }, 'and hangs up');
  assert.ok(/纪要稍后发在聊天里/.test(text(F.CallBar())) || C.S.call.tx === false, 'the bar says the minutes come later');

  // What a call left in the chat.
  const ct = { latestMsgVersion: (s) => ({ 1: { head: { webrtc: 'finished', 'webrtc-duration': 754000 } }, 2: { head: { webrtc: 'missed' } }, 3: { head: { webrtc: 'declined' } } })[s] || null };
  assert.strictEqual(F.callNote(ct, { seq: 1, from: 'usrWang00001', head: { webrtc: 'started' } }), '语音通话 12:34', 'finished: its length');
  assert.strictEqual(F.callNote(ct, { seq: 2, from: ME, head: { webrtc: 'started' } }), '对方未接听');
  assert.strictEqual(F.callNote(ct, { seq: 2, from: 'usrWang00001', head: { webrtc: 'started' } }), '未接的语音通话');
  assert.strictEqual(F.callNote(ct, { seq: 3, from: ME, head: { webrtc: 'started' } }), '对方已拒绝');
  assert.strictEqual(F.mmss(3725), '1:02:05');
  assert.strictEqual(F.plain(Drafty.videoCall(true)), '[语音通话]', 'the list says 语音通话');
  // Wiring.
  assert.ok(/client\.onDataMessage = \(d\) => \{ callIncoming\(d\); \};/.test(src) && /client\.onInfoMessage = \(info\) => \{ callInfo\(info\); \};/.test(src), 'calls come from any chat');
  assert.ok(/!group && t\.isP2PType && t\.isP2PType\(\) \? h\("button", \{ className: "icon-btn", title: S\.call \? "正在通话" : "语音通话", "data-call": "1"/.test(src), 'the 语音通话 button, one-to-one chats only');
  assert.ok(/p\.isSubscribed\(\) && !\(call && call\.topic === prev\)/.test(src) && /name !== S\.topic && !\(call && call\.topic === name\)/.test(src), 'the call\'s chat stays attached while another is looked at');
  assert.ok(/pub\.head = Object\.assign\(\{\}, pub\.head \|\| \{\}, \{ webrtc: "started", aonly: true \}\)/.test(src), 'a call begins as Tinode\'s own call message (voice only)');
  assert.ok(/"call-note": \{ label: "TDH 助手 · 通话纪要", yes: "转成任务卡"/.test(src) && /ai\.kind === "call-note" && ai\.call \? h\("button", \{ className: "ai-link"/.test(src), 'the minutes card: 转成任务卡, 看全文');
})().then(() => { console.log('CHAT_CLIENT_PROVE_OK=1'); process.exit(0); }, (e) => { console.error(e); process.exit(1); });
