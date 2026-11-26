package cn.tdharness.mobile

// company-android-parity-v1: sign-in as the iPhone's (mobile/ios/TDH/LoginView.swift) — one question per screen: the
// phone number (grouped 3-4-4, +86 | at its front), the agreement under it (a small ring, grey words, the two documents
// underlined; a shake and a word when it is not ticked), the code going out by itself at the eleventh digit; then the
// six-digit code in six boxes, the sign-in going by itself at the sixth; a shake on a wrong code; the drops and Beta
// above the title; 发送验证码 at the foot; a glass ‹ back from the code.

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt
import kotlin.math.sin

@Composable
fun Login() {
    val p = LocalPalette.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    var codeStep by remember { mutableStateOf(false) }
    var phone by remember { mutableStateOf(Session.lastPhone.filter(Char::isDigit).take(11)) }
    var code by remember { mutableStateOf("") }
    var agreed by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf(Session.problem) }
    var countdown by remember { mutableIntStateOf(0) }
    var sentTo by remember { mutableStateOf("") }
    var legal by remember { mutableStateOf<String?>(null) }
    val shake = remember { Animatable(0f) }
    val nudge = remember { Animatable(0f) }
    val phoneFocus = remember { FocusRequester() }
    val codeFocus = remember { FocusRequester() }

    LaunchedEffect(countdown) { if (countdown > 0) { delay(1000); countdown -= 1 } }
    LaunchedEffect(codeStep) { runCatching { if (codeStep) codeFocus.requestFocus() else phoneFocus.requestFocus() } }

    fun fail() {
        view.performHapticFeedback(android.view.HapticFeedbackConstants.REJECT)
        scope.launch { shake.snapTo(0f); shake.animateTo(1f, spring(dampingRatio = 0.32f, stiffness = 300f)) }
    }
    fun askAgreement() {
        message = "请先阅读并勾选同意服务协议和隐私政策"
        scope.launch { nudge.snapTo(0f); nudge.animateTo(1f, spring(dampingRatio = 0.3f, stiffness = 500f)) }
    }
    fun askCode() {
        if (phone.length != 11 || busy) return
        busy = true; message = ""
        scope.launch {
            val err = Session.sendCode(phone)
            busy = false
            if (err != null) { message = err; sentTo = ""; fail(); return@launch }
            sentTo = phone; code = ""; codeStep = true; countdown = 60
        }
    }
    fun signIn() {
        if (code.length != 6 || busy) return
        busy = true; message = ""
        scope.launch {
            val err = Session.signInSms(phone, code)
            busy = false
            if (err != null) { message = err; code = ""; fail() }
        }
    }

    Box(Modifier.fillMaxSize().imePadding()) {
        Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.height(72.dp))
            LavaDots(70.dp, 36.dp, Modifier.offset { IntOffset(0, 0) }.let { if (busy) it.padding(0.dp) else it })
            Spacer(Modifier.height(14.dp))
            BetaBadge()
            Spacer(Modifier.height(22.dp))
            AnimatedContent(codeStep, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "title") { c ->
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(if (c) "请输入验证码" else "手机号登录", color = p.ink, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(6.dp))
                    if (c) Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("已发送至 " + masked(phone), color = p.ink2, fontSize = 13.sp)
                        Spacer(Modifier.width(6.dp))
                        Text("更换", color = p.accent, fontSize = 13.sp, fontWeight = FontWeight.Medium,
                            modifier = Modifier.clickable { message = ""; code = ""; codeStep = false })
                    } else Text("公司花名册里登记的手机号", color = p.ink2, fontSize = 13.sp)
                }
            }
            Spacer(Modifier.height(30.dp))
            Box(Modifier.widthIn(max = 460.dp).offset { IntOffset((9 * sin(shake.value * Math.PI * 6) * density).roundToInt(), 0) }) {
                if (!codeStep) {
                    Row(Modifier.fillMaxWidth().height(56.dp).shadow(if (p.dark) 0.dp else 10.dp, CircleShape, ambientColor = Color(0x10000000), spotColor = Color(0x10000000))
                        .clip(CircleShape).background(p.paper.copy(alpha = 0.88f)).padding(horizontal = 22.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("+86", color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.Medium)
                        Spacer(Modifier.width(12.dp))
                        Box(Modifier.width(1.dp).height(20.dp).background(p.ink2.copy(alpha = 0.35f)))
                        Spacer(Modifier.width(12.dp))
                        Box(Modifier.weight(1f)) {
                            if (phone.isEmpty()) Text("请输入手机号", color = p.ink3, fontSize = 17.sp)
                            BasicTextField(phone, { v ->
                                val d = digits(v)
                                phone = d
                                if (d.length == 11 && !busy && sentTo != d) { if (agreed) askCode() else askAgreement() }
                            }, singleLine = true, textStyle = TextStyle(color = p.ink, fontSize = 17.sp), cursorBrush = SolidColor(p.accent),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), visualTransformation = PhoneGroups,
                                modifier = Modifier.fillMaxWidth().focusRequester(phoneFocus))
                        }
                    }
                } else {
                    Box {
                        BasicTextField(code, { v ->
                            val d = v.filter(Char::isDigit).take(6)
                            code = d
                            if (d.length == 6) signIn()
                        }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                            textStyle = TextStyle(color = Color.Transparent), cursorBrush = SolidColor(Color.Transparent),
                            modifier = Modifier.size(1.dp).alpha(0.02f).focusRequester(codeFocus))
                        Row(Modifier.fillMaxWidth().clickable(remember { MutableInteractionSource() }, null) { runCatching { codeFocus.requestFocus() } },
                            horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            for (i in 0 until 6) {
                                val ch = code.getOrNull(i)?.toString() ?: ""
                                val on = i == minOf(code.length, 5)
                                Box(Modifier.weight(1f).height(54.dp).shadow(if (on) 6.dp else 2.dp, RoundedCornerShape(14.dp))
                                    .clip(RoundedCornerShape(14.dp)).background(p.paper.copy(alpha = if (on || ch.isNotEmpty()) 0.95f else 0.55f))
                                    .border(1.5.dp, if (on) p.accent.copy(alpha = 0.6f) else Color.Transparent, RoundedCornerShape(14.dp)),
                                    contentAlignment = Alignment.Center) {
                                    Text(ch, color = p.ink, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
                    }
                }
            }
            if (!codeStep) {
                Spacer(Modifier.height(16.dp))
                Row(Modifier.offset { IntOffset((9 * sin(nudge.value * Math.PI * 6) * density).roundToInt(), 0) }, verticalAlignment = Alignment.CenterVertically) {
                    Row(Modifier.clickable(remember { MutableInteractionSource() }, null) {
                        view.performHapticFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK)
                        agreed = !agreed
                        if (agreed && message.startsWith("请先阅读")) message = ""
                    }, verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(16.dp).clip(CircleShape).then(if (agreed) Modifier.background(p.ink) else Modifier.border(1.2.dp, p.ink2, CircleShape)),
                            contentAlignment = Alignment.Center) {
                            if (agreed) Icon(Sf.check, null, tint = p.ground, modifier = Modifier.size(11.dp))
                        }
                        Spacer(Modifier.width(6.dp))
                        Text("已阅读并同意", color = p.ink2, fontSize = 13.sp)
                    }
                    Spacer(Modifier.width(4.dp))
                    Text("服务协议", color = p.ink2, fontSize = 13.sp, textDecoration = TextDecoration.Underline, modifier = Modifier.clickable { legal = "terms" })
                    Text(" 和 ", color = p.ink2, fontSize = 13.sp)
                    Text("隐私政策", color = p.ink2, fontSize = 13.sp, textDecoration = TextDecoration.Underline, modifier = Modifier.clickable { legal = "privacy" })
                }
            }
            Spacer(Modifier.height(14.dp))
            if (message.isNotEmpty()) Text(message, color = p.red, fontSize = 13.sp, textAlign = TextAlign.Center)
            when {
                busy -> Text(if (codeStep) "正在登录…" else "正在发送验证码…", color = p.ink2, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp))
                codeStep && countdown > 0 -> Text("${countdown}s 后可重新发送", color = p.ink2, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp))
                codeStep -> Text("重新发送验证码", color = p.accent, fontSize = 13.sp, fontWeight = FontWeight.Medium,
                    modifier = Modifier.padding(top = 6.dp).clickable { askCode() })
            }
        }
        if (codeStep) {
            Box(Modifier.statusBarsPadding().padding(start = 16.dp, top = 8.dp).size(44.dp).liquid(p).clickable { message = ""; code = ""; codeStep = false },
                contentAlignment = Alignment.Center) {
                Icon(Sf.chevronLeft, "返回", tint = p.ink, modifier = Modifier.size(20.dp))
            }
        } else {
            val ready = phone.length == 11
            Box(Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(horizontal = 24.dp, vertical = 8.dp).widthIn(max = 460.dp).fillMaxWidth()
                .height(50.dp).clip(CircleShape).background(if (ready && !busy) p.accent else p.ink.copy(alpha = 0.14f))
                .clickable(enabled = ready && !busy) { if (!agreed) askAgreement() else askCode() }, contentAlignment = Alignment.Center) {
                Text("发送验证码", color = if (ready && !busy) Color.White else p.ink3, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
    legal?.let { LegalPage(it) { legal = null } }
}

@Composable
fun BetaBadge() {
    val p = LocalPalette.current
    Text("Beta", color = p.ink.copy(alpha = 0.7f), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.6.sp,
        modifier = Modifier.clip(CircleShape).background(p.paper.copy(alpha = 0.55f)).border(0.5.dp, p.rim.copy(alpha = 0.8f), CircleShape)
            .padding(horizontal = 10.dp, vertical = 4.dp))
}

private fun digits(s: String): String {
    var d = s.filter(Char::isDigit)
    if (d.length >= 13 && d.startsWith("86")) d = d.drop(2)
    return d.take(11)
}

/** 186 8819 4198, shown so while the number itself stays digits (the cursor where the finger put it). */
private object PhoneGroups : androidx.compose.ui.text.input.VisualTransformation {
    override fun filter(text: androidx.compose.ui.text.AnnotatedString): androidx.compose.ui.text.input.TransformedText {
        val d = text.text
        val out = buildString { d.forEachIndexed { i, c -> if (i == 3 || i == 7) append(' '); append(c) } }
        val map = object : androidx.compose.ui.text.input.OffsetMapping {
            override fun originalToTransformed(offset: Int) = offset + (if (offset > 3) 1 else 0) + (if (offset > 7) 1 else 0)
            override fun transformedToOriginal(offset: Int) = (offset - (if (offset > 4) 1 else 0) - (if (offset > 9) 1 else 0)).coerceIn(0, d.length)
        }
        return androidx.compose.ui.text.input.TransformedText(androidx.compose.ui.text.AnnotatedString(out), map)
    }
}

/** 186 **** 4198 */
private fun masked(d: String): String = if (d.length == 11) d.take(3) + " **** " + d.takeLast(4) else d
