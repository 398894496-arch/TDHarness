package cn.tdharness.mobile

import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.zIndex
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val Blue = Color(0xFF4573ED)
private val Ink = Color(0xFF1C2230)
private val Soft = Color(0xFF6B7385)
private val Page = Color(0xFFF6F7FA)

enum class Tab(val label: String) { History("历史"), AI("AI"), Chat("聊天"), Docs("文档") }

object Shell {
    var tab by mutableStateOf(Tab.AI)
    var viewer by mutableStateOf<Triple<String, String, String>?>(null) // path, title, html

    /** The back key: true when it was used here. */
    fun back(): Boolean {
        if (viewer != null) { viewer = null; return true }
        if (tab == Tab.Chat && Desk.chatWeb?.canGoBack() == true) { Desk.chatWeb?.goBack(); return true }
        if (tab != Tab.AI) { tab = Tab.AI; return true }
        return false
    }
}

@Composable
fun Root(onSignedIn: () -> Unit) {
    MaterialTheme(colorScheme = lightColorScheme(primary = Blue, onPrimary = Color.White, background = Page, surface = Color.White)) {
        Surface(Modifier.fillMaxSize(), color = Page) {
            when (Session.phase) {
                Phase.Starting -> Splash()
                Phase.Offline -> OfflineScreen()
                Phase.SignedOut -> Login()
                Phase.SignedIn -> Session.person?.let { Main(it, onSignedIn) } ?: Login()
            }
        }
    }
}

@Composable
private fun Splash() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("TDH", fontSize = 34.sp, fontWeight = FontWeight.Bold, color = Ink)
            Spacer(Modifier.height(16.dp))
            CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 2.5.dp)
        }
    }
}

@Composable
private fun OfflineScreen() {
    val scope = rememberCoroutineScope()
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(Session.problem.ifEmpty { "暂时连不上服务器" }, color = Ink, fontSize = 17.sp)
            Spacer(Modifier.height(20.dp))
            Button(onClick = { scope.launch { Net.forget(); Session.resume() } }) { Text("重试") }
        }
    }
}

// ---- sign-in -------------------------------------------------------------------------------------------------------

