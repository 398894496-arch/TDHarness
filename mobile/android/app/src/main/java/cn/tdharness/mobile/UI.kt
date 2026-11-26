package cn.tdharness.mobile

// company-android-look-v1 (the user, 2026-11-26: 「安卓只是功能一样吗 为什么UI完全不一样」「重做并修连接」): the iPhone's app
// on Android — History · AI · Chat · Docs on a floating glass bar, the gear and 新对话 on glass at the top, the
// conversation under them, the greeting and its four cards on a new conversation, the Today-style composer (「+」 ·
// 按住说话 / typing · keyboard), the drops while it thinks, History's cards with a swipe, Docs' cards, the settings
// sheet. Mirrors mobile/ios/TDH (TDHApp, DeskTab, PhonePages, PhoneParts, PhoneShell, LoginView).

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.view.HapticFeedbackConstants
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Contacts
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.DriveFileRenameOutline
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.GraphicEq
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Keyboard
import androidx.compose.material.icons.outlined.MarkEmailRead
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Shortcut
import androidx.compose.material.icons.outlined.TableChart
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.zIndex
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

enum class Tab(val label: String, val icon: ImageVector) {
    History("History", Icons.Outlined.History), AI("AI", Icons.Outlined.AutoAwesome),
    Chat("Chat", Icons.Outlined.ChatBubbleOutline), Docs("Docs", Icons.Outlined.Description),
}

object Shell {
    var tab by mutableStateOf(Tab.AI)
    var viewer by mutableStateOf<Art?>(null)

    /** The back key: true when it was used here. */
    fun back(): Boolean {
        if (viewer != null) { viewer = null; return true }
        if (tab == Tab.Chat && Desk.chatWeb?.canGoBack() == true) { Desk.chatWeb?.goBack(); return true }
        if (tab != Tab.AI) { tab = Tab.AI; return true }
        return false
    }
}

private const val BAR = 56          // the top bar under the status bar, dp
private const val TABS = 64         // the floating tab bar, dp (with its margin)

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
        PillButton("重试") { scope.launch { Net.forget(); Session.resume() } }
    }
}

// ---- parts ---------------------------------------------------------------------------------------------------------

