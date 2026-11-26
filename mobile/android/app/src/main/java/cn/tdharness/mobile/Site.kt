package cn.tdharness.mobile

import android.content.Context
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.security.KeyStore
import java.security.cert.CertificateFactory
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory

/** One site's server (assets/site.json, written by mobile/ios/make-site.sh for the site and never committed). */
class SiteConfig(val name: String, val host: String, val port: Int, val addresses: List<String>, val cas: List<String>)

/**
 * The company server and how it is trusted: only the site's own CA (and the cloud entry's, limited to the site's name),
 * never the phone's store; the certificate must be for the site's name whatever address it was reached at — the same
 * rule as the iPhone app's PinnedTrust.
 */
object Site {
    lateinit var config: SiteConfig
        private set
    lateinit var ssl: SSLContext
        private set

    fun load(ctx: Context) {
        val text = runCatching { ctx.assets.open("site.json").bufferedReader().use { it.readText() } }.getOrDefault("")
        val j = if (text.isBlank()) JSONObject() else JSONObject(text)
        val addrs = j.optJSONArray("addresses")?.let { a -> (0 until a.length()).map { a.getString(it) } }
            ?: listOf("tdharness.local")
        val cas = mutableListOf<String>()
        j.optString("ca").takeIf { it.isNotBlank() }?.let { cas.add(it) }
        j.optJSONArray("more_ca")?.let { a -> for (i in 0 until a.length()) cas.add(a.getString(i)) }
        config = SiteConfig(j.optString("name", "TDH"), j.optString("host", "tdharness.local"), j.optInt("port", 8443), addrs, cas)
        val ks = KeyStore.getInstance(KeyStore.getDefaultType()).apply { load(null, null) }
        val cf = CertificateFactory.getInstance("X.509")
        cas.forEachIndexed { i, pem -> ks.setCertificateEntry("ca$i", cf.generateCertificate(ByteArrayInputStream(pem.toByteArray()))) }
        val tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(ks) }
        ssl = SSLContext.getInstance("TLS").apply { init(null, tmf.trustManagers, null) }
    }

    /** The certificate must name the site's host (the server is reached by address: LAN, tunnel or cloud entry). */
    val names = HostnameVerifier { _, session -> HttpsURLConnection.getDefaultHostnameVerifier().verify(config.host, session) }

    fun hostHeader(): String = config.host + if (config.port == 443) "" else ":${config.port}"
}
