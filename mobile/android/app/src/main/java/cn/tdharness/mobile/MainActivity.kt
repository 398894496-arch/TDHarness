package cn.tdharness.mobile

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.ValueCallback
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import kotlinx.coroutines.withContext
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private var pendingFiles: ValueCallback<Array<Uri>>? = null
    private var pendingMic: ((Boolean) -> Unit)? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        pendingFiles?.onReceiveValue(uris.toTypedArray())
        pendingFiles = null
    }
    // company-android-look-v1: 「+」 in the AI composer: pictures or files from the phone, into the assistant's composer.
    private val pickForAi = registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        for (u in uris.take(9)) {
            val name = runCatching {
                contentResolver.query(u, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
            }.getOrNull() ?: "文件"
            val mime = contentResolver.getType(u) ?: "application/octet-stream"
            val bytes = runCatching { contentResolver.openInputStream(u)?.use { it.readBytes() } }.getOrNull()
            if (bytes == null) { Desk.say("「$name」没读出来"); continue }
            if (bytes.size > 20 * 1024 * 1024) { Desk.say("「$name」太大了（超过 20MB）"); continue }
            Desk.askFile(name, mime, bytes)
        }
    }
    // company-android-chat-native-v1: a chat's 「+」: pictures or files into that chat, as this person.
    private val pickForChat = registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        val topic = ChatShell.pickInto
        if (topic.isEmpty()) return@registerForActivityResult
        lifecycleScope.launch {
            for (u in uris.take(9)) {
                val name = runCatching {
                    contentResolver.query(u, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
                }.getOrNull() ?: "文件"
                val mime = contentResolver.getType(u) ?: "application/octet-stream"
                val bytes = withContext(kotlinx.coroutines.Dispatchers.IO) { runCatching { contentResolver.openInputStream(u)?.use { it.readBytes() } }.getOrNull() }
                if (bytes == null) { Desk.say("「$name」没读出来"); continue }
                if (bytes.size > 50 * 1024 * 1024) { Desk.say("「$name」太大了（超过 50MB）"); continue }
                Desk.say("正在发送 $name")
                if (!Chat.sendFile(topic, name, mime, bytes)) Desk.say("「$name」没发出去")
            }
        }
    }
    private val askMic = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        pendingMic?.invoke(ok)
        pendingMic = null
    }
    private val askNotify = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (BuildConfig.DEBUG) {
            val dev = intent.getStringExtra("tdhTestDevice")
            val rem = intent.getStringExtra("tdhTestRemember")
            if (!dev.isNullOrBlank() && !rem.isNullOrBlank()) Session.seed(dev, rem)
        }
        Look.load(this)
        Desk.create(this)
        Desk.pickForAi = { runCatching { pickForAi.launch("*/*") } }
        Desk.pickForChat = { runCatching { pickForChat.launch("*/*") } }
        Chat.init(this)
        Desk.chooseFiles = { cb, params ->
            pendingFiles?.onReceiveValue(null)
            pendingFiles = cb
            val type = params.acceptTypes.firstOrNull { it.isNotBlank() }?.takeIf { !it.contains(',') } ?: "*/*"
            runCatching { pickFiles.launch(type) }.onFailure { cb.onReceiveValue(null); pendingFiles = null }
        }
        Desk.askMic = { done ->
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) done(true)
            else { pendingMic = done; askMic.launch(Manifest.permission.RECORD_AUDIO) }
        }
        takeTab(intent)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (Shell.back()) return
                // The app stays (its relay and the chat watch keep going); only the screen goes away.
                moveTaskToBack(true)
            }
        })
        setContent { Root(onSignedIn = { signedIn() }) }
        if (Session.phase == Phase.Starting && Session.person == null) lifecycleScope.launch { Session.resume() }
    }

    private fun signedIn() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            askNotify.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        ChatWatch.start(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        takeTab(intent)
    }

    private fun takeTab(i: Intent?) {
        if (i?.getStringExtra("tab") == "chat") Shell.tab = Tab.Chat
    }

    override fun onResume() {
        super.onResume()
        if (Session.phase == Phase.SignedIn) { Desk.cameBack(); Chat.check() } else Desk.foreground = true
    }

    override fun onPause() {
        Desk.foreground = false
        super.onPause()
    }

    override fun onDestroy() {
        if (isFinishing) Desk.destroy()
        super.onDestroy()
    }
}
