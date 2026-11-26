package cn.tdharness.mobile

// company-android-parity-v1 (the user, 2026-11-26: 「你对齐iphone的版本！ 什么都别漏！！！！！」「视觉也要对齐哦！」): the iPhone's
// app on Android, page for page (mobile/ios/TDH: TDHApp, DeskTab, PhonePages, PhoneParts, PhoneShell) — History · AI ·
// Chat · Docs on a floating glass tab bar; the gear and the page's button on glass circles; real frosted glass (what lies
// under a bar blurred), the content fading under the bars as iOS's scroll edges do; large titles with their search;
// the greeting and its four cards; the composer (「+」 · 按住说话 · the keyboard; typing: the send drop beside it); the
// 「+」 sheet; History's cards (进行中 · 有新回复 · 正在看的对话) with their swipe; Docs and the pager; 转发; 设置.

import android.app.Activity
import android.graphics.Bitmap
import android.net.Uri
import android.view.HapticFeedbackConstants
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.zIndex
import androidx.core.view.WindowCompat
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.HazeStyle
import dev.chrisbanes.haze.HazeTint
import dev.chrisbanes.haze.haze
import dev.chrisbanes.haze.hazeChild
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sin

enum class Tab(val label: String) { History("History"), AI("AI"), Chat("Chat"), Docs("Docs") }

private fun Tab.icon(): ImageVector = when (this) { Tab.History -> Sf.history; Tab.AI -> Sf.sparkles; Tab.Chat -> Sf.bubblesFill; Tab.Docs -> Sf.docFill }

object Shell {
    var tab by mutableStateOf(Tab.AI)
    /** Docs' pager: the list it pages through and where it opened. */
    var viewer by mutableStateOf<Pair<List<Art>, Int>?>(null)
    var settings by mutableStateOf(false)

    /** The back key: true when it was used here. */
    fun back(): Boolean {
        if (settings) { settings = false; return true }
        if (viewer != null) { viewer = null; return true }
        if (ChatShell.back()) return true
        if (tab != Tab.AI) { tab = Tab.AI; return true }
        return false
    }
}

/** The bars' sizes (dp): the row of glass buttons under the status bar, the floating tab bar with its margins. */
const val BAR = 60
const val TABS = 74

@Composable
fun Root(onSignedIn: () -> Unit) {
    val dark = when (Look.appearance) { Appearance.System -> isSystemInDarkTheme(); Appearance.Light -> false; Appearance.Dark -> true }
    val p = remember(dark) { Palette(dark) }
    val view = LocalView.current
    SideEffect {
        val w = (view.context as? Activity)?.window ?: return@SideEffect
        WindowCompat.getInsetsController(w, view).apply { isAppearanceLightStatusBars = !dark; isAppearanceLightNavigationBars = !dark }
    }
    LaunchedEffect(dark) { Desk.setDark(dark) }
    val scheme = if (dark) darkColorScheme(primary = p.ink, onPrimary = Color(0xFF14171F), surface = p.ground, background = p.ground)
    else lightColorScheme(primary = p.ink, onPrimary = Color.White, surface = p.ground, background = p.ground)
    MaterialTheme(colorScheme = scheme) {
        CompositionLocalProvider(LocalPalette provides p) {
            Box(Modifier.fillMaxSize()) {
                DeskBackground()
                when (Session.phase) {
                    Phase.Starting -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LavaDots(96.dp, 48.dp) }
                    Phase.Offline -> OfflineScreen()
                    Phase.SignedOut -> Login()
                    Phase.SignedIn -> Session.person?.let { Main(it, onSignedIn) } ?: Login()
                }
                LayerHost()
                if (Session.phase == Phase.SignedIn) TopOverlays()
            }
        }
    }
}

@Composable
private fun OfflineScreen() {
    val p = LocalPalette.current
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        LavaDots()
        Spacer(Modifier.height(20.dp))
        Text(Session.problem.ifEmpty { "暂时连不上服务器" }, color = p.ink, fontSize = 16.sp, textAlign = TextAlign.Center)
        Spacer(Modifier.height(20.dp))
        Capsule("重试", prominent = false) { scope.launch { Net.forget(); Session.resume() } }
    }
}

/**
 * A full-screen layer over the app (sheets, the pager, settings, the avatar): drawn by [LayerHost] at the top of the app's
 * own window, so the system bars' room, the keyboard and the back key work as on the pages (a dialog window lost the
 * navigation bar's room). The bars' blur is off inside one.
 */
class Layer(val id: Long) {
    var close by mutableStateOf<() -> Unit>({})
    var back by mutableStateOf(true)
    var content by mutableStateOf<@Composable androidx.compose.foundation.layout.BoxScope.() -> Unit>({})
}

object Layers {
    val list = mutableStateListOf<Layer>()
    private var n = 0L
    fun make() = Layer(++n)
}

@Composable
fun FullScreen(close: () -> Unit, back: Boolean = true, content: @Composable androidx.compose.foundation.layout.BoxScope.() -> Unit) {
    val layer = remember { Layers.make() }
    layer.close = close
    layer.back = back
    layer.content = content
    androidx.compose.runtime.DisposableEffect(layer) {
        Layers.list.add(layer)
        onDispose { Layers.list.remove(layer) }
    }
}

/** The app's own blur source (the pages under the bars), one for the app. */
object Glass { val main = HazeState() }

/**
 * Over everything, the layers too (the iPhone's banners and call screen sit above its sheets): a colleague's call,
 * the banners, the toast. Their glass blurs the pages only where the pages are what lies under them — not over a chat
 * room, 通讯录, a layer or the AI page (whose WebView the app cannot blur) — else it would show the hidden list.
 */
@Composable
fun TopOverlays() {
    val covered = Layers.list.isNotEmpty() || ChatShell.room.isNotEmpty() || ChatShell.contacts || Shell.tab == Tab.AI
    CompositionLocalProvider(LocalHaze provides if (covered) null else Glass.main) {
        BannerHost()
        Toast()
    }
    Calls.call?.let { c -> CompositionLocalProvider(LocalHaze provides null) { CallScreen(c) } }
}

@Composable
fun LayerHost() {
    Layers.list.toList().forEach { l ->
        androidx.compose.runtime.key(l.id) {
            CompositionLocalProvider(LocalHaze provides null) {
                Box(Modifier.fillMaxSize().zIndex(20f).clickable(remember { MutableInteractionSource() }, null) {}) { l.content(this) }
            }
        }
    }
    BackHandler(Layers.list.isNotEmpty()) { Layers.list.lastOrNull()?.let { if (it.back) it.close() } }
}

// ---- parts -----------------------------------------------------------------------------------------------------------

/** A capsule button: prominent (accent, white words) or on glass. */
@Composable
fun Capsule(text: String, modifier: Modifier = Modifier, icon: ImageVector? = null, prominent: Boolean = true, enabled: Boolean = true,
            busy: Boolean = false, tint: Color? = null, onClick: () -> Unit) {
    val p = LocalPalette.current
    val fill = tint ?: p.accent
    Row(modifier.height(48.dp).then(if (prominent) Modifier.clip(CircleShape).background(fill.copy(alpha = if (enabled) 1f else 0.4f)) else Modifier.liquid(p))
        .press(onClick, enabled && !busy).padding(horizontal = 20.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        if (busy) CircularProgressIndicator(Modifier.size(18.dp), color = if (prominent) Color.White else p.ink, strokeWidth = 2.dp)
        else {
            if (icon != null) { Icon(icon, null, tint = if (prominent) Color.White else p.ink, modifier = Modifier.size(19.dp)); Spacer(Modifier.width(7.dp)) }
            Text(text, color = if (prominent) Color.White else p.ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
    }
}

/** A round glass button of the bars (the gear, 新对话, the menu, back). */
@Composable
fun GlassCircle(icon: ImageVector, label: String, size: Dp = 44.dp, onClick: () -> Unit) {
    val p = LocalPalette.current
    Box(Modifier.size(size).liquid(p).press(onClick), contentAlignment = Alignment.Center) {
        Icon(icon, label, tint = p.ink, modifier = Modifier.size(21.dp))
    }
}

/**
 * The scroll edge (iOS 26): what scrolls under the top bar or the tab bar blurs more the nearer it is to the edge, and
 * a wash of the page's own ground keeps words there from showing through (the user, 2026-11-26: 「字母重叠了」).
 */
@Composable
fun EdgeBlur(top: Boolean, height: Dp, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    val haze = LocalHaze.current
    val ground = if (top) p.sky.first() else p.sky.last()
    val fade = if (top) Brush.verticalGradient(listOf(Color.Black, Color.Black.copy(alpha = 0.85f), Color.Transparent))
    else Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.85f), Color.Black))
    Box(modifier.fillMaxWidth().height(height)
        .then(if (haze != null) Modifier.hazeChild(haze, HazeStyle(ground, listOf(HazeTint(ground.copy(alpha = 0.55f))), 18.dp, 0f, HazeTint(ground.copy(alpha = 0.9f)))) { mask = fade }
        else Modifier)
        .background(if (top) Brush.verticalGradient(listOf(ground.copy(alpha = 0.7f), ground.copy(alpha = 0.35f), Color.Transparent))
        else Brush.verticalGradient(listOf(Color.Transparent, ground.copy(alpha = 0.35f), ground.copy(alpha = 0.7f)))))
}