@Composable
fun PillButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, busy: Boolean = false, prominent: Boolean = true, onClick: () -> Unit) {
    val p = LocalPalette.current
    val bg = if (prominent) p.ink.copy(alpha = if (enabled) 1f else 0.3f) else Color.Transparent
    Box(
        modifier.height(50.dp).then(if (prominent) Modifier.clip(CircleShape).background(bg) else Modifier.glass(p, CircleShape))
            .press(onClick, enabled && !busy).padding(horizontal = 22.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = if (prominent) p.ground else p.ink, strokeWidth = 2.dp)
        else Text(text, color = if (prominent) (if (p.dark) Color(0xFF14171F) else Color.White) else p.ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun GlassIcon(icon: ImageVector, label: String, size: Int = 44, onClick: () -> Unit) {
    val p = LocalPalette.current
    Box(Modifier.size(size.dp).glass(p).press(onClick), contentAlignment = Alignment.Center) {
        Icon(icon, label, tint = p.ink, modifier = Modifier.size(21.dp))
    }
}

@Composable
private fun Toast() {
    val p = LocalPalette.current
    val t = Desk.toast
    AnimatedVisibility(t != null, enter = fadeIn() + slideInVertically { -it / 2 }, exit = fadeOut(), modifier = Modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth().statusBarsPadding().padding(top = 64.dp), contentAlignment = Alignment.TopCenter) {
            Text(t ?: "", color = Color.White, fontSize = 14.sp,
                modifier = Modifier.clip(CircleShape).background(Color(0xE01E2434)).padding(horizontal = 18.dp, vertical = 11.dp))
        }
    }
}

// ---- sign-in -------------------------------------------------------------------------------------------------------

@Composable
private fun Field(value: String, onChange: (String) -> Unit, hint: String, modifier: Modifier = Modifier, keyboard: KeyboardType = KeyboardType.Text,
                  password: Boolean = false, prefix: String = "") {
    val p = LocalPalette.current
    Row(modifier.height(54.dp).fillMaxWidth().frosted(p, CircleShape).padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
        if (prefix.isNotEmpty()) { Text(prefix, color = p.ink2, fontSize = 17.sp); Spacer(Modifier.width(10.dp)) }
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Text(hint, color = p.ink3, fontSize = 17.sp)
            BasicTextField(value, onChange, singleLine = true, textStyle = TextStyle(color = p.ink, fontSize = 17.sp), cursorBrush = SolidColor(p.accent),
                keyboardOptions = KeyboardOptions(keyboardType = keyboard), modifier = Modifier.fillMaxWidth(),
                visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None)
        }
    }
}

@Composable
private fun Login() {
    val p = LocalPalette.current
    val scope = rememberCoroutineScope()
    var phone by remember { mutableStateOf(Session.lastPhone) }
    var code by remember { mutableStateOf("") }
    var user by remember { mutableStateOf("") }
    var pw by remember { mutableStateOf("") }
    var agreed by remember { mutableStateOf(false) }
    var byPassword by remember { mutableStateOf(false) }
    var wait by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf(Session.problem) }
    var legal by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(wait) { if (wait > 0) { delay(1000); wait -= 1 } }
    val phoneOk = Regex("^1[3-9]\\d{9}$").matches(phone)

    Column(
        Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(64.dp))
        LavaDots(if (busy) 88.dp else 70.dp, if (busy) 45.dp else 36.dp)
        Spacer(Modifier.height(14.dp))
        Text("Beta", color = p.ink2, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.glass(p, CircleShape).padding(horizontal = 12.dp, vertical = 4.dp))
        Spacer(Modifier.height(22.dp))
        Text(if (byPassword) "账号密码登录" else "手机号登录", fontSize = 24.sp, fontWeight = FontWeight.SemiBold, color = p.ink)
        Spacer(Modifier.height(6.dp))
        Text(if (byPassword) "公司给你的登录名和密码" else "公司花名册里登记的手机号", fontSize = 13.sp, color = p.ink2)
        Spacer(Modifier.height(30.dp))
        if (byPassword) {
            Field(user, { user = it.trim() }, "登录名")
            Spacer(Modifier.height(12.dp))
            Field(pw, { pw = it }, "密码", keyboard = KeyboardType.Password, password = true)
        } else {
            Field(phone, { phone = it.filter(Char::isDigit).take(11) }, "手机号", keyboard = KeyboardType.Phone, prefix = "+86")
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Field(code, { code = it.filter(Char::isDigit).take(6) }, "验证码", Modifier.weight(1f), keyboard = KeyboardType.NumberPassword)
                Spacer(Modifier.width(10.dp))
                PillButton(if (wait > 0) "${wait}s" else "获取验证码", Modifier.height(54.dp), enabled = phoneOk && wait == 0 && !busy, prominent = false) {
                    if (!agreed) { note = "请先阅读并同意服务协议和隐私政策"; return@PillButton }
                    busy = true; note = ""
                    scope.launch { val r = Session.sendCode(phone); busy = false; if (r == null) wait = 60 else note = r }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(22.dp).clip(CircleShape).then(if (agreed) Modifier.background(p.ink) else Modifier.border(1.5.dp, p.ink3, CircleShape))
                .clickable { agreed = !agreed }, contentAlignment = Alignment.Center) {
                if (agreed) Icon(Icons.Outlined.Check, null, tint = p.ground, modifier = Modifier.size(15.dp))
            }
            Spacer(Modifier.width(8.dp))
            Text("已阅读并同意", fontSize = 13.sp, color = p.ink2)
            Text("《服务协议》", fontSize = 13.sp, color = p.accent, modifier = Modifier.clickable { legal = "terms" })
            Text("和", fontSize = 13.sp, color = p.ink2)
            Text("《隐私政策》", fontSize = 13.sp, color = p.accent, modifier = Modifier.clickable { legal = "privacy" })
        }
        if (note.isNotEmpty()) Text(note, color = p.red, fontSize = 14.sp, modifier = Modifier.padding(top = 12.dp), textAlign = TextAlign.Center)
        Spacer(Modifier.height(18.dp))
        PillButton("登录", Modifier.fillMaxWidth().height(54.dp), busy = busy,
            enabled = if (byPassword) user.isNotEmpty() && pw.isNotEmpty() else phoneOk && code.length == 6) {
            if (!agreed) { note = "请先阅读并同意服务协议和隐私政策"; return@PillButton }
            busy = true; note = ""
            scope.launch {
                val r = if (byPassword) Session.signInPassword(user, pw) else Session.signInSms(phone, code)
                busy = false
                if (r != null) note = r
            }
        }
        Spacer(Modifier.height(16.dp))
        Text(if (byPassword) "用手机号验证码登录" else "用账号密码登录", fontSize = 14.sp, color = p.ink2,
            modifier = Modifier.clickable { byPassword = !byPassword; note = "" }.padding(8.dp))
        Spacer(Modifier.height(24.dp))
    }
    legal?.let { Legal(it) { legal = null } }
}

@Composable
private fun Legal(name: String, close: () -> Unit) {
    val p = LocalPalette.current
    val ctx = LocalContext.current
    val text = remember(name) { runCatching { ctx.assets.open("legal/$name.txt").bufferedReader().use { it.readText() } }.getOrDefault("") }
    val title = when (name) { "terms" -> "服务协议"; "privacy" -> "隐私政策"; else -> "免责声明" }
    Dialog(close, DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize()) {
            DeskBackground()
            Column(Modifier.systemBarsPadding()) {
                Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    GlassIcon(Icons.Outlined.Close, "关闭", onClick = close)
                    Spacer(Modifier.width(12.dp))
                    Text(title, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = p.ink)
                }
                Text(text, Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).frosted(p).padding(20.dp),
                    fontSize = 15.sp, color = p.ink, lineHeight = 25.sp)
            }
        }
    }
}

