package cn.tdharness.mobile

import android.util.Base64
import kotlinx.coroutines.runBlocking
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.SSLSocket

/**
 * The person's desk on the company server (server/desk_hub.js) for the web views, the way the iPhone app's DeskRelay
 * reaches it: the views load http://127.0.0.1:<port>/ and this relay passes each connection on to
 * https://<site>/desk-hub/... with the person's sign-in token, the company CA checking the server (Site). Only the
 * request head is rewritten; after it the bytes go both ways untouched, so WebSockets (the kernel's live stream, the
 * chat) pass as they are.
 *
 * Other apps on an Android phone can reach 127.0.0.1 too: a connection is served only when it carries this run's
 * key in the cookie tdh_k (set in the web views' cookie jar, Desk.cookie), and the key is never passed on.
 */
object Relay {
    @Volatile var port = 0
        private set
    @Volatile var token = ""
    val key: String = ByteArray(24).also { SecureRandom().nextBytes(it) }.let { Base64.encodeToString(it, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING) }

    private var server: ServerSocket? = null
    private val pool = Executors.newCachedThreadPool()

    /** Open live connections of the desk page (/api/remote.mux): the assistant's answers come over them. */
    val streams = AtomicInteger(0)
    @Volatile var streamGoneAt = System.currentTimeMillis()