/** The page's own row at the top: the gear (or back) at the left, the title in the middle, the page's buttons at the right. */
@Composable
fun TopRow(title: String, titleAlpha: Float = 1f, leading: @Composable () -> Unit, trailing: @Composable () -> Unit = {}) {
    val p = LocalPalette.current
    Box(Modifier.fillMaxWidth().statusBarsPadding().height(BAR.dp).padding(horizontal = 16.dp).zIndex(5f)) {
        Box(Modifier.align(Alignment.CenterStart)) { leading() }
        AnimatedContent(title, Modifier.align(Alignment.Center).widthIn(max = 220.dp).alpha(titleAlpha),
            transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(180)) }, label = "title") { t ->
            Text(t, color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Row(Modifier.align(Alignment.CenterEnd), horizontalArrangement = Arrangement.spacedBy(10.dp)) { trailing() }
    }
}

/** A large title (34, bold) and the page's search under it, as iOS's navigation bar draws them. */
@Composable
fun LargeTitle(title: String) {
    val p = LocalPalette.current
    Text(title, color = p.ink, fontSize = 34.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 4.dp, top = 2.dp, bottom = 8.dp))
}

@Composable
fun SearchField(query: String, onChange: (String) -> Unit, prompt: String, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    Row(modifier.fillMaxWidth().height(42.dp).clip(CircleShape).background(p.ink.copy(alpha = if (p.dark) 0.10f else 0.06f))
        .padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Sf.search, null, tint = p.ink2, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(7.dp))
        Box(Modifier.weight(1f)) {
            if (query.isEmpty()) Text(prompt, color = p.ink3, fontSize = 16.sp, maxLines = 1)
            BasicTextField(query, onChange, singleLine = true, textStyle = TextStyle(color = p.ink, fontSize = 16.sp), cursorBrush = SolidColor(p.accent),
                modifier = Modifier.fillMaxWidth())
        }
        if (query.isNotEmpty()) Box(Modifier.size(22.dp).clip(CircleShape).background(p.ink3.copy(alpha = 0.6f)).clickable { onChange("") }, contentAlignment = Alignment.Center) {
            Icon(Sf.xmark, "清除", tint = p.ground, modifier = Modifier.size(12.dp))
        }
    }
}

/** How far a list with a large title has scrolled past it: the small title in the top row shows from then on. */
@Composable
fun titleShown(state: LazyListState): Float {
    val past by remember { derivedStateOf { state.firstVisibleItemIndex > 0 || state.firstVisibleItemScrollOffset > 70 } }
    return animateFloatAsState(if (past) 1f else 0f, tween(180), label = "title").value
}

@Composable
private fun Toast() {
    val p = LocalPalette.current
    val t = Desk.toast
    var last by remember { mutableStateOf("") }
    if (t != null) last = t
    AnimatedVisibility(t != null, enter = fadeIn() + slideInVertically { -it / 2 }, exit = fadeOut(), modifier = Modifier.fillMaxWidth().zIndex(30f)) {
        Box(Modifier.fillMaxWidth().statusBarsPadding().padding(top = BAR.dp + 6.dp), contentAlignment = Alignment.TopCenter) {
            Text(last, color = p.ink, fontSize = 14.sp, modifier = Modifier.padding(horizontal = 24.dp).liquid(p, wash = 0.6f).padding(horizontal = 16.dp, vertical = 10.dp))
        }
    }
}

@Composable
fun Empty(title: String, detail: String, icon: ImageVector, modifier: Modifier) {
    val p = LocalPalette.current
    Column(modifier.padding(40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(icon, null, tint = p.ink3, modifier = Modifier.size(44.dp))
        Spacer(Modifier.height(12.dp))
        Text(title, color = p.ink, fontSize = 21.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        Text(detail, color = p.ink2, fontSize = 15.sp, textAlign = TextAlign.Center)
    }
}

/** iOS's confirmation: a sheet from the bottom, the question, the red action, 取消 apart. */
@Composable
fun Confirm(title: String, detail: String, action: String, cancel: () -> Unit, go: () -> Unit) {
    val p = LocalPalette.current
    FullScreen(cancel) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.25f)).clickable(remember { MutableInteractionSource() }, null, onClick = cancel))
        var on by remember { mutableStateOf(false) }
        LaunchedEffect(Unit) { on = true }
        AnimatedVisibility(on, Modifier.align(Alignment.BottomCenter), enter = slideInVertically(spring(dampingRatio = 0.85f, stiffness = 500f)) { it } + fadeIn()) {
            Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(10.dp)) {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(p.paper.copy(alpha = 0.96f))) {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(title, color = p.ink2, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
                        if (detail.isNotEmpty()) Text(detail, color = p.ink2, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp))
                    }
                    Box(Modifier.fillMaxWidth().height(0.5.dp).background(p.ink.copy(alpha = 0.12f)))
                    Box(Modifier.fillMaxWidth().height(56.dp).clickable(onClick = go), contentAlignment = Alignment.Center) {
                        Text(action, color = p.red, fontSize = 19.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 16.dp))
                    }
                }
                Spacer(Modifier.height(8.dp))
                Box(Modifier.fillMaxWidth().height(56.dp).clip(RoundedCornerShape(16.dp)).background(p.paper.copy(alpha = 0.98f)).clickable(onClick = cancel),
                    contentAlignment = Alignment.Center) { Text("取消", color = p.ink, fontSize = 19.sp, fontWeight = FontWeight.SemiBold) }
            }
        }
    }
}

// ---- the app -----------------------------------------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Main(person: Person, onSignedIn: () -> Unit) {
    val ctx = LocalContext.current
    LaunchedEffect(person.token) {
        onSignedIn()
        Desk.open(person)
        Chat.start(person.login, person.token)
        Chat.checkAvatar()
        Calls.start(ctx)
    }
    val tab = Shell.tab
    LaunchedEffect(tab) {
        if (tab == Tab.Docs && Desk.arts == null) Desk.loadArts()
        Desk.aiVisible = tab == Tab.AI
        if (tab == Tab.AI) Desk.answered = Desk.answered - Desk.currentSession()
    }
    // A layer on top (a sheet, the pager) takes the back key itself (LayerHost).
    BackHandler(enabled = Layers.list.isEmpty() && (tab != Tab.AI || ChatShell.open())) { Shell.back() }
    val ime = WindowInsets.isImeVisible
    val haze = Glass.main
    val density = LocalDensity.current
    val topInset = with(density) { WindowInsets.statusBars.getTop(this).toDp() }
    val navInset = with(density) { WindowInsets.navigationBars.getBottom(this).toDp() }
    var plus by remember { mutableStateOf(false) }

    // On AI the page draws its own frosted edges (the WebView stays out of the app's blur), so the bars there are glass.
    CompositionLocalProvider(LocalHaze provides if (tab == Tab.AI) null else haze) {
        Box(Modifier.fillMaxSize()) {
            // What the bars blur: the pages (both kept attached: the AI page keeps its live connection).
            // The AI page's own conversation is a WebView: drawn twice in a frame (once for the blur) it draws nothing,
            // so it stays out of what the bars blur and draws its own scroll edges (Desk.edges).
            DeskBackground()
            AiPage(person, topInset, navInset, tab == Tab.AI)
            HazeSource(if (tab == Tab.AI) null else haze, Modifier.fillMaxSize()) {
                if (tab != Tab.AI) DeskBackground()
                when (tab) {
                    Tab.History -> HistoryPage()
                    Tab.Docs -> DocsPage()
                    Tab.Chat -> ChatListPage()
                    else -> {}
                }
            }
            if (tab != Tab.AI) {
                EdgeBlur(true, topInset + BAR.dp + 14.dp, Modifier.align(Alignment.TopCenter))
                EdgeBlur(false, navInset + TABS.dp, Modifier.align(Alignment.BottomCenter))
            }
            // The page's own bar.
            when (tab) {
                Tab.AI -> TopRow(Desk.currentTitle, leading = { GlassCircle(Sf.gear, "设置") { Shell.settings = true } }) {
                    GlassCircle(Sf.newChat, "新对话") { Desk.newChat() }
                }
                Tab.History -> TopRow("History", PageTitle.history, { GlassCircle(Sf.gear, "设置") { Shell.settings = true } }) {
                    GlassCircle(Sf.newChat, "新对话") { Desk.newChat(); Shell.tab = Tab.AI }
                }
                Tab.Docs -> TopRow("Docs", PageTitle.docs, { GlassCircle(Sf.gear, "设置") { Shell.settings = true } })
                Tab.Chat -> TopRow("Chat", PageTitle.chat, { GlassCircle(Sf.gear, "设置") { Shell.settings = true } }) {
                    GlassCircle(Sf.menu, "更多") { ChatShell.menu = true }
                }
            }
            if (tab == Tab.AI && Desk.state == DeskState.Ready) {
                PhoneComposer(
                    Modifier.align(Alignment.BottomCenter).imePadding().navigationBarsPadding().padding(start = 16.dp, end = 16.dp, bottom = if (ime) 8.dp else (TABS + 4).dp),
                    attached = Desk.attached, detach = { Desk.detach(it) }, plus = { plus = true }, token = person.token,
                ) { text -> send(text) }
            }
            if (!ime) TabBar(Modifier.align(Alignment.BottomCenter))
            if (tab == Tab.Chat) ChatMenu()
            ChatOverlays(person)
            // Hidden, but in the window: the chat page that carries the calls (a page outside one stops its sound).
            Web(Desk.chatWeb, Modifier.size(1.dp).alpha(0.01f))
        }
    }
    if (plus) PlusSheet(withDocs = true, close = { plus = false }) { pick ->
        when (pick) {
            is PlusPick.File -> Desk.askFile(pick.f.name, pick.f.mime, pick.f.bytes)
            is PlusPick.Doc -> { Desk.ask("window.tdhPhone && tdhPhone.askArtifact ? tdhPhone.askArtifact(${JSONObject.quote(pick.a.path)}) : {ok:false}") { s ->
                if (runCatching { JSONObject(s).optBoolean("ok") }.getOrDefault(true)) Desk.attached = Desk.attached + pick.a.title else Desk.say("没放进去，稍后再试")
            } }
        }
    }
    if (Shell.settings) SettingsSheet(person) { Shell.settings = false }
    Shell.viewer?.let { (list, at) -> ArtifactPager(list, at) }
    if (Chat.needsAvatar) FullScreen({}, back = false) { AvatarSetup() }
}

