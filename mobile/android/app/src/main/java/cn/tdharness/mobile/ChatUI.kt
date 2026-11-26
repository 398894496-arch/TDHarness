package cn.tdharness.mobile

// company-android-parity-v1: Chat as the iPhone draws it (mobile/ios/TDH/ChatViews.swift, FunctionCards.swift,
// PhoneShell.swift ChatFileSheet) — the chats on one frosted card (pinned first with a pin; a swipe for 置顶 and 删除),
// search over people, groups and all the chats' words (the hits in bold blue), the ≡ menu (通讯录 · 建群), 通讯录 and
// 建群; a chat: one's own words in pale sky, the others' on paper with their picture, pictures, file cards, voice bubbles
// with their words, call lines (tap to call back), TDH 助手's cards by kind with their answers, task cards, call minutes;
// the phone button for a voice call; a file opened in place with 转发 and 交给 AI.

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.pdf.PdfRenderer
import android.media.MediaPlayer
import android.os.ParcelFileDescriptor
import android.view.HapticFeedbackConstants
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.zIndex
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.haze
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.text.Collator
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** A chat's file opened in place. */
class ChatFile(val name: String, val mime: String, val data: ByteArray)

object ChatShell {
    /** The chat on screen over the tabs, or "". */
    var room by mutableStateOf("")
    /** 通讯录, full screen (a chat opened from it stacks on it). */
    var contacts by mutableStateOf(false)
    var newGroup by mutableStateOf(false)
    var menu by mutableStateOf(false)
    var file by mutableStateOf<ChatFile?>(null)

    fun open(): Boolean = room.isNotEmpty() || contacts || menu || file != null || newGroup

    fun back(): Boolean = when {
        file != null -> { file = null; true }
        newGroup -> { newGroup = false; true }
        menu -> { menu = false; true }
        room.isNotEmpty() -> { room = ""; true }
        contacts -> { contacts = false; true }
        else -> false
    }
}

private val zh: Collator by lazy { Collator.getInstance(Locale.CHINA) }

// ---- the list -----------------------------------------------------------------------------------------------------------