@Composable
private fun Login() {
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
        Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 28.dp),
    ) {
        Spacer(Modifier.height(56.dp))
        Text("TDH", fontSize = 34.sp, fontWeight = FontWeight.Bold, color = Ink)
        Spacer(Modifier.height(28.dp))
        Text(if (byPassword) "账号密码登录" else "手机号登录", fontSize = 24.sp, fontWeight = FontWeight.SemiBold, color = Ink)
        Text(if (byPassword) "公司给你的登录名和密码" else "公司花名册里登记的手机号", fontSize = 14.sp, color = Soft)
        Spacer(Modifier.height(24.dp))
        if (byPassword) {
            OutlinedTextField(user, { user = it.trim() }, Modifier.fillMaxWidth(), label = { Text("登录名") }, singleLine = true)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(pw, { pw = it }, Modifier.fillMaxWidth(), label = { Text("密码") }, singleLine = true,
                visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
        } else {
            OutlinedTextField(phone, { phone = it.filter(Char::isDigit).take(11) }, Modifier.fillMaxWidth(),
                label = { Text("手机号") }, prefix = { Text("+86  ") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(code, { code = it.filter(Char::isDigit).take(6) }, Modifier.weight(1f),
                    label = { Text("验证码") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
                Spacer(Modifier.width(10.dp))
                OutlinedButton(
                    onClick = {
                        if (!agreed) { note = "请先阅读并同意服务协议和隐私政策"; return@OutlinedButton }
                        busy = true; note = ""
                        scope.launch { val r = Session.sendCode(phone); busy = false; if (r == null) wait = 60 else note = r }
                    },
                    enabled = phoneOk && wait == 0 && !busy,
                ) { Text(if (wait > 0) "${wait}s" else "获取验证码") }
            }
        }
        Spacer(Modifier.height(14.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(agreed, { agreed = it })
            Text("已阅读并同意", fontSize = 13.sp, color = Soft)
            TextButton({ legal = "terms" }) { Text("服务协议", fontSize = 13.sp) }
            Text("和", fontSize = 13.sp, color = Soft)
            TextButton({ legal = "privacy" }) { Text("隐私政策", fontSize = 13.sp) }
        }
        if (note.isNotEmpty()) Text(note, color = Color(0xFFD14343), fontSize = 14.sp, modifier = Modifier.padding(vertical = 6.dp))
        Spacer(Modifier.height(10.dp))
        Button(
            onClick = {
                if (!agreed) { note = "请先阅读并同意服务协议和隐私政策"; return@Button }
                busy = true; note = ""
                scope.launch {
                    val r = if (byPassword) Session.signInPassword(user, pw) else Session.signInSms(phone, code)
                    busy = false
                    if (r != null) note = r
                }
            },
            enabled = !busy && (if (byPassword) user.isNotEmpty() && pw.isNotEmpty() else phoneOk && code.length == 6),
            modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(26.dp),
        ) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp) else Text("登录", fontSize = 17.sp) }
        TextButton({ byPassword = !byPassword; note = "" }, Modifier.align(Alignment.CenterHorizontally)) {
            Text(if (byPassword) "用手机号验证码登录" else "用账号密码登录", fontSize = 14.sp)
        }
        Spacer(Modifier.height(24.dp))
    }
    legal?.let { Legal(it) { legal = null } }
}

@Composable
private fun Legal(name: String, close: () -> Unit) {
    val ctx = LocalContext.current
    val text = remember(name) { runCatching { ctx.assets.open("legal/$name.txt").bufferedReader().use { it.readText() } }.getOrDefault("") }
    val title = when (name) { "terms" -> "服务协议"; "privacy" -> "隐私政策"; else -> "免责声明" }
    Dialog(close, DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = Color.White) {
            Column(Modifier.systemBarsPadding()) {
                Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(close) { Icon(Icons.Outlined.Close, "关闭") }
                    Text(title, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Ink)
                }
                Text(text, Modifier.verticalScroll(rememberScrollState()).padding(20.dp), fontSize = 15.sp, color = Ink, lineHeight = 24.sp)
            }
        }
    }
}

// ---- the app -------------------------------------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun Main(p: Person, onSignedIn: () -> Unit) {
    LaunchedEffect(p.token) {
        onSignedIn()
        Desk.open(p)
    }
    var settings by remember { mutableStateOf(false) }
    val tab = Shell.tab
    LaunchedEffect(tab) {
        if (tab == Tab.Chat && (Desk.chatState == DeskState.Idle || Desk.chatState == DeskState.Failed) && Desk.state == DeskState.Ready) Desk.openChat()
        if (tab == Tab.Docs) Desk.loadArts()
    }
    val ime = WindowInsets.isImeVisible
    Scaffold(
        containerColor = Page,
        topBar = {
            CenterAlignedTopAppBar(
                title = {
                    Text(
                        when (tab) { Tab.AI -> Desk.currentTitle; Tab.History -> "历史对话"; Tab.Chat -> "聊天"; Tab.Docs -> "文档" },
                        maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
                    )
                },
                navigationIcon = { IconButton({ settings = true }) { Icon(Icons.Outlined.Settings, "设置") } },
                actions = {
                    when (tab) {
                        Tab.AI, Tab.History -> IconButton({ Desk.newChat(); Shell.tab = Tab.AI }) { Icon(Icons.Outlined.EditNote, "新对话") }
                        Tab.Docs -> IconButton({ Desk.arts = null; Desk.loadArts() }) { Icon(Icons.Outlined.Refresh, "刷新") }
                        Tab.Chat -> IconButton({ Desk.chatWeb?.reload() }) { Icon(Icons.Outlined.Refresh, "刷新") }
                    }
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = Page),
            )
        },
        bottomBar = {
            if (!ime) NavigationBar(containerColor = Color.White) {
                Tab.entries.forEach { t ->
                    NavigationBarItem(
                        selected = tab == t, onClick = { Shell.tab = t },
                        icon = {
                            Icon(
                                when (t) {
                                    Tab.History -> Icons.Outlined.History; Tab.AI -> Icons.Outlined.AutoAwesome
                                    Tab.Chat -> Icons.Outlined.ChatBubbleOutline; Tab.Docs -> Icons.Outlined.Description
                                }, t.label,
                            )
                        },
                        label = { Text(t.label) },
                    )
                }
            }
        },
    ) { pad ->
        Box(Modifier.padding(pad).consumeWindowInsets(pad).imePadding().fillMaxSize()) {
            Web(Desk.web, Modifier.fillMaxSize().zIndex(if (tab == Tab.AI) 2f else 0f))
            Web(Desk.chatWeb, Modifier.fillMaxSize().zIndex(if (tab == Tab.Chat) 2f else 0f))
            if (tab == Tab.AI && Desk.state != DeskState.Ready) Cover(Desk.state, Desk.failed, "正在打开工作台…") { Desk.state = DeskState.Idle; Desk.open(p) }
            if (tab == Tab.Chat && Desk.chatState != DeskState.Ready) Cover(Desk.chatState, "聊天没打开，点重试再试一次", "正在打开聊天…") { Desk.retryChat() }
            if (tab == Tab.History) History(Modifier.zIndex(3f))
            if (tab == Tab.Docs) Docs(Modifier.zIndex(3f))
        }
    }
    if (settings) Settings(p) { settings = false }
    Shell.viewer?.let { Viewer(it) }
}

