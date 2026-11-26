package cn.tdharness.mobile

// company-android-chat-native-v1: the Chat tab as the iPhone draws it (mobile/ios/TDH/ChatViews.swift) — the chats on
// frosted cards (round pictures, the unread count, pinned first; a swipe for 置顶 and 删除), and a chat: one's own words
// in pale sky on the right, the others' on paper with their picture, pictures, file cards, voice bubbles with their
// waveform and words, call lines, TDH 助手's cards with 记下 / 不用, task cards; the composer sends words, pictures,
// files and, held, a voice message.

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.media.MediaPlayer
import android.view.HapticFeedbackConstants
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.GraphicEq
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Keyboard
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.zIndex
import androidx.core.content.ContextCompat
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object ChatShell {
    /** The chat on screen over the tabs, or "". */
    var room by mutableStateOf("")
    /** 通讯录: everyone this person can chat with (a new chat starts here). */
    var contacts by mutableStateOf(false)
    /** A chat's 「+」 asked for files: the room they go to (MainActivity's picker hands them here). */
    var pickInto = ""
}

// ---- the list ----------------------------------------------------------------------------------------------------------

@Composable
fun ChatListPage(top: Dp, bottom: Dp) {
    val p = LocalPalette.current
    var query by remember { mutableStateOf("") }
    var openRow by remember { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf<ChatTopic?>(null) }
    val scope = rememberCoroutineScope()
    val rows = Chat.topics.filter { Chat.shows(it) && (query.isBlank() || it.name.contains(query.trim(), true) || it.preview.contains(query.trim(), true)) }
    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = top + 8.dp, bottom = bottom + 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item(key = "search") {
                Row(Modifier.fillMaxWidth().height(44.dp).glass(p, CircleShape).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Search, null, tint = p.ink2, modifier = Modifier.size(19.dp))
                    Spacer(Modifier.width(8.dp))
                    Box(Modifier.weight(1f)) {
                        if (query.isEmpty()) Text("搜索", color = p.ink3, fontSize = 15.sp)
                        BasicTextField(query, { query = it }, singleLine = true, textStyle = TextStyle(color = p.ink, fontSize = 15.sp),
                            cursorBrush = SolidColor(p.accent), modifier = Modifier.fillMaxWidth())
                    }
                }
            }
            items(rows, key = { it.topic }) { t ->
                val pinned = t.topic in Chat.pinned
                ChatSwipe(t.topic, openRow, { openRow = it }, listOf(
                    Triple(if (pinned) "取消置顶" else "置顶", Color(0xFF5B8DEF)) { scope.launch { if (!Chat.togglePin(t.topic)) Desk.say("没改成，稍后再试") } },
                    Triple("删除", Color(0xFFE5484D)) { deleting = t },
                ), Modifier.animateItem()) {
                    ChatRow(t, pinned) { if (openRow != null) openRow = null else ChatShell.room = t.topic }
                }
            }
        }
        when {
            !Chat.loaded -> Box(Modifier.align(Alignment.Center)) {
                if (Chat.problem.isNotEmpty()) Text(Chat.problem, color = p.ink2) else LavaDots(96.dp, 48.dp)
            }
            rows.isEmpty() -> Column(Modifier.align(Alignment.Center).padding(40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(if (query.isEmpty()) "还没有聊天" else "没找到", color = p.ink, fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(6.dp))
                Text(if (query.isEmpty()) "同事给你发消息后会出现在这里" else "换个词试试", color = p.ink2, fontSize = 14.sp)
            }
        }
    }
    deleting?.let { t ->
        ChatConfirm("删除这个聊天？", "只删你这边的聊天记录，对方那边还在。", "删除「${t.name}」", { deleting = null }) {
            deleting = null
            scope.launch { if (!Chat.deleteChat(t.topic)) Desk.say("没删掉，稍后再试") }
        }
    }
}

