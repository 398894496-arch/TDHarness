package cn.tdharness.mobile

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject
import java.util.UUID

class Person(val login: String, val role: String, val deptName: String, val token: String, val serverDesk: Boolean) {
    val roleText: String
        get() = when (role) { "admin" -> "管理员"; "director" -> "主管"; else -> "员工" }
}

enum class Phase { Starting, Offline, SignedOut, SignedIn }

/**
 * Who is signed in on this phone. A sign-in asks to be remembered on this device (company-login-remember-v1): the
 * server gives a device token that signs the person in again at the next start (/company/login/resume) until it
 * expires or the person signs out.
 */
object Session {
    var phase by mutableStateOf(Phase.Starting)
    var person by mutableStateOf<Person?>(null)
    var problem by mutableStateOf("")
    private lateinit var prefs: SharedPreferences

    fun init(ctx: Context) {
        prefs = ctx.getSharedPreferences("tdh", Context.MODE_PRIVATE)
    }

    val deviceId: String
        get() = prefs.getString("device_id", null) ?: UUID.randomUUID().toString().also { prefs.edit().putString("device_id", it).apply() }

    var lastPhone: String
        get() = prefs.getString("phone", "") ?: ""
        set(v) { prefs.edit().putString("phone", v).apply() }

    /** Debug builds only: a device id and a remember token for a test account (adb: --es tdhTestDevice … --es tdhTestRemember …). */
    fun seed(device: String, remember: String) {
        prefs.edit().putString("device_id", device).putString("remember", remember).apply()
    }

    suspend fun resume() {
        val tok = prefs.getString("remember", null)
        if (tok.isNullOrBlank()) { phase = Phase.SignedOut; return }
        phase = Phase.Starting
        try {
            val r = Net.call("POST", "/company/login/resume", JSONObject().put("token", tok).put("device_id", deviceId))
            if (r.code == 200 && r.json.optBoolean("ok")) {
                take(r.json)
            } else {
                if (r.code == 401) prefs.edit().remove("remember").apply()
                problem = r.json.optString("hint")
                phase = Phase.SignedOut
            }
        } catch (e: Offline) {
            problem = e.message ?: ""
            phase = Phase.Offline
        }
    }

    /** 获取验证码: null when sent, else what to tell the person. */
    suspend fun sendCode(phone: String): String? = try {
        val r = Net.call("POST", "/company/login/sms-code", JSONObject().put("phone", phone))
        if (r.code == 200 && r.json.optBoolean("ok")) null else r.json.optString("hint").ifEmpty { "验证码没发出去（${r.code}）" }
    } catch (e: Offline) {
        e.message
    }

    suspend fun signInSms(phone: String, code: String): String? {
        lastPhone = phone
        return finish("/company/login/sms", JSONObject().put("phone", phone).put("code", code))
    }

    suspend fun signInPassword(user: String, password: String): String? =
        finish("/company/login", JSONObject().put("username", user).put("password", password))

    private suspend fun finish(path: String, body: JSONObject): String? = try {
        body.put("remember", true).put("device_id", deviceId)
        val r = Net.call("POST", path, body)
        if (r.code == 200 && r.json.optBoolean("ok")) {
            r.json.optString("remember_token").takeIf { it.isNotEmpty() }?.let { prefs.edit().putString("remember", it).apply() }
            take(r.json)
            null
        } else {
            r.json.optString("hint").ifEmpty { "没登录上（${r.code}）" }
        }
    } catch (e: Offline) {
        e.message
    }

    private fun take(j: JSONObject) {
        val p = Person(
            login = j.optString("login"), role = j.optString("role"),
            deptName = j.optString("dept_name").ifEmpty { j.optString("dept") },
            token = j.optString("gw_token"), serverDesk = j.optBoolean("server_desk"),
        )
        Diag.token = p.token
        person = p
        problem = ""
        phase = Phase.SignedIn
    }

    suspend fun signOut() {
        val tok = prefs.getString("remember", null)
        if (!tok.isNullOrBlank()) runCatching { Net.call("POST", "/company/login/forget", JSONObject().put("token", tok)) }
        prefs.edit().remove("remember").apply()
        Diag.token = ""
        person = null
        phase = Phase.SignedOut
    }
}
