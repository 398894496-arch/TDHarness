package cn.tdharness.mobile

// company-phone-call-v1 on Android (the user, 2026-11-26: 「安卓是不是还不能打语音？」; the iPhone's CallCenter.swift): one-to-one
// voice calls, the desks' own (company-chat-call-v1): the call runs in the company chat page (Desk.chatWeb, loaded unseen
// through this phone's relay), which offers its call functions on window.__tdhChat.fn; the app watches the page's call
// (S.call) and shows its own call screen — rings, the avatar, mute, hang up, speaker — and plays the call's tones.

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.RingtoneManager
import android.media.ToneGenerator
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.HapticFeedbackConstants
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

data class Call(
    val topic: String, val dir: String, val state: String, val started: Double,
    val muted: Boolean, val tx: Boolean, val peerRinging: Boolean, val why: String,
)

object Calls {
    var call by mutableStateOf<Call?>(null)
    var ready by mutableStateOf(false)
    var speaker by mutableStateOf(false)

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var watch: Job? = null
    private var appCtx: Context? = null
    private var last = ""

    private const val PEEK = "(function(){try{var c=window.__tdhChat;if(!c||!c.S)return '';" +
        "return JSON.stringify({me:c.S.meId||'',call:c.S.call||null})}catch(e){return ''}})()"

    /** The page that carries the calls is opened at sign-in (as the iPhone's), and watched from then on. */
    fun start(ctx: Context) {
        appCtx = ctx.applicationContext
        Desk.openChat()
        if (watch?.isActive == true) return
        watch = scope.launch {
            var empty = 0
            while (isActive) {
                val w = Desk.chatWeb
                if (w != null && Desk.chatState == DeskState.Ready) {
                    val got = CompletableDeferred<String>()
                    w.evaluateJavascript(PEEK) { got.complete(it ?: "") }
                    // A page that never answers (gone, hung) does not stop the watch.
                    val raw = withTimeoutOrNull(3000) { got.await() }.orEmpty()
                    val s = runCatching { org.json.JSONTokener(raw).nextValue() as? String }.getOrNull().orEmpty()
                    if (s.isNotEmpty()) { empty = 0; if (s != last) { last = s; take(s) } }
                    else if (++empty >= 30 && call == null) {
                        // The page lost its chat (its desk restarted, its key changed): load it again.
                        empty = 0; ready = false; last = ""
                        Desk.retryChat()
                    }
                } else if (Desk.chatState == DeskState.Failed) {
                    delay(5000); Desk.retryChat()
                }
                delay(if (call != null) 200 else if (ChatWatch.inFront) 600 else 1500)
            }
        }
    }

    fun stop() {
        watch?.cancel(); watch = null
        tones(null, call); call = null; ready = false; last = ""
    }

    private fun take(s: String) {
        val j = runCatching { JSONObject(s) }.getOrNull() ?: return
        if (j.optString("me").isNotEmpty()) ready = true
        val c = j.optJSONObject("call")
        val n = c?.let {
            Call(it.optString("topic"), it.optString("dir").ifEmpty { call?.dir.orEmpty() }, it.optString("state"), it.optDouble("started", 0.0),
                it.optBoolean("muted"), it.optBoolean("tx"), it.optBoolean("ringing"), it.optString("why"))
        }
        val was = call
        call = n
        tones(n, was)
        if (n == null || n.state == "ended") useSpeaker(false)
        // A call ringing here while the app is away: a notification that opens the call screen.
        if (n?.dir == "in" && n.state == "ringing" && was?.state != "ringing" && !ChatWatch.inFront) appCtx?.let { ChatWatch.ringing(it, name(n.topic)) }
    }

    fun name(topic: String) = Chat.topics.firstOrNull { it.topic == topic }?.name ?: "同事"

    private fun js(code: String, done: (String) -> Unit = {}) {
        Desk.chatWeb?.evaluateJavascript(code) { done(it ?: "") }
    }

