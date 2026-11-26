package cn.tdharness.mobile

// company-android-chat-native-v1 (the user, 2026-11-26: the Android app as the iPhone's): the Chat tab drawn by the
// app, not by the chat's web page. Its data, as the iPhone's ChatStore (mobile/ios/TDH/ChatStore.swift): one
// WebSocket of this person's own to the company chat (Tinode, through the company server), logged in with
// basic "login:<gateway token>"; the list of chats (me's subscriptions), the open chat's messages, the people and their
// pictures; text, pictures, files and voice messages sent as this person; pins and deletions kept where the desks
// keep them.

import android.content.Context
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.TimeUnit

class ChatTopic(
    val topic: String, val name: String, val photo: ImageBitmap?, val group: Boolean,
    val seq: Int, val read: Int, val touched: Long, val preview: String = "",
) {
    val unread: Int get() = maxOf(0, seq - read)
    fun copy(name: String = this.name, photo: ImageBitmap? = this.photo, seq: Int = this.seq, read: Int = this.read,
             touched: Long = this.touched, preview: String = this.preview) = ChatTopic(topic, name, photo, group, seq, read, touched, preview)
}

enum class AttKind { Image, File, Audio }

class ChatAttachment(
    val kind: AttKind, val name: String, val mime: String, val size: Int, val inline: ByteArray?, val ref: String?,
    val width: Int, val height: Int, val duration: Int, val preview: ByteArray,
)

class TaskCard(val id: String, val event: String, val title: String, val to: String, val due: Long, val note: String)

class ChatMessage(
    val seq: Int, val from: String, val at: Long, val text: String, val attachments: List<ChatAttachment>,
    val pending: Boolean = false,
    var call: String? = null, var callMs: Int = 0, val replaces: Int? = null,
    val ai: Boolean = false, val aiKind: String = "", val aiDeciders: List<String> = emptyList(),
    val aiOkOf: Int? = null, val aiOk: Boolean = true, val card: TaskCard? = null,
)

class ChatPerson(val name: String, val photo: ImageBitmap?)

object Chat {
    var topics by mutableStateOf<List<ChatTopic>>(emptyList())
    val messages = mutableStateMapOf<String, List<ChatMessage>>()
    val people = mutableStateMapOf<String, ChatPerson>()
    var connected by mutableStateOf(false)
    var loaded by mutableStateOf(false)
    var problem by mutableStateOf("")
    var me by mutableStateOf("")
    var pinned by mutableStateOf<List<String>>(emptyList())
    var hidden by mutableStateOf<Map<String, Int>>(emptyMap())
    /** This person's own chat card (me's public), as it last came. */
    private var myPub: JSONObject? = null
    /** company-chat-avatar-v1: the card has no picture; the app asks for one before anything else (as the iPhone). */
    var needsAvatar by mutableStateOf(false)
    /** The chat on screen: its messages count as read as they come. */
    @Volatile var open = ""