@Composable
private fun ChatRow(t: ChatTopic, pinned: Boolean, onClick: () -> Unit) {
    val p = LocalPalette.current
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box {
            Avatar(t.name, 50.dp, t.photo)
            if (t.unread > 0) Text(if (t.unread > 99) "99+" else "${t.unread}", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                modifier = Modifier.align(Alignment.TopEnd).offset(6.dp, (-4).dp).clip(CircleShape).background(p.red)
                    .border(1.5.dp, p.paper, CircleShape).widthIn(min = 19.dp).padding(horizontal = 5.dp, vertical = 1.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(t.name, color = p.ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, false))
                if (pinned) { Spacer(Modifier.width(4.dp)); Icon(Icons.Outlined.PushPin, null, tint = Color(0xFF7594E6), modifier = Modifier.size(13.dp)) }
                Spacer(Modifier.weight(1f))
                Text(chatWhen(t.touched), color = p.ink3, fontSize = 13.sp)
            }
            Spacer(Modifier.height(3.dp))
            Text(t.preview.ifEmpty { " " }, color = p.ink2, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun ChatSwipe(id: String, open: String?, setOpen: (String?) -> Unit, actions: List<Triple<String, Color, () -> Unit>>, modifier: Modifier, content: @Composable () -> Unit) {
    val p = LocalPalette.current
    val density = androidx.compose.ui.platform.LocalDensity.current
    val tile = 84.dp
    val full = with(density) { (tile * actions.size).toPx() }
    val x = remember { androidx.compose.animation.core.Animatable(0f) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(open) { if (open != id && x.value != 0f) x.animateTo(0f, androidx.compose.animation.core.spring(dampingRatio = 0.85f)) }
    Box(modifier.fillMaxWidth().frosted(p)) {
        Row(Modifier.align(Alignment.CenterEnd).matchParentSize()) {
            actions.forEach { (label, color, act) ->
                Box(Modifier.width(tile).fillMaxHeight().background(color).clickable { setOpen(null); act() }, contentAlignment = Alignment.Center) {
                    Text(label, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
        Box(Modifier.offset { androidx.compose.ui.unit.IntOffset(x.value.toInt(), 0) }
            .background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(
                if (p.dark) Color(0xFF262B37) else Color(0xFFF7F9FD), if (p.dark) Color(0xFF232733) else Color(0xFFF3F5FA))))
            .pointerInput(Unit) {
                detectHorizontalDragGestures(
                    onDragEnd = { scope.launch { val o = x.value < -full / 2; x.animateTo(if (o) -full else 0f, androidx.compose.animation.core.spring(dampingRatio = 0.8f)); setOpen(if (o) id else null) } },
                ) { _, d -> scope.launch { x.snapTo((x.value + d).coerceIn(-full * 1.1f, 0f)) } }
            }) { content() }
    }
}


@Composable
private fun ChatConfirm(title: String, detail: String, action: String, cancel: () -> Unit, go: () -> Unit) {
    val p = LocalPalette.current
    Dialog(cancel) {
        Column(Modifier.fillMaxWidth().frosted(p, RoundedCornerShape(26.dp), 0.92f).padding(22.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(title, color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            Text(detail, color = p.ink2, fontSize = 14.sp, textAlign = TextAlign.Center)
            Spacer(Modifier.height(18.dp))
            Box(Modifier.fillMaxWidth().height(48.dp).clip(CircleShape).background(p.red).clickable(onClick = go), contentAlignment = Alignment.Center) {
                Text(action, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text("取消", color = p.ink, fontSize = 15.sp, modifier = Modifier.padding(top = 8.dp).clickable(onClick = cancel).padding(10.dp))
        }
    }
}

/** 通讯录: the colleagues (one-to-one chats) and the groups, by name; tap one to talk. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun ContactsSheet(close: () -> Unit) {
    val p = LocalPalette.current
    var query by remember { mutableStateOf("") }
    val all = Chat.topics.filter { query.isBlank() || it.name.contains(query.trim(), true) }
    val people = all.filter { !it.group }.sortedBy { it.name }
    val groups = all.filter { it.group }.sortedBy { it.name }
    androidx.compose.material3.ModalBottomSheet(close, sheetState = androidx.compose.material3.rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = p.ground) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().imePadding().padding(horizontal = 16.dp)) {
            Text("通讯录", color = p.ink, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = 10.dp))
            Row(Modifier.fillMaxWidth().height(44.dp).glass(p, CircleShape).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Search, null, tint = p.ink2, modifier = Modifier.size(19.dp))
                Spacer(Modifier.width(8.dp))
                Box(Modifier.weight(1f)) {
                    if (query.isEmpty()) Text("搜索同事或群", color = p.ink3, fontSize = 15.sp)
                    BasicTextField(query, { query = it }, singleLine = true, textStyle = TextStyle(color = p.ink, fontSize = 15.sp), cursorBrush = SolidColor(p.accent), modifier = Modifier.fillMaxWidth())
                }
            }
            Spacer(Modifier.height(10.dp))
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 520.dp)) {
                if (people.isNotEmpty()) item { Text("同事", color = p.ink2, fontSize = 13.sp, modifier = Modifier.padding(start = 6.dp, top = 6.dp, bottom = 6.dp)) }
                items(people, key = { it.topic }) { t -> ContactRow(t) { close(); ChatShell.room = t.topic } }
                if (groups.isNotEmpty()) item { Text("群聊", color = p.ink2, fontSize = 13.sp, modifier = Modifier.padding(start = 6.dp, top = 14.dp, bottom = 6.dp)) }
                items(groups, key = { it.topic }) { t -> ContactRow(t) { close(); ChatShell.room = t.topic } }
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
private fun ContactRow(t: ChatTopic, onClick: () -> Unit) {
    val p = LocalPalette.current
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Avatar(t.name, 40.dp, t.photo)
        Spacer(Modifier.width(12.dp))
        Text(t.name, color = p.ink, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

// ---- a chat ------------------------------------------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChatRoom(topic: String, person: Person) {
    val p = LocalPalette.current
    val scope = rememberCoroutineScope()
    val t = Chat.topics.firstOrNull { it.topic == topic }
    val list = Chat.messages[topic] ?: emptyList()
    val state = rememberLazyListState()
    var entered by remember { mutableStateOf(false) }
    var older by remember { mutableStateOf(false) }
    var noMore by remember { mutableStateOf(false) }
    var viewing by remember { mutableStateOf<Pair<String, ByteArray>?>(null) }
    BackHandler { ChatShell.room = "" }
    LaunchedEffect(topic) { Chat.enter(topic); entered = true }
    DisposableEffect(topic) { onDispose { Chat.leave(topic) } }
    // Newest at the bottom (a reversed list: its first item is the last message).
    val shown = list.asReversed()
    LaunchedEffect(list.lastOrNull()?.seq) { if (state.firstVisibleItemIndex <= 2) state.animateScrollToItem(0) }

    Box(Modifier.fillMaxSize().zIndex(4f)) {
        DeskBackground()
        Column(Modifier.fillMaxSize().imePadding()) {
            Row(Modifier.fillMaxWidth().statusBarsPadding().height(56.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(44.dp).glass(p).clickable { ChatShell.room = "" }, contentAlignment = Alignment.Center) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回", tint = p.ink, modifier = Modifier.size(21.dp))
                }
                Text(t?.name ?: "聊天", Modifier.weight(1f).padding(horizontal = 12.dp), color = p.ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
                Spacer(Modifier.width(44.dp))
            }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                LazyColumn(Modifier.fillMaxSize(), state = state, reverseLayout = true, contentPadding = PaddingValues(horizontal = 14.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.Bottom)) {
                    items(shown.size, key = { shown[it].seq }) { i ->
                        val m = shown[i]
                        val prev = shown.getOrNull(i + 1)
                        Column(Modifier.fillMaxWidth().animateItem()) {
                            if (prev == null || m.at - prev.at > 300_000) {
                                Text(stamp(m.at), color = p.ink3, fontSize = 12.sp, modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp), textAlign = TextAlign.Center)
                            }
                            Bubble(m, t, list) { name, bytes -> viewing = name to bytes }
                        }
                    }
                    if (list.size >= 20 && !noMore) item(key = "older") {
                        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                            Text(if (older) "正在加载…" else "查看更早的消息", color = p.ink2, fontSize = 13.sp,
                                modifier = Modifier.glass(p, CircleShape).clickable(enabled = !older) {
                                    older = true
                                    scope.launch { if (!Chat.loadOlder(topic)) noMore = true; older = false }
                                }.padding(horizontal = 14.dp, vertical = 7.dp))
                        }
                    }
                }
                if (list.isEmpty()) Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                    if (entered) {
                        Avatar(t?.name ?: "", 64.dp, t?.photo)
                        Spacer(Modifier.height(10.dp))
                        Text("还没有消息，打个招呼吧", color = p.ink2, fontSize = 14.sp)
                    } else LavaDots(84.dp, 42.dp)
                }
            }
            ChatComposer(topic, person, Modifier.navigationBarsPadding().padding(horizontal = 14.dp, vertical = 6.dp))
        }
        viewing?.let { (name, bytes) -> PictureViewer(name, bytes) { viewing = null } }
    }
}

private fun stamp(ms: Long): String {
    val time = SimpleDateFormat("HH:mm", Locale.CHINA).format(Date(ms))
    val w = chatWhen(ms)
    return if (w.contains(":") || w == "刚刚") time else "$w $time"
}

@Composable
private fun Bubble(m: ChatMessage, t: ChatTopic?, list: List<ChatMessage>, showPicture: (String, ByteArray) -> Unit) {
    when {
        m.call != null -> CallLine(m)
        m.aiOkOf != null -> AnswerNote(m, list)
        m.ai -> AssistantCard(m, t, list)
        else -> PlainBubble(m, t, showPicture)
    }
}

@Composable
private fun CallLine(m: ChatMessage) {
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
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Row(Modifier.glass(p, CircleShape).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Call, null, tint = if (missed) p.red else p.ink2, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(5.dp))
            Text(text, color = if (missed) p.red else p.ink2, fontSize = 13.sp)
        }
    }
}

/** An answer to TDH 助手's card: one line in the middle (「已记下」 · 「不用了」). */
@Composable
private fun AnswerNote(m: ChatMessage, list: List<ChatMessage>) {
    val p = LocalPalette.current
    val who = Chat.people[m.from]?.name ?: "同事"
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Text("$who：${m.text.ifEmpty { if (m.aiOk) "记下了" else "不用了" }}", color = p.ink2, fontSize = 13.sp,
            modifier = Modifier.glass(p, CircleShape).padding(horizontal = 12.dp, vertical = 6.dp))
    }
}

/** TDH 助手's card: its words, and 记下 / 不用 for the people it asks (until one of them answers). */
@Composable
private fun AssistantCard(m: ChatMessage, t: ChatTopic?, list: List<ChatMessage>) {
    val p = LocalPalette.current
    val scope = rememberCoroutineScope()
    val answered = list.firstOrNull { it.aiOkOf == m.seq }
    val canDecide = answered == null && (m.aiDeciders.isEmpty() || Chat.me in m.aiDeciders) && m.aiKind != "data" && m.aiKind != "call-note"
    Column(Modifier.fillMaxWidth().frosted(p, RoundedCornerShape(20.dp)).padding(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(24.dp).clip(CircleShape).background(Color(0xFF4573ED).copy(alpha = 0.16f)), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.AutoAwesome, null, tint = Color(0xFF4573ED), modifier = Modifier.size(14.dp))
            }
            Spacer(Modifier.width(8.dp))
            Text("TDH 助手", color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.height(8.dp))
        SelectionContainer { Text(m.text.removePrefix("【TDH 助手】"), color = p.ink, fontSize = 15.sp, lineHeight = 22.sp) }
        if (canDecide && t != null) {
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.weight(1f).height(40.dp).clip(CircleShape).background(p.ink).clickable {
                    scope.launch { if (!Chat.answerAi(t.topic, m.seq, true, "记下")) Desk.say("没发出去，稍后再试") }
                }, contentAlignment = Alignment.Center) { Text("记下", color = p.ground, fontSize = 15.sp, fontWeight = FontWeight.SemiBold) }
                Box(Modifier.weight(1f).height(40.dp).glass(p, CircleShape).clickable {
                    scope.launch { if (!Chat.answerAi(t.topic, m.seq, false, "不用")) Desk.say("没发出去，稍后再试") }
                }, contentAlignment = Alignment.Center) { Text("不用", color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold) }
            }
        } else if (answered != null) {
            Text(if (answered.aiOk) "已记下" else "不用了", color = p.ink2, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
        }
    }
}

@Composable
private fun PlainBubble(m: ChatMessage, t: ChatTopic?, showPicture: (String, ByteArray) -> Unit) {
    val p = LocalPalette.current
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val mine = m.from == Chat.me
    val who = Chat.people[m.from]
    var opening by remember { mutableStateOf(false) }
    fun open(a: ChatAttachment) {
        if (opening) return
        opening = true
        scope.launch {
            val d = Chat.fetch(a)
            opening = false
            if (d == null) { Desk.say("文件没取下来，稍后再试"); return@launch }
            if (a.kind == AttKind.Image) showPicture(a.name, d) else Desk.openBytes(ctx, a.name, a.mime, d)
        }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start, verticalAlignment = Alignment.Top) {
        if (!mine) { Avatar(who?.name ?: "同事", 40.dp, who?.photo); Spacer(Modifier.width(10.dp)) } else Spacer(Modifier.width(56.dp))
        Column(Modifier.weight(1f, false), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
            if (!mine && t?.group == true) Text(who?.name ?: "同事", color = p.ink2, fontSize = 12.sp, modifier = Modifier.padding(bottom = 4.dp))
            val card = m.card
            val file = m.attachments.firstOrNull { it.kind == AttKind.File }
            when {
                card != null -> TaskCardView(card)
                file != null -> FileCard(file, m.text, opening) { open(file) }
                m.text.isNotEmpty() -> SelectionContainer {
                    Text(m.text, color = p.ink, fontSize = 16.sp, lineHeight = 23.sp,
                        modifier = Modifier.frosted(p, RoundedCornerShape(18.dp), if (mine) 0.85f else 0.6f)
                            .background(if (mine) p.mine.copy(alpha = 0.8f) else Color.Transparent)
                            .padding(horizontal = 14.dp, vertical = 10.dp)
                            .let { if (m.pending) it.then(Modifier.padding(0.dp)) else it })
                }
            }
            if (card == null) m.attachments.filter { it.kind != AttKind.File }.forEach { a ->
                Spacer(Modifier.height(4.dp))
                when (a.kind) {
                    AttKind.Image -> {
                        val thumb = remember(a.ref, a.inline?.size) { a.inline?.let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() } }
                        val (w, h) = imgSize(a)
                        Box(Modifier.size(w, h).clip(RoundedCornerShape(16.dp)).background(p.ink.copy(alpha = 0.08f)).clickable { open(a) }, contentAlignment = Alignment.Center) {
                            if (thumb != null) Image(thumb, a.name, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                            else Icon(Icons.Outlined.Image, null, tint = p.ink2)
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

private fun imgSize(a: ChatAttachment): Pair<Dp, Dp> {
    val w = maxOf(a.width, 1).toFloat(); val h = maxOf(a.height, 1).toFloat()
    val s = minOf(200f / w, 240f / h, 4f)
    return maxOf(80f, minOf(200f, w * s)).dp to maxOf(80f, minOf(240f, h * s)).dp
}

@Composable
private fun FileCard(a: ChatAttachment, text: String, opening: Boolean, onClick: () -> Unit) {
    val p = LocalPalette.current
    val ext = a.name.substringAfterLast('.', "").uppercase().take(4)
    val color = when (ext) { "PDF" -> Color(0xFFFF453A); "DOC", "DOCX" -> Color(0xFF0A84FF); "XLS", "XLSX", "CSV" -> Color(0xFF30D158); "PPT", "PPTX" -> Color(0xFFFF9F0A); else -> Color(0xFF8E8E93) }
    Column(Modifier.widthIn(max = 260.dp).frosted(p, RoundedCornerShape(18.dp), 0.65f).clickable(onClick = onClick).padding(12.dp)) {
        if (text.isNotBlank()) { Text(text, color = p.ink, fontSize = 15.sp); Spacer(Modifier.height(8.dp)) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(40.dp).clip(RoundedCornerShape(10.dp)).background(color), contentAlignment = Alignment.Center) {
                Text(ext.ifEmpty { "FILE" }, color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Black)
            }
            Spacer(Modifier.width(12.dp))
            Column {
                Text(a.name, color = p.ink, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(if (opening) "正在打开…" else size(a.size) + " · 点开预览", color = p.ink2, fontSize = 12.sp)
            }
        }
    }
}

private fun size(n: Int): String = when {
    n <= 0 -> ""
    n < 1024 -> "$n B"
    n < 1024 * 1024 -> "${n / 1024} KB"
    else -> "%.1f MB".format(n / 1048576f)
}

@Composable
private fun TaskCardView(c: TaskCard) {
    val p = LocalPalette.current
    val (word, tone) = when (c.event) {
        "issued" -> "新任务" to Color(0xFF4573ED); "submitted" -> "已提交" to Color(0xFFFF9F0A); "passed" -> "已通过" to Color(0xFF30D158)
        "returned" -> "打回" to Color(0xFFE5484D); "cancelled" -> "作废" to Color(0xFF8E8E93); "due" -> "改了截止" to Color(0xFFBF5AF2); else -> "任务卡" to Color(0xFF4573ED)
    }
    Column(Modifier.widthIn(max = 280.dp).frosted(p, RoundedCornerShape(18.dp)).padding(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.TaskAlt, null, tint = tone, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp))
            Text("任务卡 · $word", color = tone, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.height(6.dp))
        Text(c.title, color = p.ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        if (c.due > 0) Text("截止 " + SimpleDateFormat("M月d日", Locale.CHINA).format(Date(c.due)), color = p.ink2, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
        if (c.note.isNotBlank()) Text(c.note, color = p.ink2, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
    }
}

/** A voice message: a bubble as long as the message is long, its waveform; tap to play; its words under it. */
@Composable
private fun VoiceBubble(a: ChatAttachment, mine: Boolean) {
    val p = LocalPalette.current
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var playing by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf(0f) }
    var words by remember(a.ref) { mutableStateOf<Pair<String, String>?>(null) }
    var player by remember { mutableStateOf<MediaPlayer?>(null) }
    DisposableEffect(a.ref) { onDispose { player?.release() } }
    LaunchedEffect(a.ref) {
        val ref = a.ref ?: return@LaunchedEffect
        repeat(6) { words = Chat.voiceText(ref); if (words != null) return@LaunchedEffect; delay(8000) }
    }
    LaunchedEffect(playing) {
        while (playing) { player?.let { if (it.duration > 0) progress = it.currentPosition / it.duration.toFloat() }; delay(80) }
    }
    val secs = maxOf(1, a.duration / 1000)
    val width = (90 + minOf(150, secs * 4)).dp
    val bars = if (a.preview.isNotEmpty()) a.preview.map { (it.toInt() and 0xff) / 255f } else List(24) { 0.4f }
    Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
        Row(Modifier.width(width).heightIn(min = 44.dp).frosted(p, RoundedCornerShape(18.dp), if (mine) 0.85f else 0.6f)
            .background(if (mine) p.mine.copy(alpha = 0.8f) else Color.Transparent)
            .clickable {
                if (playing) { player?.pause(); playing = false; return@clickable }
                scope.launch {
                    val mp = player ?: run {
                        val d = Chat.fetch(a) ?: run { Desk.say("语音没取下来"); return@launch }
                        val f = File(ctx.cacheDir, "voice-${a.ref.hashCode()}.wav").apply { writeBytes(d) }
                        MediaPlayer().apply { setDataSource(f.path); prepare(); setOnCompletionListener { playing = false; progress = 0f } }.also { player = it }
                    }
                    mp.start(); playing = true
                }
            }.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.GraphicEq, null, tint = p.ink, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Row(Modifier.weight(1f).height(22.dp), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
                val n = minOf(bars.size, 28)
                for (i in 0 until n) {
                    val v = bars[i * bars.size / n]
                    Box(Modifier.width(2.5.dp).height((4 + 18 * v).dp).clip(CircleShape)
                        .background(if (i / n.toFloat() < progress) p.accent else p.ink.copy(alpha = 0.45f)))
                }
            }
            Spacer(Modifier.width(6.dp))
            Text("$secs\"", color = p.ink2, fontSize = 13.sp)
        }
        words?.let { (text, gist) ->
            Column(Modifier.widthIn(max = 260.dp).padding(top = 4.dp)) {
                if (gist.isNotEmpty()) Text("要点：$gist", color = p.ink, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                Text(text, color = p.ink2, fontSize = 13.sp)
            }
        }
    }
}

@Composable
private fun PictureViewer(name: String, bytes: ByteArray, close: () -> Unit) {
    val img = remember(bytes) { BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap() }
    val ctx = LocalContext.current
    Dialog(close, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black).clickable(onClick = close)) {
            if (img != null) Image(img, name, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
            Text("用其他 App 打开", color = Color.White, fontSize = 14.sp,
                modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(20.dp).clip(CircleShape)
                    .background(Color(0x55FFFFFF)).clickable { Desk.openBytes(ctx, name.ifEmpty { "图片.jpg" }, "image/*", bytes) }.padding(horizontal = 18.dp, vertical = 10.dp))
        }
    }
}

// ---- the composer --------------------------------------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChatComposer(topic: String, person: Person, modifier: Modifier) {
    val p = LocalPalette.current
    val ctx = LocalContext.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    var typing by remember { mutableStateOf(true) }
    var text by remember(topic) { mutableStateOf("") }
    var holding by remember { mutableStateOf(false) }
    var cancelling by remember { mutableStateOf(false) }
    fun micGranted() = ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    fun sendText() {
        val t = text.trim()
        if (t.isEmpty()) return
        text = ""
        scope.launch { if (!Chat.sendText(topic, t)) Desk.say("没发出去，检查一下网络") }
    }
    Column(modifier.fillMaxWidth()) {
        AnimatedVisibility(holding, enter = fadeIn() + scaleIn(initialScale = 0.92f), exit = fadeOut() + scaleOut(targetScale = 0.95f)) {
            Column(Modifier.fillMaxWidth().padding(bottom = 10.dp).frosted(p, RoundedCornerShape(24.dp)).padding(vertical = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("${Voice.seconds}\"", color = if (cancelling) p.red else p.ink, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(6.dp))
                Text(if (cancelling) "松手取消" else "松手发送语音，上滑取消", color = if (cancelling) p.red else p.ink2, fontSize = 13.sp)
            }
        }
        Row(Modifier.fillMaxWidth().heightIn(min = 54.dp).frosted(p, RoundedCornerShape(27.dp)).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(42.dp).clip(CircleShape).clickable { ChatShell.pickInto = topic; Desk.pickForChat?.invoke() }, contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Add, "图片或文件", tint = p.ink, modifier = Modifier.size(24.dp))
            }
            if (typing) {
                Box(Modifier.weight(1f).padding(vertical = 14.dp)) {
                    if (text.isEmpty()) Text("发消息…", color = p.ink3, fontSize = 16.sp)
                    BasicTextField(text, { text = it }, Modifier.fillMaxWidth().heightIn(max = 120.dp), textStyle = TextStyle(color = p.ink, fontSize = 16.sp),
                        cursorBrush = SolidColor(p.accent), keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                        keyboardActions = KeyboardActions(onSend = { sendText() }))
                }
                val can = text.isNotBlank()
                Box(Modifier.size(42.dp).clip(CircleShape).background(if (can) p.ink else Color.Transparent)
                    .clickable { if (can) sendText() else typing = false }, contentAlignment = Alignment.Center) {
                    Icon(if (can) Icons.AutoMirrored.Outlined.Send else Icons.Outlined.GraphicEq, if (can) "发送" else "按住说话",
                        tint = if (can) p.ground else p.ink, modifier = Modifier.size(20.dp))
                }
            } else {
                Box(Modifier.weight(1f).height(54.dp).pointerInput(topic) {
                    awaitEachGesture {
                        val down = awaitFirstDown()
                        if (!micGranted()) { Desk.askMic?.invoke { ok -> if (!ok) Desk.say("要在手机设置里允许 TDH 使用麦克风") }; return@awaitEachGesture }
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
                        if (cancelling) return@awaitEachGesture
                        if (got == null) { Desk.say("说话时间太短"); return@awaitEachGesture }
                        scope.launch { if (!Chat.sendVoice(topic, got.wav, got.ms, got.preview)) Desk.say("语音没发出去，检查一下网络") }
                    }
                }, contentAlignment = Alignment.Center) {
                    Text(if (holding) "松手发送" else "按住说话", color = p.ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                }
                Box(Modifier.size(42.dp).clip(CircleShape).clickable { typing = true }, contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.Keyboard, "打字", tint = p.ink, modifier = Modifier.size(22.dp))
                }
            }
        }
    }
}