    /** Calls the person of a one-to-one chat (usr… topic); false when it could not start. */
    suspend fun dial(topic: String): Boolean {
        if (!ready) return false
        js("""(function(){window.__tdhDial='';var t=${JSONObject.quote(topic)};(async function(){
            try{const c=window.__tdhChat;if(!c){window.__tdhDial='no-page';return}
            c.open(t);
            for(let i=0;i<60;i++){const tp=c.client.getTopic(t);if(tp&&tp.isSubscribed())break;await new Promise(r=>setTimeout(r,100))}
            const tp=c.client.getTopic(t);if(!tp||!tp.isSubscribed()){window.__tdhDial='not-attached';return}
            window.__tdhDial=(await c.fn.callStart(t))?'ok':'failed'}catch(e){window.__tdhDial='error: '+e}})();return 1})()""")
        repeat(100) {
            delay(100)
            val got = CompletableDeferred<String>()
            js("window.__tdhDial||''") { got.complete(it) }
            val r = got.await().trim('"')
            if (r.isNotEmpty()) return r == "ok"
        }
        return false
    }

    fun accept() = js("(function(){const c=window.__tdhChat;if(c)c.fn.callAccept();return 1})()")
    fun hangup() = js("(function(){const c=window.__tdhChat;if(c)c.fn.callHangup(c.S.call&&c.S.call.state==='ringing'&&c.S.call.dir==='in'?'已拒绝':'');return 1})()")
    fun mute() = js("(function(){const c=window.__tdhChat;if(c)c.fn.callMute();return 1})()")

    fun toggleSpeaker() = useSpeaker(!speaker)

    private fun useSpeaker(on: Boolean) {
        speaker = on
        val am = appCtx?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        runCatching {
            if (Build.VERSION.SDK_INT >= 31) {
                if (on) am.availableCommunicationDevices.firstOrNull { it.type == android.media.AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }?.let { am.setCommunicationDevice(it) }
                else am.clearCommunicationDevice()
            } else @Suppress("DEPRECATION") { am.isSpeakerphoneOn = on }
        }
    }

    // ---- the call's sounds (the iPhone's CallTones) -------------------------------------------------------------------

    private var tone: ToneGenerator? = null
    private var ring: android.media.Ringtone? = null
    private var buzz: Job? = null

    private fun tones(n: Call?, was: Call?) {
        val ringing = n?.dir == "in" && n.state == "ringing"
        val dialing = n?.dir == "out" && n.state == "dialing"
        when {
            ringing -> if (was?.state != "ringing") ringHere()
            dialing -> if (was?.state != "dialing") ringBack()
            was?.state != "live" && n?.state == "live" -> { quiet(); beep(ToneGenerator.TONE_PROP_ACK) }
            was != null && was.state != "ended" && (n == null || n.state == "ended") -> { quiet(); beep(ToneGenerator.TONE_PROP_NACK) }
            else -> quiet()
        }
    }

    private fun ringBack() {
        quiet()
        tone = runCatching { ToneGenerator(AudioManager.STREAM_VOICE_CALL, 70) }.getOrNull()
        tone?.startTone(ToneGenerator.TONE_SUP_RINGTONE)
    }

    private fun ringHere() {
        quiet()
        val ctx = appCtx ?: return
        ring = runCatching {
            RingtoneManager.getRingtone(ctx, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))?.apply {
                audioAttributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build()
                if (Build.VERSION.SDK_INT >= 28) isLooping = true
                play()
            }
        }.getOrNull()
        val v = if (Build.VERSION.SDK_INT >= 31) (ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        else @Suppress("DEPRECATION") (ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator)
        buzz = scope.launch {
            while (isActive) { runCatching { v?.vibrate(VibrationEffect.createOneShot(700, VibrationEffect.DEFAULT_AMPLITUDE)) }; delay(1800) }
        }
    }

    private fun beep(t: Int) {
        runCatching { ToneGenerator(AudioManager.STREAM_VOICE_CALL, 60).apply { startTone(t, 220); scope.launch { delay(400); release() } } }
    }

    private fun quiet() {
        tone?.runCatching { stopTone(); release() }; tone = null
        ring?.runCatching { stop() }; ring = null
        buzz?.cancel(); buzz = null
    }
}

