package cn.tdharness.mobile

// company-android-look-v1 (the user, 2026-11-26: 「安卓只是功能一样吗 为什么UI完全不一样」「重做并修连接」): the iPhone's
// look on Android — the same day and night (the sky-to-apricot fall by day, night blue to a dusk plum by night), the
// frosted cards with a bright top edge, near-black ink, glass bars, the lava drops, and things rising into place on
// springs. Colours are the iPhone's (mobile/ios/TDH/PhoneParts.swift, DeskTab.swift DeskBackground).

import android.content.Context
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import dev.chrisbanes.haze.hazeChild
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

/** 跟随系统 · 浅色 · 深色 (设置 → 外观); dark unless changed, as on the iPhone. */
enum class Appearance(val label: String) { System("跟随系统"), Light("浅色"), Dark("深色") }

object Look {
    var appearance by mutableStateOf(Appearance.Dark)

    fun load(ctx: Context) {
        val v = ctx.getSharedPreferences("look", Context.MODE_PRIVATE).getString("appearance", Appearance.Dark.name)
        appearance = Appearance.entries.firstOrNull { it.name == v } ?: Appearance.Dark
    }

    fun set(ctx: Context, a: Appearance) {
        appearance = a
        ctx.getSharedPreferences("look", Context.MODE_PRIVATE).edit().putString("appearance", a.name).apply()
    }
}

/** The colours of one appearance. */
class Palette(val dark: Boolean) {
    /** Today's ink: titles, icons, the selected tab, the send button. */
    val ink = if (dark) Color(0xFFEDEFF5) else Color(0xFF1C1F24)
    val ink2 = if (dark) Color(0xFFA6ABB8) else Color(0xFF6E7280)
    val ink3 = if (dark) Color(0xFF6F7482) else Color(0xFFA6A9B2)
    /** A surface under words (cards, rows, panes). */
    val paper = if (dark) Color(0xFF2B303D) else Color.White
    /** The bright edge of glass. */
    val rim = if (dark) Color(0x38FFFFFF) else Color.White
    /** One's own message. */
    val mine = if (dark) Color(0xFF334775) else Color(0xFFD1E0FC)
    /** A sheet's ground. */
    val ground = if (dark) Color(0xFF14171F) else Color(0xFFF7F7FC)
    val sky = listOf(
        if (dark) Color(0xFF121A2E) else Color(0xFFB5CEF0),
        if (dark) Color(0xFF141724) else Color(0xFFDBE3F2),
        if (dark) Color(0xFF291C21) else Color(0xFFF5DEC7),
    )
    val accent = Color(0xFF4573ED)
    val red = Color(0xFFE5484D)
    val green = Color(0xFF34C759)
}

val LocalPalette = compositionLocalOf { Palette(true) }

/** What the bars blur (company-android-glass-v1): the pages under them register as its source. */
val LocalHaze = compositionLocalOf<dev.chrisbanes.haze.HazeState?> { null }

/**
 * Real glass (company-android-glass-v1, the user 2026-11-26: 「安卓的毛玻璃效果 是不是不行」「玻璃那个画面质感真的不够好看」):
 * what lies under the bar blurred (Haze; a plain wash where the phone cannot blur), a wash of paper over it, the bright
 * rim fading down and a soft shadow — the iPhone's .glass / .frosted over content.
 */
@androidx.compose.runtime.Composable
fun Modifier.liquid(p: Palette, shape: Shape = CircleShape, tint: Color? = null, wash: Float = 0.42f): Modifier {
    // No blur to take (the AI page: a WebView cannot be blurred by the app; the page blurs itself under the bars):
    // a frosted pane thick enough that words passing under it do not show through (the user, 2026-11-26: 「还是有点透」).
    val haze = LocalHaze.current ?: return this.shadow(if (p.dark) 6.dp else 14.dp, shape, ambientColor = Color(0x261E3359), spotColor = Color(0x261E3359))
        .clip(shape)
        .background(tint ?: if (p.dark) Color(0xE6232733) else Color(0xEBF6F7FB))
        .border(0.7.dp, Brush.verticalGradient(listOf(p.rim.copy(alpha = if (p.dark) 0.55f else 1f), p.rim.copy(alpha = 0.12f))), shape)
    val base = if (p.dark) Color(0xFF1B1F2A) else Color(0xFFF4F6FB)
    val style = dev.chrisbanes.haze.HazeStyle(
        backgroundColor = base,
        tints = listOf(dev.chrisbanes.haze.HazeTint(tint ?: if (p.dark) Color(0xFF2A2F3C).copy(alpha = wash) else Color.White.copy(alpha = wash + 0.08f))),
        blurRadius = 26.dp,
        noiseFactor = 0.06f,
        fallbackTint = dev.chrisbanes.haze.HazeTint(if (p.dark) Color(0xF0222631) else Color(0xF2F6F8FC)),
    )
    return this.shadow(if (p.dark) 6.dp else 14.dp, shape, ambientColor = Color(0x261E3359), spotColor = Color(0x261E3359))
        .clip(shape)
        .hazeChild(haze, style)
        .border(0.7.dp, Brush.verticalGradient(listOf(p.rim.copy(alpha = if (p.dark) 0.55f else 1f), p.rim.copy(alpha = 0.12f))), shape)
}