    private lateinit var prefs: android.content.SharedPreferences
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var login = ""
    private var gwToken = ""
    private var apiKey = ""
    private var authToken = ""
    private var running = false
    private var nextId = 100
    private val waiting = HashMap<String, CompletableDeferred<JSONObject?>>()
    private val attached = HashSet<String>()
    private val older = HashMap<String, Boolean>()
    private val photoRefs = HashSet<String>()
    private val callLater = HashMap<String, HashMap<Int, Pair<String, Int>>>()
    private var socket: WebSocket? = null
    private var closed: CompletableDeferred<Unit>? = null
    private var loopJob: Job? = null

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .sslSocketFactory(Site.ssl.socketFactory, Site.trust)
            .hostnameVerifier(Site.names)
            .pingInterval(25, TimeUnit.SECONDS)
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .build()
    }

    fun init(ctx: Context) { prefs = ctx.getSharedPreferences("chat", Context.MODE_PRIVATE) }

    private fun dbg(s: String) { if (BuildConfig.DEBUG) android.util.Log.d("TDHChat", s) }

    fun start(login: String, gwToken: String) {
        if (running && this.login == login) return
        this.login = login
        this.gwToken = gwToken
        running = true
        loopJob = scope.launch { connectLoop() }
    }

    fun stop() {
        running = false
        connected = false
        socket?.close(1001, null)
        socket = null
        waiting.values.forEach { it.complete(null) }
        waiting.clear()
        topics = emptyList(); messages.clear(); people.clear(); attached.clear(); loaded = false; me = ""
        loopJob?.cancel()
    }

    // ---- the connection ----------------------------------------------------------------------------------------------

    private suspend fun connectLoop() {
        var wait = 1L
        while (running) {
            if (connect()) {
                wait = 1
                closed?.await()
            } else Net.forget()
            connected = false
            socket?.cancel(); socket = null
            attached.clear()
            waiting.values.forEach { it.complete(null) }
            waiting.clear()
            loading.keys.toList().forEach { finishLoad(it) }
            if (!running) break
            delay(wait * 1000)
            wait = minOf(wait * 2, 20)
        }
    }

    private suspend fun connect(): Boolean {
        val root = Net.base ?: Net.findServer() ?: run { problem = "聊天服务器没连上"; return false }
        if (apiKey.isEmpty()) {
            val js = rawGet("$root/chat/tdh/config.js") ?: run { problem = "聊天服务器没连上"; dbg("no config.js at $root"); return false }
            apiKey = Regex("AQ[A-Za-z0-9_-]{30}").find(String(js))?.value ?: run { problem = "聊天服务器没连上"; return false }
        }
        val url = root.replaceFirst("https://", "wss://") + "/v0/channels?apikey=" + enc(apiKey)
        val done = CompletableDeferred<Unit>()
        closed = done
        val opened = CompletableDeferred<Boolean>()
        val ws = client.newWebSocket(Request.Builder().url(url).header("User-Agent", "TDH-Android/1.0").build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) { opened.complete(true) }
            override fun onMessage(webSocket: WebSocket, text: String) { scope.launch { lines(text).forEach { take(it) } } }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(1000, null) }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { opened.complete(false); done.complete(Unit) }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Diag.say("chat", "socket: ${t.javaClass.simpleName} ${t.message}")
                opened.complete(false); done.complete(Unit)
            }
        })
        socket = ws
        if (withTimeoutOrNull(10_000) { opened.await() } != true) { ws.cancel(); problem = "聊天服务器没连上"; dbg("socket did not open $url"); return false }
        dbg("socket open")
        val hi = request(JSONObject().put("hi", JSONObject().put("ver", "0.25").put("ua", "TDH-Android/1.0")))
        if (hi == null || code(hi) >= 300) { ws.cancel(); return false }
        val secret = Base64.encodeToString("$login:$gwToken".toByteArray(), Base64.NO_WRAP)
        val lg = request(JSONObject().put("login", JSONObject().put("scheme", "basic").put("secret", secret)))
        dbg("hi ${hi.optInt("code")}")
        if (lg == null || code(lg) >= 300) { problem = "聊天登录没成功"; dbg("login ${lg?.optInt("code")} ${lg?.optString("text")}"); ws.cancel(); return false }
        val p = lg.optJSONObject("params") ?: JSONObject()
        authToken = p.optString("token")
        me = p.optString("user")
        hidden = runCatching { JSONObject(prefs.getString("hidden.$me", "{}") ?: "{}") }.getOrDefault(JSONObject())
            .let { o -> o.keys().asSequence().associateWith { o.optInt(it) } }
        connected = true
        problem = ""
        subscribeMe()
        dbg("me=$me topics=${topics.size}")
        return true
    }

    /** The app is in front again: a socket that died while away is replaced at once. */
    fun check() { if (running && socket != null) socket?.send(JSONObject().put("note", JSONObject().put("topic", "me").put("what", "kp")).toString()) }

    private fun send(msg: JSONObject) { socket?.send(msg.toString()) }

    /** One message with an id; its {ctrl} answer (or the {meta} of a get), null after 20 s. */
    private suspend fun request(msg: JSONObject): JSONObject? {
        nextId += 1
        val id = nextId.toString()
        val kinds = listOf("pub", "sub", "get", "set", "del", "leave", "login", "hi", "note", "acc")
        val k = kinds.firstOrNull { msg.has(it) } ?: msg.keys().asSequence().firstOrNull() ?: return null
        msg.optJSONObject(k)?.put("id", id)
        val d = CompletableDeferred<JSONObject?>()
        waiting[id] = d
        send(msg)
        val r = withTimeoutOrNull(20_000) { d.await() }
        waiting.remove(id)
        return r
    }

    private fun answer(id: String?, v: JSONObject) { if (id != null) waiting.remove(id)?.complete(v) }
    private fun code(c: JSONObject) = c.optInt("code", 500)

    // ---- a chat's messages, whole (company-phone-chat-load-v1) -------------------------------------------------------

    private val loading = HashMap<String, MutableList<JSONObject>>()
    private val loadWait = HashMap<String, MutableList<CompletableDeferred<Unit>>>()

    private fun beginLoad(t: String) { if (loading[t] == null) loading[t] = mutableListOf() }
    private fun finishLoad(t: String) {
        val rows = loading.remove(t) ?: return
        rows.forEach { takeData(it) }
        loadWait.remove(t)?.forEach { it.complete(Unit) }
    }
    private suspend fun loaded(t: String) {
        if (loading[t] == null) return
        val d = CompletableDeferred<Unit>()
        loadWait.getOrPut(t) { mutableListOf() }.add(d)
        scope.launch { delay(4000); finishLoad(t) }
        d.await()
    }

    // ---- what comes in ---------------------------------------------------------------------------------------------------

    private fun take(m: JSONObject) {
        m.optJSONObject("ctrl")?.let { c ->
            val p = c.optJSONObject("params")
            if (p?.optString("what") == "data") c.optString("topic").takeIf { it.isNotEmpty() }?.let { finishLoad(it) }
            answer(c.optString("id").ifEmpty { null }, c)
            return
        }
        m.optJSONObject("meta")?.let { takeMeta(it); answer(it.optString("id").ifEmpty { null }, it); return }
        m.optJSONObject("data")?.let { takeData(it); return }
        m.optJSONObject("pres")?.let { takePres(it) }
    }

    private fun takeMeta(meta: JSONObject) {
        val topic = meta.optString("topic")
        if (topic == "me") {
            meta.optJSONObject("desc")?.let { desc ->
                desc.optJSONObject("public")?.let { pub -> myPub = pub; people[me] = ChatPerson(pub.optString("fn", "我"), photo(pub, me)) }
                desc.optJSONObject("private")?.let { priv ->
                    pinned = priv.optJSONArray("tpin")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()
                    topics = sorted(topics)
                }
            }
            meta.optJSONArray("sub")?.let { subs ->
                val list = topics.toMutableList()
                for (i in 0 until subs.length()) {
                    val s = subs.getJSONObject(i)
                    val t = s.optString("topic")
                    if (!(t.startsWith("usr") || t.startsWith("grp"))) continue
                    if (s.has("deleted")) { list.removeAll { it.topic == t }; continue }
                    val pub = s.optJSONObject("public") ?: JSONObject()
                    val name = s.optJSONObject("private")?.optString("comment")?.takeIf { it.isNotEmpty() } ?: pub.optString("fn", "未命名")
                    val prev = list.firstOrNull { it.topic == t }
                    val row = ChatTopic(t, name, photo(pub, t) ?: prev?.photo, t.startsWith("grp"), s.optInt("seq"), s.optInt("read"),
                        date(s.optString("touched")).takeIf { it > 0 } ?: date(s.optString("updated")), prev?.preview ?: "")
                    if (t.startsWith("usr")) people[t] = ChatPerson(row.name, row.photo)
                    val at = list.indexOfFirst { it.topic == t }
                    if (at >= 0) list[at] = row else list.add(row)
                }
                topics = sorted(list)
                loaded = true
            }
        } else meta.optJSONArray("sub")?.let { subs ->
            for (i in 0 until subs.length()) {
                val s = subs.getJSONObject(i)
                val u = s.optString("user")
                if (u.isEmpty()) continue
                val pub = s.optJSONObject("public") ?: JSONObject()
                val old = people[u]
                people[u] = ChatPerson(pub.optString("fn").ifEmpty { old?.name ?: "同事" }, photo(pub, u) ?: old?.photo)
            }
        }
    }

    private fun takeData(d: JSONObject) {
        val topic = d.optString("topic")
        val seq = d.optInt("seq", -1)
        if (topic.isEmpty() || seq < 0) return
        loading[topic]?.let { it.add(d); return }
        val msg = message(d)
        val list = (messages[topic] ?: emptyList()).toMutableList()
        if (msg.replaces == null) callLater[topic]?.remove(seq)?.let { (st, ms) -> msg.call = st; msg.callMs = maxOf(msg.callMs, ms) }
        msg.replaces?.let { target ->
            val i = list.indexOfFirst { it.seq == target }
            if (i >= 0) {
                val m = list[i]
                if (msg.call != null) { m.call = msg.call; m.callMs = maxOf(m.callMs, msg.callMs) }
                messages[topic] = list.toList()
            } else msg.call?.let { st ->
                val old = callLater[topic]?.get(target)
                if (old == null || msg.callMs >= old.second) callLater.getOrPut(topic) { HashMap() }[target] = st to msg.callMs
            }
            topics = topics.map { if (it.topic == topic) it.copy(seq = maxOf(it.seq, seq), read = if (msg.from == me || topic == open) maxOf(it.read, seq) else it.read) else it }
            return
        }
        val i = list.indexOfFirst { it.seq == seq }
        if (i >= 0) list[i] = msg else {
            if (msg.from == me) list.indexOfFirst { it.pending && it.text == msg.text }.takeIf { it >= 0 }?.let { list.removeAt(it) }
            val at = list.indexOfFirst { !it.pending && it.seq > seq }.takeIf { it >= 0 } ?: list.indexOfFirst { it.pending }.takeIf { it >= 0 } ?: list.size
            list.add(at, msg)
        }
        messages[topic] = list
        topics = sorted(topics.map { t ->
            if (t.topic != topic) t else t.copy(
                preview = if (seq >= t.seq || t.preview.isEmpty()) preview(msg, t.group, people[msg.from]?.name, msg.from == me) else t.preview,
                seq = maxOf(t.seq, seq), read = if (msg.from == me || topic == open) maxOf(t.read, seq) else t.read,
                touched = if (seq >= t.seq) maxOf(t.touched, msg.at) else t.touched,
            )
        })
        if (topic == open && msg.from != me) scope.launch { markRead(topic, seq) }
    }

    private fun takePres(p: JSONObject) {
        if (p.optString("topic") != "me") return
        val src = p.optString("src")
        when (p.optString("what")) {
            "msg" -> {
                val seq = p.optInt("seq", -1)
                if (seq >= 0 && topics.any { it.topic == src }) {
                    topics = sorted(topics.map { if (it.topic == src) it.copy(seq = maxOf(it.seq, seq), touched = System.currentTimeMillis()) else it })
                    if (src !in attached) scope.launch { attach(src, 1) }
                } else scope.launch { refreshMe() }
            }
            "read" -> {
                val seq = p.optInt("seq", -1)
                topics = topics.map { if (it.topic == src && seq > it.read) it.copy(read = seq) else it }
            }
            "acs", "upd" -> scope.launch { refreshMe() }
        }
    }

    private fun sorted(l: List<ChatTopic>): List<ChatTopic> = l.sortedWith(compareBy<ChatTopic> { pinned.indexOf(it.topic).let { i -> if (i < 0) Int.MAX_VALUE else i } }
        .thenByDescending { it.touched })

    /** Whether a chat shows in the list: pinned ones always; others once they have a message newer than a deletion. */
    fun shows(t: ChatTopic): Boolean = t.topic in pinned || (t.seq > 0 && t.seq > (hidden[t.topic] ?: 0))

    suspend fun togglePin(topic: String): Boolean {
        val old = pinned
        val list = pinned.filter { it != topic }.toMutableList()
        if (topic !in old) list.add(0, topic)
        pinned = list; topics = sorted(topics)
        val tpin: Any = if (list.isEmpty()) "␡" else JSONArray(list)
        val r = request(JSONObject().put("set", JSONObject().put("topic", "me").put("desc", JSONObject().put("private", JSONObject().put("tpin", tpin)))))
        if (r == null || code(r) >= 300) { pinned = old; topics = sorted(topics); return false }
        return true
    }

    /** 删除 a chat on this person's side: its messages deleted for them, the chat out of the list until someone writes. */
    suspend fun deleteChat(topic: String): Boolean {
        val t = topics.firstOrNull { it.topic == topic } ?: return false
        if (t.seq > 0) {
            attach(topic, 1)
            val r = request(JSONObject().put("del", JSONObject().put("topic", topic).put("what", "msg")
                .put("delseq", JSONArray().put(JSONObject().put("low", 1).put("hi", t.seq + 1))).put("hard", false)))
            if (r == null || code(r) >= 300) return false
            markRead(topic, t.seq)
        }
        hidden = hidden + (topic to t.seq)
        messages[topic] = emptyList()
        topics = topics.map { if (it.topic == topic) it.copy(preview = "", read = t.seq) else it }
        prefs.edit().putString("hidden.$me", JSONObject(hidden as Map<*, *>).toString()).apply()
        if (topic in pinned) togglePin(topic)
        return true
    }

    // ---- asking ---------------------------------------------------------------------------------------------------------

    private suspend fun subscribeMe() {
        request(JSONObject().put("sub", JSONObject().put("topic", "me").put("get", JSONObject().put("what", "desc sub"))))
        if (topics.isEmpty()) request(JSONObject().put("get", JSONObject().put("topic", "me").put("what", "sub")))
        for (t in topics.take(24)) attach(t.topic, 1)
        if (open.isNotEmpty()) attach(open, 40)
        loaded = true
    }

    private suspend fun refreshMe() { request(JSONObject().put("get", JSONObject().put("topic", "me").put("what", "sub"))) }

    private suspend fun attach(topic: String, limit: Int) {
        if (limit > 1) beginLoad(topic)
        if (topic in attached) {
            if (limit > 1) {
                val r = request(JSONObject().put("get", JSONObject().put("topic", topic).put("what", "data sub").put("data", JSONObject().put("limit", limit)).put("sub", JSONObject())))
                if (r == null) finishLoad(topic) else loaded(topic)
            }
            return
        }
        val r = request(JSONObject().put("sub", JSONObject().put("topic", topic)
            .put("get", JSONObject().put("what", if (limit > 1) "data sub" else "data").put("data", JSONObject().put("limit", limit)))))
        if (r != null && code(r) < 300) attached.add(topic)
        if (limit > 1) { if (r == null || code(r) >= 300) finishLoad(topic) else loaded(topic) }
    }

    /** Opening a chat: its last messages and its people; then everything in it counts as read. */
    suspend fun enter(topic: String) {
        open = topic
        attach(topic, 40)
        topics.firstOrNull { it.topic == topic }?.let { if (it.seq > 0) markRead(topic, it.seq) }
    }

    fun leave(topic: String) { if (open == topic) open = "" }

    /** Older messages, 30 at a time; false when there are none left. */
    suspend fun loadOlder(topic: String): Boolean {
        if (older[topic] == false) return false
        val first = messages[topic]?.firstOrNull { !it.pending }?.seq ?: 0
        if (first <= 1) { older[topic] = false; return false }
        val before = messages[topic]?.size ?: 0
        beginLoad(topic)
        request(JSONObject().put("get", JSONObject().put("topic", topic).put("what", "data").put("data", JSONObject().put("before", first).put("limit", 30))))
        finishLoad(topic)
        val more = (messages[topic]?.size ?: 0) > before
        older[topic] = more
        return more
    }

    private fun markRead(topic: String, seq: Int) {
        topics = topics.map { if (it.topic == topic) it.copy(read = maxOf(it.read, seq)) else it }
        send(JSONObject().put("note", JSONObject().put("topic", topic).put("what", "read").put("seq", seq)))
    }

    // ---- sending --------------------------------------------------------------------------------------------------------

    suspend fun sendText(topic: String, text: String): Boolean {
        val t = text.trim()
        if (t.isEmpty()) return true
        messages[topic] = (messages[topic] ?: emptyList()) + ChatMessage(Int.MAX_VALUE - (messages[topic]?.size ?: 0), me, System.currentTimeMillis(), t, emptyList(), pending = true)
        attach(topic, 1)
        val r = request(JSONObject().put("pub", JSONObject().put("topic", topic).put("noecho", false).put("content", t)))
        if (r == null || code(r) >= 300) { messages[topic] = (messages[topic] ?: emptyList()).filterNot { it.pending && it.text == t }; return false }
        return true
    }

    /** A picture or a file into the chat, as this person: up to the chat's file store, then a message pointing at it. */
    suspend fun sendFile(topic: String, name: String, mime: String, data: ByteArray): Boolean {
        val ref = upload(name, mime, data) ?: return false
        attach(topic, 1)
        val ent = JSONObject().put("mime", mime).put("name", name).put("ref", ref).put("size", data.size)
        var tp = "EX"
        if (mime.startsWith("image/")) {
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(data, 0, data.size, o)
            if (o.outWidth > 0) {
                tp = "IM"
                ent.put("width", o.outWidth).put("height", o.outHeight)
                thumb(data)?.let { ent.put("val", Base64.encodeToString(it, Base64.NO_WRAP)) }
            }
        }
        val content = JSONObject().put("txt", " ").put("fmt", JSONArray().put(JSONObject().put("at", -1).put("len", 0).put("key", 0)))
            .put("ent", JSONArray().put(JSONObject().put("tp", tp).put("data", ent)))
        val r = request(JSONObject().put("pub", JSONObject().put("topic", topic).put("noecho", false).put("head", JSONObject().put("mime", "text/x-drafty")).put("content", content))
            .put("extra", JSONObject().put("attachments", JSONArray().put(ref))))
        return r != null && code(r) < 300
    }

    /** A voice message: the WAV up to the chat's file store, then a message with its audio entity (the server writes its words). */
    suspend fun sendVoice(topic: String, wav: ByteArray, ms: Int, preview: String): Boolean {
        val ref = upload("语音.wav", "audio/wav", wav) ?: return false
        attach(topic, 1)
        val ent = JSONObject().put("mime", "audio/wav").put("ref", ref).put("size", wav.size).put("duration", ms).put("preview", preview).put("name", "语音.wav")
        val content = JSONObject().put("txt", " ").put("fmt", JSONArray().put(JSONObject().put("at", 0).put("len", 1).put("key", 0)))
            .put("ent", JSONArray().put(JSONObject().put("tp", "AU").put("data", ent)))
        val r = request(JSONObject().put("pub", JSONObject().put("topic", topic).put("noecho", false).put("head", JSONObject().put("mime", "text/x-drafty")).put("content", content))
            .put("extra", JSONObject().put("attachments", JSONArray().put(ref))))
        return r != null && code(r) < 300
    }

    // ---- the person's own card, groups, search (as the iPhone's ChatRelay / ChatStore) -----------------------------

    /** Whether the person's chat card has a picture: true / false, null when it could not be asked. */
    suspend fun hasPicture(): Boolean? {
        repeat(20) { if (connected) return@repeat; delay(500) }
        if (!connected) return null
        request(JSONObject().put("get", JSONObject().put("topic", "me").put("what", "desc"))) ?: return null
        val ph = myPub?.optJSONObject("photo") ?: return false
        val data = ph.optString("data"); val ref = ph.optString("ref")
        return data.length > 64 || (ref.length > 4 && ref != "\u2421")
    }

    /** Looks at the card once signed in: no picture → [needsAvatar] (tried again, as the iPhone does). */
    fun checkAvatar() {
        scope.launch {
            var st: Boolean? = null
            for (wait in listOf(0L, 3000L, 8000L)) { if (wait > 0) delay(wait); st = hasPicture(); if (st != null) break }
            needsAvatar = st != true
            if (st == true) backfillRoster()
        }
    }

    /** The picture on the card (256 px JPEG), the rest kept; and the roster's (128 px) so the desks show it too. */
    suspend fun setAvatar(jpeg: ByteArray): Boolean {
        if (!connected) return false
        if (myPub == null) request(JSONObject().put("get", JSONObject().put("topic", "me").put("what", "desc")))
        val pub = JSONObject((myPub ?: JSONObject()).toString())
        pub.put("photo", JSONObject().put("data", Base64.encodeToString(jpeg, Base64.NO_WRAP)).put("type", "jpeg"))
        val r = request(JSONObject().put("set", JSONObject().put("topic", "me").put("desc", JSONObject().put("public", pub)))) ?: return false
        if (code(r) >= 300) return false
        myPub = pub
        people[me] = ChatPerson(pub.optString("fn", "我"), photo(pub, me))
        if (putRoster(jpeg)) prefs.edit().putBoolean("roster.$login", true).apply()
        return true
    }

    private suspend fun backfillRoster() {
        if (prefs.getBoolean("roster.$login", false)) return
        val d = myPub?.optJSONObject("photo")?.optString("data")?.takeIf { it.length > 64 } ?: return
        val jpeg = runCatching { Base64.decode(d, Base64.DEFAULT) }.getOrNull() ?: return
        if (putRoster(jpeg)) prefs.edit().putBoolean("roster.$login", true).apply()
    }

    private suspend fun putRoster(jpeg: ByteArray): Boolean = withContext(Dispatchers.IO) {
        val small = Avatars.square(jpeg, 128, 40 * 1024) ?: return@withContext false
        val r = runCatching {
            Net.call("POST", "/company/ext/chat/avatar", JSONObject().put("avatar", "data:image/jpeg;base64," + Base64.encodeToString(small, Base64.NO_WRAP)),
                token = gwToken, timeoutMs = 20000)
        }.getOrNull()
        r?.json?.optBoolean("ok") == true
    }

    /** 建群: a name and the people in it; the group's topic once made. */
    suspend fun createGroup(title: String, members: List<String>): String? {
        val draft = "new" + UUID.randomUUID().toString().replace("-", "").take(10)
        val r = request(JSONObject().put("sub", JSONObject().put("topic", draft)
            .put("set", JSONObject().put("desc", JSONObject().put("public", JSONObject().put("fn", title)))))) ?: return null
        val grp = r.optString("topic")
        if (code(r) >= 300 || !grp.startsWith("grp")) return null
        attached.add(grp)
        for (u in members) request(JSONObject().put("set", JSONObject().put("topic", grp).put("sub", JSONObject().put("user", u))))
        refreshMe()
        if (topics.none { it.topic == grp }) topics = listOf(ChatTopic(grp, title, null, true, 0, 0, System.currentTimeMillis())) + topics
        if (grp !in pinned) hidden = hidden - grp
        return grp
    }

    class Hit(val chat: String, val topic: String, val from: String, val text: String, val time: String)

    /** Messages with these words, in all the person's own chats and of any age (the server's search). */
    suspend fun find(q: String): List<Hit> = withContext(Dispatchers.IO) {
        val r = runCatching { Net.call("POST", "/company/ext/chat/find", JSONObject().put("q", q), token = gwToken, timeoutMs = 30000) }.getOrNull()
        val a = r?.json?.optJSONArray("hits") ?: return@withContext emptyList()
        (0 until a.length()).map { i -> a.getJSONObject(i).let { Hit(it.optString("chat"), it.optString("topic"), it.optString("from"), it.optString("text"), it.optString("time")) } }
    }

    /** An answer to TDH 助手's card: the words said, and head tdh_ai_ok. */
    suspend fun answerAi(topic: String, of: Int, ok: Boolean, say: String): Boolean {
        attach(topic, 1)
        val r = request(JSONObject().put("pub", JSONObject().put("topic", topic).put("noecho", false).put("content", say)
            .put("head", JSONObject().put("tdh_ai_ok", JSONObject().put("of", of).put("ok", ok)).put("reply", "$of"))))
        return r != null && code(r) < 300
    }

    private suspend fun upload(name: String, mime: String, data: ByteArray): String? = withContext(Dispatchers.IO) {
        val root = Net.base ?: Net.findServer() ?: return@withContext null
        try {
            val boundary = "tdh-" + UUID.randomUUID()
            val c = Net.open("$root/v0/file/u/", 300_000)
            c.requestMethod = "POST"
            c.doOutput = true
            c.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
            c.setRequestProperty("X-Tinode-APIKey", apiKey)
            c.setRequestProperty("X-Tinode-Auth", "Token $authToken")
            val safe = name.replace("\"", "'")
            c.outputStream.use { o ->
                o.write("--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"$safe\"\r\nContent-Type: $mime\r\n\r\n".toByteArray())
                o.write(data)
                o.write("\r\n--$boundary--\r\n".toByteArray())
            }
            val text = (if (c.responseCode >= 400) c.errorStream else c.inputStream)?.bufferedReader()?.use { it.readText() } ?: ""
            val ctrl = JSONObject(text).optJSONObject("ctrl") ?: return@withContext null
            if (ctrl.optInt("code", 500) >= 300) null else ctrl.optJSONObject("params")?.optString("url")?.ifEmpty { null }
        } catch (e: Exception) { Diag.say("chat", "upload: ${e.javaClass.simpleName}"); null }
    }

    /** A file's bytes from the chat's file store (or inline). */
    suspend fun fetch(a: ChatAttachment): ByteArray? = if (a.ref == null) a.inline else fetchRef(a.ref)

    suspend fun fetchRef(ref: String): ByteArray? = withContext(Dispatchers.IO) {
        val root = Net.base ?: Net.findServer() ?: return@withContext null
        try {
            val c = Net.open(if (ref.startsWith("http")) ref else root + (if (ref.startsWith("/")) ref else "/$ref"), 120_000)
            c.setRequestProperty("X-Tinode-APIKey", apiKey)
            c.setRequestProperty("X-Tinode-Auth", "Token $authToken")
            if (c.responseCode != 200) null else c.inputStream.use { it.readBytes() }
        } catch (e: Exception) { null }
    }

    /** A voice message's words, as the server wrote them (people-api /company/ext/chat/voice); null while it is at it. */
    suspend fun voiceText(ref: String): Pair<String, String>? {
        val r = runCatching { Net.call("POST", "/company/ext/chat/voice", JSONObject().put("ref", ref), token = gwToken) }.getOrNull() ?: return null
        if (r.code != 200 || r.json.optBoolean("pending")) return null
        val text = r.json.optString("text")
        return if (text.isEmpty()) null else text to r.json.optString("gist")
    }

    // ---- helpers ----------------------------------------------------------------------------------------------------------

    private fun photo(pub: JSONObject, key: String): ImageBitmap? {
        val p = pub.optJSONObject("photo") ?: return null
        val data = p.optString("data")
        if (data.length > 64) runCatching { Base64.decode(data, Base64.DEFAULT) }.getOrNull()?.let { b ->
            BitmapFactory.decodeByteArray(b, 0, b.size)?.let { return it.asImageBitmap() }
        }
        val ref = p.optString("ref")
        if (ref.length > 4 && ref != "␡" && photoRefs.add(key + ref)) scope.launch {
            val b = fetchRef(ref) ?: return@launch
            val img = BitmapFactory.decodeByteArray(b, 0, b.size)?.asImageBitmap() ?: return@launch
            topics = topics.map { if (it.topic == key) it.copy(photo = img) else it }
            people[key]?.let { people[key] = ChatPerson(it.name, img) }
        }
        return null
    }

    private val iso = ThreadLocal.withInitial {
        listOf("yyyy-MM-dd'T'HH:mm:ss.SSSX", "yyyy-MM-dd'T'HH:mm:ssX").map { SimpleDateFormat(it, Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") } }
    }

    private fun date(s: String?): Long {
        if (s.isNullOrEmpty()) return 0
        for (f in iso.get()!!) runCatching { return f.parse(s)!!.time }
        return 0
    }

    private fun message(d: JSONObject): ChatMessage {
        val ts = date(d.optString("ts")).takeIf { it > 0 } ?: System.currentTimeMillis()
        var text = ""
        val atts = mutableListOf<ChatAttachment>()
        when (val c = d.opt("content")) {
            is String -> text = c
            is JSONObject -> {
                text = c.optString("txt").trim()
                val ents = c.optJSONArray("ent") ?: JSONArray()
                for (i in 0 until ents.length()) {
                    val e = ents.getJSONObject(i)
                    val tp = e.optString("tp")
                    if (tp !in listOf("EX", "IM", "AU")) continue
                    val x = e.optJSONObject("data") ?: continue
                    val v = x.optString("val").takeIf { it.isNotEmpty() }?.let { runCatching { Base64.decode(it, Base64.DEFAULT) }.getOrNull() }
                    atts.add(ChatAttachment(
                        if (tp == "IM") AttKind.Image else if (tp == "AU") AttKind.Audio else AttKind.File,
                        x.optString("name").ifEmpty { if (tp == "IM") "图片" else if (tp == "AU") "语音" else "文件" },
                        x.optString("mime"), x.optInt("size", v?.size ?: 0), v, x.optString("ref").ifEmpty { null },
                        x.optInt("width"), x.optInt("height"), x.optInt("duration"),
                        x.optString("preview").takeIf { it.isNotEmpty() }?.let { runCatching { Base64.decode(it, Base64.DEFAULT) }.getOrNull() } ?: ByteArray(0),
                    ))
                }
            }
        }
        val head = d.optJSONObject("head") ?: JSONObject()
        val ai = head.optJSONObject("tdh_ai")
        val ok = head.optJSONObject("tdh_ai_ok")
        val card = head.optJSONObject("tdh_card")?.takeIf { it.optString("title").isNotEmpty() }?.let { c ->
            val due = c.opt("due").let { v -> when (v) { is Number -> v.toLong().let { if (it > 100_000_000_000L) it else it * 1000 }; is String -> date(v); else -> 0L } }
            TaskCard(c.opt("id")?.toString() ?: "", c.optString("event"), c.optString("title"), c.opt("to")?.toString() ?: "", due, c.optString("note"))
        }
        return ChatMessage(
            d.optInt("seq"), d.optString("from"), ts, text, atts,
            call = head.optString("webrtc").ifEmpty { null }, callMs = head.optInt("webrtc-duration"),
            replaces = head.optString("replace").trim(':').toIntOrNull(),
            ai = ai != null, aiKind = ai?.optString("kind", "data") ?: "",
            aiDeciders = ai?.optJSONArray("deciders")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList(),
            aiOkOf = ok?.optInt("of", -1)?.takeIf { it >= 0 }, aiOk = ok?.optBoolean("ok", true) ?: true, card = card,
        )
    }

    fun preview(m: ChatMessage, group: Boolean, who: String?, mine: Boolean): String {
        if (m.call != null) return "[语音通话]"
        m.card?.let { return "[任务卡] " + it.title }
        var s = m.text
        m.attachments.firstOrNull()?.let { a -> s = when (a.kind) { AttKind.Image -> "[图片]"; AttKind.Audio -> "[语音]"; AttKind.File -> "[文件] " + a.name } }
        if (group && !mine && !who.isNullOrEmpty()) s = "$who：$s"
        return s.replace('\n', ' ')
    }

    private fun thumb(data: ByteArray): ByteArray? = runCatching {
        val b = BitmapFactory.decodeByteArray(data, 0, data.size) ?: return null
        val s = 64f / maxOf(b.width, b.height, 1)
        val small = android.graphics.Bitmap.createScaledBitmap(b, maxOf(1, (b.width * s).toInt()), maxOf(1, (b.height * s).toInt()), true)
        ByteArrayOutputStream().also { small.compress(android.graphics.Bitmap.CompressFormat.JPEG, 60, it) }.toByteArray()
    }.getOrNull()

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    private suspend fun rawGet(url: String): ByteArray? = withContext(Dispatchers.IO) {
        try { val c = Net.open(url, 20000); if (c.responseCode >= 400) null else c.inputStream.use { it.readBytes() } } catch (e: Exception) { null }
    }

    /** Tinode sends one JSON object per frame, sometimes several separated by newlines. */
    private fun lines(text: String): List<JSONObject> = text.split('\n').mapNotNull { l -> l.trim().takeIf { it.isNotEmpty() }?.let { runCatching { JSONObject(it) }.getOrNull() } }
}