// ---- the app -------------------------------------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Main(person: Person, onSignedIn: () -> Unit) {
    val p = LocalPalette.current
    LaunchedEffect(person.token) {
        onSignedIn()
        Desk.open(person)
        Chat.start(person.login, person.token)
    }
    var settings by remember { mutableStateOf(false) }
    val tab = Shell.tab
    LaunchedEffect(tab) {
        if (tab == Tab.Docs) Desk.loadArts()
        Desk.aiVisible = tab == Tab.AI
    }
    BackHandler(enabled = (Shell.viewer != null || tab != Tab.AI) && ChatShell.room.isEmpty()) { Shell.back() }
    val ime = WindowInsets.isImeVisible
    val density = LocalDensity.current
    val topInset = with(density) { WindowInsets.statusBars.getTop(this).toDp() }

    Box(Modifier.fillMaxSize()) {
        // Both pages stay attached (they keep their live connections); each is shown only on its own tab.
        AiPage(person, topInset, tab == Tab.AI)
        val navInset = with(density) { WindowInsets.navigationBars.getBottom(this).toDp() }
        when (tab) {
            Tab.History -> HistoryPage(topInset)
            Tab.Docs -> DocsPage(topInset)
            Tab.Chat -> ChatListPage(topInset + BAR.dp, navInset + TABS.dp)
            else -> {}
        }
        TopBar(tab, onGear = { settings = true })
        if (!ime) TabBar(Modifier.align(Alignment.BottomCenter))
        if (ChatShell.room.isNotEmpty()) ChatRoom(ChatShell.room, person)
        if (ChatShell.contacts) ContactsSheet { ChatShell.contacts = false }
        Toast()
    }
    if (settings) SettingsSheet(person) { settings = false }
    Shell.viewer?.let { Viewer(it) }
}

@Composable
private fun Web(view: WebView?, modifier: Modifier, visible: Boolean = true) {
    if (view == null) return
    AndroidView({
        (view.parent as? ViewGroup)?.removeView(view)
        view.layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        view
    }, modifier, update = { it.visibility = if (visible) android.view.View.VISIBLE else android.view.View.INVISIBLE })
}

@Composable
private fun Cover(failed: Boolean, why: String, retry: () -> Unit) {
    val p = LocalPalette.current
    Box(Modifier.fillMaxSize().zIndex(2f), contentAlignment = Alignment.Center) {
        if (failed) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(32.dp)) {
                Text(why, color = p.ink2, fontSize = 14.sp, textAlign = TextAlign.Center)
                Spacer(Modifier.height(16.dp))
                PillButton("重试", prominent = false, onClick = retry)
            }
        } else LavaDots(96.dp, 48.dp)
    }
}

@Composable
private fun TopBar(tab: Tab, onGear: () -> Unit) {
    val p = LocalPalette.current
    val title = when (tab) { Tab.AI -> Desk.currentTitle; Tab.History -> "History"; Tab.Chat -> "Chat"; Tab.Docs -> "Docs" }
    val big = tab != Tab.AI
    Box(Modifier.fillMaxWidth().zIndex(3f)
        .background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(p.sky[0], p.sky[0].copy(alpha = 0.85f), p.sky[0].copy(alpha = 0f))))
        .statusBarsPadding().height(BAR.dp).padding(horizontal = 12.dp)) {
        GlassIcon(Icons.Outlined.Settings, "设置", onClick = onGear)
        Text(title, Modifier.align(if (big) Alignment.CenterStart else Alignment.Center).padding(start = if (big) 58.dp else 0.dp).widthIn(max = 220.dp),
            color = p.ink, fontSize = if (big) 26.sp else 16.sp, fontWeight = if (big) FontWeight.Bold else FontWeight.SemiBold,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
        Box(Modifier.align(Alignment.CenterEnd)) {
            when (tab) {
                Tab.AI, Tab.History -> GlassIcon(Icons.Outlined.EditNote, "新对话") { Desk.newChat(); Shell.tab = Tab.AI }
                Tab.Docs -> GlassIcon(Icons.Outlined.Refresh, "刷新") { Desk.arts = null; Desk.loadArts() }
                Tab.Chat -> GlassIcon(Icons.Outlined.Contacts, "通讯录") { ChatShell.contacts = true }
            }
        }
    }
}

@Composable
private fun TabBar(modifier: Modifier) {
    val p = LocalPalette.current
    val view = LocalView.current
    Box(modifier.navigationBarsPadding().padding(horizontal = 20.dp, vertical = 6.dp).zIndex(3f)) {
        BoxWithConstraints(Modifier.fillMaxWidth().height(60.dp).glass(p, CircleShape).padding(5.dp)) {
            val w = maxWidth / Tab.entries.size
            val at by animateDpAsState(w * Shell.tab.ordinal, spring(dampingRatio = 0.78f, stiffness = 420f), label = "thumb")
            Box(Modifier.offset(x = at).width(w).fillMaxHeight().clip(CircleShape).background(p.ink.copy(alpha = if (p.dark) 0.14f else 0.09f)))
            Row(Modifier.fillMaxSize()) {
                Tab.entries.forEach { t ->
                    val on = Shell.tab == t
                    Column(
                        Modifier.weight(1f).fillMaxHeight().clickable(remember { MutableInteractionSource() }, null) {
                            if (Shell.tab != t) view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                            Shell.tab = t
                        },
                        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                    ) {
                        Icon(t.icon, t.label, tint = if (on) p.ink else p.ink2, modifier = Modifier.size(22.dp))
                        Text(t.label, color = if (on) p.ink else p.ink2, fontSize = 10.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium)
                    }
                }
            }
        }
    }
}

