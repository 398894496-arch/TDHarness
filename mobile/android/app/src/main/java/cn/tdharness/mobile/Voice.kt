package cn.tdharness.mobile

// company-android-voice-v1: holding to talk on Android, as on the iPhone (按住说话: speak, let go, the words go to the
// assistant; slide up to cancel). Android's own recogniser needs Google, which Huawei phones lack, so the phone records
// 16 kHz mono WAV and the company server reads it (people-api /company/ext/chat/asr, the chat's recogniser).

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.sqrt

object Voice {
    private const val RATE = 16000
    const val MAX_SECONDS = 60

    fun granted(ctx: android.content.Context) = androidx.core.content.ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED

    /** 0…1, how loud the last tenth of a second was (the panel's bars follow it). */
    var level by mutableFloatStateOf(0f)
    var seconds by mutableIntStateOf(0)

    private var record: AudioRecord? = null
    private var job: Job? = null
    private val pcm = ByteArrayOutputStream()
    @Volatile private var wanted = false

    /** Starts at once (the permission is asked before, by the composer). False when the microphone did not open. */
    @SuppressLint("MissingPermission")
    fun start(scope: CoroutineScope): Boolean {
        stop()
        pcm.reset()
        seconds = 0
        level = 0f
        val min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        if (min <= 0) return false
        val r = try {
            AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min, RATE / 5 * 2))
        } catch (e: Exception) { return false }
        if (r.state != AudioRecord.STATE_INITIALIZED) { r.release(); return false }
        try { r.startRecording() } catch (e: Exception) { r.release(); return false }
        record = r
        wanted = true
        job = scope.launch(Dispatchers.IO) {
            val buf = ByteArray(RATE / 10 * 2)
            var total = 0
            while (isActive && wanted) {
                val n = r.read(buf, 0, buf.size)
                if (n <= 0) continue
                synchronized(pcm) { pcm.write(buf, 0, n) }
                total += n
                var sum = 0.0
                val bb = ByteBuffer.wrap(buf, 0, n).order(ByteOrder.LITTLE_ENDIAN)
                val samples = n / 2
                for (i in 0 until samples) { val s = bb.short.toDouble() / 32768.0; sum += s * s }
                val v = minOf(1f, (sqrt(sum / maxOf(samples, 1)) * 9).toFloat())
                withContext(Dispatchers.Main) { level = v; seconds = total / (RATE * 2) }
                if (total >= RATE * 2 * MAX_SECONDS) break
            }
        }
        return true
    }

    /** A recording: its WAV, how long it was, its waveform (64 bars, 0…255, base64: the chat's voice preview). */
    class Take(val wav: ByteArray, val ms: Int, val preview: String) {
        val first get() = wav
    }

    /** The recording, how long it was; null when nothing was said (shorter than half a second). */
    fun finish(): Take? {
        wanted = false
        val r = record
        record = null
        try { r?.stop() } catch (e: Exception) {}
        r?.release()
        job = null
        level = 0f
        val raw = synchronized(pcm) { pcm.toByteArray() }
        val ms = raw.size * 1000 / (RATE * 2)
        if (ms < 500) return null
        return Take(wav(raw), ms, peaks(raw))
    }

    private fun peaks(pcm: ByteArray): String {
        val n = pcm.size / 2
        val bars = ByteArray(64)
        if (n == 0) return Base64.encodeToString(bars, Base64.NO_WRAP)
        val bb = ByteBuffer.wrap(pcm).order(ByteOrder.LITTLE_ENDIAN)
        val per = maxOf(1, n / 64)
        var top = 1
        val raw = IntArray(64)
        for (b in 0 until 64) {
            var m = 0
            val from = b * per
            for (i in from until minOf(n, from + per)) { val s = kotlin.math.abs(bb.getShort(i * 2).toInt()); if (s > m) m = s }
            raw[b] = m; if (m > top) top = m
        }
        for (b in 0 until 64) bars[b] = (raw[b] * 255 / top).toByte()
        return Base64.encodeToString(bars, Base64.NO_WRAP)
    }

    fun stop() {
        wanted = false
        try { record?.stop() } catch (e: Exception) {}
        record?.release()
        record = null
        job = null
        level = 0f
    }

    private fun wav(pcm: ByteArray): ByteArray {
        val h = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        h.put("RIFF".toByteArray()); h.putInt(36 + pcm.size); h.put("WAVE".toByteArray())
        h.put("fmt ".toByteArray()); h.putInt(16); h.putShort(1); h.putShort(1); h.putInt(RATE); h.putInt(RATE * 2)
        h.putShort(2); h.putShort(16)
        h.put("data".toByteArray()); h.putInt(pcm.size)
        return h.array() + pcm
    }

    /** The words in a recording, read by the company server; "" when nothing was heard, null when it could not ask. */
    suspend fun words(wav: ByteArray, token: String): String? {
        val body = JSONObject().put("audio", Base64.encodeToString(wav, Base64.NO_WRAP))
        val r = try { Net.call("POST", "/company/ext/chat/asr", body, token = token, timeoutMs = 40000) } catch (e: Exception) { return null }
        if (r.code != 200 || !r.json.optBoolean("ok")) {
            Diag.say("voice", "asr ${r.code} ${r.json.optString("error")}")
            return null
        }
        return r.json.optString("text").trim()
    }
}
