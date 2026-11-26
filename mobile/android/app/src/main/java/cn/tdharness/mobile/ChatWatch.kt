package cn.tdharness.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * New chat messages while the app is not on screen. Phones sold in China have no Google push, and each maker's own
 * push needs an account with that maker; so this app keeps a foreground service (a quiet notification says it is
 * receiving messages) that asks the person's desk for what came (/company/chat/unread, the desk's own badge source)
 * and posts a notification for each sender.
 */
class ChatWatch : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var loop: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val n = NotificationCompat.Builder(this, CH_WATCH)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle("TDH 正在接收消息")
            .setContentText("同事发来的消息会在这里提醒你")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setContentIntent(openApp(this, "chat"))
            .build()
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING else 0
        ServiceCompat.startForeground(this, 1, n, type)
        if (loop?.isActive != true) loop = scope.launch { watch() }
        return START_STICKY
    }

    override fun onDestroy() {
        scope.coroutineContext[Job]?.cancel()
        super.onDestroy()
    }

    private suspend fun watch() {
        var since = -1L
        var aiSince = -1L
        while (scope.isActive) {
            val p = Session.person
            if (p == null) { stopSelf(); return }
            val r = runCatching {
                Net.call("GET", "/desk-hub/company/chat/unread?since=${maxOf(since, 0)}", token = p.token, timeoutMs = 15000,
                    headers = mapOf("X-TDH-Chat" to "1"))
            }.getOrNull()
            if (r != null && r.code == 200 && r.json.optBoolean("ok")) {
                val seq = r.json.optLong("seq")
                val ev = r.json.optJSONArray("events")
                if (since < 0) {
                    since = seq // what came before this start is not announced again
                } else if (ev != null) {
                    for (i in 0 until ev.length()) {
                        val e = ev.getJSONObject(i)
                        since = maxOf(since, e.optLong("id"))
                        message(e.optString("from"), e.optBoolean("group"), e.optString("topic"))
                    }
                    since = maxOf(since, seq)
                }
            }
            // company-android-ai-done-v1: the AI finished an answer (people-api keeps them; the iPhone gets an Apple push).
            val a = runCatching {
                Net.call("POST", "/company/ext/chat/ai-events", org.json.JSONObject().put("since", maxOf(aiSince, 0)), token = p.token, timeoutMs = 15000)
            }.getOrNull()
            if (a != null && a.code == 200 && a.json.optBoolean("ok")) {
                val seq = a.json.optLong("seq")
                val ev = a.json.optJSONArray("events")
                if (aiSince >= 0 && ev != null) for (i in 0 until ev.length()) {
                    val e = ev.getJSONObject(i)
                    aiDone(e.optString("session"), e.optString("title"), e.optString("preview"), e.optString("reason"))
                }
                aiSince = maxOf(aiSince, seq)
            }
            delay(if (inFront) 6000 else 8000)
        }
    }

    /** As the iPhone: on screen, a glass banner (not for the chat already open); away, a notification that opens it. */
    private fun message(from: String, group: Boolean, topic: String) {
        val text = if (group) "群里有新消息" else "发来一条新消息"
        if (inFront) {
            if (Shell.tab == Tab.Chat && (ChatShell.room == topic || ChatShell.room.isEmpty())) return
            Notices.show(from.ifEmpty { "新消息" }, text, Notice.Kind.Chat) { Shell.tab = Tab.Chat; if (topic.isNotEmpty()) ChatShell.room = topic }
            return
        }
        post(from.hashCode(), CH_MSG, from.ifEmpty { "新消息" }, text, open(this, "topic", topic))
    }

    private fun aiDone(session: String, title: String, preview: String, reason: String) {
        val head = when (reason) { "error" -> "回答没完成"; "ask" -> "AI 在等你确认"; else -> "AI 已回复" }
        val name = title.takeIf { it.isNotBlank() && !it.startsWith("emp-") } ?: "新对话"
        val body = preview.ifBlank { name }
        if (session.isNotEmpty() && !(inFront && Shell.tab == Tab.AI && Desk.currentSession() == session)) Desk.answered = Desk.answered + session
        if (inFront) {
            if (Shell.tab == Tab.AI && (session.isEmpty() || Desk.currentSession() == session)) return
            Notices.show("$head · $name", body, Notice.Kind.AI) { Shell.tab = Tab.AI; if (session.isNotEmpty()) Desk.openSession(session) }
            return
        }
        post(("ai" + session).hashCode(), CH_AI, "$head · $name", body, open(this, "session", session))
    }

    private fun post(id: Int, ch: String, title: String, text: String, tap: PendingIntent) {
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) return
        val n = NotificationCompat.Builder(this, ch)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setContentIntent(tap)
            .build()
        runCatching { NotificationManagerCompat.from(this).notify(id, n) }
    }

    companion object {
        const val CH_WATCH = "watch"
        const val CH_MSG = "messages"
        const val CH_AI = "answers"

        /** The app is on screen (MainActivity onResume/onPause): banners instead of notifications. */
        @Volatile var inFront = false

        fun channels(ctx: Context) {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CH_WATCH, "保持接收消息", NotificationManager.IMPORTANCE_MIN).apply { setShowBadge(false) })
            nm.createNotificationChannel(NotificationChannel(CH_MSG, "聊天消息", NotificationManager.IMPORTANCE_HIGH))
            nm.createNotificationChannel(NotificationChannel(CH_AI, "AI 回复", NotificationManager.IMPORTANCE_HIGH))
        }

        /** Opens the app at one chat (topic) or one conversation (session). */
        fun open(ctx: Context, key: String, value: String): PendingIntent =
            PendingIntent.getActivity(ctx, (key + value).hashCode(), Intent(ctx, MainActivity::class.java).putExtra(key, value)
                .putExtra("tab", if (key == "topic") "chat" else "ai").addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        fun openApp(ctx: Context, tab: String): PendingIntent =
            PendingIntent.getActivity(ctx, tab.hashCode(), Intent(ctx, MainActivity::class.java).putExtra("tab", tab)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        /** A colleague calls while the app is away: a notification that brings the call screen up. */
        fun ringing(ctx: Context, from: String) {
            if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return
            val n = NotificationCompat.Builder(ctx, CH_MSG)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(from)
                .setContentText("邀请你语音通话")
                .setAutoCancel(true)
                .setTimeoutAfter(45_000)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(Notification.CATEGORY_CALL)
                .setContentIntent(openApp(ctx, "call"))
                .setFullScreenIntent(openApp(ctx, "call"), true)
                .build()
            runCatching { NotificationManagerCompat.from(ctx).notify(7, n) }
        }

        fun start(ctx: Context) {
            runCatching { ctx.startForegroundService(Intent(ctx, ChatWatch::class.java)) }
        }

        fun stop(ctx: Context) {
            runCatching { ctx.stopService(Intent(ctx, ChatWatch::class.java)) }
        }
    }
}