/** How far each page with a large title has scrolled (its small title fades in at the top row). */
object PageTitle {
    var history by mutableStateOf(0f)
    var docs by mutableStateOf(0f)
    var chat by mutableStateOf(0f)
}

@Composable
fun Web(view: WebView?, modifier: Modifier, visible: Boolean = true) {
    if (view == null) return
    AndroidView({
        (view.parent as? ViewGroup)?.removeView(view)
        view.layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        view
    }, modifier, update = { it.visibility = if (visible) android.view.View.VISIBLE else android.view.View.INVISIBLE })
}

@Composable
private fun TabBar(modifier: Modifier) {
    val p = LocalPalette.current
    val view = LocalView.current
    val unread = Chat.topics.filter { Chat.shows(it) }.sumOf { it.unread }
    Box(modifier.navigationBarsPadding().padding(start = 22.dp, end = 22.dp, bottom = 8.dp).zIndex(6f)) {
        BoxWithConstraints(Modifier.fillMaxWidth().height(62.dp).liquid(p, wash = 0.34f).padding(4.dp)) {
            val w = maxWidth / Tab.entries.size
            val at by animateDpAsState(w * Shell.tab.ordinal, spring(dampingRatio = 0.75f, stiffness = 380f), label = "thumb")
            Box(Modifier.offset(x = at).width(w).fillMaxHeight().clip(CircleShape).background(p.ink.copy(alpha = if (p.dark) 0.13f else 0.08f)))
            Row(Modifier.fillMaxSize()) {
                Tab.entries.forEach { t ->
                    val on = Shell.tab == t
                    val badge = when (t) { Tab.History -> Desk.answered.size; Tab.Chat -> unread; else -> 0 }
                    Column(
                        Modifier.weight(1f).fillMaxHeight().clickable(remember { MutableInteractionSource() }, null) {
                            if (Shell.tab != t) view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                            Shell.tab = t
                        },
                        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                    ) {
                        Box {
                            val s by animateFloatAsState(if (on) 1.08f else 1f, spring(dampingRatio = 0.5f, stiffness = 600f), label = "tab")
                            Icon(t.icon(), t.label, tint = if (on) p.ink else p.ink.copy(alpha = 0.72f), modifier = Modifier.size(25.dp).scale(s))
                            if (badge > 0) Text(if (badge > 99) "99+" else "$badge", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                                textAlign = TextAlign.Center, modifier = Modifier.align(Alignment.TopEnd).offset(10.dp, (-5).dp).clip(CircleShape)
                                    .background(p.red).widthIn(min = 18.dp).padding(horizontal = 5.dp, vertical = 1.dp))
                        }
                        Spacer(Modifier.height(2.dp))
                        Text(t.label, color = if (on) p.ink else p.ink.copy(alpha = 0.72f), fontSize = 10.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium)
                    }
                }
            }
        }
    }
}

// ---- AI ---------------------------------------------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AiPage(person: Person, topInset: Dp, navInset: Dp, shown: Boolean) {
    val ime = WindowInsets.isImeVisible
    // What lies over the page at its bottom: the composer and, unless typing, the tab bar.
    val bottom = 64 + (if (ime) 0 else TABS + 4)
    LaunchedEffect(topInset, bottom, navInset) { Desk.setInsets((topInset.value + BAR).roundToInt(), (bottom + navInset.value).roundToInt()) }
    Box(Modifier.fillMaxSize().imePadding()) {
        Web(Desk.web, Modifier.fillMaxSize().alpha(if (Desk.state == DeskState.Ready) 1f else 0f), visible = shown)
        if (!shown) return@Box
        // Thinking: the drops right under the question, where the answer begins (the page keeps their room).
        val at = Desk.thinkingAt
        AnimatedVisibility(Desk.state == DeskState.Ready && Desk.thinking && at[1] > 0f, enter = fadeIn(tween(200)), exit = fadeOut(tween(200))) {
            LavaDots(48.dp, 24.dp, Modifier.offset(at[0].dp, (at[1] + at[3] / 2 - 12).dp))
        }
        if (Desk.state == DeskState.Ready) {
            val w = Desk.welcome
            Box(Modifier.alpha(animateFloatAsState(if (w) 1f else 0f, tween(180), label = "welcome").value)) {
                if (w) AIWelcome(Chat.people[Chat.me]?.name ?: person.name, Modifier.padding(top = topInset + BAR.dp)) { text -> send(text) }
            }
        } else if (Desk.state == DeskState.Failed) {
            Column(Modifier.align(Alignment.Center).padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(Desk.failed.ifEmpty { "工作台没打开" }, color = LocalPalette.current.ink2, fontSize = 14.sp, textAlign = TextAlign.Center)
                Spacer(Modifier.height(14.dp))
                Capsule("重试", prominent = false) { Desk.state = DeskState.Idle; Desk.open(person) }
            }
        } else LavaDots(96.dp, 48.dp, Modifier.align(Alignment.Center))
    }
}

private fun send(text: String) {
    Desk.send(text) { ok -> if (!ok) Desk.say("没发出去，稍后再试") }
}

private class Idea(val icon: ImageVector, val tint: Color, val title: String, val detail: String, val prompt: String)

private val ideas by lazy {
    listOf(
        Idea(Sf.envelope, Color(0xFF0A84FF), "整理邮件", "挑出要回的，其余归档", "帮我整理今天的邮件，挑出需要我回复的，其余的归档。"),
        Idea(Sf.docRich, Color(0xFFFF3B30), "做报价单", "按模板排版，直接出 PDF", "帮我做一份报价单，排好版后导出成 PDF。需要的信息你先问我。"),
        Idea(Sf.chart, Color(0xFF34C759), "查车间产量", "本月产量合格率，对比上月", "汇总本月各车间的产量和合格率，和上个月对比一下。"),
        Idea(Sf.newChat, Color(0xFFAF52DE), "回复客户", "帮你起草，语气得体", "帮我起草一封给客户的回复邮件，语气正式、要点清楚。内容你先问我。"),
    )
}