/** The page behind everything: day's sky to apricot, night's blue to plum. */
@Composable
fun DeskBackground(modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    Box(modifier.fillMaxSize().background(Brush.verticalGradient(p.sky)))
}

/** A pane of content: frosted (a wash of paper), a bright edge fading down, a soft shadow under. */
fun Modifier.frosted(p: Palette, shape: Shape = RoundedCornerShape(22.dp), amount: Float = 0.55f): Modifier =
    this.shadow(if (p.dark) 0.dp else 10.dp, shape, ambientColor = Color(0x221E3359), spotColor = Color(0x221E3359))
        .clip(shape)
        .background(p.paper.copy(alpha = if (p.dark) 0.62f else amount))
        .border(0.7.dp, Brush.verticalGradient(listOf(p.rim.copy(alpha = 0.95f), p.rim.copy(alpha = 0.25f))), shape)

/** A control on glass: lighter than a card, the same bright rim. */
fun Modifier.glass(p: Palette, shape: Shape = CircleShape, tint: Color? = null): Modifier =
    this.shadow(if (p.dark) 0.dp else 8.dp, shape, ambientColor = Color(0x1A1E3359), spotColor = Color(0x1A1E3359))
        .clip(shape)
        .background(tint ?: if (p.dark) Color(0x52363C4C) else Color(0x8CFFFFFF))
        .border(0.6.dp, Brush.verticalGradient(listOf(p.rim.copy(alpha = 0.95f), p.rim.copy(alpha = 0.2f))), shape)

/** A press that gives under the finger and springs back. */
@Composable
fun Modifier.press(onClick: () -> Unit, enabled: Boolean = true): Modifier {
    val source = remember { MutableInteractionSource() }
    val down by source.collectIsPressedAsState()
    val s by animateFloatAsState(if (down) 0.965f else 1f, spring(dampingRatio = 0.55f, stiffness = 500f), label = "press")
    return this.scale(s).clickable(source, indication = null, enabled = enabled, onClick = onClick)
}

/** Rises into place out of a little blur, on a spring, a beat after the one before it. */
@Composable
fun Modifier.rise(index: Int = 0): Modifier {
    val a = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        delay(minOf(index, 10) * 40L)
        a.animateTo(1f, spring(dampingRatio = 0.8f, stiffness = Spring.StiffnessMediumLow))
    }
    return this.graphicsLayer {
        alpha = a.value
        translationY = (1f - a.value) * 16.dp.toPx()
        scaleX = 0.96f + 0.04f * a.value
        scaleY = 0.96f + 0.04f * a.value
    }
}