/** The call, full screen (the iPhone's CallScreen): the person's picture large and soft behind, rings while it rings. */
@Composable
fun CallScreen(c: Call) {
    val p = LocalPalette.current
    val peer = Chat.topics.firstOrNull { it.topic == c.topic }
    val name = peer?.name ?: "同事"
    val waiting = c.state == "dialing" || c.state == "ringing"
    Box(Modifier.fillMaxSize().zIndex(31f).clickable(remember { androidx.compose.foundation.interaction.MutableInteractionSource() }, null) {}) {
        DeskBackground()
        Box(Modifier.fillMaxSize().alpha(0.45f).blur(90.dp), contentAlignment = Alignment.Center) { Avatar(name, 420.dp, peer?.photo) }
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            if (c.tx && c.state == "live") {
                Row(Modifier.padding(top = 12.dp).liquid(p).padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Sf.bubbles, null, tint = p.ink, modifier = Modifier.size(15.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("本通话将转写，挂断后生成纪要", color = p.ink, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                }
            }
            Spacer(Modifier.weight(1f))
            Box(Modifier.height(260.dp).fillMaxWidth(), contentAlignment = Alignment.Center) {
                if (waiting) {
                    val inf = rememberInfiniteTransition(label = "rings")
                    for (i in 0..2) {
                        val t by inf.animateFloat(0f, 1f, infiniteRepeatable(tween(2400, delayMillis = 0, easing = LinearEasing), RepeatMode.Restart,
                            initialStartOffset = androidx.compose.animation.core.StartOffset(i * 800)), label = "ring$i")
                        Box(Modifier.size(150.dp).graphicsLayer { scaleX = 1f + 0.9f * t; scaleY = 1f + 0.9f * t; alpha = 0.8f * (1f - t) }
                            .border(1.2.dp, Color.White.copy(alpha = 0.6f), CircleShape))
                    }
                }
                Box(Modifier.liquid(p).padding(6.dp)) { Avatar(name, 132.dp, peer?.photo) }
            }
            Text(name, color = p.ink, fontSize = 30.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
            CallStatus(c, Modifier.padding(top = 8.dp))
            Spacer(Modifier.weight(1f))
            Box(Modifier.padding(bottom = 40.dp).fillMaxWidth()) {
                when {
                    c.state == "ended" -> Spacer(Modifier.height(96.dp))
                    c.dir == "in" && c.state == "ringing" -> Row(Modifier.fillMaxWidth().padding(horizontal = 30.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                        RoundKey(Sf.phoneDown, "拒绝", tint = p.red) { Calls.hangup() }
                        RoundKey(Sf.phoneFill, "接听", tint = p.green) { Calls.accept() }
                    }
                    else -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        RoundKey(if (c.muted) Sf.micOff else Sf.mic, if (c.muted) "已静音" else "静音", on = c.muted) { Calls.mute() }
                        RoundKey(Sf.phoneDown, "挂断", tint = p.red) { Calls.hangup() }
                        RoundKey(Sf.speaker, "免提", on = Calls.speaker) { Calls.toggleSpeaker() }
                    }
                }
            }
        }
    }
}

@Composable
private fun CallStatus(c: Call, modifier: Modifier) {
    val p = LocalPalette.current
    when (c.state) {
        "live" -> {
            var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
            LaunchedEffect(Unit) { while (true) { delay(1000); now = System.currentTimeMillis() } }
            val secs = if (c.started > 0) ((now - c.started) / 1000).toInt().coerceAtLeast(0) else 0
            Text("%d:%02d".format(secs / 60, secs % 60), color = p.ink2, fontSize = 20.sp, modifier = modifier)
        }
        "ended" -> Text(c.why.ifEmpty { "通话结束" }, color = p.ink2, fontSize = 20.sp, modifier = modifier)
        else -> {
            val inf = rememberInfiniteTransition(label = "wait")
            val a by inf.animateFloat(0.55f, 1f, infiniteRepeatable(tween(1100), RepeatMode.Reverse), label = "a")
            Text(if (c.dir == "in") (if (c.state == "ringing") "邀请你语音通话" else "正在接通…")
                else if (c.state == "connecting") "正在接通…" else if (c.peerRinging) "对方响铃中…" else "正在呼叫…",
                color = p.ink2, fontSize = 20.sp, modifier = modifier.alpha(a))
        }
    }
}

@Composable
private fun RoundKey(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, tint: Color? = null, on: Boolean = false, act: () -> Unit) {
    val p = LocalPalette.current
    val view = LocalView.current
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        val fill = tint ?: if (on) p.ink else null
        Box(Modifier.size(72.dp).then(if (fill != null) Modifier.clip(CircleShape).background(fill) else Modifier.liquid(p))
            .press({ view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY); act() }), contentAlignment = Alignment.Center) {
            Icon(icon, label, tint = if (fill != null) (if (tint == null && on) p.ground else Color.White) else p.ink, modifier = Modifier.size(30.dp))
        }
        Spacer(Modifier.height(8.dp))
        Text(label, color = p.ink, fontSize = 13.sp)
    }
}