/** A new conversation: the greeting by the time of day and the person's name, one question, four things to tap. */
@Composable
private fun AIWelcome(name: String, modifier: Modifier, ask: (String) -> Unit) {
    val p = LocalPalette.current
    val h = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
    val part = when { h < 5 -> "夜深了"; h < 11 -> "早上好"; h < 13 -> "中午好"; h < 18 -> "下午好"; else -> "晚上好" }
    Column(modifier.fillMaxWidth()) {
        Spacer(Modifier.height(72.dp))
        Text(if (name.isEmpty()) part else "$part，$name", Modifier.fillMaxWidth().padding(horizontal = 24.dp).rise(0), color = p.ink, fontSize = 28.sp,
            fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text("今天先帮你处理点什么？", Modifier.fillMaxWidth().rise(1), color = p.ink2, fontSize = 17.sp, textAlign = TextAlign.Center)
        Spacer(Modifier.height(28.dp))
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            ideas.chunked(2).forEachIndexed { r, row ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    row.forEachIndexed { c, idea ->
                        Column(Modifier.weight(1f).heightIn(min = 118.dp).rise(2 + r * 2 + c).frosted(p).press({ ask(idea.prompt) }).padding(14.dp)) {
                            Box(Modifier.size(34.dp).clip(RoundedCornerShape(10.dp)).background(idea.tint.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
                                Icon(idea.icon, null, tint = idea.tint, modifier = Modifier.size(19.dp))
                            }
                            Spacer(Modifier.height(10.dp))
                            Text(idea.title, color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                            Spacer(Modifier.height(3.dp))
                            Text(idea.detail, color = p.ink2, fontSize = 12.sp, maxLines = 2)
                        }
                    }
                }
            }
        }
    }
}

// ---- the composer (PhoneComposer) ----------------------------------------------------------------------------------------

/**
 * 「+」 · 按住说话 (or the words being typed) · the keyboard (or the waveform back). Holding: the voice as a wave above
 * the field, slide up to cancel. Typing with words: the send drop comes out beside the field. [onVoice] given, holding
 * records a voice message (the chat) instead of turning speech into words (AI).
 */
@Composable
fun PhoneComposer(
    modifier: Modifier, placeholder: String = "有什么需要我做的?", attached: List<String> = emptyList(), detach: ((String) -> Unit)? = null,
    plus: () -> Unit, token: String, onVoice: ((Voice.Take) -> Unit)? = null, onSend: (String) -> Unit,
) {
    val p = LocalPalette.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    var typing by remember { mutableStateOf(false) }
    var text by remember { mutableStateOf("") }
    var holding by remember { mutableStateOf(false) }
    var cancel by remember { mutableStateOf(false) }
    var reading by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    LaunchedEffect(typing) { if (typing) runCatching { focus.requestFocus() } }
    LaunchedEffect(note) { if (note.isNotEmpty()) { delay(2400); note = "" } }
    fun submit() {
        val t = text.trim()
        if (t.isEmpty() && attached.isEmpty()) return
        text = ""
        onSend(t)
    }
    val canSend = typing && text.isNotBlank()

    Box(modifier.fillMaxWidth().zIndex(5f)) {
        // Above the field, taking no room: the wave while holding, or a word on what went wrong.
        Box(Modifier.align(Alignment.TopCenter).offset(y = (-8).dp).graphicsLayer { translationY = -size.height }) {
            AnimatedVisibility(holding, enter = fadeIn() + scaleIn(initialScale = 0.92f), exit = fadeOut() + scaleOut(targetScale = 0.95f)) {
                HoldWave(cancel, Voice.level, if (onVoice != null) Voice.seconds else null)
            }
            AnimatedVisibility(!holding && (note.isNotEmpty() || reading), enter = fadeIn() + slideInVertically { it / 2 }, exit = fadeOut()) {
                Text(if (reading) "正在识别…" else note, color = p.ink2, fontSize = 13.sp, modifier = Modifier.liquid(p).padding(horizontal = 14.dp, vertical = 8.dp))
            }
        }
        Row(verticalAlignment = Alignment.Bottom) {
            Column(Modifier.weight(1f).liquid(p, RoundedCornerShape(26.dp), wash = 0.36f)) {
                // By place, not by name: two attachments can share a name (the same doc twice).
                if (attached.isNotEmpty()) LazyRow(Modifier.padding(start = 10.dp, end = 10.dp, top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    itemsIndexed(attached) { _, n ->
                        Row(Modifier.clip(CircleShape).background(p.ink.copy(alpha = 0.06f)).padding(horizontal = 10.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            Icon(Sf.paperclip, null, tint = p.ink, modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(4.dp))
                            Text(n, color = p.ink, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 160.dp))
                            if (detach != null) {
                                Spacer(Modifier.width(6.dp))
                                Box(Modifier.size(16.dp).clip(CircleShape).background(p.ink3).clickable { detach(n) }, contentAlignment = Alignment.Center) {
                                    Icon(Sf.xmark, "移除 $n", tint = p.ground, modifier = Modifier.size(10.dp))
                                }
                            }
                        }
                    }
                }
                Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(40.dp).clip(CircleShape).clickable(onClick = plus), contentAlignment = Alignment.Center) {
                        Icon(Sf.plus, "添加", tint = p.ink, modifier = Modifier.size(22.dp))
                    }
                    Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                        if (typing) {
                            if (text.isEmpty()) Text(placeholder, color = p.ink3, fontSize = 17.sp, modifier = Modifier.padding(vertical = 9.dp))
                            BasicTextField(text, { text = it }, Modifier.fillMaxWidth().focusRequester(focus).padding(vertical = 9.dp).heightIn(max = 130.dp),
                                textStyle = TextStyle(color = p.ink, fontSize = 17.sp), cursorBrush = SolidColor(p.accent), maxLines = 5,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { submit() }))
                        } else {
                            val s by animateFloatAsState(if (holding) 0.97f else 1f, spring(dampingRatio = 0.86f, stiffness = 800f), label = "hold")
                            Box(Modifier.fillMaxWidth().height(40.dp).scale(s).pointerInput(onVoice != null) {
                                awaitEachGesture {
                                    val down = awaitFirstDown()
                                    if (reading) return@awaitEachGesture
                                    view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                                    if (!Voice.granted(view.context)) {
                                        Desk.askMic?.invoke { ok -> if (!ok) note = "要在手机设置里允许 TDH 使用麦克风" }
                                        return@awaitEachGesture
                                    }
                                    if (!Voice.start(scope)) { note = "麦克风没打开"; return@awaitEachGesture }
                                    holding = true; cancel = false
                                    val y0 = down.position.y
                                    while (true) {
                                        val e = awaitPointerEvent()
                                        val c = e.changes.firstOrNull { it.id == down.id } ?: break
                                        val now = y0 - c.position.y > 60.dp.toPx()
                                        if (now != cancel) { cancel = now; view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK) }
                                        if (!c.pressed) break
                                    }
                                    holding = false
                                    val got = Voice.finish()
                                    if (cancel) { cancel = false; return@awaitEachGesture }
                                    if (got == null) { note = "说话时间太短"; return@awaitEachGesture }
                                    view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
                                    if (onVoice != null) { onVoice(got); return@awaitEachGesture }
                                    reading = true
                                    scope.launch {
                                        val words = Voice.words(got.wav, token)
                                        reading = false
                                        when {
                                            words == null -> note = "语音没转成文字，请再试或打字"
                                            words.isEmpty() -> note = "没听清，再说一次"
                                            else -> onSend(words)
                                        }
                                    }
                                }
                            }, contentAlignment = Alignment.Center) {
                                Text(if (holding) (if (cancel) "松开手指，取消发送" else "松手发送，上滑取消") else "按住说话",
                                    color = if (holding) p.ink2 else p.ink, fontSize = 17.sp, fontWeight = FontWeight.Medium)
                            }
                        }
                    }
                    Box(Modifier.size(40.dp).clip(CircleShape).clickable { typing = !typing }, contentAlignment = Alignment.Center) {
                        AnimatedContent(typing, transitionSpec = { (fadeIn() + scaleIn(initialScale = 0.6f)) togetherWith (fadeOut() + scaleOut(targetScale = 0.6f)) }, label = "kb") { t ->
                            Icon(if (t) Sf.waveform else Sf.keyboard, if (t) "按住说话" else "打字", tint = p.ink, modifier = Modifier.size(23.dp))
                        }
                    }
                }
            }
            // The send drop, out of the field while there are words (and back into it when emptied).
            AnimatedVisibility(canSend, enter = fadeIn() + scaleIn(initialScale = 0.3f, transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0f, 0.5f)),
                exit = fadeOut() + scaleOut(targetScale = 0.3f, transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0f, 0.5f))) {
                Box(Modifier.padding(start = 8.dp).size(52.dp).clip(CircleShape).background(p.ink).press({ submit() }), contentAlignment = Alignment.Center) {
                    Icon(Sf.arrowUp, "发送", tint = p.ground, modifier = Modifier.size(22.dp))
                }
            }
        }
    }
}

