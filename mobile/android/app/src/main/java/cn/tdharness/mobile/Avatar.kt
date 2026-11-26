package cn.tdharness.mobile

// company-chat-avatar-v1 on Android (the user, 2026-11-26: 「为什么登录不让设置头像」; the iPhone's AvatarSetup.swift): after
// sign-in, a person whose chat card has no picture is asked for one before anything else — from the photos or the
// camera, the middle square, small enough to sit on the card itself. No skipping it; signing out is the only other way.
// From settings (更换头像) it can be closed.

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.view.HapticFeedbackConstants
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream

object Avatars {
    /** The middle square of a picture, [side] px, as JPEG under [maxBytes] (lower quality until it fits). */
    fun square(data: ByteArray, side: Int, maxBytes: Int): ByteArray? = runCatching {
        val src = decode(data, side) ?: return null
        val s = minOf(src.width, src.height)
        val cut = Bitmap.createBitmap(src, (src.width - s) / 2, (src.height - s) / 2, s, s)
        val out = Bitmap.createScaledBitmap(cut, side, side, true)
        var q = 85
        var bytes: ByteArray
        do {
            bytes = ByteArrayOutputStream().also { out.compress(Bitmap.CompressFormat.JPEG, q, it) }.toByteArray()
            q -= 10
        } while (bytes.size > maxBytes && q >= 30)
        bytes
    }.getOrNull()

    /** A picture read the right way up (its EXIF turn) and not much larger than needed. */
    fun decode(data: ByteArray, atLeast: Int): Bitmap? {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(data, 0, data.size, o)
        var sample = 1
        while (minOf(o.outWidth, o.outHeight) / (sample * 2) >= atLeast) sample *= 2
        val bmp = BitmapFactory.decodeByteArray(data, 0, data.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
        val turn = runCatching {
            androidx.exifinterface.media.ExifInterface(data.inputStream()).rotationDegrees
        }.getOrDefault(0)
        if (turn == 0) return bmp
        return Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(turn.toFloat()) }, true)
    }
}

