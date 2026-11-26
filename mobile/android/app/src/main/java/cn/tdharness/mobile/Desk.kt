package cn.tdharness.mobile

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.FileProvider
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class Sess(val id: String, val title: String, val updated: Long, val busy: Boolean)
class Art(val path: String, val title: String, val updated: Long)

enum class DeskState { Idle, Opening, Ready, Failed }

/**
 * The person's desk and chat in two web views, both from Relay. The desk page shows only the conversation on a phone
 * (desk/plugins/company-shell, company-phone-layout-v1, keyed on the TDH-iOS user agent) and answers the app through
 * window.tdhPhone, posting its state through window.webkit.messageHandlers.tdh — given here by a script that runs before
 * the page's own and hands each message to this app.
 */
@SuppressLint("StaticFieldLeak", "SetJavaScriptEnabled")
object Desk {
    var web: WebView? = null
        private set
    var chatWeb: WebView? = null
        private set

    var state by mutableStateOf(DeskState.Idle)
    var failed by mutableStateOf("")
    var sessions by mutableStateOf<List<Sess>>(emptyList())
    var current by mutableStateOf("")
    var arts by mutableStateOf<List<Art>?>(null)
    var chatState by mutableStateOf(DeskState.Idle)

    // company-android-look-v1: what the iPhone's AI page follows (DeskTab.swift DeskModel).
    /** How many messages the open conversation shows (-1 until the page says): 0 is a new, empty one. */
    var flowCount by mutableStateOf(-1)
    /** Thinking before its answer begins: the drops, where the page keeps room for them (its own pixels = dp). */
    var thinking by mutableStateOf(false)
    var thinkingAt by mutableStateOf(floatArrayOf(0f, 0f, 0f, 0f))
    var sending by mutableStateOf(false)
    /** Something was sent in the conversation now open: the greeting never comes back over it. */
    var saidHere by mutableStateOf(false)
    /** A short word over everything (已转发、已放进 AI…), gone by itself. */
    var toast by mutableStateOf<String?>(null)
    private var toastJob: kotlinx.coroutines.Job? = null
    private var lookJs = ""
    private var dark = true

    /** The AI tab is in front (a finished answer there needs no word elsewhere). */
    var aiVisible = false
    val currentBusy: Boolean get() = sessions.firstOrNull { it.id == current }?.busy ?: false
    /** The greeting and its four cards over an empty conversation. */
    val welcome: Boolean get() = state == DeskState.Ready && flowCount == 0 && !currentBusy && !sending && !saidHere

    fun say(text: String) {
        toast = text
        toastJob?.cancel()
        toastJob = scope.launch { delay(2600); if (toast == text) toast = null }
    }

    /** Set by MainActivity: the file picker and the system's permission asks the pages need. */
    var chooseFiles: ((ValueCallback<Array<Uri>>, WebChromeClient.FileChooserParams) -> Unit)? = null
    var askMic: ((granted: (Boolean) -> Unit) -> Unit)? = null

    private val main = Handler(Looper.getMainLooper())
    private val scope = MainScope()
    private var readyAt = 0L
    private var reloadAt = 0L
    private var boot = ""
    private var token = ""
    private var freshStart = true
    private var pendingOpen: String? = null
    private var results = HashMap<String, (String) -> Unit>()

    private const val SHIM = """(function () {
  if (window.__tdhShim) return; window.__tdhShim = 1;
  window.webkit = window.webkit || {}; window.webkit.messageHandlers = window.webkit.messageHandlers || {};
  window.webkit.messageHandlers.tdh = { postMessage: function (m) { try { TDHAndroid.post(JSON.stringify(m)); } catch (e) {} } };
})();"""

    fun create(ctx: Context) {
        if (web != null) return
        if (lookJs.isEmpty()) lookJs = runCatching { ctx.assets.open("look.js").bufferedReader().use { it.readText() } }.getOrDefault("")
        web = makeWeb(ctx, desk = true)
        chatWeb = makeWeb(ctx, desk = false)
    }