/** Holding to talk: a wave above the field (red once slid up to cancel), how long so far for a voice message. */
@Composable
private fun HoldWave(cancel: Boolean, level: Float, seconds: Int?) {
    val p = LocalPalette.current
    val inf = rememberInfiniteTransition(label = "wave")
    val t by inf.animateFloat(0f, 200f, infiniteRepeatable(tween(200_000, easing = androidx.compose.animation.core.LinearEasing)), label = "t")
    Column(Modifier.fillMaxWidth().liquid(p, RoundedCornerShape(24.dp), wash = 0.5f).padding(vertical = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        if (seconds != null && !cancel) {
            Text("%d:%02d".format(seconds / 60, seconds % 60) + if (seconds >= Voice.MAX_SECONDS - 10) "  还能说 ${Voice.MAX_SECONDS - seconds} 秒" else "",
                color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(10.dp))
        }
        Row(Modifier.height(36.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            for (i in 0 until 28) {
                val wob = abs(sin(t * 5 + i * 0.55)) * (0.5 + 0.5 * sin(i * 0.9))
                Box(Modifier.width(3.dp).height((5 + (8 + 26 * level) * wob).dp).clip(CircleShape)
                    .background(if (cancel) p.red.copy(alpha = 0.7f) else p.ink.copy(alpha = 0.7f)))
            }
        }
        Spacer(Modifier.height(10.dp))
        Text(if (cancel) "松开手指，取消发送" else "松手发送，上滑取消", color = if (cancel) p.red else p.ink2, fontSize = 13.sp)
    }
}

// ---- the 「+」 sheet ---------------------------------------------------------------------------------------------------

sealed class PlusPick {
    class File(val f: Picked) : PlusPick()
    class Doc(val a: Art) : PlusPick()
}

/** 「+」: the camera and the latest photos to tap, 全部照片, a file, or one of the Docs. */
@Composable
fun PlusSheet(withDocs: Boolean, close: () -> Unit, picked: (PlusPick) -> Unit) {
    val p = LocalPalette.current
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var recent by remember { mutableStateOf<List<Uri>>(emptyList()) }
    val thumbs = remember { mutableStateMapOf<Uri, ImageBitmap>() }
    var docs by remember { mutableStateOf(false) }
    fun give(x: PlusPick) { close(); picked(x) }
    LaunchedEffect(Unit) {
        Pick.askMedia?.invoke { ok ->
            if (!ok) return@invoke
            scope.launch {
                val l = withContext(Dispatchers.IO) { Media.recent(ctx) }
                recent = l
                for (u in l) withContext(Dispatchers.IO) { Media.thumb(ctx, u) }?.let { thumbs[u] = it.asImageBitmap() }
            }
        }
    }
    Sheet(close, "添加到对话", leading = { SheetX(close) }, trailing = {
        Text("全部照片", color = p.ink, fontSize = 16.sp, fontWeight = FontWeight.Medium, modifier = Modifier.clip(CircleShape)
            .clickable { Pick.photos?.invoke(9) { l -> if (l.isNotEmpty()) { close(); l.forEach { picked(PlusPick.File(it)) } } } }.padding(horizontal = 10.dp, vertical = 6.dp))
    }, half = true) {
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                Box(Modifier.size(84.dp).clip(RoundedCornerShape(16.dp)).background(p.ink2.copy(alpha = 0.12f))
                    .press({ Pick.camera?.invoke { c -> if (c != null) give(PlusPick.File(c)) } }), contentAlignment = Alignment.Center) {
                    Icon(Sf.camera, "拍照", tint = p.ink, modifier = Modifier.size(28.dp))
                }
            }
            items(recent, key = { it.toString() }) { u ->
                Box(Modifier.size(84.dp).clip(RoundedCornerShape(16.dp)).background(p.ink2.copy(alpha = 0.1f)).press({
                    scope.launch { withContext(Dispatchers.IO) { Media.photo(ctx, u) }?.let { give(PlusPick.File(it)) } }
                })) { thumbs[u]?.let { Image(it, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) } }
            }
            if (recent.isEmpty()) item {
                Column(Modifier.size(84.dp).clip(RoundedCornerShape(16.dp)).background(p.ink2.copy(alpha = 0.12f))
                    .press({ Pick.photos?.invoke(9) { l -> if (l.isNotEmpty()) { close(); l.forEach { picked(PlusPick.File(it)) } } } }),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Icon(Sf.photos, null, tint = p.ink, modifier = Modifier.size(26.dp))
                    Text("照片", color = p.ink, fontSize = 12.sp)
                }
            }
        }
        Spacer(Modifier.height(18.dp))
        Column(Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(p.paper)) {
            SheetRow(Sf.folder, "上传文件") { Pick.files?.invoke { l -> if (l.isNotEmpty()) { close(); l.forEach { picked(PlusPick.File(it)) } } } }
            if (withDocs) {
                Box(Modifier.padding(start = 52.dp).fillMaxWidth().height(0.5.dp).background(p.ink.copy(alpha = 0.12f)))
                SheetRow(Sf.doc, "选一个文档", "从 Docs") { docs = true }
            }
        }
    }
    if (docs) DocPickSheet({ docs = false }) { a -> docs = false; give(PlusPick.Doc(a)) }
}

@Composable
fun SheetRow(icon: ImageVector, title: String, value: String? = null, onClick: () -> Unit) {
    val p = LocalPalette.current
    Row(Modifier.fillMaxWidth().height(52.dp).clickable(onClick = onClick).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = p.ink, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(14.dp))
        Text(title, color = p.ink, fontSize = 17.sp, modifier = Modifier.weight(1f))
        if (value != null) { Text(value, color = p.ink2, fontSize = 17.sp); Spacer(Modifier.width(8.dp)) }
        Icon(Sf.chevronRight, null, tint = p.ink3, modifier = Modifier.size(14.dp))
    }
}

/** One of the Docs, for the 「+」 sheet. */
@Composable
private fun DocPickSheet(close: () -> Unit, picked: (Art) -> Unit) {
    val p = LocalPalette.current
    LaunchedEffect(Unit) { if (Desk.arts == null) Desk.loadArts() }
    val rows = Desk.arts?.sortedByDescending { it.updated }
    Sheet(close, "选一个文档", leading = { SheetX(close) }) {
        when {
            rows == null -> Box(Modifier.fillMaxWidth().height(200.dp), contentAlignment = Alignment.Center) { LavaDots() }
            rows.isEmpty() -> Empty("还没有文档", "", Sf.doc, Modifier.fillMaxWidth())
            else -> LazyColumn(Modifier.padding(horizontal = 16.dp).clip(RoundedCornerShape(18.dp)).background(p.paper)) {
                items(rows, key = { it.path }) { a ->
                    Row(Modifier.fillMaxWidth().clickable { picked(a) }.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        DocIcon(a, 36.dp)
                        Spacer(Modifier.width(12.dp))
                        Column {
                            Text(a.title, color = p.ink, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(chatWhen(a.updated), color = p.ink2, fontSize = 12.sp)
                        }
                    }
                }
            }
        }
    }
}

/** A sheet from the bottom, as iOS draws one: the grabber, ×, the title, the page's button; [half] stops halfway first. */
@Composable
fun Sheet(close: () -> Unit, title: String, leading: @Composable () -> Unit = {}, trailing: @Composable () -> Unit = {}, half: Boolean = false,
          content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    val p = LocalPalette.current
    FullScreen(close) {
        var on by remember { mutableStateOf(false) }
        LaunchedEffect(Unit) { on = true }
        val shade by animateFloatAsState(if (on) 0.28f else 0f, tween(250), label = "shade")
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = shade)).clickable(remember { MutableInteractionSource() }, null, onClick = close))
        val drag = remember { Animatable(0f) }
        val scope = rememberCoroutineScope()
        AnimatedVisibility(on, Modifier.align(Alignment.BottomCenter), enter = slideInVertically(spring(dampingRatio = 0.9f, stiffness = 420f)) { it }) {
            Column(Modifier.fillMaxWidth().then(if (half) Modifier.heightIn(max = 520.dp) else Modifier.statusBarsPadding().padding(top = 10.dp).fillMaxHeight())
                .offset { IntOffset(0, drag.value.coerceAtLeast(0f).roundToInt()) }
                .clip(RoundedCornerShape(topStart = 30.dp, topEnd = 30.dp)).background(p.ground).imePadding().navigationBarsPadding()) {
                Column(Modifier.fillMaxWidth().pointerInput(Unit) {
                    detectVerticalDragGestures(onDragEnd = {
                        scope.launch { if (drag.value > 120.dp.toPx()) close() else drag.animateTo(0f, spring(dampingRatio = 0.8f)) }
                    }) { _, d -> scope.launch { drag.snapTo((drag.value + d).coerceAtLeast(0f)) } }
                }) {
                    Box(Modifier.padding(top = 6.dp).align(Alignment.CenterHorizontally).size(36.dp, 5.dp).clip(CircleShape).background(p.ink3.copy(alpha = 0.6f)))
                    Box(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 16.dp)) {
                        Box(Modifier.align(Alignment.CenterStart)) { leading() }
                        Text(title, Modifier.align(Alignment.Center).widthIn(max = 220.dp), color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Box(Modifier.align(Alignment.CenterEnd)) { trailing() }
                    }
                }
                content()
                Spacer(Modifier.height(12.dp))
            }
        }
    }
}

@Composable
fun SheetX(close: () -> Unit) {
    val p = LocalPalette.current
    Box(Modifier.size(36.dp).clip(CircleShape).background(p.ink.copy(alpha = 0.07f)).clickable(onClick = close), contentAlignment = Alignment.Center) {
        Icon(Sf.xmark, "关闭", tint = p.ink, modifier = Modifier.size(17.dp))
    }
}

// ---- History -----------------------------------------------------------------------------------------------------------

