// company-chat-client-v1: TDH's chat page. A WeChat-style client on Tinode's own SDK (window.tinode) and server.
// It logs in with the chat token the desk's relay leaves in this page's storage ("auth-token", the same one
// Tinode's own page uses), so it works wherever that page did. React from ../vendor, no build step.
(function () {
	"use strict";
	const h = React.createElement;
	const { useState, useEffect, useRef, useLayoutEffect, useSyncExternalStore } = React;
	const { Tinode, Drafty } = window.tinode;
	const KEY = window.TDH_CHAT_KEY || "";
	const RECALL_MS = 2 * 60 * 1000; // as long as WeChat lets one take a message back
	const PAGE = 30;

	// ---- Theme: the system's, or what the desk says (?theme=, or a message from the desk page). ----------------
	function setTheme(t) {
		if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
		else delete document.documentElement.dataset.theme;
	}
	setTheme(new URLSearchParams(location.search).get("theme"));
	window.addEventListener("message", (e) => {
		const d = e.data;
		if (e.source === window.parent && d && d.type === "tdh-theme") setTheme(d.theme); // only the desk page around us
	});

	// ---- A tiny store: one version, bumped on any change, everything re-renders from Tinode's own caches. --------
	let ver = 0;
	let queued = false;
	const subs = new Set();
	function bump() {
		if (queued) return;
		queued = true;
		setTimeout(() => {
			queued = false;
			ver += 1;
			subs.forEach((f) => f());
		}, 16);
	}
	function useBump() {
		return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => ver);
	}
	const S = {
		status: "connecting", // connecting | ready | offline | noauth | error
		error: "",
		meId: "",
		myName: "",
		topic: null, // the open chat
		view: "chats", // chats | contacts
		search: "",
		toast: "",
		typing: {}, // topic -> until (ms)
		recalled: {}, // "topic:seq" -> text, for 重新编辑
		members: {}, // group -> [uid]
		tried: {}, // topic -> seq last fetched for the list (a chat whose messages are all gone is not asked again)
		drafts: {}, // topic -> text
		ats: {}, // topic -> [{ uid, label }]: the people picked with @ for the draft (label is "@name")
		pending: {}, // topic -> [{ file, url }]: pictures and files waiting in the input box (a screenshot, a paste)
		shooting: false,
		reply: null, // { seq, content, label }
		dialog: null, // { kind, ... }
		menu: null, // { x, y, items }
		viewer: null, // { src, name }
	};
	let toastTimer = null;
	function toast(text) {
		S.toast = text;
		bump();
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => { S.toast = ""; bump(); }, 3200);
	}

	// ---- Tinode. -------------------------------------------------------------------------------------------------
	const client = new Tinode({
		appName: "TDH-Chat/1.0",
		host: location.host,
		apiKey: KEY,
		transport: "ws",
		secure: location.protocol === "https:",
		persist: false,
	});
	client.setHumanLanguage("zh-CN");
	function storedToken() {
		try {
			const t = JSON.parse(localStorage.getItem("auth-token") || "null");
			return t && t.token ? t : null;
		} catch (e) {
			return null;
		}
	}
	client.onDisconnect = () => {
		if (S.status === "ready" || S.status === "connecting") S.status = "offline";
		bump();
	};
	client.onConnect = () => {
		const t = storedToken();
		if (!t) { S.status = "noauth"; bump(); return; }
		client.loginToken(t.token).then(() => {
			S.meId = client.getCurrentUserID();
			const nt = client.getAuthToken();
			if (nt && nt.token) {
				try { localStorage.setItem("auth-token", JSON.stringify(nt)); } catch (e) { /* kept in memory */ }
			}
			return attachMe();
		}).then(() => {
			S.status = "ready";
			bump();
			const asked = /(?:^|[#&])topic=([A-Za-z0-9_]+)/.exec(location.hash || "");
			if (asked && !S.topic) { openTopic(asked[1]); history.replaceState(null, "", location.pathname + location.search); }
			else if (S.topic) openTopic(S.topic, true);
			prefetch();
		}).catch((err) => {
			S.status = err && (err.code === 401 || err.code === 403) ? "noauth" : "error";
			S.error = (err && err.message) || "";
			bump();
		});
	};
	function start() {
		const t = storedToken();
		if (!t) { S.status = "noauth"; bump(); return; }
		client.setAuthToken({ token: t.token, expires: new Date(t.expires) });
		client.connect().catch(() => { S.status = "offline"; bump(); });
	}

	function attachMe() {
		const me = client.getMeTopic();
		me.onMetaDesc = (d) => { S.myName = (d && d.public && d.public.fn) || ""; bump(); };
		me.onContactUpdate = (what, cont) => {
			if (what === "msg" && cont && cont.name !== S.topic) later(cont.name);
			if (what === "gone" && cont && cont.name === S.topic) { S.topic = null; }
			bump();
		};
		me.onSubsUpdated = () => { prefetch(); bump(); };
		return me.subscribe(me.startMetaQuery().withLaterSub().withDesc().withTags().build());
	}

	// The last message of each chat (for the list) and each group's members (for its avatar): a short visit to each
	// chat that has messages, one at a time, never the open one.
	const pending = [];
	let fetching = false;
	function later(name) {
		if (!pending.includes(name)) pending.push(name);
		pump();
	}
	function prefetch() {
		contacts().forEach((c) => {
			const needMsg = (c.seq | 0) > 0 && !c.latestMessage() && S.tried[c.name] !== (c.seq | 0);
			const needMembers = c.isGroupType() && !S.members[c.name];
			if (needMsg || needMembers) later(c.name);
		});
	}
	function pump() {
		if (fetching || !pending.length || S.status !== "ready") return;
		const name = pending.shift();
		const t = client.getTopic(name);
		if (!t || name === S.topic || t.isSubscribed()) { pump(); return; }
		fetching = true;
		S.tried[name] = t.seq | 0;
		// A group's unread ones too (up to 20), so an @ that is not the last message still shows as [有人@我].
		let q = t.startMetaQuery().withLaterData(t.isGroupType() ? Math.min(Math.max(unread(t), 1), 20) : 1).withDesc();
		if (t.isGroupType()) q = q.withSub();
		t.subscribe(q.build()).then(() => {
			if (t.isGroupType()) rememberMembers(t);
			if (name !== S.topic) return t.leave(false);
		}).catch(() => {}).finally(() => {
			fetching = false;
			bump();
			setTimeout(pump, 50);
		});
	}
	function rememberMembers(t) {
		const list = [];
		t.subscribers((s) => { if (s && s.user && !list.includes(s.user)) list.push(s.user); });
		// One's own subscription is not always in the list (a group just made): one is a member of one's own groups.
		if (S.meId && !list.includes(S.meId)) list.unshift(S.meId);
		S.members[t.name] = list;
	}

	// ---- What the list and the chat show. ------------------------------------------------------------------------
	function contacts() {
		const out = [];
		const me = client.getMeTopic();
		me.contacts((c) => { if (!(c.private && c.private.arch)) out.push(c); });
		return out;
	}
	function rank(c) { return client.getMeTopic().pinnedTopicRank(c.name); }
	function when(c) {
		const m = c.latestMessage && c.latestMessage();
		if (m && m.ts) return new Date(m.ts).getTime();
		const t = c.touched || c.updated;
		return t ? new Date(t).getTime() : 0;
	}
	// The chat list holds chats with something in them (as WeChat's): pinned ones, groups, and any with messages.
	// The rest of one's colleagues are under 通讯录.
	function listed(c) { return rank(c) > 0 || c.isGroupType() || (c.seq | 0) > 0 || c.name === S.topic; }
	function unread(c) { return Math.max(0, (c.seq | 0) - (c.read | 0)); }
	function muted(c) { return !!(c.acs && c.acs.isMuted && c.acs.isMuted()); }
	function nameOf(c) { return (c && c.public && c.public.fn) || (c && c.name) || ""; }
	function userName(uid, topic) {
		if (!uid) return "";
		if (uid === S.meId) return S.myName || "我";
		const t = topic && topic.userDesc(uid);
		if (t && t.public && t.public.fn) return t.public.fn;
		const p = client.getTopic(uid);
		return (p && p.public && p.public.fn) || "同事";
	}
	function photoOf(pub) {
		const p = pub && pub.photo;
		if (!p) return null;
		if (p.ref) return client.authorizeURL(p.ref);
		if (p.data) return "data:image/" + (p.type || "jpeg") + ";base64," + p.data;
		return null;
	}
	function colorOf(id) {
		let n = 0;
		for (let i = 0; i < (id || "").length; i++) n = (n * 31 + id.charCodeAt(i)) | 0;
		return "c" + (Math.abs(n) % 8);
	}
	function initial(name) { return (name || "?").trim().slice(0, 1).toUpperCase(); }

	function pad(n) { return (n < 10 ? "0" : "") + n; }
	function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
	const WEEK = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
	function listTime(ms) {
		if (!ms) return "";
		const d = new Date(ms);
		const now = new Date();
		if (sameDay(d, now)) return pad(d.getHours()) + ":" + pad(d.getMinutes());
		const y = new Date(now); y.setDate(now.getDate() - 1);
		if (sameDay(d, y)) return "昨天";
		if (now - d < 6 * 86400e3) return WEEK[d.getDay()];
		return (d.getFullYear() === now.getFullYear() ? "" : d.getFullYear() + "/") + (d.getMonth() + 1) + "/" + d.getDate();
	}
	function clock(d) {
		const hh = d.getHours();
		const part = hh < 6 ? "凌晨" : hh < 12 ? "上午" : hh < 13 ? "中午" : hh < 18 ? "下午" : "晚上";
		return part + " " + (hh % 12 === 0 ? 12 : hh % 12) + ":" + pad(d.getMinutes());
	}
	function chatTime(ms) {
		const d = new Date(ms);
		const now = new Date();
		if (sameDay(d, now)) return clock(d);
		const y = new Date(now); y.setDate(now.getDate() - 1);
		if (sameDay(d, y)) return "昨天 " + clock(d);
		if (now - d < 6 * 86400e3) return WEEK[d.getDay()] + " " + clock(d);
		return (d.getFullYear() === now.getFullYear() ? "" : d.getFullYear() + "年") + (d.getMonth() + 1) + "月" + d.getDate() + "日 " + clock(d);
	}
	function size(n) {
		n = n | 0;
		if (n < 1024) return n + " B";
		if (n < 1048576) return Math.round(n / 1024) + " KB";
		return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + " MB";
	}
	function ftype(name, mime) {
		const ext = ((name || "").split(".").pop() || "").toLowerCase();
		if (ext === "pdf") return ["pdf", "PDF"];
		if (["xls", "xlsx", "csv", "et"].includes(ext)) return ["xls", "XLS"];
		if (["doc", "docx", "wps", "txt", "md"].includes(ext)) return ["doc", ext === "txt" || ext === "md" ? "TXT" : "DOC"];
		if (["ppt", "pptx", "dps"].includes(ext)) return ["ppt", "PPT"];
		if (["zip", "rar", "7z", "gz", "tar"].includes(ext)) return ["zip", "ZIP"];
		if (/^image\//.test(mime || "") || ["png", "jpg", "jpeg", "gif", "webp", "heic", "bmp"].includes(ext)) return ["img", "IMG"];
		if (/^video\//.test(mime || "") || ["mp4", "mov", "avi", "mkv"].includes(ext)) return ["vid", "VID"];
		return ["", (ext || "FILE").slice(0, 4).toUpperCase()];
	}
	function safeUrl(u) {
		if (typeof u !== "string") return "";
		return /^(https?:|mailto:|tel:)/i.test(u.trim()) ? u.trim() : "";
	}
	function mediaUrl(data) {
		if (!data) return "";
		if (data.ref && typeof data.ref === "string") return client.authorizeURL(data.ref);
		if (data.val) return "data:" + (data.mime || "application/octet-stream") + ";base64," + data.val;
		if (data._tempPreview) return "data:image/jpeg;base64," + data._tempPreview;
		return "";
	}

	// A message's text for the list, a quote or copying: pictures and files as words, quotes left out.
	function plain(content) {
		if (content == null) return "";
		if (typeof content === "string") return content;
		const flat = (v) => (v == null ? "" : Array.isArray(v) ? v.map(flat).join("") : String(v));
		const out = Drafty.format(content, (style, data, values) => {
			switch (style) {
			case "QQ": return "";
			case "BR": return " ";
			case "IM": return "[图片]";
			case "EX": return "[文件] " + ((data && data.name) || "");
			case "AU": return "[语音]";
			case "VC": return "[通话]";
			case "VD": return "[视频]";
			case "HD": return "";
			default: return flat(values);
			}
		});
		return flat(out).trim();
	}
	function mentionsMe(content) {
		if (!content || typeof content === "string" || !Array.isArray(content.ent)) return false;
		return content.ent.some((e) => e && e.tp === "MN" && e.data && e.data.val === S.meId);
	}
	// company-chat-at-v1: whether any unread message of a chat @ me (the list's [有人@我] stays until it is read, as
	// WeChat's, not only while that message is the last one).
	function mentionedUnread(c) {
		if (unread(c) <= 0) return false;
		const read = c.read | 0;
		return allMessages(c).some((m) => m && !m._deleted && (m.seq | 0) > read && m.from !== S.meId && mentionsMe(contentOf(c, m)));
	}
	// The words with the people picked by @ as mentions (Drafty MN, the person's id in data.val; Tinode's own page reads
	// the same); null when none of them is left in the text.
	function atDraft(text, picks) {
		const labels = Array.from(new Set(picks.map((p) => p.label))).sort((a, b) => b.length - a.length);
		const used = {};
		const parts = [];
		let from = 0;
		let i = 0;
		while (i < text.length) {
			const label = text[i] === "@" ? labels.find((l) => text.startsWith(l, i)) : null;
			if (!label) { i++; continue; }
			if (i > from) parts.push(text.slice(from, i));
			const same = picks.filter((p) => p.label === label);
			const k = used[label] | 0;
			used[label] = k + 1;
			parts.push({ label, uid: same[Math.min(k, same.length - 1)].uid });
			i += label.length;
			from = i;
		}
		if (!parts.some((p) => typeof p !== "string")) return null;
		if (from < text.length) parts.push(text.slice(from));
		return parts.reduce((d, p) => Drafty.append(d, typeof p === "string" ? (Drafty.parse(p) || Drafty.init(p)) : Drafty.mention(p.label, p.uid)), Drafty.init(""));
	}
	// Every message of a chat in order, with the places where one was deleted (topic.messages() leaves those out;
	// Tinode keeps them as { low, hi, _deleted } in the same list). Edits are folded into their message by contentOf.
	function allMessages(t) {
		const out = [];
		if (t._messages && typeof t._messages.forEach === "function") {
			t._messages.forEach((m) => { if (m && !(m.head && m.head.replace)) out.push(m); });
		} else {
			t.messages((m) => out.push(m));
		}
		return out;
	}
	// What one deleted only for oneself leaves no mark (as in WeChat); others only ever see deletions made for
	// everyone, i.e. recalls. Kept on this computer.
	const HIDDEN = "tdh-chat-hidden";
	function hidden() { try { return JSON.parse(localStorage.getItem(HIDDEN) || "{}") || {}; } catch (e) { return {}; } }
	function hide(topic, seq) {
		const all = hidden();
		all[topic] = (all[topic] || []).concat([seq]).slice(-500);
		try { localStorage.setItem(HIDDEN, JSON.stringify(all)); } catch (e) { /* this session only */ }
	}
	function isHidden(topic, seq) { return (hidden()[topic] || []).includes(seq); }
	function contentOf(t, msg) {
		const v = t.latestMsgVersion ? t.latestMsgVersion(msg.seq) : null;
		return (v || msg).content;
	}

	// company-chat-cards-v1: a task card between the two people of a one-to-one chat (head tdh_card: what happened to
	// it, said by the one who did it), drawn as a card in that person's bubble.
	function cardOf(msg) {
		const c = msg && msg.head && msg.head.tdh_card;
		return c && typeof c === "object" && c.title ? c : null;
	}
	const CARD_EVENT = { issued: "下达了任务卡", submitted: "提交验收", passed: "验收通过", returned: "打回了", cancelled: "作废了", due: "改了截止时间" };
	function cardBody(c) {
		const due = c.due ? new Date(c.due) : null;
		return h("div", { className: "tcard " + String(c.event || ""), "data-card": String(c.id || "") },
			h("div", { className: "tc-top" }, h("span", { className: "tc-tag" }, "任务卡"), h("span", { className: "tc-ev" }, CARD_EVENT[c.event] || "")),
			h("div", { className: "tc-title" }, String(c.title)),
			h("div", { className: "tc-meta" }, "负责人 " + String(c.to || "") + (due ? " · 截止 " + (due.getMonth() + 1) + "月" + due.getDate() + "日 " + pad(due.getHours()) + ":" + pad(due.getMinutes()) : "")),
			c.note ? h("div", { className: "tc-note" }, String(c.note)) : null,
			h("div", { className: "tc-foot" }, "在 TDH 左栏「任务」里查看和处理"));
	}

	// company-chat-assist-v1: TDH 助手's answers (head tdh_ai: the question's seq, the kind, who confirms; in a one-to-one
	// chat the person asked posts it, as Tinode has no third party) and their confirmations (head tdh_ai_ok, counted only
	// from the person named to confirm).
	function aiOf(msg) {
		const a = msg && msg.head && msg.head.tdh_ai;
		return a && typeof a === "object" ? a : null;
	}
	function aiOkOf(msg) {
		const a = msg && msg.head && msg.head.tdh_ai_ok;
		return a && typeof a === "object" ? a : null;
	}
	function aiText(t, msg) {
		return plain(contentOf(t, msg)).replace(/^【TDH 助手】\s*/, "");
	}
	// Who may answer an AI message: the person asked (an answer: confirm), or the person who said it and the owner
	// (a proposed task card, company-chat-tasks-v1: deciders). The first answer from one of them counts.
	function aiDeciders(a) {
		return !a ? [] : Array.isArray(a.deciders) ? a.deciders.map(String) : a.confirm ? [String(a.confirm)] : [];
	}
	function aiConfirmation(items, msg) {
		const who = aiDeciders(aiOf(msg));
		let out = null;
		if (!who.length) return null;
		items.forEach((m) => {
			const ok = aiOkOf(m);
			if (!out && ok && (ok.of | 0) === msg.seq && who.includes(m.from)) out = { ok: ok.ok !== false, by: m.from, seq: m.seq };
		});
		return out;
	}

	// ---- Actions. ------------------------------------------------------------------------------------------------
	function openTopic(name, again) {
		const prev = S.topic;
		if (prev && prev !== name) {
			const p = client.getTopic(prev);
			if (p && p.isSubscribed()) p.leave(false).catch(() => {});
			S.drafts[prev] = S.drafts[prev] || "";
		}
		if (!again) S.reply = null;
		S.topic = name;
		S.view = "chats";
		bump();
		if (!name || S.status !== "ready") return;
		const t = client.getTopic(name);
		t.onData = () => { markRead(t); bump(); };
		t.onMetaDesc = () => bump();
		t.onSubsUpdated = () => { if (t.isGroupType()) rememberMembers(t); bump(); };
		t.onPres = () => bump();
		t.onInfo = (info) => {
			if (info && info.what === "kp" && info.from !== S.meId) {
				S.typing[t.name] = Date.now() + 3500;
				setTimeout(bump, 3600);
			}
			bump();
		};
		t.onAllMessagesReceived = () => bump();
		if (t.isSubscribed()) {
			// Attached already (the list was fetching its last message): get the rest of the first page.
			if (t.messageCount() < PAGE && t.minMsgSeq() > 1) t.getMeta(t.startMetaQuery().withEarlierData(PAGE).build()).catch(() => {}).finally(bump);
			markRead(t);
			bump();
			return;
		}
		const q = t.startMetaQuery().withLaterDesc().withLaterSub().withLaterData(PAGE).withLaterDel().build();
		t.subscribe(q).then(() => {
			if (t.isGroupType()) rememberMembers(t);
			markRead(t);
			bump();
			// A short chat: see once whether anything is earlier (deleted messages leave a gap at the start).
			if (t.messageCount() < PAGE && t.minMsgSeq() > 1) earlier(t);
		}).catch((err) => toast("打不开这个聊天：" + ((err && err.message) || "")));
	}
	// Older messages, a page at a time; when a page brings nothing, there is nothing older.
	function earlier(t) {
		if (t._tdhLoading || t._tdhNoMore) return Promise.resolve();
		t._tdhLoading = true;
		const min = t.minMsgSeq();
		return t.getMeta(t.startMetaQuery().withEarlierData(PAGE).build()).catch(() => {}).finally(() => {
			t._tdhLoading = false;
			if (t.minMsgSeq() === min) t._tdhNoMore = true;
			bump();
		});
	}
	let readTimer = null;
	function markRead(t) {
		clearTimeout(readTimer);
		readTimer = setTimeout(() => {
			if (S.topic !== t.name || document.visibilityState === "hidden") return;
			const seq = t.maxMsgSeq();
			if (seq > 0 && seq > (t.read | 0)) {
				try { t.noteRead(seq); } catch (e) { /* next time */ }
			}
		}, 400);
	}
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible" && S.topic) {
			const t = client.getTopic(S.topic);
			if (t && t.isSubscribed()) markRead(t);
		}
	});

	function sendText(text) {
		const t = S.topic && client.getTopic(S.topic);
		if (!t || !text.trim()) return;
		// Plain words go as a string (Tinode makes it formatted only when it is: links, bold…); a quote or an @ needs
		// Drafty.
		const picks = S.ats[S.topic] || [];
		delete S.ats[S.topic];
		const body = picks.length ? atDraft(text, picks) : null;
		let content = body || text;
		let head = null;
		if (S.reply) {
			head = { reply: "" + S.reply.seq };
			content = Drafty.append(Drafty.sanitizeEntities(S.reply.content), body || Drafty.parse(text) || Drafty.init(text));
		}
		const pub = t.createMessage(content, true);
		if (head) pub.head = Object.assign({}, pub.head || {}, head);
		S.reply = null;
		t.publishDraft(pub).catch(() => {});
		bump();
	}
	// The words of each kind of TDH 助手 message: its label, its buttons (none: no button), what an answer says.
	// data: an answer from the data; task: a proposed task card (company-chat-tasks-v1); doc-saved / doc-ask / doc-note:
	// a finance paper filed, asked about, or a line about one (company-chat-docs-v1).
	const AI_WORDS = {
		data: { label: "TDH 助手 · 自动查询", yes: "确认无误", no: "有误", sayYes: "确认无误", sayNo: "这条数据有误，我来核对",
			noteYes: " 确认了 TDH 助手的数据", noteNo: " 说 TDH 助手的数据有误，正在核对", doneYes: (b) => "✓ " + b + " 确认无误", doneNo: (b) => "✗ " + b + "：有误，正在核对", wait: " 确认" },
		task: { label: "TDH 助手 · 任务卡", yes: "记下", no: "不用", sayYes: "记下", sayNo: "不用记",
			noteYes: " 记下了这张任务卡", noteNo: " 说不用记", doneYes: (b) => "✓ " + b + " 记下了", doneNo: (b) => b + "：不用记", wait: " 决定" },
		"task-made": { label: "TDH 助手 · 任务卡" },
		"doc-saved": { label: "TDH 助手 · 财务单据", no: "撤销", sayNo: "撤销", noteNo: " 撤销了这张单据", doneNo: (b) => b + " 撤销了这张单据" },
		"doc-ask": { label: "TDH 助手 · 财务单据", yes: "存进财务", no: "不用", sayYes: "存进财务", sayNo: "不用存",
			noteYes: " 把它存进了财务", noteNo: " 说不用存", doneYes: (b) => "✓ " + b + " 存进了财务", doneNo: (b) => b + "：不用存", wait: " 决定" },
		"doc-note": { label: "TDH 助手 · 财务单据" },
		// company-kb-organize-v1: a file on the share TDH could not place for sure, and what went in.
		"kb-ask": { label: "TDH 助手 · 知识库", yes: "放进去", no: "不放", sayYes: "放进去", sayNo: "不放", noteYes: " 让 TDH 收进知识库", noteNo: " 说不放进知识库",
			doneYes: (b) => "✓ " + b + " 让它收进知识库", doneNo: (b) => b + "：不放进知识库", wait: " 决定" },
		"kb-note": { label: "TDH 助手 · 知识库" },
	};
	function aiWords(a) {
		return AI_WORDS[(a && a.kind) || ""] || AI_WORDS.data;
	}
	function confirmAi(t, msg, ok) {
		const w = aiWords(aiOf(msg));
		const pub = t.createMessage(ok ? w.sayYes : w.sayNo, true);
		pub.head = Object.assign({}, pub.head || {}, { tdh_ai_ok: { of: msg.seq, ok: !!ok }, reply: "" + msg.seq });
		t.publishDraft(pub).catch((err) => toast("发送失败：" + ((err && err.message) || "")));
		bump();
	}
	// Waiting in the input box until 发送 (as WeChat holds a screenshot or a pasted picture).
	function addPending(name, list) {
		const cur = S.pending[name] || [];
		Array.from(list || []).forEach((file) => {
			if (!file) return;
			cur.push({ file, url: /^image\//.test(file.type) ? URL.createObjectURL(file) : "" });
		});
		S.pending[name] = cur;
		bump();
		focusInput();
	}
	function dropPending(name, i) {
		const cur = S.pending[name] || [];
		const gone = cur.splice(i, 1)[0];
		if (gone && gone.url) URL.revokeObjectURL(gone.url);
		bump();
	}
	function sendPending(name) {
		const cur = S.pending[name] || [];
		if (!cur.length) return;
		S.pending[name] = [];
		sendFiles(cur.map((p) => p.file));
		cur.forEach((p) => { if (p.url) URL.revokeObjectURL(p.url); });
	}
	// 截图: the system's own screenshot on this computer, through the desk's relay (it says so with TDH_SHOT); the
	// picture comes back here and waits in the input box. Without the relay's help, the keyboard shortcut tip.
	const PAGE_KEY = new URLSearchParams(location.search).get("k") || "";
	function canShoot() { return !!window.TDH_SHOT && !!PAGE_KEY; }
	function shoot(name) {
		if (S.shooting) return;
		S.shooting = true;
		bump();
		const q = (p) => p + (p.indexOf("?") < 0 ? "?" : "&") + "k=" + encodeURIComponent(PAGE_KEY);
		fetch(q("/tdh/shot"), { method: "POST" }).then((r) => r.json()).then((j) => {
			if (!j || !j.ok) { if (j && j.error) toast(j.error); return null; }
			const f = j.files[0];
			return fetch(q("/tdh/picked?id=" + encodeURIComponent(f.id))).then((r) => r.blob()).then((b) => new File([b], f.name, { type: "image/png" }));
		}).then((file) => { if (file) addPending(name, [file]); })
			.catch(() => toast("截图没成功"))
			.finally(() => { S.shooting = false; bump(); });
	}
	function maxUpload() { return client.getServerParam("maxFileUploadSize", 200 * 1048576); }
	function sendFiles(files) {
		const t = S.topic && client.getTopic(S.topic);
		if (!t) return;
		Array.from(files || []).forEach((file) => {
			if (!file) return;
			if (file.size > maxUpload()) { toast("「" + file.name + "」太大了，单个文件最多 " + size(maxUpload())); return; }
			if (/^image\/(png|jpe?g|gif|webp|bmp)$/i.test(file.type)) sendImage(t, file);
			else sendFile(t, file);
		});
	}
	function sendFile(t, file) {
		const up = client.getLargeFileHelper();
		const prom = up.upload(file);
		const msg = Drafty.attachFile(null, { mime: file.type || "application/octet-stream", filename: file.name, size: file.size, urlPromise: prom });
		t.publishDraft(t.createMessage(msg, true), prom).catch(() => {});
		bump();
	}
	function sendImage(t, file) {
		const url = URL.createObjectURL(file);
		const img = new Image();
		img.onload = () => {
			const w = img.naturalWidth;
			const ht = img.naturalHeight;
			const k = Math.min(1, 128 / Math.max(w, ht));
			const cv = document.createElement("canvas");
			cv.width = Math.max(1, Math.round(w * k));
			cv.height = Math.max(1, Math.round(ht * k));
			cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
			const bits = cv.toDataURL("image/jpeg", 0.7).split(",")[1];
			URL.revokeObjectURL(url);
			const up = client.getLargeFileHelper();
			const prom = up.upload(file);
			const msg = Drafty.insertImage(null, 0, { mime: file.type, _tempPreview: bits, bits, width: w, height: ht, filename: file.name || "图片.png", size: file.size, urlPromise: prom });
			t.publishDraft(t.createMessage(msg, true), prom).catch(() => {});
			bump();
		};
		img.onerror = () => { URL.revokeObjectURL(url); sendFile(t, file); };
		img.src = url;
	}
	function retry(t, msg) {
		const content = msg.content;
		const head = msg.head;
		try { t.cancelSend(msg.seq); } catch (e) { /* gone already */ }
		t.delMessagesList([msg.seq], true).catch(() => {});
		const pub = t.createMessage(content, true);
		if (head) pub.head = Object.assign({}, head);
		t.publishDraft(pub).catch(() => {});
		bump();
	}
	function quote(t, msg) {
		const name = userName(msg.from, t);
		const c = contentOf(t, msg);
		const body = typeof c === "string" ? Drafty.init(c) : Drafty.replyContent(c, 40);
		S.reply = { seq: msg.seq, content: Drafty.quote(name, msg.from, body), label: name + "：" + plain(c).slice(0, 40) };
		bump();
		focusInput();
	}
	function forwardTo(names, from, msg) {
		const c = contentOf(from, msg);
		const who = userName(msg.from, from);
		const body = typeof c === "string" ? Drafty.init(c) : Drafty.forwardedContent(c);
		const content = Drafty.append(Drafty.appendLineBreak(Drafty.mention("➦ " + who, msg.from)), body);
		names.forEach((n) => {
			const t = client.getTopic(n);
			const go = t.isSubscribed() ? Promise.resolve() : t.subscribe(t.startMetaQuery().withLaterDesc().build());
			go.then(() => {
				const pub = t.createMessage(content, true);
				pub.head = Object.assign({}, pub.head || {}, { forwarded: from.name + ":" + msg.seq });
				return t.publishMessage(pub);
			}).then(() => { if (n !== S.topic) t.leave(false).catch(() => {}); }).catch((err) => toast("转发失败：" + ((err && err.message) || "")));
		});
		toast("已转发");
	}
	function recall(t, msg) {
		const text = plain(contentOf(t, msg));
		t.delMessagesList([msg.seq], true).then(() => {
			S.recalled[t.name + ":" + msg.seq] = text;
			bump();
		}).catch((err) => toast("撤回失败：" + ((err && err.message) || "")));
	}
	function removeForMe(t, msg) {
		hide(t.name, msg.seq);
		t.delMessagesList([msg.seq], false).catch((err) => toast("删除失败：" + ((err && err.message) || "")));
	}
	function togglePin(name) {
		const me = client.getMeTopic();
		const on = me.pinnedTopicRank(name) > 0;
		me.pinTopic(name, !on).then(bump).catch((err) => toast("置顶失败：" + ((err && err.message) || "")));
	}
	function toggleMute(name) {
		const t = client.getTopic(name);
		const on = muted(t);
		const go = t.isSubscribed() ? Promise.resolve() : t.subscribe(t.startMetaQuery().withLaterDesc().build());
		go.then(() => t.updateMode(null, on ? "+P" : "-P")).then(() => {
			if (name !== S.topic) t.leave(false).catch(() => {});
			bump();
		}).catch((err) => toast("设置失败：" + ((err && err.message) || "")));
	}
	function createGroup(title, uids) {
		const t = client.getTopic(client.newGroupTopicName(false));
		t.subscribe(null, { desc: { public: { fn: title } } }).then(() => {
			const name = t.name;
			return Promise.all(uids.map((u) => t.invite(u, null).catch(() => null))).then(() => name);
		}).then((name) => {
			S.dialog = null;
			return t.getMeta(t.startMetaQuery().withSub().build()).catch(() => {}).then(() => name);
		}).then((name) => {
			rememberMembers(t);
			openTopic(name);
		}).catch((err) => toast("建群失败：" + ((err && err.message) || "")));
	}
	function inviteMembers(t, uids) {
		Promise.all(uids.map((u) => t.invite(u, null))).then(() => { rememberMembers(t); bump(); toast("已邀请"); })
			.catch((err) => toast("邀请失败：" + ((err && err.message) || "")));
	}
	function renameGroup(t, title) {
		t.setMeta({ desc: { public: Object.assign({}, t.public || {}, { fn: title }) } }).then(bump).catch((err) => toast("改名失败：" + ((err && err.message) || "")));
	}
	function leaveGroup(t) {
		t.leave(true).then(() => { S.topic = null; S.dialog = null; bump(); }).catch((err) => toast("退出失败：" + ((err && err.message) || "")));
	}
	function copy(text) {
		const done = () => toast("已复制");
		if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
		else fallbackCopy(text, done);
	}
	function fallbackCopy(text, done) {
		const ta = document.createElement("textarea");
		ta.value = text;
		document.body.appendChild(ta);
		ta.select();
		try { document.execCommand("copy"); done(); } catch (e) { /* nothing more to try */ }
		ta.remove();
	}
	let focusInput = () => {};

	// ---- Icons (drawn here, not taken from anyone's app). --------------------------------------------------------
	function I(d, o) {
		o = o || {};
		return h("svg", { width: o.s || 20, height: o.s || 20, viewBox: "0 0 24 24", fill: o.fill ? "currentColor" : "none", stroke: o.fill ? "none" : "currentColor",
			strokeWidth: o.w || 1.7, strokeLinecap: "round", strokeLinejoin: "round" }, (Array.isArray(d) ? d : [d]).map((x, i) => typeof x === "string" ? h("path", { key: i, d: x }) : h(x.t, Object.assign({ key: i }, x.a))));
	}
	const ICON = {
		chat: (s) => I("M4 5.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4.5 3.5V16.5H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z", { s }),
		people: (s) => I([{ t: "circle", a: { cx: 9, cy: 8.5, r: 3.5 } }, "M3 19c.8-3.2 3.2-5 6-5s5.2 1.8 6 5", "M16 6.5h5M16 10h5M17.5 13.5H21"], { s }),
		menu: () => I("M4 7h16M4 12h16M4 17h16"),
		search: () => I([{ t: "circle", a: { cx: 11, cy: 11, r: 6.5 } }, "M16 16l4 4"], { s: 14, w: 2 }),
		plus: () => I("M12 5v14M5 12h14", { s: 16, w: 2 }),
		more: () => I([{ t: "circle", a: { cx: 5, cy: 12, r: 1.6 } }, { t: "circle", a: { cx: 12, cy: 12, r: 1.6 } }, { t: "circle", a: { cx: 19, cy: 12, r: 1.6 } }], { fill: true }),
		back: () => I("M15 5l-7 7 7 7", { w: 2 }),
		smile: () => I([{ t: "circle", a: { cx: 12, cy: 12, r: 8.5 } }, "M8.5 14.5a4.5 4.5 0 0 0 7 0", { t: "circle", a: { cx: 9.3, cy: 10, r: 0.6, fill: "currentColor" } }, { t: "circle", a: { cx: 14.7, cy: 10, r: 0.6, fill: "currentColor" } }]),
		folder: () => I("M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4.5l2 2H19a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"),
		cut: () => I([{ t: "circle", a: { cx: 6.5, cy: 17.5, r: 2.5 } }, { t: "circle", a: { cx: 17.5, cy: 17.5, r: 2.5 } }, "M8.5 16L18 4M15.5 16L6 4"]),
		image: () => I([{ t: "rect", a: { x: 3.5, y: 5.5, width: 17, height: 13, rx: 1.5 } }, { t: "circle", a: { cx: 9, cy: 10, r: 1.5 } }, "M20.5 15.5l-5-4.5-8 7.5"]),
		mute: () => I("M6 10a6 6 0 0 1 9.5-4.9M18 10v4l1.5 2.5H8M10 19.5a2 2 0 0 0 4 0M3 3l18 18", { s: 13, w: 1.8 }),
		close: () => I("M6 6l12 12M18 6L6 18", { s: 14, w: 2 }),
	};

	// ---- Components. ---------------------------------------------------------------------------------------------
	function Avatar(props) {
		const c = props.topic;
		const cls = props.size ? " " + props.size : "";
		if (c && c.isGroupType && c.isGroupType()) {
			const ids = (S.members[c.name] || []).slice(0, 9);
			if (ids.length >= 2) {
				return h("div", { className: "grid n" + ids.length + cls }, ids.map((u) => h("i", { key: u, className: colorOf(u) }, initial(userName(u, c)))));
			}
		}
		const id = props.uid || (c && c.name) || "";
		const name = props.name || nameOf(c);
		const src = photoOf(props.pub || (c && c.public));
		return h("div", { className: "a " + colorOf(id) + cls }, src ? h("img", { src, alt: "" }) : initial(name));
	}

	function Rail() {
		const total = contacts().reduce((n, c) => n + (muted(c) ? 0 : unread(c)), 0);
		return h("nav", { className: "rail" },
			h("div", { className: "me", title: S.myName }, h(Avatar, { uid: S.meId, name: S.myName, pub: client.getMeTopic().public, size: "s34" })),
			h("button", { className: "tab" + (S.view === "chats" ? " on" : ""), title: "消息", onClick: () => { S.view = "chats"; bump(); } }, ICON.chat(22), total ? h("span", { className: "count" }, total > 99 ? "99+" : total) : null),
			h("button", { className: "tab" + (S.view === "contacts" ? " on" : ""), title: "通讯录", onClick: () => { S.view = "contacts"; bump(); } }, ICON.people(22)),
			h("div", { className: "grow" }),
			h("button", { className: "tab", title: "更多", onClick: (e) => openMenu(e, [{ label: "发起群聊", run: () => { S.dialog = { kind: "group" }; bump(); } }]) }, ICON.menu()));
	}

	function Search() {
		const [, redraw] = useState(0); // drawn within the same event, as the input box (company-chat-ime-v1)
		return h("div", { className: "search" },
			h("label", null, ICON.search(), h("input", { placeholder: "搜索", value: S.search, onChange: (e) => { S.search = e.target.value; redraw((n) => n + 1); bump(); } })),
			h("button", { className: "add", title: "发起群聊", onClick: () => { S.dialog = { kind: "group" }; bump(); } }, ICON.plus()));
	}

	function ChatList() {
		const q = S.search.trim().toLowerCase();
		let list = contacts().filter(listed);
		if (q) list = contacts().filter((c) => nameOf(c).toLowerCase().includes(q) || plain((c.latestMessage() || {}).content).toLowerCase().includes(q));
		list.sort((a, b) => (rank(b) - rank(a)) || (when(b) - when(a)));
		const rows = list.map((c) => {
			const last = c.latestMessage();
			const n = unread(c);
			const quiet = muted(c);
			let preview = last ? plain(contentOf(c, last)) : "";
			if (last && c.isGroupType() && last.from && last.from !== S.meId) preview = userName(last.from, c) + "：" + preview;
			if (last && aiOf(last)) preview = "[TDH 助手] " + aiText(c, last);
			if (last && last._deleted) preview = S.recalled[c.name + ":" + last.low] != null ? "你撤回了一条消息" : isHidden(c.name, last.low) ? "" : "撤回了一条消息";
			const at = mentionedUnread(c);
			return h("div", {
				key: c.name,
				className: "row" + (rank(c) > 0 ? " pinned" : "") + (c.name === S.topic ? " on" : ""),
				onClick: () => openTopic(c.name),
				onContextMenu: (e) => openMenu(e, [
					{ label: rank(c) > 0 ? "取消置顶" : "置顶", run: () => togglePin(c.name) },
					{ label: quiet ? "开启新消息提醒" : "消息免打扰", run: () => toggleMute(c.name) },
				]),
			},
			h("div", { className: "av" }, h(Avatar, { topic: c }), n > 0 ? h("span", { className: "badge" + (quiet ? " dot" : "") }, quiet ? null : n > 99 ? "99+" : n) : null,
				c.isP2PType() && c.online ? h("span", { className: "online" }) : null),
			h("div", { className: "body" },
				h("div", { className: "top" }, h("div", { className: "name" }, nameOf(c)), h("div", { className: "time" }, listTime(when(c)))),
				h("div", { className: "bottom" }, h("div", { className: "preview" }, at ? h("b", null, "[有人@我] ") : null, quiet && n > 1 ? "[" + n + "条] " : "", preview || " "), quiet ? ICON.mute() : null)));
		});
		// The line that says TDH 助手 reads the chat, under the list (the user, 2026-11-21: not on top).
		return h("div", { className: "rows" },
			rows.length ? rows : h("div", { className: "empty" }, q ? "没有找到" : "还没有聊天"),
			h("div", { className: "assist-note" }, "TDH 助手会读公司聊天：问到资金、生产进度、原料行情，它会自动查好发在对话里，由被问的人确认；说到要做的事，它会问一句要不要记成任务卡，到期前提醒；发来的账单、回单、发票、付款计划（图片、PDF 都行），它会认出来存进财务，付款回单还会挂到对应的付款任务卡上。"));
	}

	function Contacts() {
		const q = S.search.trim().toLowerCase();
		const all = contacts().filter((c) => !q || nameOf(c).toLowerCase().includes(q));
		const coll = (a, b) => nameOf(a).localeCompare(nameOf(b), "zh-Hans-CN");
		const people = all.filter((c) => c.isP2PType()).sort(coll);
		const groups = all.filter((c) => c.isGroupType()).sort(coll);
		const row = (c) => h("div", { key: c.name, className: "row", onClick: () => openTopic(c.name) },
			h("div", { className: "av" }, h(Avatar, { topic: c, size: "s36" }), c.isP2PType() && c.online ? h("span", { className: "online" }) : null),
			h("div", { className: "body" }, h("div", { className: "top" }, h("div", { className: "name" }, nameOf(c)))));
		return h("div", { className: "rows" },
			groups.length ? h("div", { className: "section" }, "群聊") : null, groups.map(row),
			h("div", { className: "section" }, "同事"), people.length ? people.map(row) : h("div", { className: "empty" }, "还没有同事"));
	}

	// One message's content: the bubble's part, the quote it answers (shown under it), whether it is only a picture
	// or a file (no bubble then).
	function renderContent(t, msg) {
		const c = contentOf(t, msg);
		if (typeof c === "string") return { body: c, quote: null, bare: false };
		let quoteNode = null;
		let only = null;
		let count = 0;
		const out = Drafty.format(c, (style, data, values, key, stack) => {
			const inQuote = stack && stack.includes("QQ");
			if (inQuote) {
				switch (style) {
				case "BR": return "";
				case "MN": return [values, "："];
				case "IM": return "[图片]";
				case "EX": return "[文件] " + ((data && data.name) || "");
				default: return values;
				}
			}
			if (!style) return values;
			switch (style) {
			case "QQ": quoteNode = values; return null;
			case "ST": return h("strong", { key }, values);
			case "EM": return h("em", { key }, values);
			case "DL": return h("del", { key }, values);
			case "CO": return h("code", { key }, values);
			case "BR": return h("br", { key });
			case "HL": return h("mark", { key }, values);
			case "LN": { const u = safeUrl(data && data.url); return u ? h("a", { key, href: u, target: "_blank", rel: "noopener noreferrer" }, values) : h("span", { key }, values); }
			case "MN": return h("span", { key, className: (values && String(values).startsWith("➦")) ? "fwd" : "mention" + (data && data.val === S.meId ? " me" : "") }, values);
			case "IM": count++; only = only || "IM"; return h(Picture, { key, data });
			case "EX": count++; only = only || "EX"; return h(FileCard, { key, data });
			case "AU": return h("span", { key }, "[语音]");
			case "VC": return h("span", { key }, "[通话]");
			case "VD": return h("span", { key }, "[视频]");
			case "HD": return null;
			default: return h("span", { key }, values);
			}
		});
		// Only one picture or one file and no words: no bubble around it.
		const rest = plain(c).replace(/^\[图片\]$/, "").replace(/^\[文件\] .*$/, "").trim();
		return { body: out, quote: quoteNode, bare: count === 1 && !rest && !quoteNode && (only === "IM" || only === "EX") };
	}

	function Picture(props) {
		const d = props.data || {};
		const w = d.width | 0;
		const ht = d.height | 0;
		const k = w && ht ? Math.min(1, 240 / Math.max(w, ht)) : 1;
		const style = w && ht ? { width: Math.round(w * k) + "px", height: Math.round(ht * k) + "px" } : null;
		const src = mediaUrl(d);
		return h("img", { className: "img", src, alt: d.name || "图片", style, onClick: () => { S.viewer = { src, name: d.name || "图片.png" }; bump(); } });
	}
	function FileCard(props) {
		const d = props.data || {};
		const [cls, label] = ftype(d.name, d.mime);
		const busy = d._processing;
		const href = d.ref && typeof d.ref === "string" ? client.authorizeURL(d.ref) + "&asatt=1" : mediaUrl(d);
		return h("a", { className: "file", href: busy ? undefined : href, download: d.name || "文件", title: busy ? "正在上传…" : "下载" },
			h("div", { className: "ftype " + cls }, label),
			h("div", { className: "fn" }, h("div", null, d.name || "文件"), h("div", null, busy ? "正在上传…" : size(d.size))));
	}

	function Messages(props) {
		const t = props.topic;
		const box = useRef(null);
		const stick = useRef(true);
		const before = useRef(0);
		useBump();
		const items = allMessages(t).filter((m) => !(m._deleted && isHidden(t.name, m.low)));
		const total = Math.max(0, (S.members[t.name] || []).length - 1);
		useLayoutEffect(() => {
			const el = box.current;
			if (!el) return;
			if (before.current) {
				el.scrollTop = el.scrollHeight - before.current;
				before.current = 0;
			} else if (stick.current) {
				el.scrollTop = el.scrollHeight;
			}
		});
		useEffect(() => { stick.current = true; }, [t.name]);
		const onScroll = (e) => {
			const el = e.currentTarget;
			stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
			if (el.scrollTop < 40 && t.minMsgSeq() > 1 && !t._tdhLoading && !t._tdhNoMore) loadEarlier();
		};
		const loadEarlier = () => {
			const el = box.current;
			before.current = el ? el.scrollHeight - el.scrollTop : 0;
			earlier(t);
		};
		const nodes = [];
		let last = 0;
		if (t.minMsgSeq() > 1 && !t._tdhNoMore) nodes.push(h("button", { key: "more", className: "more", onClick: loadEarlier }, "查看更早的消息"));
		items.forEach((msg, i) => {
			if (msg._deleted) {
				const mine = S.recalled[t.name + ":" + msg.low];
				if (mine != null) {
					nodes.push(h("div", { key: "d" + msg.low, className: "note" }, ["你撤回了一条消息", h("a", { key: "e", onClick: () => { S.drafts[t.name] = mine; bump(); focusInput(); } }, "重新编辑")]));
					return;
				}
				// Deletions side by side are one line ("撤回了 3 条消息"), not a column of them.
				const prev = items[i - 1];
				if (prev && prev._deleted && S.recalled[t.name + ":" + prev.low] == null) return;
				let n = 0;
				for (let j = i; j < items.length && items[j]._deleted && S.recalled[t.name + ":" + items[j].low] == null; j++) n += Math.max(1, (items[j].hi || items[j].low + 1) - items[j].low);
				nodes.push(h("div", { key: "d" + msg.low, className: "note" }, n > 1 ? "撤回了 " + n + " 条消息" : "撤回了一条消息"));
				return;
			}
			if (msg.head && msg.head.webrtc) {
				nodes.push(h("div", { key: "c" + msg.seq, className: "note" }, "语音通话"));
				return;
			}
			const ts = msg.ts ? new Date(msg.ts).getTime() : Date.now();
			if (ts - last > 5 * 60 * 1000) nodes.push(h("div", { key: "w" + msg.seq + "-" + i, className: "when" }, chatTime(ts)));
			last = ts;
			const okOf = aiOkOf(msg);
			if (okOf) {
				const target = items.find((x) => x.seq === (okOf.of | 0));
				const counted = target ? aiConfirmation(items, target) : null;
				if (!counted || counted.seq !== msg.seq) return; // an answer that does not count leaves no note
				const tw = aiWords(aiOf(target));
				nodes.push(h("div", { key: "k" + msg.seq, className: "note" }, userName(msg.from, t) + (okOf.ok !== false ? tw.noteYes : tw.noteNo)));
				return;
			}
			const ai = aiOf(msg);
			if (ai) {
				const conf = aiConfirmation(items, msg);
				const w = aiWords(ai);
				const who = w.no ? aiDeciders(ai) : [];
				const names = who.map((u) => userName(u, t)).join(" 或 ");
				let foot = null;
				if (conf) {
					const by = userName(conf.by, t);
					const said = conf.ok ? (w.doneYes ? w.doneYes(by) : "") : w.doneNo ? w.doneNo(by) : "";
					foot = said ? h("div", { className: "ai-foot " + (conf.ok ? "ok" : "bad") }, said) : null;
				} else if (who.includes(S.meId)) foot = h("div", { className: "ai-foot" },
					w.yes ? h("button", { className: "ai-ok", onClick: () => confirmAi(t, msg, true) }, w.yes) : null,
					h("button", { className: w.yes ? "ai-bad" : "ai-bad only", onClick: () => confirmAi(t, msg, false) }, w.no));
				else if (who.length && w.wait) foot = h("div", { className: "ai-foot" }, "等 " + names + w.wait);
				nodes.push(h("div", { key: "m" + msg.seq, className: "m ai", onContextMenu: (e) => openMenu(e, [{ label: "复制", run: () => copy(aiText(t, msg)) }]) },
					h("div", { className: "a s36 ai-av" }, "TDH"),
					h("div", { className: "col" },
						h("div", { className: "who" }, w.label),
						h("div", { className: "b" }, aiText(t, msg)),
						foot)));
				return;
			}
			const mine = msg.from === S.meId || !msg.from;
			const card = cardOf(msg);
			const r = card ? { body: cardBody(card), bare: true } : renderContent(t, msg);
			let status = null;
			// The state under the last of one's own messages in a row (and any that is still on its way or failed).
			const next = items[i + 1];
			const lastOfRun = !next || next._deleted || !(next.from === S.meId || !next.from);
			if (mine && (lastOfRun || msg._sending || msg._failed)) {
				if (msg._sending) status = h("div", { className: "status" }, "发送中…");
				else if (msg._failed) status = h("div", { className: "status fail", onClick: () => retry(t, msg) }, "发送失败，点此重发");
				else if (msg.seq < 0xFFFFFFF) {
					const n = t.msgReadCount(msg.seq);
					status = h("div", { className: "status" }, t.isGroupType() ? (n > 0 && total > 0 && n >= total ? "全部已读" : n > 0 ? n + " 人已读" : "未读") : (n > 0 ? "已读" : "未读"));
				}
			}
			const items2 = [
				{ label: "复制", run: () => copy(plain(contentOf(t, msg))) },
				{ label: "引用", run: () => quote(t, msg) },
				{ label: "转发", run: () => { S.dialog = { kind: "forward", from: t.name, seq: msg.seq }; bump(); } },
			];
			if (mine && !msg._sending && Date.now() - ts < RECALL_MS) items2.push({ label: "撤回", run: () => recall(t, msg) });
			items2.push({ label: "删除", danger: true, run: () => removeForMe(t, msg) });
			nodes.push(h("div", { key: "m" + msg.seq, className: "m" + (mine ? " me" : ""), onContextMenu: (e) => openMenu(e, items2) },
				h(Avatar, { uid: mine ? S.meId : msg.from, name: userName(msg.from, t), pub: mine ? client.getMeTopic().public : (client.getTopic(msg.from) || {}).public, size: "s36" }),
				h("div", { className: "col" },
					t.isGroupType() && !mine ? h("div", { className: "who" }, userName(msg.from, t)) : null,
					h("div", { className: "b" + (r.bare ? " bare" : "") + (msg._failed ? " failed" : "") }, r.body),
					r.quote ? h("div", { className: "quote" }, r.quote) : null,
					status)));
		});
		return h("div", { className: "msgs", ref: box, onScroll }, h("div", { className: "stack" }, nodes));
	}

	const EMOJI = "😀 😃 😄 😁 😆 😅 😂 🤣 😊 🙂 😉 😍 😘 😋 😜 🤗 🤔 😐 😑 😶 🙄 😏 😮 😲 😳 😢 😭 😤 😡 🤯 😴 🥱 😷 🤝 👍 👎 👏 🙏 💪 👌 ✌️ 🤞 👋 ✅ ❌ ❗ ❓ 💯 🔥 🎉 🎁 ☕ 🍵 🍺 🌹 💐 ❤️ 💔 ⭐ 🌞 🌙 ⚡ 📌 📎 📷 📄 📦 🚚 💰 ⏰ 🗓️ 🏭 🔧 ⚙️ 📈 📉".split(" ");

	function Composer(props) {
		const t = props.topic;
		const ta = useRef(null);
		const files = useRef(null);
		const images = useRef(null);
		const [panel, setPanel] = useState(null);
		const [drop, setDrop] = useState(false);
		const text = S.drafts[t.name] || "";
		const keyAt = useRef(0);
		const [at, setAt] = useState(null); // { start, q, i }: an @ being typed in a group, and the row picked
		const atRow = useRef(null);
		useEffect(() => { focusInput = () => { if (ta.current) ta.current.focus(); }; });
		useEffect(() => { setAt(null); if (ta.current) ta.current.focus(); }, [t.name]);
		useEffect(() => { if (atRow.current) atRow.current.scrollIntoView({ block: "nearest" }); }, [at && at.i]);
		// company-chat-ime-v1: the box is drawn with its new text within the same event. React puts a controlled box
		// back to the text it last drew when the event is over; the store's redraw comes a frame later, so while a
		// Chinese input method composed, the box was put back on every key, the input method broke and the pinyin
		// letters stayed in the text ("ddada zda zi打字", twice; scripts/prove-chat-composer.js).
		const [, redraw] = useState(0);
		const set = (v) => {
			S.drafts[t.name] = v;
			redraw((n) => n + 1);
			bump();
			if (Date.now() - keyAt.current > 3000 && t.isSubscribed()) { keyAt.current = Date.now(); try { t.noteKeyPress(); } catch (e) { /* not now */ } }
		};
		const pend = S.pending[t.name] || [];
		// company-chat-at-v1: "@" (or "＠") then a part of a name, right before the caret, in a group.
		const findAt = (v, caret) => {
			if (!t.isGroupType()) return null;
			const before = v.slice(0, caret);
			const p = Math.max(before.lastIndexOf("@"), before.lastIndexOf("＠"));
			if (p < 0) return null;
			const q = before.slice(p + 1);
			return q.length > 16 || /[\s@＠]/.test(q) ? null : { start: p, q, i: 0 };
		};
		const people = at ? (S.members[t.name] || []).filter((u) => u !== S.meId).map((u) => ({ uid: u, name: userName(u, t) }))
			.filter((p) => !at.q || p.name.toLowerCase().includes(at.q.toLowerCase()))
			.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN")) : [];
		const atI = at ? Math.min(at.i, Math.max(people.length - 1, 0)) : 0;
		const caretTo = (pos) => requestAnimationFrame(() => { if (ta.current) { ta.current.focus(); ta.current.setSelectionRange(pos, pos); } });
		const choose = (p) => {
			const caret = ta.current ? ta.current.selectionStart : text.length;
			const label = "@" + p.name;
			S.ats[t.name] = (S.ats[t.name] || []).concat([{ uid: p.uid, label }]);
			setAt(null);
			set(text.slice(0, at.start) + label + " " + text.slice(caret));
			caretTo(at.start + label.length + 1);
		};
		// Backspace right after a picked @name takes the whole of it away (as WeChat's), and the mention with it.
		const unpick = (el) => {
			if (el.selectionStart !== el.selectionEnd) return false;
			const before = text.slice(0, el.selectionStart);
			const picks = S.ats[t.name] || [];
			for (let k = picks.length - 1; k >= 0; k--) {
				const chunk = before.endsWith(picks[k].label + " ") ? picks[k].label + " " : before.endsWith(picks[k].label) ? picks[k].label : "";
				if (!chunk) continue;
				picks.splice(k, 1);
				const pos = before.length - chunk.length;
				set(text.slice(0, pos) + text.slice(before.length));
				caretTo(pos);
				return true;
			}
			return false;
		};
		const send = () => {
			if (!text.trim() && !pend.length) return;
			sendPending(t.name);
			if (text.trim()) sendText(text);
			S.drafts[t.name] = "";
			bump();
		};
		const onKey = (e) => {
			const composing = e.isComposing || e.keyCode === 229;
			if (at && people.length && !composing) {
				if (e.key === "ArrowDown" || e.key === "ArrowUp") {
					e.preventDefault();
					setAt(Object.assign({}, at, { i: (atI + (e.key === "ArrowDown" ? 1 : people.length - 1)) % people.length }));
					return;
				}
				if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(people[atI]); return; }
			}
			if (at && e.key === "Escape") { e.preventDefault(); setAt(null); return; }
			if (e.key === "Backspace" && !composing && unpick(e.target)) { e.preventDefault(); return; }
			if (e.key === "Enter" && !e.shiftKey && !composing) { e.preventDefault(); send(); }
		};
		const onPaste = (e) => {
			const list = e.clipboardData && e.clipboardData.files;
			if (list && list.length) { e.preventDefault(); addPending(t.name, list); }
		};
		const dropProps = {
			onDragOver: (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) { e.preventDefault(); setDrop(true); } },
			onDragLeave: () => setDrop(false),
			onDrop: (e) => { e.preventDefault(); setDrop(false); addPending(t.name, e.dataTransfer.files); },
		};
		return h("div", Object.assign({ className: "composer" + (drop ? " drop" : "") + (pend.length ? " has-pend" : "") }, dropProps),
			panel === "emoji" ? h("div", { className: "emoji", onMouseLeave: () => setPanel(null) }, EMOJI.map((em) => h("button", { key: em, onClick: () => { set(text + em); setPanel(null); focusInput(); } }, em))) : null,
			panel === "cut" ? h("div", { className: "tip", onClick: () => setPanel(null) },
				"截图后粘贴进来：", h("br"),
				navigator.platform.indexOf("Mac") >= 0
					? [h("b", { key: "a" }, "Control + Shift + Command + 4"), " 截图，再按 ", h("b", { key: "b" }, "Command + V")]
					: [h("b", { key: "a" }, "Win + Shift + S"), " 截图，再按 ", h("b", { key: "b" }, "Ctrl + V")], h("br"),
				"（更新 TDH 后，点这个按钮就直接截图）") : null,
			at && people.length ? h("div", { className: "atpick" }, h("div", { className: "hd" }, "选择提醒的人"),
				people.map((p, i) => h("button", { key: p.uid, ref: i === atI ? atRow : null, className: i === atI ? "on" : "",
					onMouseDown: (e) => { e.preventDefault(); choose(p); }, onMouseEnter: () => { if (i !== atI) setAt(Object.assign({}, at, { i })); } },
				h(Avatar, { uid: p.uid, name: p.name, pub: (t.userDesc(p.uid) || {}).public, size: "s28" }), h("span", null, p.name)))) : null,
			h("div", { className: "tools" },
				h("button", { className: "icon-btn", title: "表情", onClick: () => setPanel(panel === "emoji" ? null : "emoji") }, ICON.smile()),
				h("button", { className: "icon-btn", title: "发送文件", onClick: () => files.current && files.current.click() }, ICON.folder()),
				h("button", { className: "icon-btn" + (S.shooting ? " busy" : ""), title: canShoot() ? (S.shooting ? "正在截图…" : "截图") : "截图",
					onClick: () => { if (canShoot()) { setPanel(null); shoot(t.name); } else setPanel(panel === "cut" ? null : "cut"); } }, ICON.cut()),
				h("button", { className: "icon-btn", title: "发送图片", onClick: () => images.current && images.current.click() }, ICON.image())),
			h("input", { ref: files, type: "file", multiple: true, hidden: true, onChange: (e) => { sendFiles(e.target.files); e.target.value = ""; } }),
			h("input", { ref: images, type: "file", accept: "image/*", multiple: true, hidden: true, onChange: (e) => { sendFiles(e.target.files); e.target.value = ""; } }),
			pend.length ? h("div", { className: "pending" }, pend.map((p, i) => h("div", { key: i, className: "pend" + (p.url ? "" : " file") },
				p.url ? h("img", { src: p.url, alt: p.file.name }) : h(React.Fragment, null, h("div", { className: "ftype " + ftype(p.file.name, p.file.type)[0] }, ftype(p.file.name, p.file.type)[1]), h("span", null, p.file.name)),
				h("button", { className: "x", title: "不发了", onClick: () => dropPending(t.name, i) }, ICON.close())))) : null,
			S.reply ? h("div", { className: "reply" }, h("span", null, "引用 " + S.reply.label), h("button", { className: "icon-btn", title: "不引用了", onClick: () => { S.reply = null; bump(); } }, ICON.close())) : null,
			h("textarea", { ref: ta, value: text, placeholder: t.isGroupType() ? "输入消息，@ 提醒群成员" : "输入消息", onKeyDown: onKey, onPaste,
				onChange: (e) => { set(e.target.value); setAt(findAt(e.target.value, e.target.selectionStart)); },
				onBlur: () => setAt(null) }),
			h("div", { className: "foot" },
				h("div", { className: "hint" }, "Enter 发送，Shift + Enter 换行"),
				h("button", { className: "send", disabled: !text.trim() && !pend.length, onClick: send }, "发送")));
	}

	function ChatPane(props) {
		if (!S.topic) return h("main", { className: "chat" + (props.narrow ? " away" : "") }, h("div", { className: "welcome" }, "选一个同事或群，开始聊天"));
		const t = client.getTopic(S.topic);
		const group = t.isGroupType();
		const count = (S.members[t.name] || []).length;
		const typing = (S.typing[t.name] || 0) > Date.now();
		return h("main", { className: "chat" },
			h("div", { className: "head" },
				h("button", { className: "icon-btn back", title: "返回", onClick: () => openTopic(null) }, ICON.back()),
				h("div", { className: "title" }, nameOf(t), group && count ? h("span", null, "（" + count + "）") : null, typing ? h("span", { className: "typing" }, "正在输入…") : null),
				h("button", { className: "icon-btn", title: group ? "群聊信息" : "聊天信息", onClick: () => { S.dialog = { kind: "info" }; bump(); } }, ICON.more())),
			S.status !== "ready" ? h("div", { className: "banner" }, S.status === "offline" ? "网络断了，正在重连…" : "正在连接…") : null,
			h(Messages, { topic: t }),
			h(Composer, { topic: t }));
	}

	// ---- Menus and dialogs. --------------------------------------------------------------------------------------
	function openMenu(e, items) {
		e.preventDefault();
		e.stopPropagation();
		const x = Math.min(e.clientX, window.innerWidth - 150);
		const y = Math.min(e.clientY, window.innerHeight - items.length * 34 - 12);
		S.menu = { x, y, items };
		bump();
	}
	function Menu() {
		if (!S.menu) return null;
		const close = () => { S.menu = null; bump(); };
		return h("div", { className: "veil", style: { background: "transparent" }, onClick: close, onContextMenu: (e) => { e.preventDefault(); close(); } },
			h("div", { className: "pop", style: { left: S.menu.x + "px", top: S.menu.y + "px" }, onClick: (e) => e.stopPropagation() },
				S.menu.items.map((it) => h("button", { key: it.label, className: it.danger ? "danger" : "", onClick: () => { close(); it.run(); } }, it.label))));
	}

	function PeoplePicker(props) {
		const [q, setQ] = useState("");
		const exclude = props.exclude || [];
		const people = contacts().filter((c) => (props.groups ? true : c.isP2PType()) && !exclude.includes(c.name) && nameOf(c).toLowerCase().includes(q.toLowerCase()))
			.sort((a, b) => nameOf(a).localeCompare(nameOf(b), "zh-Hans-CN"));
		return h(React.Fragment, null,
			h("input", { className: "field", placeholder: "搜索", value: q, onChange: (e) => setQ(e.target.value) }),
			h("div", { className: "pick" }, people.map((c) => h("label", { key: c.name },
				h("input", { type: "checkbox", checked: props.picked.includes(c.name), onChange: () => props.toggle(c.name) }),
				h(Avatar, { topic: c, size: "s28" }), h("span", null, nameOf(c))))));
	}
	function GroupDialog() {
		const [title, setTitle] = useState("");
		const [picked, setPicked] = useState([]);
		const toggle = (n) => setPicked(picked.includes(n) ? picked.filter((x) => x !== n) : picked.concat([n]));
		const close = () => { S.dialog = null; bump(); };
		const name = title.trim() || picked.slice(0, 3).map((n) => nameOf(client.getTopic(n))).join("、") + (picked.length > 3 ? "等" : "");
		return h("div", { className: "veil", onClick: close }, h("div", { className: "dialog", onClick: (e) => e.stopPropagation() },
			h("h3", null, "发起群聊"),
			h("input", { className: "field", placeholder: "群名称（可以不填）", value: title, onChange: (e) => setTitle(e.target.value) }),
			h(PeoplePicker, { picked, toggle }),
			h("div", { className: "acts" }, h("button", { className: "btn", onClick: close }, "取消"),
				h("button", { className: "btn primary", disabled: picked.length < 1, onClick: () => createGroup(name || "群聊", picked) }, picked.length ? "建群（" + picked.length + " 人）" : "建群"))));
	}
	function ForwardDialog() {
		const [picked, setPicked] = useState([]);
		const toggle = (n) => setPicked(picked.includes(n) ? picked.filter((x) => x !== n) : picked.concat([n]));
		const close = () => { S.dialog = null; bump(); };
		const from = client.getTopic(S.dialog.from);
		const msg = from.findMessage(S.dialog.seq);
		return h("div", { className: "veil", onClick: close }, h("div", { className: "dialog", onClick: (e) => e.stopPropagation() },
			h("h3", null, "转发给"),
			h(PeoplePicker, { picked, toggle, groups: true }),
			h("div", { className: "acts" }, h("button", { className: "btn", onClick: close }, "取消"),
				h("button", { className: "btn primary", disabled: !picked.length || !msg, onClick: () => { forwardTo(picked, from, msg); close(); } }, "发送"))));
	}
	function InviteDialog(props) {
		const t = props.topic;
		const [picked, setPicked] = useState([]);
		const toggle = (n) => setPicked(picked.includes(n) ? picked.filter((x) => x !== n) : picked.concat([n]));
		const back = () => { S.dialog = { kind: "info" }; bump(); };
		return h("div", { className: "veil", onClick: back }, h("div", { className: "dialog", onClick: (e) => e.stopPropagation() },
			h("h3", null, "添加成员"),
			h(PeoplePicker, { picked, toggle, exclude: S.members[t.name] || [] }),
			h("div", { className: "acts" }, h("button", { className: "btn", onClick: back }, "取消"),
				h("button", { className: "btn primary", disabled: !picked.length, onClick: () => { inviteMembers(t, picked); back(); } }, "邀请"))));
	}
	function InfoDialog() {
		const t = client.getTopic(S.topic);
		const [title, setTitle] = useState(nameOf(t));
		const close = () => { S.dialog = null; bump(); };
		const group = t.isGroupType();
		const owner = t.acs && t.acs.isOwner && t.acs.isOwner();
		const admin = t.acs && t.acs.isAdmin && t.acs.isAdmin();
		const pinned = rank(t) > 0;
		const quiet = muted(t);
		const members = S.members[t.name] || [];
		return h("div", { className: "veil", onClick: close }, h("div", { className: "dialog", onClick: (e) => e.stopPropagation() },
			h("h3", null, group ? "群聊信息" : "聊天信息"),
			h("div", { className: "info" },
				group ? h("div", { className: "members" }, members.map((u) => h("div", { key: u }, h(Avatar, { uid: u, name: userName(u, t), size: "s36" }), userName(u, t))),
					admin ? h("div", { key: "add", style: { cursor: "pointer" }, onClick: () => { S.dialog = { kind: "invite" }; bump(); } }, h("div", { className: "a s36", style: { background: "var(--field)", color: "var(--text-2)" } }, "+"), "添加") : null) : null,
				group && (owner || admin) ? h("div", { className: "line" }, h("span", null, "群名称"),
					h("input", { className: "field", style: { margin: 0, width: "60%" }, value: title, onChange: (e) => setTitle(e.target.value),
						onBlur: () => { if (title.trim() && title.trim() !== nameOf(t)) renameGroup(t, title.trim()); } })) : null,
				h("div", { className: "line", onClick: () => togglePin(t.name), style: { cursor: "pointer" } }, h("span", null, "置顶聊天"), h("i", { className: "switch" + (pinned ? " on" : "") })),
				h("div", { className: "line", onClick: () => toggleMute(t.name), style: { cursor: "pointer" } }, h("span", null, "消息免打扰"), h("i", { className: "switch" + (quiet ? " on" : "") }))),
			h("div", { className: "acts" },
				group && !owner ? h("button", { className: "btn danger", onClick: () => leaveGroup(t) }, "退出群聊") : null,
				h("button", { className: "btn", onClick: close }, "完成"))));
	}
	function Dialogs() {
		const d = S.dialog;
		if (!d) return null;
		if (d.kind === "group") return h(GroupDialog);
		if (d.kind === "forward") return h(ForwardDialog);
		if (d.kind === "info" && S.topic) return h(InfoDialog, { key: S.topic });
		if (d.kind === "invite" && S.topic) return h(InviteDialog, { topic: client.getTopic(S.topic) });
		return null;
	}
	function Viewer() {
		if (!S.viewer) return null;
		const v = S.viewer;
		return h("div", { className: "viewer", onClick: () => { S.viewer = null; bump(); } },
			h("img", { src: v.src, alt: v.name }),
			h("a", { className: "dl", href: v.src, download: v.name, onClick: (e) => e.stopPropagation() }, "保存图片"));
	}

	function useNarrow() {
		const [n, setN] = useState(window.innerWidth < 640);
		useEffect(() => {
			const f = () => setN(window.innerWidth < 640);
			window.addEventListener("resize", f);
			return () => window.removeEventListener("resize", f);
		}, []);
		return n;
	}

	function App() {
		useBump();
		const narrow = useNarrow();
		if (S.status === "noauth") return h("div", { className: "full-note" }, "聊天没登录上。", h("br"), "请从 TDH 窗口最右边的聊天栏，或左栏的「聊天」打开。");
		if (S.status === "error") return h("div", { className: "full-note" }, "聊天出错了：" + S.error, h("br"), h("button", { className: "btn", style: { marginTop: "12px" }, onClick: () => location.reload() }, "重新打开"));
		if (S.status === "connecting" && !S.meId) return h("div", { className: "full-note" }, "正在打开聊天…");
		return h("div", { className: "app" + (narrow ? " narrow" : "") },
			h(Rail),
			h("section", { className: "list" + (narrow && S.topic ? " away" : "") },
				h(Search),
				S.view === "contacts" ? h(Contacts) : h(ChatList)),
			h(ChatPane, { narrow }),
			h(Menu), h(Dialogs), h(Viewer),
			S.toast ? h("div", { className: "toast" }, S.toast) : null);
	}

	ReactDOM.createRoot(document.getElementById("root")).render(h(App));
	start();
	window.__tdhChat = { S, client, bump, open: openTopic,
		act: { sendText, sendFiles, recall, quote, createGroup, togglePin, toggleMute, forwardTo, leaveGroup },
		// company-chat-client-test-v1: the page's own logic, for scripts/prove-chat-client.js and prove-chat-composer.js (CI)
		fn: { atDraft, plain, mentionsMe, mentionedUnread, allMessages, contentOf, renderContent, safeUrl, listed, unread, Composer, Search, Messages, aiOf, aiConfirmation } }; // for checks in the desk's tests and a person's own debugging
})();
