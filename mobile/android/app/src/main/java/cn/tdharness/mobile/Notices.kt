package cn.tdharness.mobile

// company-phone-notices-v1 on Android (the iPhone's Notices.swift): while the app is on screen, a colleague's message
// or the AI's finished answer comes down as a glass banner at the top — the avatar (or the AI's sparkle), who, what;
// tap opens it, a swipe up puts it away, four seconds and it goes by itself. A light buzz with it.

import android.view.HapticFeedbackConstants
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

class Notice(val id: Long, val title: String, val body: String, val kind: Kind, val open: () -> Unit) {
    enum class Kind { Chat, AI }
}

object Notices {
    var current by mutableStateOf<Notice?>(null)
    private var n = 0L

    fun show(title: String, body: String, kind: Notice.Kind, open: () -> Unit) {
        n += 1
        current = Notice(n, title, body, kind, open)
    }
}

@Composable
fun BannerHost() {
    val p = LocalPalette.current
    val view = LocalView.current
    val b = Notices.current
    var last by remember { mutableStateOf<Notice?>(null) }
    if (b != null) last = b
    val shown = last
    val drag = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(b?.id) {
        if (b == null) return@LaunchedEffect
        drag.snapTo(0f)
        view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
        delay(4000)
        if (Notices.current?.id == b.id) Notices.current = null
    }
    AnimatedVisibility(b != null, Modifier.fillMaxWidth().zIndex(32f),
        enter = slideInVertically(spring(dampingRatio = 0.8f, stiffness = 380f)) { -it * 2 } + fadeIn(),
        exit = slideOutVertically { -it * 2 } + fadeOut()) {
        if (shown == null) return@AnimatedVisibility
        val who = Chat.topics.firstOrNull { it.name == shown.title }
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 12.dp, vertical = 6.dp)
            .offset { IntOffset(0, minOf(0f, drag.value).roundToInt()) }
            .liquid(p, RoundedCornerShape(24.dp), wash = 0.55f)
            .pointerInput(shown.id) {
                detectVerticalDragGestures(onDragEnd = {
                    scope.launch {
                        if (drag.value < -24.dp.toPx()) Notices.current = null else drag.animateTo(0f, spring(dampingRatio = 0.8f))
                    }
                }) { _, d -> scope.launch { drag.snapTo(drag.value + d) } }
            }
            .press({ Notices.current = null; shown.open() })
            .padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            when (shown.kind) {
                Notice.Kind.Chat -> Avatar(shown.title, 40.dp, who?.photo)
                Notice.Kind.AI -> Box(Modifier.size(40.dp).clip(CircleShape)
                    .background(Brush.linearGradient(listOf(Color(0xFFA8C7FA), Color(0xFF7594E6)))), contentAlignment = Alignment.Center) {
                    Icon(Sf.sparkles, null, tint = Color.White, modifier = Modifier.size(20.dp))
                }
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(shown.title, color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(shown.body, color = p.ink.copy(alpha = 0.62f), fontSize = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}