// ---- AI --------------------------------------------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AiPage(person: Person, topInset: androidx.compose.ui.unit.Dp, shown: Boolean) {
    val p = LocalPalette.current
    val ime = WindowInsets.isImeVisible
    val density = LocalDensity.current
    val navInset = with(density) { WindowInsets.navigationBars.getBottom(this).toDp() }
    // What lies over the page at its bottom: the composer and, unless typing, the tab bar.
    val composerH = 64
    val bottom = composerH + (if (ime) 0 else TABS + 8)
    LaunchedEffect(topInset, bottom, navInset) { Desk.setInsets((topInset.value + BAR).roundToInt(), (bottom + navInset.value).roundToInt()) }
    Box(Modifier.fillMaxSize().imePadding()) {
        Web(Desk.web, Modifier.fillMaxSize(), visible = shown)
        if (!shown) return@Box
        // Thinking: the drops right under the question, where the answer begins (the page keeps their room).
        val at = Desk.thinkingAt
        if (Desk.state == DeskState.Ready && Desk.thinking && at[1] > 0f) {
            LavaDots(48.dp, 24.dp, Modifier.offset(at[0].dp, (at[1] + at[3] / 2 - 12).dp))
        }
        if (Desk.state == DeskState.Ready) {
            AnimatedVisibility(Desk.welcome, enter = fadeIn(), exit = fadeOut()) {
                AIWelcome(person.name, Modifier.padding(top = topInset + BAR.dp)) { text -> send(text) }
            }
        } else {
            Cover(Desk.state == DeskState.Failed, Desk.failed.ifEmpty { "工作台没打开" }) { Desk.state = DeskState.Idle; Desk.open(person) }
        }
        if (Desk.state == DeskState.Ready) {
            Composer(person, Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = if (ime) 6.dp else (TABS + 8).dp))
        }
    }
}

private fun send(text: String) {
    Desk.send(text) { ok -> if (!ok) Desk.say("没发出去，稍后再试") }
}

private class Idea(val icon: ImageVector, val tint: Color, val title: String, val detail: String, val prompt: String)

private val ideas = listOf(
    Idea(Icons.Outlined.MarkEmailRead, Color(0xFF0A84FF), "整理邮件", "挑出要回的，其余归档", "帮我整理今天的邮件，挑出需要我回复的，其余的归档。"),
    Idea(Icons.Outlined.Description, Color(0xFFFF453A), "做报价单", "按模板排版，直接出 PDF", "帮我做一份报价单，排好版后导出成 PDF。需要的信息你先问我。"),
    Idea(Icons.Outlined.BarChart, Color(0xFF30D158), "查车间产量", "本月产量合格率，对比上月", "汇总本月各车间的产量和合格率，和上个月对比一下。"),
    Idea(Icons.Outlined.DriveFileRenameOutline, Color(0xFFBF5AF2), "回复客户", "帮你起草，语气得体", "帮我起草一封给客户的回复邮件，语气正式、要点清楚。内容你先问我。"),
)