    fun destroy() {
        web?.destroy(); chatWeb?.destroy()
        web = null; chatWeb = null
        state = DeskState.Idle; chatState = DeskState.Idle
    }

    private fun makeWeb(ctx: Context, desk: Boolean): WebView = WebView(ctx).apply {
        // Match-parent, never wrap-content (what a view gets by default inside Compose): a WebView whose height is
        // wrap-content lays its page out at height 0, and the desk's height:100% layout collapsed to nothing.
        layoutParams = android.view.ViewGroup.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT)
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.setSupportMultipleWindows(false)
        settings.userAgentString = settings.userAgentString + (if (desk) " TDH-iOS/1.0" else "") + " TDH-Android/1.0"
        setBackgroundColor(Color.WHITE)
        overScrollMode = WebView.OVER_SCROLL_NEVER
        if (desk) {
            addJavascriptInterface(Bridge(), "TDHAndroid")
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                WebViewCompat.addDocumentStartJavaScript(this, SHIM, setOf("*"))
            }
            setBackgroundColor(Color.TRANSPARENT)
        } else {
            addJavascriptInterface(Bridge(), "TDHAndroid")
        }
        webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                if (desk && !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) view.evaluateJavascript(SHIM, null)
            }

            override fun onPageFinished(view: WebView, url: String?) {
                if (url == null || !url.startsWith("http://127.0.0.1:")) return
                if (desk) {
                    // The page's look (the iPhone's), its day or night, and the room under the app's bars.
                    view.evaluateJavascript("window.__tdhDark=" + dark + ";" + lookJs, null)
                    sendInsets()
                    pageReady()
                } else if (chatState == DeskState.Opening) chatState = DeskState.Ready
            }

            override fun onReceivedError(view: WebView, req: WebResourceRequest, err: android.webkit.WebResourceError) {
                if (!req.isForMainFrame) return
                Diag.say(if (desk) "desk" else "chat", "page: ${err.errorCode} ${err.description}")
                if (desk) fail("工作台没打开，点重试再试一次") else chatState = DeskState.Failed
            }

            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val u = req.url
                if (u.scheme == "blob") { saveBlob(view, u.toString()); return true }
                if (u.host == "127.0.0.1" || u.host == "localhost") {
                    val p = u.path ?: "/"
                    if (p == "/" || p.startsWith("/chat/")) return false
                    fetchFile(view.context, p + (u.encodedQuery?.let { "?$it" } ?: ""), null, null)
                    return true
                }
                if (u.scheme == "http" || u.scheme == "https") {
                    try { view.context.startActivity(Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: ActivityNotFoundException) {}
                }
                return true
            }
        }
        webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(v: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                val f = chooseFiles ?: return false
                f(cb, params)
                return true
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                val want = request.resources.filter { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE || it == PermissionRequest.RESOURCE_VIDEO_CAPTURE }
                if (want.isEmpty()) { request.deny(); return }
                val ask = askMic ?: run { request.deny(); return }
                ask { ok -> main.post { if (ok) request.grant(want.toTypedArray()) else request.deny() } }
            }
        }
        setDownloadListener { url, _, disposition, mime, _ ->
            if (url.startsWith("blob:")) { saveBlob(this, url); return@setDownloadListener }
            val u = Uri.parse(url)
            fetchFile(context, (u.path ?: "/") + (u.encodedQuery?.let { "?$it" } ?: ""), URLUtil.guessFileName(url, disposition, mime), mime)
        }
    }

    private class Bridge {
        @JavascriptInterface
        fun post(s: String) { main.post { runCatching { take(JSONObject(s)) } } }

        @JavascriptInterface
        fun result(id: String, s: String) {
            if (BuildConfig.DEBUG) android.util.Log.d("TDHDesk", "result $id ${s.length}B waiting=${results.containsKey(id)}")
            main.post { results.remove(id)?.invoke(s) }
        }

        @JavascriptInterface
        fun file(name: String, mime: String, dataUrl: String) {
            val ctx = web?.context ?: return
            scope.launch {
                val f = withContext(Dispatchers.IO) {
                    runCatching {
                        val b64 = dataUrl.substringAfter("base64,", "")
                        File(File(ctx.cacheDir, "files"), safeName(name)).apply {
                            parentFile?.mkdirs(); writeBytes(Base64.decode(b64, Base64.DEFAULT))
                        }
                    }.getOrNull()
                }
                if (f != null) openFile(ctx, f, mime) else Toast.makeText(ctx, "文件没取下来", Toast.LENGTH_SHORT).show()
            }
        }
    }

    // ---- the desk -------------------------------------------------------------------------------------------------

    fun open(p: Person) {
        if (state == DeskState.Opening) return
        token = p.token
        state = DeskState.Opening
        failed = ""
        scope.launch {
            val port = try { withContext(Dispatchers.IO) { Relay.start(p.token) } } catch (e: Exception) {
                fail("这台手机上开不了本地通道"); return@launch
            }
            if (!p.serverDesk) { fail("这个账号还没切到服务器上的工作台，请联系管理员"); return@launch }
            if (!waitUp()) { fail("工作台没打开，点重试再试一次"); return@launch }
            CookieManager.getInstance().apply {
                setAcceptCookie(true)
                setCookie("http://127.0.0.1:$port", "tdh_k=${Relay.key}; Path=/; HttpOnly; SameSite=Lax")
                flush()
            }
            load()
            // The chat page too, a moment later (the chat tab then opens at once).
            delay(2500)
            openChat()
        }
        startHealing()
    }

    private fun fail(why: String) {
        failed = why
        state = DeskState.Failed
        Diag.say("desk", why)
    }

    /** The person's kernel up on the server (started if it was not), its start remembered. */
    private suspend fun waitUp(): Boolean {
        for (i in 0 until 40) {
            val s = runCatching { Net.call("GET", "/desk-hub/_hub/status", token = token, timeoutMs = 15000) }.getOrNull()
            if (s != null && s.code == 200 && s.json.optString("state") == "up") { boot = s.json.optString("boot"); return true }
            if (i == 0 || (s != null && s.json.optString("state") == "down")) {
                runCatching { Net.call("GET", "/desk-hub/_hub/warm", token = token, timeoutMs = 30000) }
            }
            delay(2000)
        }
        return false
    }

    private fun load() {
        val w = web ?: return
        Relay.streamGoneAt = System.currentTimeMillis()
        readyAt = 0
        w.loadUrl("http://127.0.0.1:${Relay.port}/")
        scope.launch {
            delay(40000)
            if (state == DeskState.Opening) fail("工作台没打开，点重试再试一次")
        }
    }

    private fun pageReady() {
        if (state == DeskState.Ready) return
        state = DeskState.Ready
        readyAt = System.currentTimeMillis()
        learnCan()
        val want = pendingOpen
        pendingOpen = null
        if (want != null) js("if (window.tdhPhone) tdhPhone.open(${JSONObject.quote(want)})")
        else if (freshStart) { freshStart = false; scope.launch { delay(600); newChat() } }
    }

    private fun take(m: JSONObject) {
        when (m.optString("type")) {
            "flow" -> { flowCount = m.optInt("count", -1); if (flowCount > 0) sending = false; return }
            "thinking" -> {
                thinking = m.optBoolean("on")
                if (thinking) thinkingAt = floatArrayOf(m.optDouble("x").toFloat(), m.optDouble("y").toFloat(), m.optDouble("w", 56.0).toFloat(), m.optDouble("h", 28.0).toFloat())
                return
            }
            "copy" -> {
                val ctx = web?.context ?: return
                val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                cm.setPrimaryClip(android.content.ClipData.newPlainText("TDH", m.optString("text")))
                say("已复制")
                return
            }
        }
        if (m.optString("type") != "state") return
        if (state != DeskState.Ready) pageReady()
        val was = current
        current = m.optString("current")
        if (current != was) saidHere = false
        val list = m.optJSONArray("sessions") ?: JSONArray()
        sessions = (0 until list.length()).map { i ->
            val s = list.getJSONObject(i)
            Sess(s.optString("id"), s.optString("title"), s.optLong("updated"), s.optBoolean("busy"))
        }
    }

    val currentTitle: String
        get() = sessions.firstOrNull { it.id == current }?.title?.takeIf { !it.startsWith("_") && it != "新会话" } ?: "新对话"

    fun js(code: String) { web?.evaluateJavascript(code, null) }

    fun openSession(id: String) {
        current = id
        if (state != DeskState.Ready) { pendingOpen = id; return }
        js("if (window.tdhPhone) tdhPhone.open(${JSONObject.quote(id)})")
    }

    fun newChat() { saidHere = false; js("if (window.tdhPhone) tdhPhone.newChat()") }

    /** Day or night for the page too (the app's appearance, not the system's). */
    fun setDark(d: Boolean) {
        dark = d
        js("window.__tdhDark=$d; if (window.__tdhSetDark) __tdhSetDark($d)")
    }

    /** The app's bars over the page (dp = the page's own pixels): the conversation scrolls beneath them. */
    private var insets = 0 to 0
    fun setInsets(top: Int, bottom: Int) { insets = top to bottom; sendInsets() }
    private fun sendInsets() { js("if (window.tdhPhone && tdhPhone.insets) tdhPhone.insets(${insets.first}, ${insets.second})") }

    /** Says it to the assistant in the open conversation (a new one when none is open): true when it went. */
    fun send(text: String, done: (Boolean) -> Unit) {
        if (state != DeskState.Ready) { done(false); return }
        sending = true
        val id = "send" + System.nanoTime()
        results[id] = { s ->
            val ok = runCatching { JSONObject(s).optBoolean("ok") }.getOrDefault(false)
            if (ok) { saidHere = true; attached = emptyList(); scope.launch { delay(8000); sending = false } } else { sending = false; Diag.say("desk", "send: $s") }
            done(ok)
        }
        js("""(async function (t) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const answer = (o) => TDHAndroid.result(${JSONObject.quote(id)}, JSON.stringify(o));
  try {
    if (!window.tdhPhone) return answer({ok:false, error:'not-ready'});
    const cards = () => [...document.querySelectorAll("[data-composer-card] button")].some(x => /^(移除文件|Remove file)/.test(x.getAttribute('aria-label') || ''));
    let put = tdhPhone.ask(t);
    if (!put && cards()) { for (let i = 0; i < 5 && !put; i++) { await wait(400); put = tdhPhone.ask(t); } if (!put) return answer({ok:false, error:'ask-failed-with-files'}); }
    if (!put) { tdhPhone.newChat(); await wait(700); put = tdhPhone.ask(t); }
    if (!put && t) return answer({ok:false, error:'no-session'});
    for (let i = 0; i < 20; i++) {
      await wait(60);
      const b = document.querySelector("[data-composer-card] button[aria-label='发送消息'], [data-composer-card] button[aria-label='Send message']");
      if (b && !b.disabled && b.getAttribute('aria-disabled') !== 'true') { b.click(); return answer({ok:true}); }
    }
    answer({ok:false, error:'no-send'});
  } catch (e) { answer({ok:false, error:String(e && e.message || e)}); }
})(${JSONObject.quote(text)})""")
    }

    /** A page call that answers later: [expr] is a JS expression (a value or a promise); [done] gets its JSON. */
    fun ask(expr: String, done: (String) -> Unit) {
        if (state != DeskState.Ready) { done("{}"); return }
        val id = "ask" + System.nanoTime()
        results[id] = done
        js("Promise.resolve().then(function () { return $expr; }).then(function (r) { TDHAndroid.result(${JSONObject.quote(id)}, JSON.stringify(r === undefined ? null : r)); }, function (e) { TDHAndroid.result(${JSONObject.quote(id)}, JSON.stringify({ok:false, error:String(e && e.message || e)})); })")
    }

    /** Set by MainActivity: the phone's own picker for 「+」. */
    var pickForAi: (() -> Unit)? = null
    /** Files put into the assistant's composer, to go with the next thing said (their names, for the native composer). */
    var attached by mutableStateOf<List<String>>(emptyList())

    fun askFile(name: String, mime: String, bytes: ByteArray) {
        val b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
        ask("window.tdhPhone && tdhPhone.askFile ? tdhPhone.askFile(${JSONObject.quote(name)}, ${JSONObject.quote(mime)}, ${JSONObject.quote(b64)}) : {ok:false}") { s ->
            if (runCatching { JSONObject(s).optBoolean("ok") }.getOrDefault(false)) { attached = attached + name; say("已放进对话框，说说要怎么处理它") }
            else say("「$name」没放进去，稍后再试")
        }
    }

    /** An attached file out of the composer again: the page's own 「移除文件 <name>」 button on its file card. */
    fun detach(name: String) {
        attached = attached - name
        js("(function(n){var b=[].slice.call(document.querySelectorAll('[data-composer-card] button')).find(function(x){var l=x.getAttribute('aria-label')||'';return /^(移除文件|Remove file)/.test(l)&&l.indexOf(n)>=0});if(b)b.click()})(${JSONObject.quote(name)})")
    }

    /** What History's swipe may do (the kernel archives; deleting only where it can). */
    var canArchive by mutableStateOf(false)
    var canRemove by mutableStateOf(false)
    fun learnCan() {
        ask("window.tdhPhone && tdhPhone.can ? tdhPhone.can() : {}") { s ->
            val j = runCatching { JSONObject(s) }.getOrNull() ?: return@ask
            canArchive = j.optBoolean("archive"); canRemove = j.optBoolean("remove")
        }
    }

    fun archive(id: String, done: (Boolean) -> Unit) =
        ask("window.tdhPhone && tdhPhone.archive ? tdhPhone.archive(${JSONObject.quote(id)}) : {ok:false}") { s -> done(runCatching { JSONObject(s).optBoolean("ok") }.getOrDefault(false)) }

    fun remove(id: String, done: (Boolean) -> Unit = {}) =
        ask("window.tdhPhone && tdhPhone.remove ? tdhPhone.remove(${JSONObject.quote(id)}) : {ok:false}") { s -> done(runCatching { JSONObject(s).optBoolean("ok") }.getOrDefault(false)) }

    fun loadArts() {
        val id = "arts" + System.nanoTime()
        results[id] = { s ->
            arts = runCatching {
                val a = JSONArray(s)
                (0 until a.length()).map { i -> a.getJSONObject(i).let { Art(it.optString("path"), it.optString("title").ifEmpty { it.optString("name") }, it.optLong("updated")) } }
            }.getOrDefault(emptyList())
        }
        js("(window.tdhPhone && tdhPhone.artifacts ? tdhPhone.artifacts() : Promise.resolve([])).then(function (l) { TDHAndroid.result(${JSONObject.quote(id)}, JSON.stringify(l || [])); }, function () { TDHAndroid.result(${JSONObject.quote(id)}, '[]'); })")
    }

    fun readArt(path: String, done: (String, String) -> Unit) {
        if (BuildConfig.DEBUG) android.util.Log.d("TDHDesk", "readArt $path")
        val id = "read" + System.nanoTime()
        results[id] = { s -> runCatching { JSONObject(s) }.getOrNull()?.let { done(it.optString("title"), it.optString("content")) } ?: done("", "") }
        js("tdhPhone.readArtifact(${JSONObject.quote(path)}).then(function (r) { TDHAndroid.result(${JSONObject.quote(id)}, JSON.stringify(r || {})); }, function () { TDHAndroid.result(${JSONObject.quote(id)}, '{}'); })")
    }

    /** The artifact as a file in a new conversation, for the assistant to read (as the iPhone's 交给 AI). */
    fun askArt(path: String) {
        newChat()
        scope.launch {
            delay(900)
            js("if (window.tdhPhone && tdhPhone.askArtifact) tdhPhone.askArtifact(${JSONObject.quote(path)})")
        }
    }

    // ---- staying open -----------------------------------------------------------------------------------------------

    @Volatile var foreground = false
    private var healing = false
    private var healStarted = false

    private fun startHealing() {
        if (healStarted) return
        healStarted = true
        scope.launch {
            while (true) {
                delay(20000)
                if (foreground) heal()
            }
        }
    }

    /** The app is in front again: a moment for the page to open its own live connection, then a look. */
    fun cameBack() {
        foreground = true
        scope.launch { delay(5000); heal() }
    }

    private suspend fun heal() {
        if (healing || state != DeskState.Ready || token.isEmpty()) return
        healing = true
        try {
            val now = System.currentTimeMillis()
            var again = false
            val s = runCatching { Net.call("GET", "/desk-hub/_hub/status", token = token, timeoutMs = 8000) }.getOrNull()
            if (s != null && s.code == 200) {
                if (s.json.optString("state") != "up") {
                    again = waitUp(); Diag.say("desk", "heal: kernel was down")
                } else {
                    val b = s.json.optString("boot")
                    if (boot.isNotEmpty() && b.isNotEmpty() && b != boot) { again = true; Diag.say("desk", "heal: kernel started anew") }
                    if (b.isNotEmpty()) boot = b
                }
            }
            // No live connection for a while: nothing the assistant says would reach the page.
            if (!again && Relay.streams.get() == 0 && now - Relay.streamGoneAt > 5000 && now - readyAt > 8000 && now - reloadAt > 30000) {
                again = true
                Diag.say("desk", "heal: live stream was gone")
            }
            if (again) {
                reloadAt = now
                if (current.isNotEmpty()) pendingOpen = current
                state = DeskState.Opening
                load()
            }
        } finally {
            healing = false
        }
    }

    // ---- the chat -----------------------------------------------------------------------------------------------------

    fun openChat() {
        if (chatState == DeskState.Opening || chatState == DeskState.Ready) return
        chatState = DeskState.Opening
        scope.launch {
            val r = runCatching { Net.call("GET", "/desk-hub/company/chat/where", token = token, timeoutMs = 20000) }.getOrNull()
            val path = r?.json?.optString("url").orEmpty()
            if (r == null || r.code != 200 || !path.startsWith("/chat/")) {
                chatState = DeskState.Failed
                Diag.say("chat", "where: ${r?.code} ${r?.json?.optString("error")}")
                return@launch
            }
            chatWeb?.loadUrl("http://127.0.0.1:${Relay.port}$path")
        }
    }

    fun retryChat() { chatState = DeskState.Idle; openChat() }

    // ---- files ----------------------------------------------------------------------------------------------------------

    private fun safeName(n: String): String = n.replace(Regex("[\\\\/:*?\"<>|\\x00-\\x1f]"), "_").take(120).ifEmpty { "file" }

    private fun fetchFile(ctx: Context, path: String, name: String?, mime: String?) {
        val fileName = safeName(name ?: Uri.parse(path).lastPathSegment ?: "file")
        Toast.makeText(ctx, "正在打开文件…", Toast.LENGTH_SHORT).show()
        scope.launch {
            val f = File(File(ctx.cacheDir, "files"), fileName)
            val type = Net.download("/desk-hub$path", token, f)
            if (type == null) { Toast.makeText(ctx, "文件没取下来", Toast.LENGTH_SHORT).show(); return@launch }
            openFile(ctx, f, mime ?: type.substringBefore(';'))
        }
    }

    private fun saveBlob(view: WebView, url: String) {
        view.evaluateJavascript("""(function () {
  fetch(${JSONObject.quote(url)}).then(function (r) { return r.blob(); }).then(function (b) {
    var fr = new FileReader(); fr.onload = function () { TDHAndroid.file('file', b.type || 'application/octet-stream', String(fr.result)); }; fr.readAsDataURL(b);
  });
})();""", null)
    }

    private fun openFile(ctx: Context, f: File, mime: String?) {
        val uri = FileProvider.getUriForFile(ctx, "cn.tdharness.mobile.files", f)
        val type = mime?.takeIf { it.isNotBlank() && it != "application/octet-stream" }
            ?: android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(f.extension.lowercase()) ?: "*/*"
        val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, type).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            ctx.startActivity(view)
        } catch (e: ActivityNotFoundException) {
            val send = Intent(Intent.ACTION_SEND).setType(type).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            ctx.startActivity(Intent.createChooser(send, f.name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}