@Composable
private fun HistoryPage() {
    val p = LocalPalette.current
    var query by remember { mutableStateOf("") }
    var openRow by remember { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf<Sess?>(null) }
    val q = query.trim()
    val all = Desk.sessions.filter { !it.title.startsWith("_") && (it.title.isNotBlank() && it.title != "新会话" || it.busy) }
    val rows = if (q.isEmpty()) all else all.filter { Desk.titleOf(it.title).contains(q, true) }
    val state = rememberLazyListState()
    val shownTitle = titleShown(state)
    SideEffect { PageTitle.history = shownTitle }
    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), state = state, contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = statusTop() + BAR.dp, bottom = navBottom() + TABS.dp + 30.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item(key = "title") { LargeTitle("History") }
            item(key = "search") { SearchField(query, { query = it }, "搜索过往对话", Modifier.padding(bottom = 4.dp)) }
            listOf("今天", "最近一周", "更早").forEach { g ->
                val list = rows.filter { dayGroup(it.updated) == g }
                if (list.isNotEmpty()) {
                    item(key = "g-$g") { Text(g, color = p.ink2, fontSize = 13.sp, modifier = Modifier.padding(start = 6.dp, top = 8.dp)) }
                    itemsIndexed(list, key = { _, s -> s.id }) { i, s ->
                        val actions = buildList {
                            if (Desk.canArchive) add(SwipeAction("归档", Tone.Sky) {
                                Desk.archive(s.id) { ok -> Desk.say(if (ok) "已归档，电脑上「已归档」里还能找到" else "没归档成功，稍后再试") }
                            })
                            if (Desk.canRemove) add(SwipeAction("删除", Tone.Rose) { deleting = s })
                        }
                        val on = s.id == Desk.current
                        SwipeRow(s.id, openRow, { openRow = it }, actions,
                            Modifier.animateItem().rise(i).frosted(p).then(if (on) Modifier.border(1.5.dp, p.ink.copy(alpha = 0.18f), RoundedCornerShape(22.dp)) else Modifier)) {
                            HistoryCard(s, on, s.id in Desk.answered) {
                                if (openRow != null) { openRow = null; return@HistoryCard }
                                Desk.openSession(s.id); Shell.tab = Tab.AI
                            }
                        }
                    }
                }
            }
        }
        when {
            Desk.state != DeskState.Ready -> Box(Modifier.align(Alignment.Center)) {
                if (Desk.state == DeskState.Failed) Text(Desk.failed, color = p.ink2, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(24.dp))
                else LavaDots(96.dp, 48.dp)
            }
            rows.isEmpty() -> Empty(if (q.isEmpty()) "还没有对话" else "没找到", if (q.isEmpty()) "在 AI 里说第一句话，电脑上的对话也会出现在这里" else "换个词试试",
                if (q.isEmpty()) Sf.history else Sf.search, Modifier.align(Alignment.Center))
        }
    }
    deleting?.let { s ->
        Confirm("删除这个对话？", "删除后电脑上也看不到了，不能恢复。只想收起来就用「归档」。", "删除「${Desk.titleOf(s.title)}」", { deleting = null }) {
            deleting = null
            Desk.remove(s.id) { ok -> Desk.say(if (ok) "已删除" else "没删掉，稍后再试") }
        }
    }
}