@Composable
private fun AIWelcome(name: String, modifier: Modifier, ask: (String) -> Unit) {
    val p = LocalPalette.current
    val h = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
    val part = when { h < 5 -> "夜深了"; h < 11 -> "早上好"; h < 13 -> "中午好"; h < 18 -> "下午好"; else -> "晚上好" }
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        Spacer(Modifier.height(48.dp))
        Text(if (name.isEmpty()) part else "$part，$name", Modifier.fillMaxWidth().rise(0), color = p.ink, fontSize = 28.sp,
            fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text("今天先帮你处理点什么？", Modifier.fillMaxWidth().rise(1), color = p.ink2, fontSize = 16.sp, textAlign = TextAlign.Center)
        Spacer(Modifier.height(28.dp))
        ideas.chunked(2).forEachIndexed { r, row ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEachIndexed { c, idea ->
                    Column(Modifier.weight(1f).heightIn(min = 118.dp).rise(2 + r * 2 + c).frosted(p).press({ ask(idea.prompt) }).padding(14.dp)) {
                        Box(Modifier.size(34.dp).clip(RoundedCornerShape(10.dp)).background(idea.tint.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
                            Icon(idea.icon, null, tint = idea.tint, modifier = Modifier.size(19.dp))
                        }
                        Spacer(Modifier.height(10.dp))
                        Text(idea.title, color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(3.dp))
                        Text(idea.detail, color = p.ink2, fontSize = 12.sp, maxLines = 2)
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
        }
    }
}

/** The Today-style composer: 「+」 · 按住说话 (or the words being typed) · the keyboard (or send). */
@Composable
private fun Composer(person: Person, modifier: Modifier) {
    val p = LocalPalette.current
    val ctx = LocalContext.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    var typing by remember { mutableStateOf(false) }
    var text by remember { mutableStateOf("") }
    var holding by remember { mutableStateOf(false) }
    var cancelling by remember { mutableStateOf(false) }
    var reading by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(typing) { if (typing) runCatching { focus.requestFocus() } }

    fun micGranted() = ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        // Holding: the panel over the composer, the voice's level, how to cancel.
        AnimatedVisibility(holding, enter = fadeIn() + scaleIn(initialScale = 0.92f), exit = fadeOut() + scaleOut(targetScale = 0.95f)) {
            Column(Modifier.fillMaxWidth().padding(bottom = 10.dp).frosted(p, RoundedCornerShape(24.dp)).padding(vertical = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally) {
                Bars(Voice.level, if (cancelling) p.red else p.accent)
                Spacer(Modifier.height(10.dp))
                Text(if (cancelling) "松手取消" else "松手发送，上滑取消", color = if (cancelling) p.red else p.ink2, fontSize = 13.sp)
            }
        }
        // What goes with the next thing said: the files put in, each with its ×.
        if (Desk.attached.isNotEmpty()) Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Desk.attached.take(3).forEach { n ->
                Row(Modifier.glass(p, CircleShape).clickable { Desk.detach(n) }.padding(start = 12.dp, end = 8.dp, top = 7.dp, bottom = 7.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Text(n, color = p.ink, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 140.dp))
                    Spacer(Modifier.width(4.dp))
                    Icon(Icons.Outlined.Close, "移除", tint = p.ink2, modifier = Modifier.size(14.dp))
                }
            }
            if (Desk.attached.size > 3) Text("等 ${Desk.attached.size} 个", color = p.ink2, fontSize = 13.sp, modifier = Modifier.align(Alignment.CenterVertically))
        }
        Row(Modifier.fillMaxWidth().heightIn(min = 54.dp).frosted(p, RoundedCornerShape(27.dp)).padding(horizontal = 6.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(42.dp).clip(CircleShape).clickable { Desk.pickForAi?.invoke() }, contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Add, "添加", tint = p.ink, modifier = Modifier.size(24.dp))
            }
            if (typing) {
                Box(Modifier.weight(1f).padding(vertical = 14.dp)) {
                    if (text.isEmpty()) Text("有什么需要我做的?", color = p.ink3, fontSize = 16.sp)
                    BasicTextField(text, { text = it }, Modifier.fillMaxWidth().focusRequester(focus).heightIn(max = 120.dp),
                        textStyle = TextStyle(color = p.ink, fontSize = 16.sp), cursorBrush = SolidColor(p.accent),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                        keyboardActions = KeyboardActions(onSend = { val t = text.trim(); if (t.isNotEmpty()) { send(t); text = "" } }))
                }
                val can = text.isNotBlank()
                Box(Modifier.size(42.dp).clip(CircleShape).background(if (can) p.ink else Color.Transparent)
                    .clickable { if (can) { send(text.trim()); text = "" } else typing = false }, contentAlignment = Alignment.Center) {
                    Icon(if (can) Icons.AutoMirrored.Outlined.Send else Icons.Outlined.GraphicEq, if (can) "发送" else "按住说话",
                        tint = if (can) p.ground else p.ink, modifier = Modifier.size(20.dp))
                }
            } else {
                Box(
                    Modifier.weight(1f).height(54.dp).pointerInput(Unit) {
                        awaitEachGesture {
                            val down = awaitFirstDown()
                            if (reading) return@awaitEachGesture
                            if (!micGranted()) {
                                Desk.askMic?.invoke { ok -> if (!ok) Desk.say("要在手机设置里允许 TDH 使用麦克风") }
                                return@awaitEachGesture
                            }
                            if (!Voice.start(scope)) { Desk.say("麦克风没打开"); return@awaitEachGesture }
                            view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                            holding = true; cancelling = false
                            val y0 = down.position.y
                            while (true) {
                                val e = awaitPointerEvent()
                                val c = e.changes.firstOrNull { it.id == down.id } ?: break
                                cancelling = y0 - c.position.y > 80.dp.toPx()
                                if (!c.pressed) break
                            }
                            holding = false
                            val got = Voice.finish()
                            if (cancelling || got == null) { if (!cancelling && got == null) Desk.say("说话时间太短"); return@awaitEachGesture }
                            reading = true
                            scope.launch {
                                val words = Voice.words(got.wav, person.token)
                                reading = false
                                when {
                                    words == null -> Desk.say("语音没转成文字，请再试或打字")
                                    words.isEmpty() -> Desk.say("没听清，请再说一次")
                                    else -> send(words)
                                }
                            }
                        }
                    },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(if (reading) "正在识别…" else if (holding) "松手发送" else "按住说话", color = p.ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                }
                Box(Modifier.size(42.dp).clip(CircleShape).clickable { typing = true }, contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.Keyboard, "打字", tint = p.ink, modifier = Modifier.size(22.dp))
                }
            }
        }
    }
}

/** The voice's level as bars (the newest on the right). */
@Composable
private fun Bars(level: Float, color: Color) {
    val history = remember { mutableStateListOf<Float>().apply { repeat(28) { add(0.06f) } } }
    LaunchedEffect(level) { history.removeAt(0); history.add(maxOf(0.06f, level)) }
    Row(Modifier.height(36.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        history.forEach { v ->
            val h by animateFloatAsState(v, spring(dampingRatio = 0.7f, stiffness = 900f), label = "bar")
            Box(Modifier.width(3.dp).height((4 + 32 * h).dp).clip(CircleShape).background(color))
        }
    }
}

// ---- History ---------------------------------------------------------------------------------------------------------

@Composable
private fun HistoryPage(topInset: androidx.compose.ui.unit.Dp) {
    val p = LocalPalette.current
    var openRow by remember { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf<Sess?>(null) }
    val rows = Desk.sessions.filter { it.title != "新会话" && !it.title.startsWith("_") }
    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = topInset + BAR.dp + 8.dp, bottom = (TABS + 40).dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            listOf("今天", "最近一周", "更早").forEach { g ->
                val list = rows.filter { dayGroup(it.updated) == g }
                if (list.isNotEmpty()) {
                    item(key = "g-$g") { Text(g, color = p.ink2, fontSize = 13.sp, modifier = Modifier.padding(start = 6.dp, top = 8.dp)) }
                    items(list, key = { it.id }) { s ->
                        val actions = buildList {
                            if (Desk.canArchive) add(Triple("归档", Color(0xFF5B8DEF)) {
                                Desk.archive(s.id) { ok -> Desk.say(if (ok) "已归档，电脑上「已归档」里还能找到" else "没归档成功，稍后再试") }
                            })
                            if (Desk.canRemove) add(Triple("删除", Color(0xFFE5484D)) { deleting = s })
                        }
                        SwipeRow(s.id, openRow, { openRow = it }, actions, Modifier.animateItem()) {
                            Column(Modifier.fillMaxWidth().clickable {
                                if (openRow != null) { openRow = null; return@clickable }
                                Desk.openSession(s.id); Shell.tab = Tab.AI
                            }.padding(horizontal = 14.dp, vertical = 15.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(s.title, Modifier.weight(1f), color = p.ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(chatWhen(s.updated), color = p.ink3, fontSize = 13.sp)
                                }
                                when {
                                    s.busy -> Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                                        Box(Modifier.size(6.dp).clip(CircleShape).background(p.accent)); Spacer(Modifier.width(5.dp))
                                        Text("进行中", color = p.accent, fontSize = 14.sp)
                                    }
                                    s.id == Desk.current -> Text("正在看的对话", color = p.ink2, fontSize = 14.sp, modifier = Modifier.padding(top = 4.dp))
                                }
                            }
                        }
                    }
                }
            }
        }
        when {
            Desk.state != DeskState.Ready -> Box(Modifier.align(Alignment.Center)) { if (Desk.state == DeskState.Failed) Text(Desk.failed, color = p.ink2) else LavaDots(96.dp, 48.dp) }
            rows.isEmpty() -> Empty("还没有对话", "在 AI 里说第一句话，电脑上的对话也会出现在这里", Modifier.align(Alignment.Center))
        }
    }
    deleting?.let { s ->
        Confirm("删除这个对话？", "删除后电脑上也看不到了，不能恢复。只想收起来就用「归档」。", "删除「${s.title}」", { deleting = null }) {
            Desk.remove(s.id) { ok -> Desk.say(if (ok) "已删除" else "没删掉，稍后再试") }
            deleting = null
        }
    }
}