@Composable
private fun Web(view: WebView?, modifier: Modifier) {
    if (view == null) return
    AndroidView({ (view.parent as? ViewGroup)?.removeView(view); view }, modifier)
}

@Composable
private fun Cover(state: DeskState, failed: String, opening: String, retry: () -> Unit) {
    Box(Modifier.fillMaxSize().zIndex(5f).background(Page), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(32.dp)) {
            if (state == DeskState.Failed) {
                Text(failed.ifEmpty { "没打开，点重试再试一次" }, color = Ink, fontSize = 16.sp)
                Spacer(Modifier.height(16.dp))
                Button(retry) { Text("重试") }
            } else {
                CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 2.5.dp)
                Spacer(Modifier.height(14.dp))
                Text(opening, color = Soft, fontSize = 14.sp)
            }
        }
    }
}

private fun whenText(ms: Long): String {
    if (ms <= 0) return ""
    val d = System.currentTimeMillis() - ms
    return when {
        d < 60_000 -> "刚刚"
        d < 3_600_000 -> "${d / 60_000} 分钟前"
        d < 86_400_000 -> SimpleDateFormat("HH:mm", Locale.CHINA).format(Date(ms))
        else -> SimpleDateFormat("M月d日", Locale.CHINA).format(Date(ms))
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun History(modifier: Modifier) {
    var removing by remember { mutableStateOf<Sess?>(null) }
    val list = Desk.sessions.filter { it.title != "新会话" }
    Box(modifier.fillMaxSize().background(Page)) {
        if (list.isEmpty()) {
            Text(if (Desk.state == DeskState.Ready) "还没有对话" else "正在载入…", Modifier.align(Alignment.Center), color = Soft)
        } else {
            LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item { Spacer(Modifier.height(4.dp)) }
                items(list, key = { it.id }) { s ->
                    Row(
                        Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(16.dp))
                            .combinedClickable(onClick = { Desk.openSession(s.id); Shell.tab = Tab.AI }, onLongClick = { removing = s })
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(s.title, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, color = Ink, fontSize = 16.sp,
                            fontWeight = if (s.id == Desk.current) FontWeight.SemiBold else FontWeight.Normal)
                        if (s.busy) Text("回答中", color = Blue, fontSize = 12.sp) else Text(whenText(s.updated), color = Soft, fontSize = 12.sp)
                    }
                }
                item { Spacer(Modifier.height(12.dp)) }
            }
        }
    }
    removing?.let { s ->
        AlertDialog(
            onDismissRequest = { removing = null },
            title = { Text("删除这个对话？") },
            text = { Text("「${s.title}」会从历史里删掉。") },
            confirmButton = { TextButton({ Desk.remove(s.id); removing = null }) { Text("删除", color = Color(0xFFD14343)) } },
            dismissButton = { TextButton({ removing = null }) { Text("取消") } },
        )
    }
}