@Composable
private fun HistoryCard(s: Sess, on: Boolean, fresh: Boolean, onClick: () -> Unit) {
    val p = LocalPalette.current
    val source = remember { MutableInteractionSource() }
    val down by source.collectIsPressedAsState()
    Column(Modifier.fillMaxWidth().alpha(if (down) 0.55f else 1f).clickable(source, null, onClick = onClick).padding(horizontal = 14.dp, vertical = 15.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (fresh) { Box(Modifier.size(8.dp).clip(CircleShape).background(Color(0xFF7594E6))); Spacer(Modifier.width(6.dp)) }
            Text(Desk.titleOf(s.title), Modifier.weight(1f), color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.width(8.dp))
            Text(chatWhen(s.updated), color = p.ink3, fontSize = 13.sp)
        }
        when {
            s.busy -> Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                val inf = rememberInfiniteTransition(label = "busy")
                val o by inf.animateFloat(0.3f, 1f, infiniteRepeatable(tween(800), RepeatMode.Reverse), label = "o")
                Box(Modifier.size(6.dp).scale(o).alpha(o).clip(CircleShape).background(Color(0xFF0A84FF)))
                Spacer(Modifier.width(5.dp))
                Text("进行中", color = Color(0xFF0A84FF), fontSize = 15.sp)
            }
            fresh -> Text("有新回复", color = Color(0xFF6685DB), fontSize = 15.sp, modifier = Modifier.padding(top = 4.dp))
            on -> Text("正在看的对话", color = p.ink2, fontSize = 15.sp, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

// ---- the swipe (company-phone-swipe-v1): the row slides, flat gradient blocks of its height under it -----------------------

enum class Tone(val light: Color, val deep: Color) {
    Sky(Color(0xFFA8C7FA), Color(0xFF7594E6)), Rose(Color(0xFFF2A3B8), Color(0xFFE06B85))
}

class SwipeAction(val title: String, val tone: Tone, val act: () -> Unit)

/** One row open at a time; a spring, and a rubber band past the end. The card's own frame goes on [modifier]. */
@Composable
fun SwipeRow(id: String, open: String?, setOpen: (String?) -> Unit, actions: List<SwipeAction>, modifier: Modifier = Modifier,
             tile: Dp = 76.dp, content: @Composable () -> Unit) {
    val density = LocalDensity.current
    val full = with(density) { (tile * actions.size).toPx() }
    val x = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(open) { if (open != id && x.value != 0f) x.animateTo(0f, spring(dampingRatio = 0.82f, stiffness = 420f)) }
    Box(modifier.fillMaxWidth()) {
        if (actions.isNotEmpty() && x.value < 0f) Row(Modifier.matchParentSize(), horizontalArrangement = Arrangement.End) {
            actions.forEach { a ->
                Box(Modifier.width(tile).fillMaxHeight().background(Brush.verticalGradient(listOf(a.tone.light, a.tone.deep)))
                    .clickable { setOpen(null); a.act() }, contentAlignment = Alignment.Center) {
                    Text(a.title, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
        Box(Modifier.offset { IntOffset(x.value.roundToInt(), 0) }.pointerInput(actions.size) {
            if (actions.isEmpty()) return@pointerInput
            detectHorizontalDragGestures(
                onDragStart = { if (open != null && open != id) setOpen(null) },
                onDragEnd = { scope.launch { val o = x.value < -full / 2; x.animateTo(if (o) -full else 0f, spring(dampingRatio = 0.82f, stiffness = 420f)); setOpen(if (o) id else null) } },
            ) { _, d ->
                scope.launch {
                    val n = x.value + d
                    x.snapTo(if (n < -full) -full + (n + full) * 0.3f else n.coerceAtMost(0f))
                }
            }
        }) { content() }
    }
}

// ---- Docs -----------------------------------------------------------------------------------------------------------------

@Composable
fun DocIcon(a: Art, size: Dp = 44.dp) {
    val t = (a.title + " " + a.path).lowercase()
    val (icon, tint) = when {
        "pdf" in t || "报价" in t -> Sf.docRich to Color(0xFFFF3B30)
        "xls" in t || "csv" in t || "sheet" in t || "表" in t || "预算" in t -> Sf.table to Color(0xFF34C759)
        "chart" in t || "产量" in t || "统计" in t || "简报" in t || "看板" in t -> Sf.chart to Color(0xFF0A84FF)
        "ppt" in t || "slide" in t -> Sf.slides to Color(0xFFFF9500)
        else -> Sf.doc to Color(0xFFAF52DE)
    }
    Box(Modifier.size(size).clip(RoundedCornerShape(size * 0.27f)).background(tint.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(size * 0.5f))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DocsPage() {
    val p = LocalPalette.current
    var query by remember { mutableStateOf("") }
    var refreshing by remember { mutableStateOf(false) }
    val q = query.trim()
    val arts = Desk.arts?.sortedByDescending { it.updated }
    val shown = arts?.let { l -> if (q.isEmpty()) l else l.filter { it.title.contains(q, true) } }
    LaunchedEffect(Desk.arts) { refreshing = false }
    LaunchedEffect(Desk.state) { if (Desk.state == DeskState.Ready && Desk.arts == null) Desk.loadArts() }
    val state = rememberLazyListState()
    val shownTitle = titleShown(state)
    SideEffect { PageTitle.docs = shownTitle }
    PullToRefreshBox(refreshing, { refreshing = true; Desk.loadArts() }, Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), state = state, contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = statusTop() + BAR.dp, bottom = navBottom() + TABS.dp + 30.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item(key = "title") { LargeTitle("Docs") }
            item(key = "search") { SearchField(query, { query = it }, "搜索文档", Modifier.padding(bottom = 4.dp)) }
            if (shown != null) listOf("今天", "最近一周", "更早").forEach { g ->
                val list = shown.filter { dayGroup(it.updated) == g }
                if (list.isNotEmpty()) {
                    item(key = "g-$g") { Text(g, color = p.ink2, fontSize = 13.sp, modifier = Modifier.padding(start = 6.dp, top = 6.dp)) }
                    itemsIndexed(list, key = { _, a -> a.path }) { i, a ->
                        Row(Modifier.fillMaxWidth().animateItem().rise(i).frosted(p).press({ Shell.viewer = shown to shown.indexOf(a) }).padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            DocIcon(a)
                            Spacer(Modifier.width(14.dp))
                            Column(Modifier.weight(1f)) {
                                Text(a.title, color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Spacer(Modifier.height(3.dp))
                                Text(chatWhen(a.updated), color = p.ink2, fontSize = 13.sp)
                            }
                            Icon(Sf.chevronRight, null, tint = p.ink3, modifier = Modifier.size(14.dp))
                        }
                    }
                }
            }
        }
        when {
            shown == null -> LavaDots(96.dp, 48.dp, Modifier.align(Alignment.Center))
            shown.isEmpty() -> Empty(if (q.isEmpty()) "还没有文档" else "没找到", if (q.isEmpty()) "让 AI 写报告、做表格，做好的文件会出现在这里" else "换个词试试",
                if (q.isEmpty()) Sf.doc else Sf.search, Modifier.align(Alignment.Center))
        }
    }
}

@Composable
fun statusTop(): Dp = with(LocalDensity.current) { WindowInsets.statusBars.getTop(this).toDp() }

@Composable
fun navBottom(): Dp = with(LocalDensity.current) { WindowInsets.navigationBars.getBottom(this).toDp() }

/** One document full screen; swipe for the next or the one before. Below it: 转发 and 交给 AI; the menu: 用其他 App 打开. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ArtifactPager(items: List<Art>, start: Int) {
    val p = LocalPalette.current
    val ctx = LocalContext.current
    val pager = rememberPagerState(start.coerceIn(0, maxOf(0, items.size - 1))) { items.size }
    val pages = remember { mutableStateMapOf<String, Pair<String, String>>() }
    var forwarding by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    val item = items.getOrNull(pager.currentPage) ?: return
    val title = pages[item.path]?.first?.ifEmpty { null } ?: item.title
    fun ask() {
        Desk.askArt(item.path); Shell.viewer = null; Shell.tab = Tab.AI
        Desk.say("已放进 AI 对话框，说说要怎么处理，比如「做成 PDF」")
    }
    FullScreen({ Shell.viewer = null }) {
        DeskBackground()
        Column(Modifier.fillMaxSize()) {
            TopRow(title, leading = { GlassCircle(Sf.chevronLeft, "返回") { Shell.viewer = null } }) {
                GlassCircle(Sf.ellipsis, "更多") { menu = true }
            }
            HorizontalPager(pager, Modifier.weight(1f).fillMaxWidth(), beyondViewportPageCount = 1) { i ->
                val a = items[i]
                LaunchedEffect(a.path) { if (pages[a.path] == null) Desk.readArt(a.path) { t, h -> pages[a.path] = t to h } }
                Box(Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 4.dp).clip(RoundedCornerShape(22.dp)).background(Color.White)) {
                    val h = pages[a.path]?.second
                    if (h == null) LavaDots(84.dp, 42.dp, Modifier.align(Alignment.Center))
                    else AndroidView({ c ->
                        WebView(c).apply {
                            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                            settings.javaScriptEnabled = true
                            settings.allowFileAccess = false
                            settings.useWideViewPort = true
                            settings.loadWithOverviewMode = true
                            loadDataWithBaseURL(null, h.ifEmpty { "<p style='font:16px sans-serif;padding:24px'>这个文档没有读出来。</p>" }, "text/html", "utf-8", null)
                        }
                    }, Modifier.fillMaxSize())
                }
            }
            Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                if (items.size > 1) { Text("${pager.currentPage + 1} / ${items.size}", color = p.ink2, fontSize = 12.sp); Spacer(Modifier.height(10.dp)) }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Capsule("转发", Modifier.weight(1f), icon = Sf.forward, prominent = false) { forwarding = true }
                    Capsule("交给 AI", Modifier.weight(1f), icon = Sf.sparkles, tint = Color(0xFF4573ED)) { ask() }
                }
            }
        }
        if (menu) Menu({ menu = false }, listOf(
            MenuItem("转发到聊天", Sf.forward) { forwarding = true },
            MenuItem("交给 AI", Sf.sparkles) { ask() },
            MenuItem("用其他 App 打开", Sf.share) {
                val h = pages[item.path]?.second ?: return@MenuItem Desk.say("文档还没读出来，稍等")
                Desk.openBytes(ctx, title.replace("/", "-") + ".html", "text/html", h.toByteArray())
            },
        ))
        if (forwarding) ForwardSheet(title, { topics, note, done ->
            Desk.ask("window.tdhPhone ? tdhPhone.forwardArtifact(${JSONObject.quote(item.path)}, ${JSONArray(topics)}, ${JSONObject.quote(note)}) : {ok:false, error:'not-ready'}") { s ->
                val j = runCatching { JSONObject(s) }.getOrDefault(JSONObject())
                done(if (j.optBoolean("ok")) null else j.optString("error").ifEmpty { "没转发成功" })
            }
        }) { forwarding = false }
    }
}

class MenuItem(val title: String, val icon: ImageVector, val act: () -> Unit)

/** A glass menu out of the top-right button (as iOS's Menu swells out of it). */
@Composable
fun Menu(close: () -> Unit, items: List<MenuItem>, width: Dp = 220.dp) {
    val p = LocalPalette.current
    Box(Modifier.fillMaxSize().zIndex(9f).clickable(remember { MutableInteractionSource() }, null, onClick = close)) {
        var on by remember { mutableStateOf(false) }
        LaunchedEffect(Unit) { on = true }
        AnimatedVisibility(on, Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(top = 8.dp, end = 16.dp),
            enter = scaleIn(spring(dampingRatio = 0.8f, stiffness = 500f), initialScale = 0.25f, transformOrigin = androidx.compose.ui.graphics.TransformOrigin(1f, 0f)) + fadeIn()) {
            Column(Modifier.width(width).clip(RoundedCornerShape(20.dp)).background(p.paper.copy(alpha = 0.95f))
                .border(0.6.dp, p.rim.copy(alpha = 0.6f), RoundedCornerShape(20.dp))) {
                items.forEachIndexed { i, m ->
                    if (i > 0) Box(Modifier.padding(horizontal = 12.dp).fillMaxWidth().height(0.5.dp).background(p.ink.copy(alpha = 0.12f)))
                    Row(Modifier.fillMaxWidth().height(46.dp).clickable { close(); m.act() }.padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(m.title, color = p.ink, fontSize = 16.sp, modifier = Modifier.weight(1f))
                        Icon(m.icon, null, tint = p.ink, modifier = Modifier.size(18.dp))
                    }
                }
            }
        }
    }
}

// ---- 转发 (ForwardPicker) ----------------------------------------------------------------------------------------------

private class FwdChat(val topic: String, val name: String, val group: Boolean)

/** 转发: the chats this person is in (the last talked with first: 最近聊天 then 全部), several at once, a word with it. */
@Composable
fun ForwardSheet(title: String, send: (List<String>, String, (String?) -> Unit) -> Unit, close: () -> Unit) {
    val p = LocalPalette.current
    val view = LocalView.current
    var chats by remember { mutableStateOf<List<FwdChat>?>(null) }
    val picked = remember { mutableStateListOf<String>() }
    var query by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    LaunchedEffect(Unit) {
        // The chats as the app has them (the last talked with first), the page's list where the app has none yet.
        val mine = Chat.topics.filter { Chat.shows(it) || it.group }.sortedByDescending { it.touched }.map { FwdChat(it.topic, it.name, it.group) }
        if (mine.isNotEmpty()) chats = mine
        else Desk.ask("window.tdhPhone ? tdhPhone.chats() : {topics:[]}") { s ->
            val a = runCatching { JSONObject(s).optJSONArray("topics") }.getOrNull() ?: JSONArray()
            chats = (0 until a.length()).map { i -> a.getJSONObject(i).let { FwdChat(it.optString("topic"), it.optString("name"), it.optBoolean("group")) } }
        }
    }
    fun go() {
        if (picked.isEmpty() || sending) return
        sending = true; error = ""
        val ids = picked.toList()
        send(ids, note.trim()) { e ->
            sending = false
            if (e != null) { error = "转发没成功：$e"; return@send }
            val names = ids.mapNotNull { id -> chats?.firstOrNull { it.topic == id }?.name }
            val who = if (names.size > 3) names.take(3).joinToString("、") + " 等 ${names.size} 个" else names.joinToString("、")
            view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
            Desk.say("已转发给 $who")
            close()
        }
    }
    Sheet(close, "转发「$title」", leading = { SheetX(close) }, trailing = {
        Text(if (sending) "发送中…" else if (picked.size > 1) "发送(${picked.size})" else "发送", color = if (picked.isEmpty() || sending) p.ink3 else p.accent,
            fontSize = 17.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.clip(CircleShape).clickable(enabled = picked.isNotEmpty() && !sending) { go() }.padding(8.dp))
    }) {
        SearchField(query, { query = it }, "搜索同事或群", Modifier.padding(horizontal = 16.dp))
        Spacer(Modifier.height(8.dp))
        val list = chats
        val q = query.trim()
        if (picked.isNotEmpty()) LazyRow(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(picked.toList(), key = { it }) { id ->
                Row(Modifier.animateItem().clip(CircleShape).background(p.accent.copy(alpha = 0.12f)).clickable { picked.remove(id) }.padding(horizontal = 12.dp, vertical = 7.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Text(list?.firstOrNull { it.topic == id }?.name ?: id, color = p.ink, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                    Spacer(Modifier.width(4.dp))
                    Icon(Sf.xmark, null, tint = p.ink, modifier = Modifier.size(10.dp))
                }
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                list == null -> Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) { LavaDots(); Text("正在取聊天列表…", color = p.ink2, fontSize = 13.sp) }
                list.isEmpty() -> Empty("还没有聊天", "先在「聊天」里找同事说句话", Sf.bubbles, Modifier.align(Alignment.Center))
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp)) {
                    fun section(head: String, rows: List<FwdChat>) {
                        if (rows.isEmpty()) return
                        item(key = "h-$head") { Text(head, color = p.ink2, fontSize = 13.sp, modifier = Modifier.padding(start = 14.dp, top = 14.dp, bottom = 6.dp)) }
                        itemsIndexed(rows, key = { _, c -> head + c.topic }) { i, c ->
                            val on = c.topic in picked
                            val shape = RoundedCornerShape(topStart = if (i == 0) 12.dp else 0.dp, topEnd = if (i == 0) 12.dp else 0.dp,
                                bottomStart = if (i == rows.size - 1) 12.dp else 0.dp, bottomEnd = if (i == rows.size - 1) 12.dp else 0.dp)
                            Row(Modifier.fillMaxWidth().clip(shape).background(p.paper).clickable {
                                error = ""
                                if (on) picked.remove(c.topic) else picked.add(c.topic)
                                view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                            }.padding(horizontal = 14.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(36.dp).clip(RoundedCornerShape(if (c.group) 11.dp else 18.dp)).background(nameColor(c.name)), contentAlignment = Alignment.Center) {
                                    Text(initials(c.name), color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                                }
                                Spacer(Modifier.width(12.dp))
                                Text(c.name, color = p.ink, fontSize = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, false))
                                if (c.group) { Spacer(Modifier.width(6.dp)); GroupTag() }
                                Spacer(Modifier.weight(1f))
                                Icon(if (on) Sf.checkCircle else Sf.circle, null, tint = if (on) p.accent else p.ink3.copy(alpha = 0.6f), modifier = Modifier.size(24.dp))
                            }
                        }
                    }
                    if (q.isEmpty()) { section("最近聊天", list.take(5)); section("全部", list.drop(5)) }
                    else section("搜索结果", list.filter { it.name.contains(q, true) })
                }
            }
        }
        if (error.isNotEmpty()) Text(error, color = p.red, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
        Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp).fillMaxWidth().height(46.dp).clip(CircleShape).background(p.paper).padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) {
                if (note.isEmpty()) Text("留言（可不填）", color = p.ink3, fontSize = 16.sp)
                BasicTextField(note, { note = it }, singleLine = true, textStyle = TextStyle(color = p.ink, fontSize = 16.sp), cursorBrush = SolidColor(p.accent),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { go() }), modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable
fun GroupTag() {
    val p = LocalPalette.current
    Text("群", color = p.ink2, fontSize = 11.sp, modifier = Modifier.clip(RoundedCornerShape(5.dp)).background(p.ink.copy(alpha = 0.06f)).padding(horizontal = 6.dp, vertical = 2.dp))
}

// ---- 设置 (PhoneSettings) ----------------------------------------------------------------------------------------------

@Composable
private fun SettingsSheet(person: Person, close: () -> Unit) {
    val p = LocalPalette.current
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var legal by remember { mutableStateOf<String?>(null) }
    var out by remember { mutableStateOf(false) }
    var avatar by remember { mutableStateOf(false) }
    val me = Chat.people[Chat.me]
    val name = me?.name?.takeIf { it.isNotEmpty() && it != "我" } ?: person.name.ifEmpty { person.login }
    Sheet(close, "设置", trailing = { SheetX(close) }) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
            Column(Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Avatar(name, 76.dp, me?.photo)
                Spacer(Modifier.height(8.dp))
                Text(name, color = p.ink, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                Text(listOf(person.deptName, person.roleText).filter { it.isNotEmpty() }.joinToString(" · "), color = p.ink2, fontSize = 15.sp)
            }
            Group("账号") {
                LabelRow(Sf.personCircle, "更换头像", chevron = false) { avatar = true }
                if (person.deptName.isNotEmpty()) { Divider(); LabelRow(Sf.building, "部门", person.deptName) }
                if (person.roleText.isNotEmpty()) { Divider(); LabelRow(Sf.personKey, "角色", person.roleText) }
                if (person.login.isNotEmpty()) { Divider(); LabelRow(Sf.at, "登录名", person.login) }
            }
            Text("外观", color = p.ink2, fontSize = 13.sp, modifier = Modifier.padding(start = 16.dp, top = 22.dp, bottom = 6.dp))
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(p.ink.copy(alpha = 0.07f)).padding(2.dp)) {
                Appearance.entries.forEach { a ->
                    val on = Look.appearance == a
                    Box(Modifier.weight(1f).height(32.dp).clip(RoundedCornerShape(8.dp)).background(if (on) p.paper else Color.Transparent)
                        .clickable { Look.set(ctx, a) }, contentAlignment = Alignment.Center) {
                        Text(a.label, color = p.ink, fontSize = 13.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium)
                    }
                }
            }
            Group("通用") {
                LabelRow(Sf.server, "公司服务器", if (Net.base != null) "已连接" else "未连接")
                Divider()
                LabelRow(Sf.bubbles, "聊天", if (Chat.connected) "已连接" else "正在连接")
                Divider()
                LabelRow(Sf.info, "关于 TDH", BuildConfig.VERSION_NAME + " Beta")
            }
            Group("关于") {
                listOf(Triple("terms", "服务协议", Sf.doc), Triple("privacy", "隐私政策", Sf.hand), Triple("disclaimer", "免责声明", Sf.shield)).forEachIndexed { i, (k, t, ic) ->
                    if (i > 0) Divider()
                    LabelRow(ic, t, chevron = true) { legal = k }
                }
            }
            Spacer(Modifier.height(22.dp))
            Box(Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(12.dp)).background(p.paper).clickable { out = true }, contentAlignment = Alignment.Center) {
                Text("退出登录", color = p.red, fontSize = 17.sp)
            }
            Text("退出后这台手机不再保持登录，下次要重新用手机号验证码登录。", color = p.ink2, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            Spacer(Modifier.height(20.dp))
        }
    }
    legal?.let { LegalPage(it) { legal = null } }
    if (avatar) AvatarSetup(again = true) { avatar = false }
    if (out) Confirm("退出登录？", "", "退出登录", { out = false }) {
        out = false
        close()
        // Not in this sheet's scope: closing the sheet cancels it.
        AppScope.launch { signOutAll(ctx) }
    }
}

@Composable
private fun Group(title: String, content: @Composable () -> Unit) {
    val p = LocalPalette.current
    Text(title, color = p.ink2, fontSize = 13.sp, modifier = Modifier.padding(start = 16.dp, top = 22.dp, bottom = 6.dp))
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(p.paper)) { content() }
}

@Composable
private fun Divider() {
    val p = LocalPalette.current
    Box(Modifier.padding(start = 54.dp).fillMaxWidth().height(0.5.dp).background(p.ink.copy(alpha = 0.12f)))
}

@Composable
private fun LabelRow(icon: ImageVector, title: String, value: String? = null, chevron: Boolean = false, onClick: (() -> Unit)? = null) {
    val p = LocalPalette.current
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = p.ink, modifier = Modifier.size(21.dp))
        Spacer(Modifier.width(16.dp))
        Text(title, color = p.ink, fontSize = 17.sp, modifier = Modifier.weight(1f))
        if (value != null) Text(value, color = p.ink2, fontSize = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 180.dp))
        if (chevron) { Spacer(Modifier.width(6.dp)); Icon(Sf.chevronRight, null, tint = p.ink3, modifier = Modifier.size(14.dp)) }
    }
}

/** 服务协议 · 隐私政策 · 免责声明, full screen. */
@Composable
fun LegalPage(name: String, close: () -> Unit) {
    val p = LocalPalette.current
    val ctx = LocalContext.current
    val text = remember(name) { runCatching { ctx.assets.open("legal/$name.txt").bufferedReader().use { it.readText() } }.getOrDefault("") }
    val title = when (name) { "terms" -> "服务协议"; "privacy" -> "隐私政策"; else -> "免责声明" }
    FullScreen(close) {
        DeskBackground()
        Column(Modifier.fillMaxSize()) {
            TopRow(title, leading = { GlassCircle(Sf.chevronLeft, "返回", onClick = close) })
            Text(text, Modifier.weight(1f).verticalScroll(rememberScrollState()).navigationBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp).frosted(p).padding(20.dp),
                fontSize = 15.sp, color = p.ink, lineHeight = 25.sp)
        }
    }
}
