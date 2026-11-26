package cn.tdharness.mobile

// company-android-icons-v1 (the user, 2026-11-26: 「图标也不对」): the iPhone's icons (SF Symbols) drawn for Android —
// thin rounded strokes on a 24 grid, the shapes the iPhone app shows: gearshape, square.and.pencil, line.3.horizontal,
// clock.arrow.circlepath, sparkles, bubble.left.and.bubble.right, doc.text, and the rest the pages use.

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

object Sf {
    private fun icon(name: String, vararg strokes: String, fills: List<String> = emptyList(), width: Float = 1.7f): ImageVector {
        val b = ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f)
        for (d in strokes) b.addPath(addPathNodes(d), stroke = SolidColor(Color.Black), strokeLineWidth = width,
            strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round)
        for (d in fills) b.addPath(addPathNodes(d), fill = SolidColor(Color.Black))
        return b.build()
    }

    /** gearshape: a round gear of eight soft teeth around a ring. */
    val gear: ImageVector by lazy {
        val teeth = StringBuilder()
        val n = 8
        for (i in 0 until n * 2) {
            val a = Math.PI * 2 * i / (n * 2) - Math.PI / 2
            val a2 = Math.PI * 2 * (i + 1) / (n * 2) - Math.PI / 2
            val r = if (i % 2 == 0) 9.6 else 7.6
            val x1 = 12 + r * Math.cos(a); val y1 = 12 + r * Math.sin(a)
            val x2 = 12 + r * Math.cos(a2); val y2 = 12 + r * Math.sin(a2)
            if (i == 0) teeth.append("M%.2f %.2f".format(x1, y1))
            teeth.append("A%.1f %.1f 0 0 1 %.2f %.2f".format(r, r, x2, y2))
            val rn = if (i % 2 == 0) 7.6 else 9.6
            teeth.append("L%.2f %.2f".format(12 + rn * Math.cos(a2), 12 + rn * Math.sin(a2)))
        }
        teeth.append("Z")
        icon("gearshape", teeth.toString(), "M12 9a3 3 0 1 0 0.001 0Z")
    }
    val newChat = icon("square.and.pencil", "M11 4.5H6.5A2.5 2.5 0 0 0 4 7v10.5A2.5 2.5 0 0 0 6.5 20H17a2.5 2.5 0 0 0 2.5-2.5V13",
        "M17.6 3.6a1.9 1.9 0 0 1 2.8 2.7L12.3 14.4 9.4 15.1l0.7-2.9Z")
    val menu = icon("line.3.horizontal", "M4.5 7h15", "M4.5 12h15", "M4.5 17h15", width = 1.9f)
    val history = icon("clock.arrow.circlepath", "M4.3 13.2A8 8 0 1 0 6.7 6.2", "M3.6 3.9v4.3h4.3", "M12 8v4.4l2.9 1.7")
    val sparkles = icon("sparkles", fills = listOf(
        "M10 3.5C10.5 8 12 9.5 16.5 10 12 10.5 10.5 12 10 16.5 9.5 12 8 10.5 3.5 10 8 9.5 9.5 8 10 3.5Z",
        "M18 3c0.25 1.7 0.8 2.25 2.5 2.5-1.7 0.25-2.25 0.8-2.5 2.5-0.25-1.7-0.8-2.25-2.5-2.5C17.2 5.25 17.75 4.7 18 3Z",
        "M17.5 15c0.3 1.9 0.9 2.5 2.8 2.8-1.9 0.3-2.5 0.9-2.8 2.8-0.3-1.9-0.9-2.5-2.8-2.8 1.9-0.3 2.5-0.9 2.8-2.8Z"))
    val sparklesLine = icon("sparkles.outline",
        "M10 3.5C10.5 8 12 9.5 16.5 10 12 10.5 10.5 12 10 16.5 9.5 12 8 10.5 3.5 10 8 9.5 9.5 8 10 3.5Z",
        "M18 3c0.25 1.7 0.8 2.25 2.5 2.5-1.7 0.25-2.25 0.8-2.5 2.5-0.25-1.7-0.8-2.25-2.5-2.5C17.2 5.25 17.75 4.7 18 3Z",
        "M17.5 15c0.3 1.9 0.9 2.5 2.8 2.8-1.9 0.3-2.5 0.9-2.8 2.8-0.3-1.9-0.9-2.5-2.8-2.8 1.9-0.3 2.5-0.9 2.8-2.8Z", width = 1.5f)
    val bubbles = icon("bubble.left.and.bubble.right",
        "M8.6 7.5V6.6A3.1 3.1 0 0 1 11.7 3.5h6.2A3.1 3.1 0 0 1 21 6.6v3.6a3.1 3.1 0 0 1-2.2 3l0.4 2.1-2.4-1.9",
        "M6.1 8.6h6.2a3.1 3.1 0 0 1 3.1 3.1v3.6a3.1 3.1 0 0 1-3.1 3.1H8.6l-3 2.4 0.5-2.5A3.1 3.1 0 0 1 3 15.3v-3.6a3.1 3.1 0 0 1 3.1-3.1Z")
    val doc = icon("doc.text", "M7 3h6.6L18.5 7.9V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z", "M13.4 3.2V8h4.9",
        "M8.5 12.2h6.5", "M8.5 15.2h6.5", "M8.5 18.1h4")
    val plus = icon("plus", "M12 5v14", "M5 12h14", width = 1.9f)
    val keyboard = icon("keyboard", "M4.5 6.5h15A1.5 1.5 0 0 1 21 8v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5V8a1.5 1.5 0 0 1 1.5-1.5Z",
        "M6.5 10h0.01", "M9.5 10h0.01", "M12.5 10h0.01", "M15.5 10h0.01", "M18 10h0.01", "M6.5 13h0.01", "M9.5 13h0.01",
        "M12.5 13h0.01", "M15.5 13h0.01", "M18 13h0.01", "M8 15.8h8", width = 1.6f)
    val waveform = icon("waveform", "M3.5 11v2", "M6.5 8.5v7", "M9.5 5v14", "M12.5 8v8", "M15.5 6v12", "M18.5 9.5v5", "M21 11.2v1.6", width = 1.8f)
    val arrowUp = icon("arrow.up", "M12 19V5.5", "M6.5 11 12 5.5 17.5 11", width = 2.2f)
    val xmark = icon("xmark", "M6.5 6.5l11 11", "M17.5 6.5l-11 11", width = 1.9f)
    val chevronLeft = icon("chevron.left", "M14.5 5.5 8 12l6.5 6.5", width = 2f)
    val chevronRight = icon("chevron.right", "M9.5 5.5 16 12l-6.5 6.5", width = 2f)
    val ellipsis = icon("ellipsis", fills = listOf("M6 12m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0Z",
        "M12 12m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0Z", "M18 12m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0Z"))
    val search = icon("magnifyingglass", "M10.5 4.5a6 6 0 1 0 0.001 0Z", "M15 15l5 5", width = 1.9f)
    val phone = icon("phone", "M8.2 3.6 5.6 4.3C4.6 4.6 4 5.6 4.1 6.6c0.6 6.8 6.4 12.6 13.2 13.2 1 0.1 2-0.5 2.3-1.5l0.7-2.6a1.2 1.2 0 0 0-0.7-1.4l-3-1.3a1.2 1.2 0 0 0-1.4 0.4l-1.1 1.4a10 10 0 0 1-4.6-4.6l1.4-1.1a1.2 1.2 0 0 0 0.4-1.4L9.6 4.3a1.2 1.2 0 0 0-1.4-0.7Z")
    val phoneFill = icon("phone.fill", fills = listOf("M8.2 3.6 5.6 4.3C4.6 4.6 4 5.6 4.1 6.6c0.6 6.8 6.4 12.6 13.2 13.2 1 0.1 2-0.5 2.3-1.5l0.7-2.6a1.2 1.2 0 0 0-0.7-1.4l-3-1.3a1.2 1.2 0 0 0-1.4 0.4l-1.1 1.4a10 10 0 0 1-4.6-4.6l1.4-1.1a1.2 1.2 0 0 0 0.4-1.4L9.6 4.3a1.2 1.2 0 0 0-1.4-0.7Z"))
    val phoneDown = icon("phone.down.fill", fills = listOf("M12 8.6c-3.6 0-6.8 1.1-8.6 2.8-0.6 0.6-0.6 1.5-0.1 2.1l1.4 1.6c0.4 0.5 1.1 0.6 1.6 0.3l2.3-1.4c0.4-0.3 0.6-0.7 0.6-1.2v-1.6a12 12 0 0 1 5.6 0v1.6c0 0.5 0.2 0.9 0.6 1.2l2.3 1.4c0.5 0.3 1.2 0.2 1.6-0.3l1.4-1.6c0.5-0.6 0.5-1.5-0.1-2.1-1.8-1.7-5-2.8-8.6-2.8Z"))
    val mic = icon("mic.fill", fills = listOf("M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"), strokes = *arrayOf("M6 11.5a6 6 0 0 0 12 0", "M12 17.5V21", "M9 21h6"))
    val micOff = icon("mic.slash.fill", "M4 4l16 16", "M6 11.5a6 6 0 0 0 9.3 5", "M18 11.5a6 6 0 0 1-0.5 2.3", "M12 17.5V21", "M9 21h6",
        fills = listOf("M15 9.6V6a3 3 0 0 0-5.8-1.1Z", "M9 9.2V12a3 3 0 0 0 4.6 2.5Z"))
    val speaker = icon("speaker.wave.2", "M4 9.5h3l4.5-4v13l-4.5-4H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z", "M15 9a4 4 0 0 1 0 6", "M17.8 6.5a7.5 7.5 0 0 1 0 11")
    val book = icon("book.closed", "M6.5 3.5H18a1 1 0 0 1 1 1v13H7a2 2 0 0 0-2 2V5a1.5 1.5 0 0 1 1.5-1.5Z", "M5 19.5a2 2 0 0 0 2 2h12v-4", "M9 3.5v8l2-1.4 2 1.4v-8")
    val plusBubble = icon("plus.bubble", "M12 3.5c4.7 0 8.5 3.2 8.5 7.2s-3.8 7.2-8.5 7.2a9.6 9.6 0 0 1-2.6-0.4L5.5 20l0.9-3.4C4.6 15.3 3.5 13.1 3.5 10.7c0-4 3.8-7.2 8.5-7.2Z",
        "M12 7.5v6.5", "M8.75 10.7h6.5")
    val camera = icon("camera", "M8.5 6 9.8 4h4.4l1.3 2H19a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z", "M12 9.5a3.5 3.5 0 1 0 0.001 0Z")
    val photos = icon("photo.on.rectangle", "M7 6.5V5.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-1",
        "M5 8h10a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z", "M3.5 17l3.8-3.6 3 2.6 2.2-1.8L16.5 17")
    val folder = icon("folder", "M3.5 7V6a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z", "M3.5 9.5h17")
    val paperclip = icon("paperclip", "M16.5 7.5 9 15a2 2 0 0 0 2.8 2.8l7.4-7.4a4 4 0 0 0-5.7-5.7L6 12.2a6 6 0 0 0 8.5 8.5L20 15.2")
    val check = icon("checkmark", "M5 12.5l4.5 4.5L19 7.5", width = 2.2f)
    val forward = icon("arrowshape.turn.up.right", "M13.5 5.5 20 11.5l-6.5 6V14c-4.2 0-7.2 1.4-9.5 4.5C4.8 13.8 7.6 10.2 13.5 9.6Z")
    val share = icon("square.and.arrow.up", "M12 3.5V15", "M8 7.2 12 3.5l4 3.7", "M8.5 10H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1.5")
    val play = icon("play.fill", fills = listOf("M8 5.2v13.6a1 1 0 0 0 1.5 0.9l10.6-6.8a1 1 0 0 0 0-1.7L9.5 4.3A1 1 0 0 0 8 5.2Z"))
    val pause = icon("pause.fill", fills = listOf("M7 5h3.2v14H7Z", "M13.8 5H17v14h-3.2Z"))
    val pin = icon("pin.fill", fills = listOf("M9 3.5h6l-0.8 5.4 3.3 3.3V14H6.5v-1.8l3.3-3.3Z"), strokes = *arrayOf("M12 14v6.5"))
    val person = icon("person.fill", fills = listOf("M12 4a4 4 0 1 0 0.001 0Z", "M4.5 20c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6Z"))
    val archive = icon("archivebox", "M4 4.5h16v4H4Z", "M5.5 8.5v10a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-10", "M10 12h4")
    val trash = icon("trash", "M4.5 6.5h15", "M9.5 6.5V4.5h5v2", "M6.5 6.5l0.9 12.2A1.5 1.5 0 0 0 8.9 20h6.2a1.5 1.5 0 0 0 1.5-1.3l0.9-12.2", "M10 10.5v6", "M14 10.5v6")
    val envelope = icon("envelope.open", "M3.5 10 12 4l8.5 6v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19Z", "M3.5 10l8.5 6 8.5-6")
    val docRich = icon("doc.richtext", "M7 3h6.6L18.5 7.9V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z", "M13.4 3.2V8h4.9", "M8 17l2.5-2.8 1.8 1.6 1.7-1.6L16 17", "M9.5 11.2h0.01")
    val chart = icon("chart.bar.xaxis", "M4 20h16", "M7 17v-5", "M11 17V7", "M15 17v-7", "M19 17v-3", width = 2f)
    val clock = icon("clock", "M12 3.5a8.5 8.5 0 1 0 0.001 0Z", "M12 7.5V12l3 2")
    val calendar = icon("calendar", "M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7A1.5 1.5 0 0 1 5 5.5Z", "M3.5 10h17", "M8 3.5v4", "M16 3.5v4")

    // Filled, as the iPhone's tab bar draws them (bubble.left.and.bubble.right.fill, doc.text.fill).
    val bubblesFill = icon("bubble.left.and.bubble.right.fill", fills = listOf(
        "M8.6 7.5V6.6A3.1 3.1 0 0 1 11.7 3.5h6.2A3.1 3.1 0 0 1 21 6.6v3.6a3.1 3.1 0 0 1-2.2 3l0.4 2.1-2.4-1.9h-0.4V11.7a3.4 3.4 0 0 0-3.4-3.4H8.6Z",
        "M6.1 9.3h6.2a2.4 2.4 0 0 1 2.4 2.4v3.6a2.4 2.4 0 0 1-2.4 2.4H8.4l-2.8 2.2 0.5-2.3A2.4 2.4 0 0 1 3.7 15.3v-3.6a2.4 2.4 0 0 1 2.4-2.4Z"))
    val docFill = icon("doc.text.fill", fills = listOf("M7 3h6.2v4.4c0 0.9 0.7 1.6 1.6 1.6h4.2V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z", "M14.4 3.3 18.7 7.7h-3.5a0.8 0.8 0 0 1-0.8-0.8Z"),
        strokes = *arrayOf())
    val personCircle = icon("person.crop.circle", "M12 3.2a8.8 8.8 0 1 0 0.001 0Z", "M12 7.6a3 3 0 1 0 0.001 0Z", "M6.2 18.4c1.3-2.2 3.4-3.4 5.8-3.4s4.5 1.2 5.8 3.4")
    val building = icon("building.2", "M4 20.5V6.5l7-3v17", "M11 9.5h7a1 1 0 0 1 1 1v10", "M3 20.5h18", "M7 8.5h1", "M7 11.5h1", "M7 14.5h1", "M14 13h2", "M14 16h2")
    val personKey = icon("person.badge.key", "M9.5 4a3.5 3.5 0 1 0 0.001 0Z", "M3 19.5c0-3.3 2.9-5.5 6.5-5.5 1.3 0 2.5 0.3 3.5 0.8", "M17.5 12.5a2.2 2.2 0 1 0 0.001 0Z", "M17.5 16.9V21", "M17.5 19h1.6")
    val at = icon("at", "M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z", "M15.5 9v4.2a2.3 2.3 0 0 0 4.5 0.6A8.5 8.5 0 1 0 16.7 19")
    val server = icon("server.rack", "M4.5 4h15a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z", "M4.5 14h15a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Z", "M7 7h0.01", "M7 17h0.01", "M10 7h5", "M10 17h5")
    val info = icon("info.circle", "M12 3.5a8.5 8.5 0 1 0 0.001 0Z", "M12 11v5.5", "M12 7.8h0.01", width = 1.8f)
    val hand = icon("hand.raised", "M8 12V5.5a1.5 1.5 0 0 1 3 0V11", "M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5", "M14 10.5V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-0.5a5.5 5.5 0 0 1-4.4-2.2L3.8 15a1.6 1.6 0 0 1 2.4-2.1L8 14.5V8.5a1.5 1.5 0 0 1 3 0")
    val shield = icon("exclamationmark.shield", "M12 3 5 5.8v5.4c0 4.3 3 8 7 9.3 4-1.3 7-5 7-9.3V5.8Z", "M12 8v5", "M12 16h0.01", width = 1.8f)
    val table = icon("tablecells", "M4.5 4.5h15a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z", "M3.5 9.5h17", "M3.5 14.5h17", "M9.5 4.5v15", "M15 4.5v15")
    val slides = icon("rectangle.on.rectangle", "M7 7.5h12a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 17V9A1.5 1.5 0 0 1 7 7.5Z", "M3.5 15V6a1.5 1.5 0 0 1 1.5-1.5h11.5")
    val phoneIn = icon("phone.arrow.down.left", "M8.2 3.6 5.6 4.3C4.6 4.6 4 5.6 4.1 6.6c0.6 6.8 6.4 12.6 13.2 13.2 1 0.1 2-0.5 2.3-1.5l0.7-2.6a1.2 1.2 0 0 0-0.7-1.4l-3-1.3a1.2 1.2 0 0 0-1.4 0.4l-1.1 1.4a10 10 0 0 1-4.6-4.6l1.4-1.1a1.2 1.2 0 0 0 0.4-1.4L9.6 4.3a1.2 1.2 0 0 0-1.4-0.7Z", "M20 4l-5.5 5.5", "M14.5 5.5v4h4")
    val lines = icon("text.alignleft", "M4.5 6h15", "M4.5 10h10", "M4.5 14h15", "M4.5 18h9", width = 2f)
    val seal = icon("checkmark.seal.fill", fills = listOf("M12 2.8l2.2 1.6 2.7-0.2 0.9 2.6 2.3 1.4-0.7 2.6 0.7 2.6-2.3 1.4-0.9 2.6-2.7-0.2L12 19.2l-2.2-1.6-2.7 0.2-0.9-2.6-2.3-1.4 0.7-2.6-0.7-2.6 2.3-1.4 0.9-2.6 2.7 0.2Z"), strokes = *arrayOf())
    val checklist = icon("checklist", "M3.5 6.5l1.5 1.5 3-3", "M3.5 12.5l1.5 1.5 3-3", "M3.5 18.5l1.5 1.5 3-3", "M11 7h9.5", "M11 13h9.5", "M11 19h9.5")
    val phoneBubble = icon("phone.bubble.fill", fills = listOf("M12 3c4.97 0 9 3.36 9 7.5S16.97 18 12 18c-0.9 0-1.8-0.1-2.6-0.3L5.5 20l0.8-3.6C4.3 15 3 12.9 3 10.5 3 6.36 7.03 3 12 3Z"), strokes = *arrayOf())
    val paperplane = icon("paperplane.fill", fills = listOf("M3.4 11.2 19.8 4.1c0.8-0.3 1.5 0.4 1.2 1.2l-7.1 16.4c-0.3 0.8-1.5 0.7-1.7-0.1l-1.6-6.7-6.7-1.6c-0.8-0.2-0.9-1.4-0.1-1.7Z"), strokes = *arrayOf())
    val tray = icon("tray.and.arrow.up", "M3.5 13.5h4.5l1.5 2.5h5l1.5-2.5h4.5", "M3.5 13.5V19a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5v-5.5", "M12 3.5V12", "M8.5 7 12 3.5 15.5 7")
    val uturn = icon("arrow.uturn.backward", "M9 5 4.5 9.5 9 14", "M4.5 9.5H15a5 5 0 0 1 0 10h-3")
    val xmarkCircle = icon("xmark.circle", "M12 3.5a8.5 8.5 0 1 0 0.001 0Z", "M9 9l6 6", "M15 9l-6 6")
    val checkCircle = icon("checkmark.circle.fill", fills = listOf("M12 2.5a9.5 9.5 0 1 0 0.001 0Z"), strokes = *arrayOf())
    val circle = icon("circle", "M12 3a9 9 0 1 0 0.001 0Z", width = 1.5f)
    val books = icon("books.vertical", "M4 4.5h4v15H4Z", "M8 4.5h4v15H8Z", "M13.5 5.2l3.8-1 3.7 14.5-3.8 1Z")
    val docSearch = icon("doc.text.magnifyingglass", "M13 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6.6L18.5 7.9V11", "M13.4 3.2V8h4.9", "M16.5 13.5a2.8 2.8 0 1 0 0.001 0Z", "M18.6 18.6 20.5 20.5", "M8.5 12h3", "M8.5 15h2")
    val chartDoc = icon("chart.bar.doc.horizontal", "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z", "M8.5 8h5", "M8.5 12h7.5", "M8.5 16h3.5", width = 1.8f)
    val zip = icon("archivebox.fill", fills = listOf("M3.5 4.5h17v4h-17Z", "M4.8 9.6h14.4v9a1.5 1.5 0 0 1-1.5 1.5H6.3a1.5 1.5 0 0 1-1.5-1.5Z"), strokes = *arrayOf())
}
