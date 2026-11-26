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
        } else {
            addJavascriptInterface(Bridge(), "TDHAndroid")
        }
        webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                if (desk && !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) view.evaluateJavascript(SHIM, null)
            }

            override fun onPageFinished(view: WebView, url: String?) {
                if (url == null || !url.startsWith("http://127.0.0.1:")) return
                if (desk) pageReady() else if (chatState == DeskState.Opening) chatState = DeskState.Ready
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
        val want = pendingOpen
        pendingOpen = null
        if (want != null) js("if (window.tdhPhone) tdhPhone.open(${JSONObject.quote(want)})")
        else if (freshStart) { freshStart = false; scope.launch { delay(600); newChat() } }
    }

    private fun take(m: JSONObject) {
        if (m.optString("type") != "state") return
        if (state != DeskState.Ready) pageReady()
        current = m.optString("current")
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

    fun newChat() { js("if (window.tdhPhone) tdhPhone.newChat()") }

    fun remove(id: String) { js("if (window.tdhPhone && tdhPhone.remove) tdhPhone.remove(${JSONObject.quote(id)})") }

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