/** A card that opens to the left onto its actions (归档 · 删除); one open at a time. */
@Composable
private fun SwipeRow(id: String, open: String?, setOpen: (String?) -> Unit, actions: List<Triple<String, Color, () -> Unit>>,
                     modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val p = LocalPalette.current
    val density = LocalDensity.current
    val tile = 76.dp
    val full = with(density) { (tile * actions.size).toPx() }
    val x = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(open) { if (open != id && x.value != 0f) x.animateTo(0f, spring(dampingRatio = 0.85f)) }
    Box(modifier.fillMaxWidth().frosted(p)) {
        if (actions.isNotEmpty()) Row(Modifier.align(Alignment.CenterEnd).fillMaxHeight()) {
            actions.forEach { (label, color, act) ->
                Box(Modifier.width(tile).fillMaxHeight().background(color).clickable { setOpen(null); act() }, contentAlignment = Alignment.Center) {
                    Text(label, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
        Box(Modifier.offset { IntOffset(x.value.roundToInt(), 0) }
            .background(cardGround(p))
            .pointerInput(actions.size) {
                if (actions.isEmpty()) return@pointerInput
                detectHorizontalDragGestures(
                    onDragEnd = { scope.launch { val o = x.value < -full / 2; x.animateTo(if (o) -full else 0f, spring(dampingRatio = 0.8f)); setOpen(if (o) id else null) } },
                ) { _, d -> scope.launch { x.snapTo((x.value + d).coerceIn(-full * 1.1f, 0f)) } }
            }) { content() }
    }
}

/** The card's own ground under the words while it slides over its actions. */
private fun cardGround(p: Palette) = androidx.compose.ui.graphics.Brush.verticalGradient(listOf(
    if (p.dark) Color(0xFF262B37) else Color(0xFFF7F9FD), if (p.dark) Color(0xFF232733) else Color(0xFFF3F5FA)))

@Composable
private fun Empty(title: String, detail: String, modifier: Modifier) {
    val p = LocalPalette.current
    Column(modifier.padding(40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, color = p.ink, fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(6.dp))
        Text(detail, color = p.ink2, fontSize = 14.sp, textAlign = TextAlign.Center)
    }
}

@Composable
private fun Confirm(title: String, detail: String, action: String, cancel: () -> Unit, go: () -> Unit) {
    val p = LocalPalette.current
    Dialog(cancel) {
        Column(Modifier.fillMaxWidth().frosted(p, RoundedCornerShape(26.dp), 0.92f).padding(22.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(title, color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            Text(detail, color = p.ink2, fontSize = 14.sp, textAlign = TextAlign.Center)
            Spacer(Modifier.height(18.dp))
            Box(Modifier.fillMaxWidth().height(48.dp).clip(CircleShape).background(p.red).press(go), contentAlignment = Alignment.Center) {
                Text(action, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(horizontal = 16.dp))
            }
            Spacer(Modifier.height(8.dp))
            Text("取消", color = p.ink, fontSize = 15.sp, modifier = Modifier.clickable(onClick = cancel).padding(10.dp))
        }
    }
}

// ---- Docs ------------------------------------------------------------------------------------------------------------

@Composable
private fun DocIcon(a: Art) {
    val t = (a.title + " " + a.path).lowercase()
    val (icon, tint) = when {
        "xls" in t || "csv" in t || "表" in t -> Icons.Outlined.TableChart to Color(0xFF30D158)
        "报价" in t || "pdf" in t -> Icons.Outlined.Description to Color(0xFFFF453A)
        "图" in t || "png" in t || "jpg" in t -> Icons.Outlined.BarChart to Color(0xFFFF9F0A)
        else -> Icons.Outlined.Description to Color(0xFF0A84FF)
    }
    Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(tint.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(21.dp))
    }
}

@Composable
private fun DocsPage(topInset: androidx.compose.ui.unit.Dp) {
    val p = LocalPalette.current
    val arts = Desk.arts?.sortedByDescending { it.updated }
    Box(Modifier.fillMaxSize()) {
        if (arts != null) LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = topInset + BAR.dp + 8.dp, bottom = (TABS + 40).dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            listOf("今天", "最近一周", "更早").forEach { g ->
                val list = arts.filter { dayGroup(it.updated) == g }
                if (list.isNotEmpty()) {
                    item(key = "g-$g") { Text(g, color = p.ink2, fontSize = 13.sp, modifier = Modifier.padding(start = 6.dp, top = 6.dp)) }
                    items(list, key = { it.path }) { a ->
                        Row(Modifier.fillMaxWidth().animateItem().frosted(p).press({ Shell.viewer = a }).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                            DocIcon(a)
                            Spacer(Modifier.width(14.dp))
                            Column(Modifier.weight(1f)) {
                                Text(a.title, color = p.ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(chatWhen(a.updated), color = p.ink2, fontSize = 13.sp)
                            }
                            Icon(Icons.Outlined.ChevronRight, null, tint = p.ink3)
                        }
                    }
                }
            }
        }
        when {
            arts == null -> Box(Modifier.align(Alignment.Center)) { LavaDots(96.dp, 48.dp) }
            arts.isEmpty() -> Empty("还没有文档", "让 AI 写报告、做表格，做好的文件会出现在这里", Modifier.align(Alignment.Center))
        }
    }
}

/** One document full screen: its page on a card, 转发 and 交给 AI under it. */
@Composable
private fun Viewer(a: Art) {
    val p = LocalPalette.current
    var html by remember(a.path) { mutableStateOf<String?>(null) }
    var title by remember(a.path) { mutableStateOf(a.title) }
    var forwarding by remember { mutableStateOf(false) }
    LaunchedEffect(a.path) { Desk.readArt(a.path) { t, h -> html = h; if (t.isNotEmpty()) title = t } }
    Dialog({ Shell.viewer = null }, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize()) {
            DeskBackground()
            Column(Modifier.fillMaxSize().systemBarsPadding()) {
                Row(Modifier.fillMaxWidth().height(BAR.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    GlassIcon(Icons.AutoMirrored.Outlined.ArrowBack, "返回") { Shell.viewer = null }
                    Text(title, Modifier.weight(1f).padding(horizontal = 12.dp), color = p.ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
                    Spacer(Modifier.width(44.dp))
                }
                Box(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp).clip(RoundedCornerShape(22.dp)).background(Color.White)) {
                    val h = html
                    if (h == null) LavaDots(84.dp, 42.dp, Modifier.align(Alignment.Center))
                    else AndroidView({ ctx ->
                        WebView(ctx).apply {
                            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                            settings.javaScriptEnabled = true
                            settings.allowFileAccess = false
                            loadDataWithBaseURL(null, h.ifEmpty { "<p style='font:16px sans-serif;padding:24px'>这个文档没有读出来。</p>" }, "text/html", "utf-8", null)
                        }
                    }, Modifier.fillMaxSize())
                }
                Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    PillButton("转发", Modifier.weight(1f), prominent = false) { forwarding = true }
                    Box(Modifier.weight(1f).height(50.dp).clip(CircleShape).background(Color(0xFF4573ED)).press({
                        Desk.askArt(a.path); Shell.viewer = null; Shell.tab = Tab.AI; Desk.say("已放进 AI 对话框，说说要怎么处理，比如「做成 PDF」")
                    }), contentAlignment = Alignment.Center) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.AutoAwesome, null, tint = Color.White, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("交给 AI", color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
            if (forwarding) ForwardSheet(title, { topics, note, done ->
                Desk.ask("window.tdhPhone ? tdhPhone.forwardArtifact(${JSONObject.quote(a.path)}, ${JSONArray(topics)}, ${JSONObject.quote(note)}) : {ok:false, error:'not-ready'}") { s ->
                    val j = runCatching { JSONObject(s) }.getOrDefault(JSONObject())
                    done(if (j.optBoolean("ok")) null else j.optString("error").ifEmpty { "没转发成功" })
                }
            }) { forwarding = false }
        }
    }
}

private class FwdChat(val topic: String, val name: String, val group: Boolean)

/** 转发: the chats this person is in, the ones talked with last first; several at once, a word with it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ForwardSheet(title: String, send: (List<String>, String, (String?) -> Unit) -> Unit, close: () -> Unit) {
    val p = LocalPalette.current
    var chats by remember { mutableStateOf<List<FwdChat>?>(null) }
    val picked = remember { mutableStateListOf<String>() }
    var note by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    LaunchedEffect(Unit) {
        Desk.ask("window.tdhPhone ? tdhPhone.chats() : {topics:[]}") { s ->
            val a = runCatching { JSONObject(s).optJSONArray("topics") }.getOrNull() ?: JSONArray()
            chats = (0 until a.length()).map { i -> a.getJSONObject(i).let { FwdChat(it.optString("topic"), it.optString("name"), it.optBoolean("group")) } }
        }
    }
    ModalBottomSheet(close, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = p.ground) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().imePadding().padding(horizontal = 16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("转发「$title」", Modifier.weight(1f), color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(if (sending) "发送中…" else if (picked.size > 1) "发送(${picked.size})" else "发送",
                    color = if (picked.isEmpty() || sending) p.ink3 else p.accent, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.clickable(enabled = picked.isNotEmpty() && !sending) {
                        sending = true; error = ""
                        send(picked.toList(), note.trim()) { e -> sending = false; if (e == null) { Desk.say("已转发"); close() } else error = "转发没成功：$e" }
                    }.padding(8.dp))
            }
            Spacer(Modifier.height(8.dp))
            val list = chats
            if (list == null) Box(Modifier.fillMaxWidth().height(160.dp), contentAlignment = Alignment.Center) { LavaDots() }
            else LazyColumn(Modifier.fillMaxWidth().heightIn(max = 420.dp).frosted(p)) {
                items(list, key = { it.topic }) { c ->
                    val on = c.topic in picked
                    Row(Modifier.fillMaxWidth().clickable { if (on) picked.remove(c.topic) else picked.add(c.topic) }.padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Avatar(c.name, 36.dp)
                        Spacer(Modifier.width(12.dp))
                        Text(c.name, Modifier.weight(1f), color = p.ink, fontSize = 15.sp, maxLines = 1)
                        Box(Modifier.size(22.dp).clip(CircleShape).then(if (on) Modifier.background(p.accent) else Modifier.border(1.5.dp, p.ink3, CircleShape)),
                            contentAlignment = Alignment.Center) { if (on) Icon(Icons.Outlined.Check, null, tint = Color.White, modifier = Modifier.size(15.dp)) }
                    }
                }
            }
            if (error.isNotEmpty()) Text(error, color = p.red, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
            Spacer(Modifier.height(10.dp))
            Field(note, { note = it }, "留言（可不填）")
            Spacer(Modifier.height(12.dp))
        }
    }
}

// ---- settings ----------------------------------------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsSheet(person: Person, close: () -> Unit) {
    val p = LocalPalette.current
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var legal by remember { mutableStateOf<String?>(null) }
    var out by remember { mutableStateOf(false) }
    ModalBottomSheet(close, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = p.ground) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 20.dp)) {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Avatar(person.name.ifEmpty { person.login }, 76.dp)
                Spacer(Modifier.height(8.dp))
                Text(person.name.ifEmpty { person.login }, color = p.ink, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                Text(listOf(person.deptName, person.roleText).filter { it.isNotEmpty() }.joinToString(" · "), color = p.ink2, fontSize = 14.sp)
            }
            Section("账号") {
                Line("部门", person.deptName.ifEmpty { "—" }); Line("角色", person.roleText); Line("登录名", person.login)
            }
            Section("外观") {
                Row(Modifier.fillMaxWidth().padding(6.dp).clip(CircleShape).background(p.ink.copy(alpha = 0.06f)).padding(3.dp)) {
                    Appearance.entries.forEach { a ->
                        val on = Look.appearance == a
                        Box(Modifier.weight(1f).height(36.dp).clip(CircleShape).background(if (on) p.paper else Color.Transparent)
                            .clickable { Look.set(ctx, a) }, contentAlignment = Alignment.Center) {
                            Text(a.label, color = if (on) p.ink else p.ink2, fontSize = 14.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal)
                        }
                    }
                }
            }
            Section("通用") {
                Line("公司服务器", if (Desk.state == DeskState.Ready) "已连接" else "正在连接")
                Line("关于 TDH", BuildConfig.VERSION_NAME + " Beta")
            }
            Section("关于") {
                listOf("terms" to "服务协议", "privacy" to "隐私政策", "disclaimer" to "免责声明").forEach { (k, t) ->
                    Row(Modifier.fillMaxWidth().clickable { legal = k }.padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(t, Modifier.weight(1f), color = p.ink, fontSize = 15.sp)
                        Icon(Icons.Outlined.ChevronRight, null, tint = p.ink3)
                    }
                }
            }
            Spacer(Modifier.height(18.dp))
            Box(Modifier.fillMaxWidth().height(50.dp).frosted(p, RoundedCornerShape(16.dp)).clickable { out = true }, contentAlignment = Alignment.Center) {
                Text("退出登录", color = p.red, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            }
            Text("退出后这台手机不再保持登录，下次要重新用手机号验证码登录。", color = p.ink2, fontSize = 12.sp, modifier = Modifier.padding(8.dp))
        }
    }
    legal?.let { Legal(it) { legal = null } }
    if (out) Confirm("退出登录？", "退出后要重新登录才能用。", "退出登录", { out = false }) {
        out = false
        scope.launch {
            ChatWatch.stop(ctx)
            Chat.stop()
            Desk.web?.loadUrl("about:blank"); Desk.chatWeb?.loadUrl("about:blank")
            Desk.state = DeskState.Idle; Desk.chatState = DeskState.Idle; Desk.sessions = emptyList(); Desk.arts = null
            Relay.stop()
            Session.signOut()
            close()
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    val p = LocalPalette.current
    Text(title, color = p.ink2, fontSize = 13.sp, modifier = Modifier.padding(start = 16.dp, top = 22.dp, bottom = 6.dp))
    Column(Modifier.fillMaxWidth().frosted(p, RoundedCornerShape(16.dp)).animateContentSize()) { content() }
}

@Composable
private fun Line(k: String, v: String) {
    val p = LocalPalette.current
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp)) {
        Text(k, color = p.ink, fontSize = 15.sp, modifier = Modifier.weight(1f))
        Text(v, color = p.ink2, fontSize = 15.sp)
    }
}

