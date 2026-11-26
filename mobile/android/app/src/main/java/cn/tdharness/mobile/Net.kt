package cn.tdharness.mobile

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.URL
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.HttpsURLConnection

class Reply(val code: Int, val json: JSONObject)

class Offline : IOException("暂时连不上服务器，请检查网络后再试")

/**
 * The company server, found among the site's addresses (office LAN, company tunnel, the cloud entry for outside the
 * office): the first that answers is kept until a request fails or the network changes, and only one search runs at
 * a time (a page is dozens of requests; probing for each tripped the entry's sign-in limit and its ban).
 */
object Net {
    @Volatile var base: String? = null
        private set
    private val lock = Any()
    private var searching: Deferred<String?>? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun forget() { base = null }

    suspend fun findServer(): String? {
        val d = synchronized(lock) {
            searching?.takeIf { it.isActive } ?: scope.async { search() }.also { searching = it }
        }
        return d.await()
    }

    private suspend fun search(): String? {
        base?.let { if (answers(it)) return it }
        val cands = Site.config.addresses.map { if (it.contains("://")) it.trimEnd('/') else "https://$it:${Site.config.port}" }
        if (cands.isEmpty()) return null
        val found = withTimeoutOrNull(8000) {
            coroutineScope {
                val first = CompletableDeferred<String?>()
                val left = AtomicInteger(cands.size)
                val jobs = cands.map { u ->
                    launch(Dispatchers.IO) {
                        if (answers(u)) first.complete(u)
                        if (left.decrementAndGet() == 0) first.complete(null)
                    }
                }
                val r = first.await()
                jobs.forEach { it.cancel() }
                r
            }
        }
        base = found
        return found
    }

    private fun answers(root: String): Boolean = try {
        val c = open("$root/company/login", 4000)
        c.responseCode
        c.disconnect()
        true
    } catch (e: Exception) {
        false
    }

    fun open(url: String, timeoutMs: Int): HttpsURLConnection {
        val c = URL(url).openConnection() as HttpsURLConnection
        c.sslSocketFactory = Site.ssl.socketFactory
        c.hostnameVerifier = Site.names
        c.connectTimeout = minOf(timeoutMs, 10000)
        c.readTimeout = timeoutMs
        c.useCaches = false
        c.instanceFollowRedirects = false
        return c
    }

    suspend fun call(
        method: String, path: String, body: JSONObject? = null, token: String? = null,
        timeoutMs: Int = 20000, headers: Map<String, String> = emptyMap(),
    ): Reply = withContext(Dispatchers.IO) {
        val root = base ?: findServer() ?: throw Offline()
        try {
            val c = open(root + path, timeoutMs)
            c.requestMethod = method
            token?.let { c.setRequestProperty("Authorization", "Bearer $it") }
            headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
            c.setRequestProperty("Accept", "application/json")
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                c.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val code = c.responseCode
            val text = (if (code >= 400) c.errorStream else c.inputStream)?.bufferedReader()?.use { it.readText() } ?: ""
            Reply(code, runCatching { JSONObject(text) }.getOrElse { JSONObject() })
        } catch (e: IOException) {
            base = null
            throw Offline()
        }
    }

    /** A file from the server to [to] (a chat's or the desk's file the person opens); its type, or null. */
    suspend fun download(path: String, token: String, to: File): String? = withContext(Dispatchers.IO) {
        val root = base ?: findServer() ?: return@withContext null
        try {
            val c = open(root + path, 120000)
            c.setRequestProperty("Authorization", "Bearer $token")
            if (c.responseCode != 200) return@withContext null
            to.parentFile?.mkdirs()
            c.inputStream.use { i -> to.outputStream().use { o -> i.copyTo(o) } }
            c.contentType
        } catch (e: IOException) {
            base = null
            null
        }
    }
}

/** What went wrong on this phone, to the server's log (who, where, what; never anyone's words). At most 60 a run. */
object Diag {
    @Volatile var token = ""
    private val sent = AtomicInteger(0)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun say(place: String, what: String) {
        val t = token
        if (t.isEmpty() || sent.incrementAndGet() > 60) return
        scope.launch {
            runCatching {
                Net.call("POST", "/company/ext/chat/diag", JSONObject().put("where", "android-$place").put("what", what.take(400)), t, 10000)
            }
        }
    }
}