    @Synchronized
    fun start(tok: String): Int {
        token = tok
        server?.takeIf { !it.isClosed }?.let { return port }
        for (p in listOf(17803, 17804, 17805, 0)) {
            try {
                val s = ServerSocket()
                s.reuseAddress = true
                s.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), p), 64)
                server = s
                port = s.localPort
                pool.execute { acceptLoop(s) }
                return port
            } catch (e: IOException) {
                // the next port
            }
        }
        throw IOException("no port")
    }

    @Synchronized
    fun stop() {
        runCatching { server?.close() }
        server = null
        port = 0
        token = ""
    }

    private fun acceptLoop(s: ServerSocket) {
        while (!s.isClosed) {
            val c = try { s.accept() } catch (e: IOException) { break }
            pool.execute { serve(c) }
        }
    }

    private val crlf2 = "\r\n\r\n".toByteArray()

    private fun readHead(inp: InputStream): Pair<ByteArray, ByteArray>? {
        val buf = ByteArrayOutputStream()
        val tmp = ByteArray(16 * 1024)
        while (true) {
            val n = inp.read(tmp)
            if (n <= 0) return null
            buf.write(tmp, 0, n)
            val b = buf.toByteArray()
            val i = indexOf(b, crlf2)
            if (i >= 0) return b.copyOfRange(0, i) to b.copyOfRange(i + 4, b.size)
            if (b.size > 256 * 1024) return null
        }
    }

    private fun indexOf(b: ByteArray, pat: ByteArray): Int {
        outer@ for (i in 0..b.size - pat.size) {
            for (j in pat.indices) if (b[i + j] != pat[j]) continue@outer
            return i
        }
        return -1
    }

    private fun plain(out: OutputStream, status: String) {
        runCatching { out.write("HTTP/1.1 $status\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray()); out.flush() }
    }

    private fun serve(c: Socket) {
        try {
            c.tcpNoDelay = true
            val inp = c.getInputStream()
            val out = c.getOutputStream()
            val (head, rest) = readHead(inp) ?: run { c.close(); return }
            val text = String(head, Charsets.UTF_8)
            val first = text.substringBefore("\r\n")
            if (!keyed(text)) { plain(out, "403 Forbidden"); c.close(); return }
            // The desk's side-panel socket (files the assistant opens beside the conversation) has nothing to show on a
            // phone: answered here as opened, then silent. Answered, not left waiting — a browser opens one WebSocket to an
            // address at a time, and one left waiting kept the live connection from ever coming back (iPhone, 2026-11-26).
            if (first.startsWith("GET /sidebar/ws/")) {
                val k = header(text, "sec-websocket-key")
                if (k.isEmpty()) { plain(out, "400 Bad Request"); c.close(); return }
                val accept = Base64.encodeToString(
                    MessageDigest.getInstance("SHA-1").digest((k + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").toByteArray()), Base64.NO_WRAP)
                out.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: $accept\r\n\r\n".toByteArray())
                out.flush()
                val sink = ByteArray(8192)
                while (inp.read(sink) >= 0) { /* what the page says there is dropped */ }
                c.close()
                return
            }
            val stream = if (first.startsWith("GET /api/remote.mux")) UUID.randomUUID().toString() else null
            val upgrade = header(text, "upgrade").isNotEmpty()
            val newHead = rewrite(text, stream) ?: run { plain(out, "403 Forbidden"); c.close(); return }
            val root = Net.base ?: runBlocking { Net.findServer() }
            if (root == null) { Diag.say("relay", "no server answers"); plain(out, "502 Bad Gateway"); c.close(); return }
            val u = URI(root)
            val up = try {
                (Site.ssl.socketFactory.createSocket() as SSLSocket).apply {
                    connect(InetSocketAddress(u.host, if (u.port > 0) u.port else 443), 10000)
                    tcpNoDelay = true
                    startHandshake()
                }
            } catch (e: IOException) {
                Net.forget()
                Diag.say("relay", "${u.host}: ${e.javaClass.simpleName} ${e.message}")
                plain(out, "502 Bad Gateway"); c.close(); return
            }
            if (!Site.names.verify(Site.config.host, up.session)) { up.close(); plain(out, "502 Bad Gateway"); c.close(); return }
            up.outputStream.write(newHead + rest)
            up.outputStream.flush()
            if (stream != null) streams.incrementAndGet()
            pool.execute {
                pump(inp, up.outputStream)
                // The page's side of a live connection is gone: all of it ends (a half-open pair would stay on the server).
                if (stream != null || upgrade) { runCatching { up.close() }; runCatching { c.close() } }
            }
            pump(up.inputStream, out)
            runCatching { c.close() }
            runCatching { up.close() }
            if (stream != null && streams.decrementAndGet() == 0) streamGoneAt = System.currentTimeMillis()
        } catch (e: Exception) {
            runCatching { c.close() }
        }
    }

    private fun pump(i: InputStream, o: OutputStream) {
        val b = ByteArray(64 * 1024)
        try {
            while (true) {
                val n = i.read(b)
                if (n < 0) break
                o.write(b, 0, n)
                o.flush()
            }
        } catch (e: IOException) {
            // closed on one side
        }
    }

    private fun header(text: String, name: String): String {
        for (l in text.split("\r\n").drop(1)) {
            val i = l.indexOf(':')
            if (i > 0 && l.substring(0, i).trim().equals(name, ignoreCase = true)) return l.substring(i + 1).trim()
        }
        return ""
    }

    private fun keyed(text: String): Boolean =
        header(text, "cookie").split(';').any { it.trim() == "tdh_k=$key" }

    /** The request head as the server must see it; null for one this relay does not answer (another Host). */
    fun rewrite(text: String, stream: String?): ByteArray? {
        val lines = text.split("\r\n")
        val first = lines[0].split(" ", limit = 3)
        if (first.size != 3 || !first[1].startsWith("/")) return null
        var host = ""
        var upgrade = false
        val kept = mutableListOf<String>()
        for (l in lines.drop(1)) {
            val i = l.indexOf(':')
            if (i <= 0) continue
            val k = l.substring(0, i).trim().lowercase()
            val v = l.substring(i + 1).trim()
            when (k) {
                "host" -> host = v
                "authorization", "proxy-connection", "keep-alive" -> {}
                "connection" -> upgrade = v.lowercase().contains("upgrade")
                "cookie" -> {
                    val left = v.split(';').map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("tdh_k=") }
                    if (left.isNotEmpty()) kept.add("Cookie: " + left.joinToString("; "))
                }
                else -> kept.add(l)
            }
        }
        if (host != "127.0.0.1:$port" && host != "localhost:$port") return null
        val sb = StringBuilder("${first[0]} /desk-hub${first[1]} ${first[2]}\r\n")
        sb.append("Host: ${Site.hostHeader()}\r\nAuthorization: Bearer $token\r\n")
        sb.append(if (upgrade) "Connection: Upgrade\r\n" else "Connection: close\r\n")
        stream?.let { sb.append("X-TDH-Stream: $it\r\n") }
        kept.forEach { sb.append(it).append("\r\n") }
        sb.append("\r\n")
        return sb.toString().toByteArray(Charsets.UTF_8)
    }
}
