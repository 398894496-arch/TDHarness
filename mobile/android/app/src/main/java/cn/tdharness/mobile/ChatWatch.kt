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
        while (scope.isActive) {
            val p = Session.person
            if (p == null) { stopSelf(); return }
            val r = runCatching {
                Net.call("GET", "/desk-hub/company/chat/unread?since=${maxOf(since, 0)}", token = p.token, timeoutMs = 15000,
                    headers = mapOf("X-TDH-Chat" to "1"))
            }.getOrNull()
            if (BuildConfig.DEBUG) android.util.Log.d("TDHWatch", "unread ${r?.code} ok=${r?.json?.optBoolean("ok")} live=${r?.json?.optBoolean("live")} seq=${r?.json?.optLong("seq")} since=$since")
            if (r != null && r.code == 200 && r.json.optBoolean("ok")) {
                val seq = r.json.optLong("seq")
                val ev = r.json.optJSONArray("events")
                if (since < 0) {
                    since = seq // what came before this start is not announced again
                } else if (ev != null) {
                    for (i in 0 until ev.length()) {
                        val e = ev.getJSONObject(i)
                        since = maxOf(since, e.optLong("id"))
                        if (!(Desk.foreground && Shell.tab == Tab.Chat)) notifyMessage(e.optString("from"), e.optBoolean("group"), e.optLong("id"))
                    }
                    since = maxOf(since, seq)
                }
            }
            delay(if (Desk.foreground) 15000 else 8000)
        }
    }

    private fun notifyMessage(from: String, group: Boolean, id: Long) {
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) return
        val n = NotificationCompat.Builder(this, CH_MSG)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(from.ifEmpty { "新消息" })
            .setContentText(if (group) "群里有新消息" else "发来一条新消息")
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setContentIntent(openApp(this, "chat"))
            .build()
        runCatching { NotificationManagerCompat.from(this).notify(from.hashCode(), n) }
    }

    companion object {
        const val CH_WATCH = "watch"
        const val CH_MSG = "messages"

        fun channels(ctx: Context) {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CH_WATCH, "保持接收消息", NotificationManager.IMPORTANCE_MIN).apply { setShowBadge(false) })
            nm.createNotificationChannel(NotificationChannel(CH_MSG, "聊天消息", NotificationManager.IMPORTANCE_HIGH))
        }

        fun openApp(ctx: Context, tab: String): PendingIntent =
            PendingIntent.getActivity(ctx, tab.hashCode(), Intent(ctx, MainActivity::class.java).putExtra("tab", tab)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        fun start(ctx: Context) {
            runCatching { ctx.startForegroundService(Intent(ctx, ChatWatch::class.java)) }
        }

        fun stop(ctx: Context) {
            runCatching { ctx.stopService(Intent(ctx, ChatWatch::class.java)) }
        }
    }
}