@Composable
private fun Docs(modifier: Modifier) {
    val arts = Desk.arts
    Box(modifier.fillMaxSize().background(Page)) {
        when {
            arts == null -> CircularProgressIndicator(Modifier.align(Alignment.Center).size(28.dp), strokeWidth = 2.5.dp)
            arts.isEmpty() -> Text("还没有文档。让 AI 做报价单、报告这类东西，做好的会出现在这里。", Modifier.align(Alignment.Center).padding(32.dp), color = Soft)
            else -> LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item { Spacer(Modifier.height(4.dp)) }
                items(arts, key = { it.path }) { a ->
                    Row(
                        Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(16.dp))
                            .combinedClickableCompat { Desk.readArt(a.path) { t, html -> Shell.viewer = Triple(a.path, t.ifEmpty { a.title }, html) } }
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Outlined.Description, null, tint = Blue)
                        Spacer(Modifier.width(12.dp))
                        Text(a.title, Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis, color = Ink, fontSize = 15.sp)
                        Text(whenText(a.updated), color = Soft, fontSize = 12.sp)
                    }
                }
                item { Spacer(Modifier.height(12.dp)) }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
private fun Modifier.combinedClickableCompat(onClick: () -> Unit): Modifier = this.combinedClickable(onClick = onClick)

@Composable
private fun Viewer(v: Triple<String, String, String>) {
    Dialog({ Shell.viewer = null }, DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = Color.White) {
            Column(Modifier.systemBarsPadding()) {
                Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton({ Shell.viewer = null }) { Icon(Icons.Outlined.Close, "关闭") }
                    Text(v.second, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Ink)
                    TextButton({ Desk.askArt(v.first); Shell.viewer = null; Shell.tab = Tab.AI }) { Text("交给 AI") }
                }
                HorizontalDivider()
                AndroidView({ ctx ->
                    WebView(ctx).apply {
                        settings.javaScriptEnabled = true
                        settings.allowFileAccess = false
                        loadDataWithBaseURL(null, v.third.ifEmpty { "<p style='font:16px sans-serif;padding:24px'>这个文档打不开。</p>" }, "text/html", "utf-8", null)
                    }
                }, Modifier.fillMaxSize())
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Settings(p: Person, close: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var legal by remember { mutableStateOf<String?>(null) }
    ModalBottomSheet(close, containerColor = Color.White) {
        Column(Modifier.navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 16.dp)) {
            Text("设置", fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Ink)
            Spacer(Modifier.height(16.dp))
            Line("登录名", p.login)
            Line("部门", p.deptName.ifEmpty { "—" })
            Line("角色", p.roleText)
            Line("版本", BuildConfig.VERSION_NAME + " (" + BuildConfig.VERSION_CODE + ")")
            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            listOf("terms" to "服务协议", "privacy" to "隐私政策", "disclaimer" to "免责声明").forEach { (k, t) ->
                TextButton({ legal = k }) { Text(t) }
            }
            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            TextButton({
                scope.launch {
                    ChatWatch.stop(ctx)
                    Desk.web?.loadUrl("about:blank"); Desk.chatWeb?.loadUrl("about:blank")
                    Desk.state = DeskState.Idle; Desk.chatState = DeskState.Idle; Desk.sessions = emptyList(); Desk.arts = null
                    Relay.stop()
                    Session.signOut()
                    close()
                }
            }) { Text("退出登录", color = Color(0xFFD14343)) }
        }
    }
    legal?.let { Legal(it) { legal = null } }
}

@Composable
private fun Line(k: String, v: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Text(k, color = Soft, fontSize = 15.sp, modifier = Modifier.width(80.dp))
        Text(v, color = Ink, fontSize = 15.sp)
    }
}