/** The desk's lava lamp: three drops drifting on their own slow paths, sky to sand. */
@Composable
fun LavaDots(width: Dp = 70.dp, height: Dp = 36.dp, modifier: Modifier = Modifier) {
    var t by remember { mutableStateOf(0.0) }
    LaunchedEffect(Unit) {
        val start = System.nanoTime()
        while (true) withFrameNanos { t = (it - start) / 1e9 }
    }
    val brush = Brush.horizontalGradient(listOf(Color(0xFF4073F2), Color(0xFF73BFFA), Color(0xFFFAB880)))
    Canvas(modifier.size(width, height)) {
        val speeds = doubleArrayOf(0.85, 1.25, 0.65)
        val phases = doubleArrayOf(0.0, 2.1, 4.2)
        val radii = floatArrayOf(0.30f, 0.25f, 0.22f)
        val pts = (0..2).map { i ->
            Offset(
                (size.width / 2 + size.width * 0.27 * sin(t * speeds[i] + phases[i])).toFloat(),
                (size.height / 2 + size.height * 0.12 * cos(t * speeds[i] * 1.4 + phases[i])).toFloat(),
            )
        }
        // Drops that meet melt together: each pair close enough draws a bridge between them.
        for (i in 0..2) for (j in i + 1..2) {
            val a = pts[i]; val b = pts[j]
            val d = (a - b).getDistance()
            val r = minOf(radii[i], radii[j]) * size.height
            if (d < (radii[i] + radii[j]) * size.height * 1.15f) {
                val steps = 8
                for (k in 1 until steps) {
                    val f = k / steps.toFloat()
                    val pinch = 1f - 0.45f * (1f - abs(2f * f - 1f)) * (d / ((radii[i] + radii[j]) * size.height * 1.15f))
                    drawCircle(brush, r * pinch, Offset(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f))
                }
            }
        }
        for (i in 0..2) drawCircle(brush, radii[i] * size.height, pts[i])
    }
}

/** A person's or a group's picture, round; their initials on a colour of their own when there is none. */
@Composable
fun Avatar(name: String, size: Dp = 50.dp, picture: androidx.compose.ui.graphics.ImageBitmap? = null) {
    Box(Modifier.size(size).clip(CircleShape).background(nameColor(name)), contentAlignment = Alignment.Center) {
        if (picture != null) {
            androidx.compose.foundation.Image(picture, null, Modifier.fillMaxSize(), contentScale = androidx.compose.ui.layout.ContentScale.Crop)
        } else {
            Text(initials(name), color = Color.White, fontSize = (size.value * 0.36f).sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

fun initials(name: String): String {
    val t = name.trim()
    val cjk = t.filter { it in '一'..'鿿' }
    if (cjk.length >= 2) return cjk.takeLast(2)
    return t.take(1).uppercase()
}

fun nameColor(name: String): Color {
    val hues = floatArrayOf(212f, 262f, 330f, 18f, 150f, 190f, 40f, 280f)
    var h = 0L
    for (c in name) h = (h * 31 + c.code) and 0xffffffffL
    return Color.hsv(hues[(h % hues.size).toInt()], 0.55f, 0.85f)
}

/** 刚刚 · 14:02 · 昨天 · 周一 · 11月18日, the way chat lists say it. */
fun chatWhen(ms: Long): String {
    if (ms <= 0) return ""
    val now = System.currentTimeMillis()
    if (now - ms < 60_000) return "刚刚"
    val c = java.util.Calendar.getInstance()
    val today = c.apply { timeInMillis = now; set(java.util.Calendar.HOUR_OF_DAY, 0); set(java.util.Calendar.MINUTE, 0); set(java.util.Calendar.SECOND, 0); set(java.util.Calendar.MILLISECOND, 0) }.timeInMillis
    val day = 86_400_000L
    return when {
        ms >= today -> java.text.SimpleDateFormat("HH:mm", java.util.Locale.CHINA).format(java.util.Date(ms))
        ms >= today - day -> "昨天"
        ms >= today - 6 * day -> arrayOf("周日", "周一", "周二", "周三", "周四", "周五", "周六")[java.util.Calendar.getInstance().apply { timeInMillis = ms }.get(java.util.Calendar.DAY_OF_WEEK) - 1]
        else -> java.text.SimpleDateFormat("M月d日", java.util.Locale.CHINA).format(java.util.Date(ms))
    }
}

/** 今天 · 最近一周 · 更早, History's and Docs' groups. */
fun dayGroup(ms: Long): String {
    if (ms <= 0) return "更早"
    val c = java.util.Calendar.getInstance().apply { set(java.util.Calendar.HOUR_OF_DAY, 0); set(java.util.Calendar.MINUTE, 0); set(java.util.Calendar.SECOND, 0); set(java.util.Calendar.MILLISECOND, 0) }
    val today = c.timeInMillis
    return when { ms >= today -> "今天"; ms >= today - 6 * 86_400_000L -> "最近一周"; else -> "更早" }
}

@Suppress("unused")
private fun Modifier.dim(on: Boolean) = this.alpha(if (on) 0.55f else 1f)