@Composable
fun AvatarSetup(again: Boolean = false, close: () -> Unit = {}) {
    val p = LocalPalette.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    var picked by remember { mutableStateOf<ByteArray?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var done by remember { mutableStateOf(false) }
    val image = remember(picked) { picked?.let { Avatars.decode(it, 360)?.asImageBitmap() } }

    fun take(b: ByteArray?) { if (b != null) { picked = b; error = "" } }

    val body: @Composable () -> Unit = {
        Box(Modifier.fillMaxSize()) {
            DeskBackground()
            Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally) {
                Spacer(Modifier.height(56.dp))
                LavaDots()
                Text(if (done) "头像已设置好" else if (again) "换一张头像" else "上传一张你的头像", color = p.ink, fontSize = 22.sp,
                    fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 20.dp))
                Text(if (again) "同事在聊天里靠头像认出你。" else "同事在聊天里靠头像认出你。设置好以后才能开始使用。",
                    color = p.ink2, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp, start = 8.dp, end = 8.dp))
                val s by animateFloatAsState(if (image != null) 1f else 0.94f, spring(dampingRatio = 0.7f, stiffness = 300f), label = "pic")
                Box(Modifier.padding(top = 36.dp).size(180.dp).scale(s), contentAlignment = Alignment.Center) {
                    Box(Modifier.fillMaxSize().shadow(20.dp, CircleShape, ambientColor = Color(0x14000000), spotColor = Color(0x14000000))
                        .clip(CircleShape).background(p.paper.copy(alpha = 0.7f))
                        .drawBehind {
                            drawCircle(p.accent.copy(alpha = 0.5f), size.minDimension / 2 - 1.dp.toPx(),
                                style = Stroke(2.dp.toPx(), pathEffect = if (image == null) PathEffect.dashPathEffect(floatArrayOf(7.dp.toPx(), 6.dp.toPx())) else null))
                        }, contentAlignment = Alignment.Center) {
                        if (image != null) Image(image, null, Modifier.fillMaxSize().clip(CircleShape), contentScale = ContentScale.Crop)
                        else Icon(Sf.person, null, tint = p.ink2.copy(alpha = 0.5f), modifier = Modifier.size(76.dp))
                    }
                    androidx.compose.animation.AnimatedVisibility(done, Modifier.align(Alignment.BottomEnd).offset((-8).dp, (-8).dp), enter = scaleIn(initialScale = 0.3f) + fadeIn(), exit = fadeOut()) {
                        Box(Modifier.size(40.dp).clip(CircleShape).background(p.green).border(2.dp, Color.White, CircleShape), contentAlignment = Alignment.Center) {
                            Icon(Sf.check, null, tint = Color.White, modifier = Modifier.size(22.dp))
                        }
                    }
                }
                if (error.isNotEmpty()) Text(error, color = p.red, fontSize = 13.sp, modifier = Modifier.padding(top = 14.dp))
                Spacer(Modifier.weight(1f))
                if (image != null && !done) {
                    Box(Modifier.fillMaxWidth().height(50.dp).clip(CircleShape).background(p.accent).press({
                        val b = picked ?: return@press
                        busy = true; error = ""
                        scope.launch {
                            val jpeg = Avatars.square(b, 256, 48 * 1024)
                            val ok = jpeg != null && Chat.setAvatar(jpeg)
                            busy = false
                            if (ok) {
                                view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
                                done = true
                                delay(1000)
                                Chat.needsAvatar = false
                                close()
                            } else error = "头像没传上去，检查一下网络再试一次"
                        }
                    }, !busy), contentAlignment = Alignment.Center) {
                        Text(if (busy) "正在上传…" else "用这张", color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }
                    Spacer(Modifier.height(12.dp))
                }
                if (!done) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        val first = image == null
                        Row(Modifier.weight(1f).height(48.dp).then(if (first) Modifier.clip(CircleShape).background(p.accent) else Modifier.liquid(p))
                            .press({ Pick.photos?.invoke(1) { l -> take(l.firstOrNull()?.bytes) } }, !busy),
                            horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                            Icon(Sf.photos, null, tint = if (first) Color.White else p.ink, modifier = Modifier.size(19.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(if (first) "从相册选" else "换一张", color = if (first) Color.White else p.ink, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                        }
                        Row(Modifier.weight(1f).height(48.dp).liquid(p).press({ Pick.camera?.invoke { c -> take(c?.bytes) } }, !busy),
                            horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                            Icon(Sf.camera, null, tint = p.ink, modifier = Modifier.size(19.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("拍照", color = p.ink, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                        }
                    }
                    Text(if (again) "取消" else "退出登录", color = p.ink2, fontSize = 13.sp, modifier = Modifier.padding(top = 10.dp).clip(CircleShape)
                        .clickable { if (again) close() else AppScope.launch { signOutAll(view.context) } }.padding(horizontal = 14.dp, vertical = 8.dp))
                }
                Spacer(Modifier.height(10.dp))
            }
        }
    }
    // The app's own layer (a Dialog window lost the navigation bar's room); at sign-in Main already puts it in one.
    if (again) FullScreen(close) { body() } else body()
}

/** Work that must finish though the page that started it goes away (signing out, a file on its way). */
val AppScope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Main)

/** Signing out everywhere on this phone: the watch, the chat, the pages, the relay, then the session. */
suspend fun signOutAll(ctx: android.content.Context) {
    ChatWatch.stop(ctx)
    Calls.stop()
    Chat.stop()
    Chat.needsAvatar = false
    Desk.web?.loadUrl("about:blank"); Desk.chatWeb?.loadUrl("about:blank")
    Desk.state = DeskState.Idle; Desk.chatState = DeskState.Idle; Desk.sessions = emptyList(); Desk.arts = null
    Relay.stop()
    Session.signOut()
}
