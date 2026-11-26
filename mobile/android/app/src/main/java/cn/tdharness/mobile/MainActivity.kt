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
        Desk.create(this)
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
        if (Session.phase == Phase.SignedIn) Desk.cameBack() else Desk.foreground = true
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