@Composable
fun ChatListPage() {
    val p = LocalPalette.current
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var openRow by remember { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf<ChatTopic?>(null) }
    var hits by remember { mutableStateOf<List<Chat.Hit>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    val q = query.trim()
    val talked = Chat.topics.filter { Chat.shows(it) }
    val nameHits = if (q.isEmpty()) emptyList() else Chat.topics.filter { it.name.contains(q, true) }.sortedByDescending { it.touched }
    LaunchedEffect(q) {
        hits = emptyList()
        if (q.isEmpty()) { searching = false; return@LaunchedEffect }
        searching = true
        delay(450) // while still typing, nothing is asked
        val got = Chat.find(q)
        if (q == query.trim()) { hits = got; searching = false }
    }
    val state = rememberLazyListState()
    val shownTitle = titleShown(state)
    SideEffect { PageTitle.chat = shownTitle }
    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), state = state,
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = statusTop() + BAR.dp, bottom = navBottom() + TABS.dp + 30.dp)) {
            item(key = "title") { LargeTitle("Chat") }
            item(key = "search") { SearchField(query, { query = it }, "搜索同事、群和聊天记录", Modifier.padding(bottom = 12.dp)) }
            if (q.isEmpty()) {
                itemsIndexed(talked, key = { _, t -> t.topic }) { i, t ->
                    val pinned = t.topic in Chat.pinned
                    val first = i == 0; val last = i == talked.size - 1
                    val shape = RoundedCornerShape(topStart = if (first) 26.dp else 0.dp, topEnd = if (first) 26.dp else 0.dp,
                        bottomStart = if (last) 26.dp else 0.dp, bottomEnd = if (last) 26.dp else 0.dp)
                    Column(Modifier.animateItem().clip(shape)) {
                        SwipeRow(t.topic, openRow, { openRow = it }, listOf(
                            SwipeAction(if (pinned) "取消置顶" else "置顶", Tone.Sky) {
                                scope.launch { if (!Chat.togglePin(t.topic)) Desk.say(if (pinned) "没取消成功，稍后再试" else "没置顶成功，稍后再试") }
                            },
                            SwipeAction("删除", Tone.Rose) { deleting = t },
                        ), Modifier.background(p.paper.copy(alpha = if (pinned) 0.78f else 0.55f)), tile = 84.dp) {
                            ChatRow(t, pinned) { if (openRow != null) openRow = null else ChatShell.room = t.topic }
                        }
                        if (!last) Box(Modifier.fillMaxWidth().background(p.paper.copy(alpha = 0.55f)).padding(start = 78.dp)
                            .height(0.5.dp).background(p.ink.copy(alpha = 0.08f)))
                    }
                }
            } else {
                if (nameHits.isNotEmpty()) {
                    item(key = "nh") { Text("联系人和群", color = p.ink2, fontSize = 13.sp, modifier = Modifier.padding(start = 6.dp, top = 6.dp, bottom = 8.dp)) }
                    item(key = "nhl") {
                        Column(Modifier.fillMaxWidth().frosted(p)) {
                            nameHits.take(8).forEach { t ->
                                Row(Modifier.fillMaxWidth().rowPress { ChatShell.room = t.topic }.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Avatar(t.name, 40.dp, t.photo)
                                    Spacer(Modifier.width(12.dp))
                                    Text(mark(t.name, q, p.ink), fontSize = 17.sp, maxLines = 1)
                                    if (t.group) { Spacer(Modifier.width(6.dp)); GroupTag() }
                                }
                            }
                        }
                    }
                }
                item(key = "hh") {
                    Row(Modifier.fillMaxWidth().padding(start = 6.dp, end = 6.dp, top = 16.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("聊天记录", color = p.ink2, fontSize = 13.sp)
                        if (searching) { Spacer(Modifier.width(6.dp)); CircularProgressIndicator(Modifier.size(11.dp), color = p.ink2, strokeWidth = 1.5.dp) }
                        Spacer(Modifier.weight(1f))
                        Text("全部记录", color = p.ink3, fontSize = 11.sp)
                    }
                }
                if (hits.isEmpty()) item(key = "none") {
                    Text(if (searching) "正在搜…" else "没有找到含「$q」的消息", color = p.ink2, fontSize = 15.sp, textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().frosted(p).padding(vertical = 24.dp))
                } else item(key = "hits") {
                    Column(Modifier.fillMaxWidth().frosted(p)) {
                        hits.forEach { h ->
                            val t = Chat.topics.firstOrNull { it.topic == h.topic } ?: Chat.topics.firstOrNull { it.name == h.chat }
                            Row(Modifier.fillMaxWidth().rowPress { t?.let { ChatShell.room = it.topic } }.padding(horizontal = 14.dp, vertical = 10.dp)) {
                                Avatar(h.chat, 40.dp, t?.photo)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Row {
                                        Text(h.chat, color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, modifier = Modifier.weight(1f))
                                        Text(hitWhen(h.time), color = p.ink3, fontSize = 12.sp)
                                    }
                                    Spacer(Modifier.height(3.dp))
                                    Text(mark((if (t?.group == true) h.from + "：" else "") + h.text, q, p.ink2), fontSize = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                    }
                }
            }
        }
        when {
            !Chat.loaded -> Box(Modifier.align(Alignment.Center)) {
                if (Chat.problem.isNotEmpty()) Text(Chat.problem, color = p.ink2, fontSize = 13.sp) else LavaDots(96.dp, 48.dp)
            }
            q.isEmpty() && talked.isEmpty() -> Empty("还没有聊天", "点右上角「通讯录」找同事说句话", Sf.bubbles, Modifier.align(Alignment.Center))
        }
    }
    deleting?.let { t ->
        Confirm("删除这个聊天？", "你这边的聊天记录会清空，对方那边不受影响。有新消息时它会重新出现。", "删除「${t.name}」", { deleting = null }) {
            deleting = null
            scope.launch { if (!Chat.deleteChat(t.topic)) Desk.say("没删掉，稍后再试") }
        }
    }
}

/** The word found, in bold blue. */
private fun mark(text: String, word: String, ink: Color): AnnotatedString = buildAnnotatedString {
    append(text)
    addStyle(SpanStyle(color = ink), 0, text.length)
    if (word.isEmpty()) return@buildAnnotatedString
    var from = 0
    while (true) {
        val i = text.indexOf(word, from, ignoreCase = true)
        if (i < 0) break
        addStyle(SpanStyle(color = Color(0xFF0A84FF), fontWeight = FontWeight.SemiBold), i, i + word.length)
        from = i + word.length
    }
}

/** The server's clock (the company is in China): 「2026-11-25 21:11」 as the chat lists say it. */
private fun hitWhen(s: String): String {
    val f = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.CHINA).apply { timeZone = TimeZone.getTimeZone("Asia/Shanghai") }
    return runCatching { chatWhen(f.parse(s.take(16))!!.time) }.getOrDefault(s.take(10))
}

/** A row's press: a light shade under it while the finger is down. */
@Composable
private fun Modifier.rowPress(onClick: () -> Unit): Modifier {
    val p = LocalPalette.current
    val source = remember { MutableInteractionSource() }
    val down by source.collectIsPressedAsState()
    return this.background(if (down) p.ink.copy(alpha = 0.05f) else Color.Transparent).clickable(source, null, onClick = onClick)
}

@Composable
private fun ChatRow(t: ChatTopic, pinned: Boolean, onClick: () -> Unit) {
    val p = LocalPalette.current
    Row(Modifier.fillMaxWidth().rowPress(onClick).padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box {
            Avatar(t.name, 50.dp, t.photo)
            if (t.unread > 0) Text(if (t.unread > 99) "99+" else "${t.unread}", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                modifier = Modifier.align(Alignment.TopEnd).offset(5.dp, (-4).dp).clip(CircleShape).background(Color(0xFFFF3B30))
                    .border(1.5.dp, p.paper, CircleShape).widthIn(min = 19.dp).padding(horizontal = 5.dp, vertical = 1.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(t.name, color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, false))
                if (pinned) { Spacer(Modifier.width(4.dp)); Icon(Sf.pin, null, tint = Color(0xFF7594E6), modifier = Modifier.size(12.dp).graphicsLayer { rotationZ = 45f }) }
                Spacer(Modifier.weight(1f))
                Text(chatWhen(t.touched), color = p.ink3, fontSize = 13.sp)
            }
            Spacer(Modifier.height(3.dp))
            Text(t.preview.ifEmpty { " " }, color = p.ink2, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** The ≡ menu: narrow, two lines, opening out of the button's own place (its top on the gear's line, 16 from the edge). */
@Composable
fun ChatMenu() {
    val p = LocalPalette.current
    if (!ChatShell.menu) return
    Box(Modifier.fillMaxSize().zIndex(8f).clickable(remember { MutableInteractionSource() }, null) { ChatShell.menu = false }) {
        var on by remember { mutableStateOf(false) }
        LaunchedEffect(Unit) { on = true }
        AnimatedVisibility(on, Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(top = 8.dp, end = 16.dp),
            enter = scaleIn(spring(dampingRatio = 0.8f, stiffness = 500f), initialScale = 0.25f, transformOrigin = androidx.compose.ui.graphics.TransformOrigin(1f, 0f)) + fadeIn()) {
            Column(Modifier.width(140.dp).shadow(14.dp, RoundedCornerShape(20.dp), ambientColor = Color(0x261E3359), spotColor = Color(0x261E3359))
                .clip(RoundedCornerShape(20.dp)).background(p.paper.copy(alpha = if (p.dark) 0.92f else 0.85f))
                .border(0.6.dp, p.rim.copy(alpha = 0.7f), RoundedCornerShape(20.dp))) {
                // The page first, then the menu away (a delay here would die with the menu's own scope as it closes).
                fun go(act: () -> Unit) { act(); ChatShell.menu = false }
                MenuLine(Sf.book, "通讯录") { go { ChatShell.contacts = true } }
                Box(Modifier.padding(horizontal = 12.dp).fillMaxWidth().height(0.5.dp).background(p.ink.copy(alpha = 0.12f)))
                MenuLine(Sf.plusBubble, "建群") { go { ChatShell.newGroup = true } }
            }
        }
    }
}

@Composable
private fun MenuLine(icon: ImageVector, title: String, onClick: () -> Unit) {
    val p = LocalPalette.current
    Row(Modifier.fillMaxWidth().height(40.dp).rowPress(onClick).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
        Icon(icon, null, tint = p.ink, modifier = Modifier.size(17.dp))
    }
}

/** What Chat puts over the tabs: 通讯录, a chat on it, 建群, a file. */
@Composable
fun ChatOverlays(person: Person) {
    if (ChatShell.contacts) ContactsPage()
    if (ChatShell.room.isNotEmpty()) ChatRoom(ChatShell.room, person)
    if (ChatShell.newGroup) NewGroupSheet({ ChatShell.newGroup = false }) { grp -> ChatShell.room = grp }
    ChatShell.file?.let { ChatFileSheet(it) { ChatShell.file = null } }
}

/** A page of its own over the tabs, with its own glass bars over what scrolls in it. */
@Composable
private fun Page(content: @Composable (HazeState) -> Unit) {
    val haze = remember { HazeState() }
    CompositionLocalProvider(LocalHaze provides haze) {
        Box(Modifier.fillMaxSize().zIndex(6.5f).clickable(remember { MutableInteractionSource() }, null) {}) { content(haze) }
    }
}

// ---- 通讯录 · 建群 ---------------------------------------------------------------------------------------------------------

@Composable
private fun ContactsPage() {
    val p = LocalPalette.current
    var query by remember { mutableStateOf("") }
    val q = query.trim()
    val all = Chat.topics.filter { q.isEmpty() || it.name.contains(q, true) }
    val groups = all.filter { it.group }.sortedWith { a, b -> zh.compare(a.name, b.name) }
    val people = all.filter { !it.group }.sortedWith { a, b -> zh.compare(a.name, b.name) }
    Page { haze ->
        Box(Modifier.fillMaxSize().haze(haze)) {
            DeskBackground()
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = statusTop() + BAR.dp + 58.dp, bottom = navBottom() + 40.dp)) {
                fun block(title: String, list: List<ChatTopic>) {
                    item(key = "h$title") { Text(title, color = p.ink2, fontSize = 13.sp, modifier = Modifier.padding(start = 6.dp, top = 12.dp, bottom = 8.dp)) }
                    item(key = "b$title") {
                        Column(Modifier.fillMaxWidth().frosted(p)) {
                            list.forEachIndexed { i, t ->
                                Row(Modifier.fillMaxWidth().rise(minOf(i, 12)).rowPress { ChatShell.room = t.topic }.padding(horizontal = 14.dp, vertical = 9.dp),
                                    verticalAlignment = Alignment.CenterVertically) {
                                    Avatar(t.name, 40.dp, t.photo)
                                    Spacer(Modifier.width(12.dp))
                                    Text(t.name, color = p.ink, fontSize = 17.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Icon(Sf.chevronRight, null, tint = p.ink3, modifier = Modifier.size(14.dp))
                                }
                                if (i < list.size - 1) Box(Modifier.padding(start = 66.dp).fillMaxWidth().height(0.5.dp).background(p.ink.copy(alpha = 0.1f)))
                            }
                        }
                    }
                }
                if (groups.isNotEmpty()) block("群聊", groups)
                block("同事（${people.size}）", people)
            }
        }
        EdgeBlur(true, statusTop() + BAR.dp + 66.dp)
        Column {
            TopRow("通讯录", leading = { GlassCircle(Sf.chevronLeft, "返回") { ChatShell.contacts = false } })
            SearchField(query, { query = it }, "搜索同事或群", Modifier.padding(horizontal = 16.dp))
        }
    }
}

/** 建群: a name and the people in it; the group opens once made. */
@Composable
private fun NewGroupSheet(close: () -> Unit, made: (String) -> Unit) {
    val p = LocalPalette.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    var title by remember { mutableStateOf("") }
    val picked = remember { mutableStateListOf<String>() }
    var query by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val q = query.trim()
    val people = Chat.topics.filter { !it.group && (q.isEmpty() || it.name.contains(q, true)) }.sortedWith { a, b -> zh.compare(a.name, b.name) }
    fun toggle(u: String) { if (u in picked) picked.remove(u) else picked.add(u); view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK) }
    val can = !busy && picked.isNotEmpty() && title.isNotBlank()
    Sheet(close, "建群", leading = { SheetX(close) }, trailing = {
        Text(if (busy) "正在建…" else if (picked.isEmpty()) "创建" else "创建(${picked.size + 1})", color = if (can) p.ink else p.ink3, fontSize = 17.sp,
            fontWeight = FontWeight.SemiBold, modifier = Modifier.clip(CircleShape).clickable(enabled = can) {
                busy = true; error = ""
                scope.launch {
                    val grp = Chat.createGroup(title.trim(), picked.toList())
                    busy = false
                    if (grp == null) { error = "群没建成，检查一下网络再试"; return@launch }
                    view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
                    close(); made(grp)
                }
            }.padding(8.dp))
    }) {
        SearchField(query, { query = it }, "搜索同事", Modifier.padding(horizontal = 16.dp))
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(16.dp)) {
            item(key = "name") {
                Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(p.paper).padding(horizontal = 16.dp, vertical = 14.dp)) {
                    if (title.isEmpty()) Text("群名称（比如：报价小组）", color = p.ink3, fontSize = 17.sp)
                    BasicTextField(title, { title = it }, singleLine = true, textStyle = TextStyle(color = p.ink, fontSize = 17.sp), cursorBrush = SolidColor(p.accent), modifier = Modifier.fillMaxWidth())
                }
                if (error.isNotEmpty()) Text(error, color = p.red, fontSize = 13.sp, modifier = Modifier.padding(start = 16.dp, top = 6.dp))
            }
            if (picked.isNotEmpty()) item(key = "picked") {
                LazyRow(Modifier.padding(top = 14.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(p.paper).padding(vertical = 8.dp),
                    contentPadding = PaddingValues(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(picked.toList(), key = { it }) { u ->
                        val t = Chat.topics.firstOrNull { it.topic == u }
                        Column(Modifier.animateItem().width(52.dp).clickable { toggle(u) }, horizontalAlignment = Alignment.CenterHorizontally) {
                            Box {
                                Avatar(t?.name ?: "", 40.dp, t?.photo)
                                Box(Modifier.align(Alignment.TopEnd).offset(4.dp, (-4).dp).size(16.dp).clip(CircleShape).background(Color.Gray), contentAlignment = Alignment.Center) {
                                    Icon(Sf.xmark, null, tint = Color.White, modifier = Modifier.size(9.dp))
                                }
                            }
                            Text(t?.name ?: "", color = p.ink, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
            item(key = "h") { Text("选同事", color = p.ink2, fontSize = 13.sp, modifier = Modifier.padding(start = 16.dp, top = 20.dp, bottom = 6.dp)) }
            itemsIndexed(people, key = { _, t -> t.topic }) { i, t ->
                val on = t.topic in picked
                val shape = RoundedCornerShape(topStart = if (i == 0) 12.dp else 0.dp, topEnd = if (i == 0) 12.dp else 0.dp,
                    bottomStart = if (i == people.size - 1) 12.dp else 0.dp, bottomEnd = if (i == people.size - 1) 12.dp else 0.dp)
                Row(Modifier.fillMaxWidth().clip(shape).background(p.paper).clickable { toggle(t.topic) }.padding(horizontal = 14.dp, vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Avatar(t.name, 36.dp, t.photo)
                    Spacer(Modifier.width(12.dp))
                    Text(t.name, color = p.ink, fontSize = 17.sp, modifier = Modifier.weight(1f))
                    Icon(if (on) Sf.checkCircle else Sf.circle, null, tint = if (on) p.ink else p.ink3.copy(alpha = 0.5f), modifier = Modifier.size(24.dp))
                }
            }
        }
    }
}

// ---- a chat ---------------------------------------------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChatRoom(topic: String, person: Person) {
    val p = LocalPalette.current
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val t = Chat.topics.firstOrNull { it.topic == topic }
    val list = Chat.messages[topic] ?: emptyList()
    val state = rememberLazyListState()
    var entered by remember(topic) { mutableStateOf(false) }
    var older by remember { mutableStateOf(false) }
    var noMore by remember(topic) { mutableStateOf(false) }
    var opening by remember { mutableStateOf<Int?>(null) }
    var plus by remember { mutableStateOf(false) }
    LaunchedEffect(topic) { Chat.enter(topic); entered = true }
    DisposableEffect(topic) { onDispose { Chat.leave(topic) } }
    val shown = list.asReversed()
    LaunchedEffect(list.lastOrNull()?.seq) { if (state.firstVisibleItemIndex <= 2) state.animateScrollToItem(0) }
    val ime = WindowInsets.isImeVisible
    fun open(a: ChatAttachment, m: ChatMessage) {
        if (opening != null) return
        opening = m.seq
        scope.launch {
            val d = Chat.fetch(a)
            opening = null
            if (d == null) Desk.say("文件没取下来，稍后再试") else ChatShell.file = ChatFile(a.name, a.mime, d)
        }
    }
    fun dial() {
        val go = {
            scope.launch { if (!Calls.dial(topic)) Desk.say(if (Calls.ready) "没打出去，稍后再试" else "通话还没准备好，稍等几秒再试") }
        }
        if (Voice.granted(ctx)) go() else Desk.askMic?.invoke { ok -> if (ok) go() else Desk.say("要在手机设置里允许 TDH 使用麦克风才能通话") }
    }

    Page { haze ->
        Box(Modifier.fillMaxSize().imePadding()) {
            Box(Modifier.fillMaxSize().haze(haze)) {
                DeskBackground()
                LazyColumn(Modifier.fillMaxSize(), state = state, reverseLayout = true,
                    contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = statusTop() + BAR.dp + 8.dp, bottom = (if (ime) 0.dp else navBottom()) + 76.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.Bottom)) {
                    items(shown.size, key = { shown[it].seq }) { i ->
                        val m = shown[i]
                        val prev = shown.getOrNull(i + 1)
                        Column(Modifier.fillMaxWidth().animateItem(), horizontalAlignment = Alignment.CenterHorizontally) {
                            if (prev == null || m.at - prev.at > 300_000) {
                                Text(if (chatWhen(m.at) == "刚刚") "刚刚" else stamp(m.at), color = p.ink3, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp, bottom = 12.dp))
                            }
                            Bubble(m, topic, t, list, opening == m.seq, { dial() }) { a -> open(a, m) }
                        }
                    }
                    if (list.size >= 20 && !noMore) item(key = "older") {
                        Box(Modifier.fillMaxWidth().height(32.dp), contentAlignment = Alignment.Center) {
                            Box(Modifier.liquid(p).clickable(enabled = !older) {
                                older = true
                                scope.launch { if (!Chat.loadOlder(topic)) noMore = true; older = false }
                            }.padding(horizontal = 12.dp, vertical = 6.dp)) {
                                if (older) CircularProgressIndicator(Modifier.size(14.dp), color = p.ink2, strokeWidth = 1.5.dp)
                                else Text("查看更早的消息", color = p.ink2, fontSize = 13.sp)
                            }
                        }
                    }
                }
                if (list.isEmpty()) Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                    if (entered) {
                        Avatar(t?.name ?: "", 64.dp, t?.photo)
                        Spacer(Modifier.height(10.dp))
                        Text("还没有消息，打个招呼吧", color = p.ink2, fontSize = 15.sp)
                    } else CircularProgressIndicator(Modifier.size(24.dp), color = p.ink2, strokeWidth = 2.dp)
                }
            }
            EdgeBlur(true, statusTop() + BAR.dp + 14.dp, Modifier.align(Alignment.TopCenter))
            EdgeBlur(false, (if (ime) 0.dp else navBottom()) + 80.dp, Modifier.align(Alignment.BottomCenter))
            TopRow(t?.name ?: "聊天", leading = { GlassCircle(Sf.chevronLeft, "返回") { ChatShell.room = "" } }) {
                if (topic.startsWith("usr")) GlassCircle(Sf.phone, "语音通话") { dial() }
            }
            PhoneComposer(Modifier.align(Alignment.BottomCenter).then(if (ime) Modifier else Modifier.navigationBarsPadding()).padding(start = 14.dp, end = 14.dp, bottom = 6.dp),
                placeholder = "发消息…", plus = { plus = true }, token = person.token,
                onVoice = { v -> scope.launch { if (!Chat.sendVoice(topic, v.wav, v.ms, v.preview)) Desk.say("语音没发出去，检查一下网络") } },
            ) { text -> if (text.isNotEmpty()) scope.launch { if (!Chat.sendText(topic, text)) Desk.say("没发出去，检查一下网络") } }
        }
    }
    if (plus) PlusSheet(withDocs = true, close = { plus = false }) { pick ->
        scope.launch {
            when (pick) {
                is PlusPick.File -> {
                    val f = pick.f
                    Desk.say(if (f.mime.startsWith("image/")) "正在发送图片…" else "正在发送 ${f.name}")
                    if (!Chat.sendFile(topic, f.name, f.mime, f.bytes)) Desk.say(if (f.mime.startsWith("image/")) "图片没发出去" else "文件没发出去")
                }
                is PlusPick.Doc -> Desk.ask("window.tdhPhone ? tdhPhone.forwardArtifact(${org.json.JSONObject.quote(pick.a.path)}, ${org.json.JSONArray(listOf(topic))}, '') : {ok:false, error:'not-ready'}") { s ->
                    val j = runCatching { org.json.JSONObject(s) }.getOrDefault(org.json.JSONObject())
                    Desk.say(if (j.optBoolean("ok")) "已发送「${pick.a.title}」" else "没发出去：" + j.optString("error").ifEmpty { "稍后再试" })
                }
            }
        }
    }
}

private fun stamp(ms: Long): String {
    val time = SimpleDateFormat("HH:mm", Locale.CHINA).format(Date(ms))
    val w = chatWhen(ms)
    return if (w.contains(":")) time else "$w $time"
}

@Composable
private fun Bubble(m: ChatMessage, topic: String, t: ChatTopic?, list: List<ChatMessage>, opening: Boolean, dial: () -> Unit, open: (ChatAttachment) -> Unit) {
    when {
        m.call != null -> CallNote(m, topic, dial)
        m.aiOkOf != null -> AnswerNote(m, list)
        m.ai -> AssistantCard(m, topic, list)
        else -> PlainBubble(m, t, opening, open)
    }
}

/** A call, as the desks show it: one line in the middle (语音通话 0:36, 对方未接听…); tap it to call back. */
@Composable
private fun CallNote(m: ChatMessage, topic: String, dial: () -> Unit) {
    val p = LocalPalette.current
    val mine = m.from == Chat.me
    val secs = m.callMs / 1000
    val text = when (m.call) {
        "finished" -> "语音通话" + if (secs > 0) " %d:%02d".format(secs / 60, secs % 60) else ""
        "missed" -> if (mine) "对方未接听" else "未接的语音通话"
        "declined" -> if (mine) "对方已拒绝" else "已拒绝语音通话"
        "busy" -> if (mine) "对方忙" else "未接的语音通话"
        "disconnected" -> "通话中断"
        else -> "语音通话"
    }
    val missed = m.call == "missed" && !mine
    Row(Modifier.liquid(p).press({ if (topic.startsWith("usr")) dial() }).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(if (missed) Sf.phoneIn else Sf.phone, null, tint = if (missed) p.red else p.ink2, modifier = Modifier.size(14.dp))
        Spacer(Modifier.width(5.dp))
        Text(text, color = if (missed) p.red else p.ink2, fontSize = 13.sp)
    }
}

@Composable
private fun PlainBubble(m: ChatMessage, t: ChatTopic?, opening: Boolean, open: (ChatAttachment) -> Unit) {
    val p = LocalPalette.current
    val mine = m.from == Chat.me
    val who = Chat.people[m.from]
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start, verticalAlignment = Alignment.Top) {
        if (mine) Spacer(Modifier.width(56.dp)) else { Avatar(who?.name ?: "同事", 40.dp, who?.photo); Spacer(Modifier.width(10.dp)) }
        Column(Modifier.weight(1f, false), horizontalAlignment = if (mine) Alignment.End else Alignment.Start, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (!mine && t?.group == true) Text(who?.name ?: "同事", color = p.ink2, fontSize = 12.sp)
            val card = m.card
            val file = m.attachments.firstOrNull { it.kind == AttKind.File }
            when {
                card != null -> TaskCardView(card)
                file != null -> FileCard(file, m.text, opening) { open(file) }
                m.text.isNotEmpty() -> SelectionContainer {
                    Text(m.text, color = p.ink, fontSize = 17.sp, lineHeight = 24.sp,
                        modifier = Modifier.alpha(if (m.pending) 0.6f else 1f).wash(p, if (mine) p.mine else p.paper, if (mine) 0.75f else 0.6f, RoundedCornerShape(18.dp))
                            .padding(horizontal = 14.dp, vertical = 10.dp))
                }
            }
            if (card == null) m.attachments.filter { it.kind != AttKind.File }.forEach { a ->
                when (a.kind) {
                    AttKind.Image -> {
                        val thumb = remember(a.ref, a.inline?.size) { a.inline?.let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() } }
                        val (w, h) = imgSize(a)
                        Box(Modifier.size(w, h).shadow(12.dp, RoundedCornerShape(16.dp), ambientColor = Color(0x1A1E3359), spotColor = Color(0x1A1E3359))
                            .clip(RoundedCornerShape(16.dp)).background(p.ink2.copy(alpha = 0.12f))
                            .border(1.dp, p.rim.copy(alpha = 0.8f), RoundedCornerShape(16.dp)).press({ open(a) }), contentAlignment = Alignment.Center) {
                            if (thumb != null) Image(thumb, a.name, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                            else Icon(Sf.photos, null, tint = p.ink2)
                            if (opening) CircularProgressIndicator(Modifier.size(22.dp), color = Color.White, strokeWidth = 2.dp)
                        }
                    }
                    AttKind.Audio -> VoiceBubble(a, mine)
                    else -> {}
                }
            }
        }
        if (mine) { Spacer(Modifier.width(10.dp)); Avatar(Chat.people[Chat.me]?.name ?: "我", 40.dp, Chat.people[Chat.me]?.photo) } else Spacer(Modifier.width(56.dp))
    }
}

/** The iPhone's frosted(_, wash:, amount:): a wash of a colour, a bright edge fading down, a soft shadow. */
fun Modifier.wash(p: Palette, color: Color, amount: Float, shape: androidx.compose.ui.graphics.Shape): Modifier =
    this.shadow(if (p.dark) 0.dp else 10.dp, shape, ambientColor = Color(0x141E3359), spotColor = Color(0x141E3359))
        .clip(shape)
        .background(color.copy(alpha = if (p.dark) minOf(1f, amount + 0.15f) else amount))
        .border(0.6.dp, Brush.verticalGradient(listOf(p.rim.copy(alpha = 0.95f), p.rim.copy(alpha = 0.3f))), shape)

private fun imgSize(a: ChatAttachment): Pair<Dp, Dp> {
    val w = maxOf(a.width, 1).toFloat(); val h = maxOf(a.height, 1).toFloat()
    val s = minOf(200f / w, 240f / h, 4f)
    return maxOf(80f, minOf(200f, w * s)).dp to maxOf(80f, minOf(240f, h * s)).dp
}

private fun size(n: Int): String = when {
    n <= 0 -> ""
    n < 1000 -> "$n 字节"
    n < 1000 * 1000 -> "${(n + 500) / 1000} KB"
    else -> "%.1f MB".format(n / 1_000_000f)
}

// ---- FunctionCards --------------------------------------------------------------------------------------------------------

/** TDH 助手's words for each kind of card (the chat page's AI_WORDS). */
private class AIWords(
    val label: String, val yes: String? = null, val no: String? = null, val sayYes: String = "", val sayNo: String = "",
    val noteYes: String = "", val noteNo: String = "", val doneYes: (String) -> String = { "" }, val doneNo: (String) -> String = { "" },
    val wait: String = "", val icon: ImageVector, val tint: Color,
) {
    companion object {
        private val orange = Color(0xFFFF9500); private val green = Color(0xFF34C759); private val purple = Color(0xFFAF52DE)
        private val indigo = Color(0xFF5856D6); private val blue = Color(0xFF0A84FF)
        fun of(kind: String): AIWords = when (kind) {
            "task" -> AIWords("任务卡", "记下", "不用", "记下", "不用记", " 记下了这张任务卡", " 说不用记", { "✓ $it 记下了" }, { "$it：不用记" }, " 决定", Sf.checklist, orange)
            "task-made" -> AIWords("任务卡", icon = Sf.checklist, tint = orange)
            "doc-saved" -> AIWords("财务单据", no = "撤销", sayNo = "撤销", noteNo = " 撤销了这张单据", doneNo = { "$it 撤销了这张单据" }, icon = Sf.docSearch, tint = green)
            "doc-ask" -> AIWords("财务单据", "存进财务", "不用", "存进财务", "不用存", " 把它存进了财务", " 说不用存", { "✓ $it 存进了财务" }, { "$it：不用存" }, " 决定", Sf.docSearch, green)
            "doc-note" -> AIWords("财务单据", icon = Sf.docSearch, tint = green)
            "kb-ask" -> AIWords("知识库", "放进去", "不放", "放进去", "不放", " 让 TDH 收进知识库", " 说不放进知识库", { "✓ $it 让它收进知识库" }, { "$it：不放进知识库" }, " 决定", Sf.books, purple)
            "kb-note" -> AIWords("知识库", icon = Sf.books, tint = purple)
            "call-note" -> AIWords("通话纪要", "转成任务卡", "不用", "把纪要里的待办转成任务卡", "待办不用转任务卡", " 把纪要里的待办转成了任务卡", " 说待办不用转任务卡",
                { "✓ $it 转成了任务卡" }, { "$it：不用转任务卡" }, " 决定", Sf.phoneBubble, indigo)
            else -> AIWords("自动查询", "确认无误", "有误", "确认无误", "这条数据有误，我来核对", " 确认了 TDH 助手的数据", " 说 TDH 助手的数据有误，正在核对",
                { "✓ $it 确认无误" }, { "✗ $it：有误，正在核对" }, " 确认", Sf.chartDoc, blue)
        }
    }
}

private fun nameOf(uid: String) = if (uid == Chat.me) "我" else Chat.people[uid]?.name ?: "同事"

/** TDH 助手's card: its kind, what it says (a call's minutes laid out), and at its foot the buttons, the answer, or whom it waits for. */
@Composable
private fun AssistantCard(m: ChatMessage, topic: String, list: List<ChatMessage>) {
    val p = LocalPalette.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    var sending by remember { mutableStateOf(false) }
    val w = AIWords.of(m.aiKind)
    val answer = list.firstOrNull { it.aiOkOf == m.seq && (m.aiDeciders.isEmpty() || it.from in m.aiDeciders) }
    val minutes = if (m.aiKind == "call-note") CallMinutes.parse(m.text) else null
    fun say(ok: Boolean) {
        sending = true
        view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
        scope.launch { Chat.answerAi(topic, m.seq, ok, if (ok) w.sayYes else w.sayNo); sending = false }
    }
    Column(Modifier.padding(horizontal = 6.dp).fillMaxWidth().wash(p, p.paper, 0.7f, RoundedCornerShape(24.dp)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (minutes != null) CallMinutesCard(minutes)
        else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(26.dp).clip(RoundedCornerShape(8.dp)).background(Brush.verticalGradient(listOf(w.tint.copy(alpha = 0.85f), w.tint))), contentAlignment = Alignment.Center) {
                    Icon(w.icon, null, tint = Color.White, modifier = Modifier.size(15.dp))
                }
                Spacer(Modifier.width(8.dp))
                Text("TDH 助手 · " + w.label, color = w.tint, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
            SelectionContainer {
                Text(m.text.replace("【TDH 助手】", "").trim(), color = p.ink, fontSize = 15.sp, lineHeight = 22.sp)
            }
        }
        when {
            answer != null -> {
                val said = (if (answer.aiOk) w.doneYes(nameOf(answer.from)) else w.doneNo(nameOf(answer.from))).replace("✓ ", "").replace("✗ ", "")
                if (said.isNotEmpty()) Row(Modifier.clip(CircleShape).background((if (answer.aiOk) p.green else p.ink).copy(alpha = 0.08f)).padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (answer.aiOk) Sf.checkCircle else Sf.xmarkCircle, null, tint = if (answer.aiOk) p.green else p.ink2, modifier = Modifier.size(15.dp))
                    Spacer(Modifier.width(5.dp))
                    Text(said, color = if (answer.aiOk) p.green else p.ink2, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                }
            }
            w.no != null && Chat.me in m.aiDeciders -> Row(Modifier.alpha(if (sending) 0.5f else 1f), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                w.yes?.let { yes ->
                    Box(Modifier.weight(1f).height(40.dp).clip(CircleShape).background(p.ink).press({ say(true) }, !sending), contentAlignment = Alignment.Center) {
                        Text(yes, color = p.ground, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
                Box(Modifier.weight(1f).height(40.dp).liquid(p).press({ say(false) }, !sending), contentAlignment = Alignment.Center) {
                    Text(w.no, color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            w.no != null && m.aiDeciders.isNotEmpty() && w.wait.isNotEmpty() ->
                Text("等 " + m.aiDeciders.joinToString(" 或 ") { nameOf(it) } + w.wait, color = p.ink2, fontSize = 13.sp)
        }
    }
}

/** An answer to one of TDH 助手's cards, one quiet line in the middle (「郑飞飞 记下了这张任务卡」). */
@Composable
private fun AnswerNote(m: ChatMessage, list: List<ChatMessage>) {
    val p = LocalPalette.current
    val target = list.firstOrNull { it.seq == m.aiOkOf }
    val w = AIWords.of(target?.aiKind ?: "")
    Text(nameOf(m.from) + if (m.aiOk) w.noteYes else w.noteNo, color = p.ink2, fontSize = 12.sp,
        modifier = Modifier.liquid(p).padding(horizontal = 12.dp, vertical = 5.dp))
}

/** A task card: what happened to it in colour, its title, who does it by when, the note. */
@Composable
private fun TaskCardView(c: TaskCard) {
    val p = LocalPalette.current
    val (label, tint, icon) = when (c.event) {
        "issued" -> Triple("下达了任务卡", Color(0xFF0A84FF), Sf.paperplane)
        "submitted" -> Triple("提交验收", Color(0xFFAF52DE), Sf.tray)
        "passed" -> Triple("验收通过", Color(0xFF34C759), Sf.seal)
        "returned" -> Triple("打回了", Color(0xFFFF3B30), Sf.uturn)
        "cancelled" -> Triple("作废了", Color(0xFF8E8E93), Sf.xmarkCircle)
        "due" -> Triple("改了截止时间", Color(0xFFFF9500), Sf.calendar)
        else -> Triple("任务卡", Color(0xFFFF9500), Sf.checklist)
    }
    val late = c.due > 0 && c.due < System.currentTimeMillis() && c.event != "passed"
    Box(Modifier.width(272.dp).wash(p, p.paper, 0.75f, RoundedCornerShape(20.dp))) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("任务卡", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.clip(CircleShape).background(Brush.verticalGradient(listOf(Color(0xFFFFAD33), Color(0xFFFF9500)))).padding(horizontal = 7.dp, vertical = 3.dp))
                Spacer(Modifier.weight(1f))
                Icon(icon, null, tint = tint, modifier = Modifier.size(13.dp))
                Spacer(Modifier.width(4.dp))
                Text(label, color = tint, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
            Text(c.title, color = if (c.event == "cancelled") p.ink2 else p.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
                textDecoration = if (c.event == "cancelled") TextDecoration.LineThrough else null)
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (c.to.isNotEmpty()) {
                    Icon(Sf.person, null, tint = p.ink2, modifier = Modifier.size(12.dp)); Spacer(Modifier.width(3.dp))
                    Text("负责人 " + c.to, color = p.ink2, fontSize = 12.sp); Spacer(Modifier.width(8.dp))
                }
                if (c.due > 0) Row(Modifier.clip(CircleShape).background((if (late) p.red else Color(0xFFFF9500)).copy(alpha = 0.1f)).padding(horizontal = 7.dp, vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Icon(Sf.calendar, null, tint = if (late) p.red else Color(0xFFFF9500), modifier = Modifier.size(11.dp)); Spacer(Modifier.width(3.dp))
                    Text("截止 " + SimpleDateFormat("M月d日 HH:mm", Locale.CHINA).format(Date(c.due)), color = if (late) p.red else Color(0xFFFF9500), fontSize = 12.sp, fontWeight = FontWeight.Medium)
                }
            }
            if (c.note.isNotBlank()) Text(c.note, color = p.ink.copy(alpha = 0.85f), fontSize = 15.sp,
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(p.paper.copy(alpha = 0.55f)).padding(10.dp))
            Text("在电脑 TDH 左栏「任务」里查看和处理", color = p.ink3, fontSize = 11.sp)
        }
        Box(Modifier.width(4.dp).matchParentSize().clip(RoundedCornerShape(topStart = 20.dp, bottomStart = 20.dp)).background(Color.Transparent)) {
            Box(Modifier.width(4.dp).fillMaxSize().background(Brush.verticalGradient(listOf(tint.copy(alpha = 0.8f), tint))))
        }
    }
}

/** A file (or a forwarded document: an HTML attachment under a 「📎 title」 line) as a card. */
@Composable
private fun FileCard(a: ChatAttachment, text: String, opening: Boolean, onClick: () -> Unit) {
    val p = LocalPalette.current
    val ext = a.name.substringAfterLast('.', "").uppercase()
    val isDoc = ext == "HTML" || ext == "HTM" || a.mime == "text/html"
    val title = if (isDoc) text.lines().firstOrNull { it.startsWith("📎") }?.removePrefix("📎")?.trim() ?: a.name else a.name
    val note = text.lines().filter { !it.startsWith("📎") }.joinToString("\n").trim()
    val (icon, tint) = when {
        isDoc -> Sf.docRich to Color(0xFF5856D6)
        ext == "PDF" -> Sf.docFill to Color(0xFFFF3B30)
        ext == "DOC" || ext == "DOCX" -> Sf.docFill to Color(0xFF0A84FF)
        ext in setOf("XLS", "XLSX", "CSV") -> Sf.table to Color(0xFF34C759)
        ext == "PPT" || ext == "PPTX" -> Sf.slides to Color(0xFFFF9500)
        ext in setOf("ZIP", "RAR", "7Z") -> Sf.zip to Color(0xFFA2845E)
        ext == "TXT" || ext == "MD" -> Sf.doc to Color(0xFF8E8E93)
        else -> Sf.docFill to Color(0xFF8E8E93)
    }
    Column(Modifier.width(262.dp).press(onClick).wash(p, p.paper, 0.7f, RoundedCornerShape(20.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (note.isNotEmpty()) Text(note, color = p.ink, fontSize = 15.sp)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(50.dp)) {
                Box(Modifier.size(46.dp).clip(RoundedCornerShape(12.dp)).background(Brush.verticalGradient(listOf(tint.copy(alpha = 0.8f), tint))), contentAlignment = Alignment.Center) {
                    Icon(icon, null, tint = Color.White, modifier = Modifier.size(24.dp))
                }
                if (ext.isNotEmpty() && !isDoc) Text(ext.take(4), color = tint, fontSize = 8.sp, fontWeight = FontWeight.Black,
                    modifier = Modifier.align(Alignment.BottomEnd).clip(RoundedCornerShape(3.dp)).background(p.paper).padding(horizontal = 3.dp, vertical = 1.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                if (isDoc) Text("文档", color = tint, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                Text(title, color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(if (opening) "正在打开…" else listOf(if (isDoc) "" else ext, size(a.size), "点开查看").filter { it.isNotEmpty() }.joinToString(" · "),
                    color = p.ink2, fontSize = 12.sp)
            }
            Icon(Sf.chevronRight, null, tint = p.ink3, modifier = Modifier.size(13.dp))
        }
    }
}

/** A voice message, WeChat's way: as long as it is long, its waveform, tap to play; its words underneath once written out. */
@Composable
private fun VoiceBubble(a: ChatAttachment, mine: Boolean) {
    val p = LocalPalette.current
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var playing by remember { mutableStateOf(false) }
    var progress by remember { mutableFloatStateOf(0f) }
    var words by remember(a.ref) { mutableStateOf<Pair<String, String>?>(null) }
    var player by remember { mutableStateOf<MediaPlayer?>(null) }
    DisposableEffect(a.ref) { onDispose { player?.release() } }
    LaunchedEffect(a.ref) {
        val ref = a.ref ?: return@LaunchedEffect
        for (wait in listOf(0L, 4000L, 8000L, 15000L, 30000L)) { if (wait > 0) delay(wait); words = Chat.voiceText(ref); if (words != null) return@LaunchedEffect }
    }
    LaunchedEffect(playing) {
        while (playing) { player?.let { if (it.duration > 0) progress = it.currentPosition / it.duration.toFloat() }; delay(100) }
    }
    val secs = maxOf(1, (a.duration + 500) / 1000)
    val peaks = if (a.preview.isNotEmpty()) a.preview.map { (it.toInt() and 0xff) / 255f } else List(16) { 90 / 255f }
    val n = minOf(24, maxOf(8, secs + 6))
    Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.width(minOf(230, 110 + secs * 3).dp).press({
            if (playing) { player?.pause(); player?.seekTo(0); playing = false; progress = 0f; return@press }
            scope.launch {
                val mp = player ?: run {
                    val d = Chat.fetch(a) ?: run { Desk.say("语音没取下来"); return@launch }
                    val f = File(ctx.cacheDir, "voice-${a.ref.hashCode()}.wav").apply { writeBytes(d) }
                    withContext(Dispatchers.IO) { MediaPlayer().apply { setDataSource(f.path); prepare() } }.also { m ->
                        m.setOnCompletionListener { playing = false; progress = 0f }
                        player = m
                    }
                }
                mp.start(); playing = true
            }
        }).wash(p, if (mine) p.mine else p.paper, if (mine) 0.75f else 0.6f, RoundedCornerShape(18.dp)).padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Icon(if (playing) Sf.pause else Sf.play, null, tint = p.ink, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(8.dp))
            Row(Modifier.height(20.dp), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
                for (i in 0 until n) {
                    val v = peaks[minOf(peaks.size - 1, i * peaks.size / n)]
                    Box(Modifier.width(2.5.dp).height((4 + 14 * maxOf(0.15f, v)).dp).clip(CircleShape)
                        .background(if (i / n.toFloat() < progress) p.ink else p.ink.copy(alpha = 0.3f)))
                }
            }
            Spacer(Modifier.weight(1f))
            Text("$secs″", color = p.ink, fontSize = 15.sp)
        }
        words?.let { (text, gist) ->
            if (text.isNotEmpty() || gist.isNotEmpty()) SelectionContainer {
                Column(Modifier.widthIn(max = 250.dp).wash(p, p.paper, 0.4f, RoundedCornerShape(14.dp)).padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (gist.isNotEmpty()) Text("要点：$gist", color = p.ink, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    if (text.isNotEmpty()) Text(text, color = p.ink2, fontSize = 13.sp)
                }
            }
        }
    }
}

// ---- call minutes ------------------------------------------------------------------------------------------------------

/** A call's minutes as the server writes them (chat_call.card_text): head, then 要点 / 定下的事 / 待办 lines. */
class CallMinutes(val a: String, val b: String, val whenAt: String, val length: String, val points: List<String>, val decisions: List<String>,
                  val todos: List<Triple<String, String, String>>, val plain: List<String>) {
    companion object {
        fun parse(text: String): CallMinutes? {
            val lines = text.split("\n")
            val first = lines.firstOrNull() ?: return null
            if (!first.contains("通话纪要（")) return null
            var a = ""; var b = ""; var w = ""; var len = ""
            Regex("通话纪要（(.+?) 与 (.+?)，(.+?)，(.+?)）").find(first.replace("【TDH 助手】", ""))?.let { m ->
                a = m.groupValues[1]; b = m.groupValues[2]; w = m.groupValues[3]; len = m.groupValues[4]
            }
            val points = ArrayList<String>(); val decisions = ArrayList<String>(); val todos = ArrayList<Triple<String, String, String>>(); val plain = ArrayList<String>()
            var section = ""
            for (raw in lines.drop(1)) {
                val l = raw.trim()
                if (l.isEmpty()) continue
                if (l in setOf("要点：", "定下的事：", "待办：")) { section = l; continue }
                if (!l.startsWith("·")) { plain.add(l); continue }
                val item = l.drop(1).trim()
                when (section) {
                    "要点：" -> points.add(item)
                    "定下的事：" -> decisions.add(item)
                    "待办：" -> {
                        var who = ""; var what = item; var due = ""
                        item.indexOf('：').takeIf { it >= 0 }?.let { who = item.substring(0, it); what = item.substring(it + 1) }
                        Regex("（截止 (.+)）$").find(what)?.let { m -> due = m.groupValues[1]; what = what.substring(0, m.range.first) }
                        todos.add(Triple(who, what, due))
                    }
                    else -> plain.add(item)
                }
            }
            return CallMinutes(a, b, w, len, points, decisions, todos, plain)
        }
    }
}

/** The minutes, laid out: who and when under the title, the length at the corner, each part under its own coloured mark. */
@Composable
private fun CallMinutesCard(m: CallMinutes) {
    val p = LocalPalette.current
    SelectionContainer {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(Brush.linearGradient(listOf(Color(0xFF5C8CFA), Color(0xFF8C6BF2)))), contentAlignment = Alignment.Center) {
                    Icon(Sf.phoneBubble, null, tint = Color.White, modifier = Modifier.size(20.dp))
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("通话纪要", color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                    if (m.a.isNotEmpty()) Text(m.a + " 与 " + m.b, color = p.ink2, fontSize = 12.sp, maxLines = 1)
                    if (m.whenAt.isNotEmpty()) Text(m.whenAt, color = p.ink3, fontSize = 11.sp)
                }
                if (m.length.isNotEmpty()) Row(Modifier.clip(CircleShape).background(p.ink.copy(alpha = 0.05f)).padding(horizontal = 9.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Icon(Sf.clock, null, tint = p.ink2, modifier = Modifier.size(12.dp)); Spacer(Modifier.width(3.dp))
                    Text(m.length, color = p.ink2, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                }
            }
            if (m.points.isNotEmpty()) MinutesPart("要点", Sf.lines, Color(0xFF0A84FF)) { Bullets(m.points, Color(0xFF0A84FF)) }
            if (m.decisions.isNotEmpty()) MinutesPart("定下的事", Sf.seal, Color(0xFF34C759)) { Bullets(m.decisions, Color(0xFF34C759)) }
            if (m.todos.isNotEmpty()) MinutesPart("待办", Sf.checklist, Color(0xFFFF9500)) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    m.todos.forEach { (who, what, due) ->
                        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(p.paper.copy(alpha = 0.55f)).padding(10.dp)) {
                            Avatar(who, 26.dp, Chat.people.values.firstOrNull { it.name == who }?.photo)
                            Spacer(Modifier.width(10.dp))
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(what, color = p.ink, fontSize = 15.sp)
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(who, color = p.ink2, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                                    if (due.isNotEmpty()) {
                                        Spacer(Modifier.width(6.dp))
                                        Row(Modifier.clip(CircleShape).background(Color(0xFFFF9500).copy(alpha = 0.12f)).padding(horizontal = 7.dp, vertical = 2.dp),
                                            verticalAlignment = Alignment.CenterVertically) {
                                            Icon(Sf.calendar, null, tint = Color(0xFFFF9500), modifier = Modifier.size(10.dp)); Spacer(Modifier.width(3.dp))
                                            Text(due, color = Color(0xFFFF9500), fontSize = 11.sp, fontWeight = FontWeight.Medium)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if (m.plain.isNotEmpty()) Text(m.plain.joinToString("\n"), color = p.ink2, fontSize = 15.sp)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Sf.sparkles, null, tint = p.ink3, modifier = Modifier.size(11.dp)); Spacer(Modifier.width(5.dp))
                Text("TDH 助手根据通话自动整理", color = p.ink3, fontSize = 11.sp)
            }
        }
    }
}

@Composable
private fun MinutesPart(title: String, icon: ImageVector, tint: Color, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, tint = tint, modifier = Modifier.size(13.dp)); Spacer(Modifier.width(5.dp))
            Text(title, color = tint, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        }
        content()
    }
}

@Composable
private fun Bullets(items: List<String>, tint: Color) {
    val p = LocalPalette.current
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        items.forEach { x ->
            Row {
                Box(Modifier.padding(top = 8.dp).size(5.dp).clip(CircleShape).background(tint.copy(alpha = 0.7f)))
                Spacer(Modifier.width(8.dp))
                Text(x, color = p.ink, fontSize = 15.sp, lineHeight = 21.sp)
            }
        }
    }
}

// ---- a chat's file (ChatFileSheet) -----------------------------------------------------------------------------------------

/** A file from a chat, opened in place: the picture, the PDF's pages, the page or the words; 转发 and 交给 AI under it. */
@Composable
private fun ChatFileSheet(f: ChatFile, close: () -> Unit) {
    val p = LocalPalette.current
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var forwarding by remember { mutableStateOf(false) }
    var asking by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    val ext = f.name.substringAfterLast('.', "").lowercase()
    fun ask() {
        asking = true
        if (Desk.state != DeskState.Ready) { asking = false; Desk.say("AI 还没打开，稍后再试"); return }
        Desk.newChat()
        scope.launch {
            delay(900)
            Desk.askFile(f.name, f.mime, f.data)
            asking = false
            close(); ChatShell.room = ""; Shell.tab = Tab.AI
        }
    }
    FullScreen(close) {
        DeskBackground()
        Column(Modifier.fillMaxSize()) {
            TopRow(f.name, leading = { GlassCircle(Sf.xmark, "关闭", onClick = close) }) { GlassCircle(Sf.ellipsis, "更多") { menu = true } }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when {
                    f.mime.startsWith("image/") || ext in setOf("jpg", "jpeg", "png", "gif", "webp", "heic") -> {
                        val img = remember(f) { Avatars.decode(f.data, 1600)?.asImageBitmap() }
                        if (img != null) Image(img, f.name, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
                    }
                    ext == "pdf" || f.mime == "application/pdf" -> PdfPages(f)
                    ext in setOf("html", "htm", "txt", "md", "csv", "json", "log") || f.mime.startsWith("text/") -> {
                        val html = remember(f) {
                            val s = f.data.toString(Charsets.UTF_8)
                            if (ext == "html" || ext == "htm" || f.mime == "text/html") s
                            else "<meta name=viewport content='width=device-width'><pre style='white-space:pre-wrap;font:15px/1.6 sans-serif;padding:16px'>" +
                                s.replace("&", "&amp;").replace("<", "&lt;") + "</pre>"
                        }
                        Box(Modifier.fillMaxSize().padding(horizontal = 12.dp).clip(RoundedCornerShape(22.dp)).background(Color.White)) {
                            AndroidView({ c -> WebView(c).apply {
                                layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                                settings.javaScriptEnabled = false; settings.allowFileAccess = false
                                loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
                            } }, Modifier.fillMaxSize())
                        }
                    }
                    else -> Column(Modifier.align(Alignment.Center).padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Sf.docFill, null, tint = p.ink2, modifier = Modifier.size(64.dp))
                        Spacer(Modifier.height(12.dp))
                        Text(f.name, color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
                        Text(size(f.data.size), color = p.ink2, fontSize = 13.sp)
                        Spacer(Modifier.height(18.dp))
                        Capsule("用其他 App 打开", icon = Sf.share, prominent = false) { Desk.openBytes(ctx, f.name, f.mime, f.data) }
                    }
                }
            }
            Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 20.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Capsule("转发", Modifier.weight(1f), icon = Sf.forward, prominent = false) { forwarding = true }
                Capsule(if (asking) "正在放进去…" else "交给 AI", Modifier.weight(1f), icon = Sf.sparkles, tint = Color(0xFF4573ED), enabled = !asking) { ask() }
            }
        }
        if (menu) Menu({ menu = false }, listOf(
            MenuItem("转发到聊天", Sf.forward) { forwarding = true },
            MenuItem("交给 AI", Sf.sparkles) { ask() },
            MenuItem("用其他 App 打开", Sf.share) { Desk.openBytes(ctx, f.name, f.mime, f.data) },
        ))
        if (forwarding) ForwardSheet(f.name, { topics, note, done ->
            scope.launch {
                var ok = true
                for (t in topics) {
                    if (!Chat.sendFile(t, f.name, f.mime, f.data)) ok = false
                    if (note.isNotEmpty()) Chat.sendText(t, note)
                }
                done(if (ok) null else "有的没发出去")
            }
        }) { forwarding = false }
    }
}

/** A PDF's pages as pictures, one under another. */
@Composable
private fun PdfPages(f: ChatFile) {
    val ctx = LocalContext.current
    val pages = remember(f) { mutableStateListOf<ImageBitmap>() }
    var failed by remember(f) { mutableStateOf(false) }
    LaunchedEffect(f) {
        withContext(Dispatchers.IO) {
            runCatching {
                val file = File(ctx.cacheDir, "view.pdf").apply { writeBytes(f.data) }
                PdfRenderer(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)).use { r ->
                    for (i in 0 until minOf(r.pageCount, 60)) r.openPage(i).use { pg ->
                        val w = 1200; val h = (w * pg.height / maxOf(1, pg.width))
                        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.WHITE) }
                        pg.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        withContext(Dispatchers.Main) { pages.add(bmp.asImageBitmap()) }
                    }
                }
            }.onFailure { failed = true }
        }
    }
    if (failed) Text("这个 PDF 打不开，试试「用其他 App 打开」", color = LocalPalette.current.ink2, modifier = Modifier.padding(32.dp))
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items(pages.size) { i -> Image(pages[i], null, Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)), contentScale = ContentScale.FillWidth) }
    }
}
