package cn.tdharness.mobile

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.ValueCallback
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

/** A picture or a file the person picked, read whole. */
class Picked(val name: String, val mime: String, val bytes: ByteArray)

/**
 * The phone's own pickers (company-android-parity-v1), as the iPhone's 「+」 sheet and avatar use them: photos (the
 * system's photo picker, no permission), the camera, files. Set by MainActivity; each answers once.
 */
object Pick {
    var photos: ((max: Int, done: (List<Picked>) -> Unit) -> Unit)? = null
    var camera: ((done: (Picked?) -> Unit) -> Unit)? = null
    var files: ((done: (List<Picked>) -> Unit) -> Unit)? = null
    /** Asks to see the phone's photos (for the latest ones in 「+」); true when it may. */
    var askMedia: ((done: (Boolean) -> Unit) -> Unit)? = null
}

/** The phone's latest photos (MediaStore), their thumbnails, and one read whole. */
object Media {
    fun allowed(ctx: android.content.Context): Boolean {
        val perms = if (Build.VERSION.SDK_INT >= 33) listOf(Manifest.permission.READ_MEDIA_IMAGES, "android.permission.READ_MEDIA_VISUAL_USER_SELECTED")
        else listOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        return perms.any { ContextCompat.checkSelfPermission(ctx, it) == PackageManager.PERMISSION_GRANTED }
    }

    fun recent(ctx: android.content.Context, n: Int = 12): List<Uri> = runCatching {
        val base = android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        ctx.contentResolver.query(base, arrayOf(android.provider.MediaStore.Images.Media._ID), null, null,
            android.provider.MediaStore.Images.Media.DATE_ADDED + " DESC")?.use { c ->
            val out = ArrayList<Uri>()
            while (c.moveToNext() && out.size < n) out.add(android.content.ContentUris.withAppendedId(base, c.getLong(0)))
            out
        } ?: emptyList()
    }.getOrDefault(emptyList())

    fun thumb(ctx: android.content.Context, u: Uri): Bitmap? = runCatching {
        if (Build.VERSION.SDK_INT >= 29) ctx.contentResolver.loadThumbnail(u, android.util.Size(252, 252), null)
        else ctx.contentResolver.openInputStream(u)?.use { android.graphics.BitmapFactory.decodeStream(it, null, android.graphics.BitmapFactory.Options().apply { inSampleSize = 8 }) }
    }.getOrNull()

    /** A photo as JPEG, its longer side at most 2048 (the iPhone's PlusSheet.jpeg). */
    fun photo(ctx: android.content.Context, u: Uri): Picked? = runCatching {
        val raw = ctx.contentResolver.openInputStream(u)?.use { it.readBytes() } ?: return null
        val bmp = Avatars.decode(raw, 1024) ?: return null
        val s = minOf(1f, 2048f / maxOf(bmp.width, bmp.height))
        val out = if (s < 1f) Bitmap.createScaledBitmap(bmp, (bmp.width * s).toInt(), (bmp.height * s).toInt(), true) else bmp
        val jpeg = ByteArrayOutputStream().also { out.compress(Bitmap.CompressFormat.JPEG, 85, it) }.toByteArray()
        Picked(photoName(), "image/jpeg", jpeg)
    }.getOrNull()

    fun photoName() = "照片-" + java.text.SimpleDateFormat("yyyyMMdd-HHmmss", java.util.Locale.CHINA).format(java.util.Date()) + ".jpg"
}

class MainActivity : ComponentActivity() {
    private var pendingFiles: ValueCallback<Array<Uri>>? = null
    private var pendingMic: ((Boolean) -> Unit)? = null
    private var pendingPicked: ((List<Picked>) -> Unit)? = null
    private var pendingCamera: ((Picked?) -> Unit)? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        pendingFiles?.onReceiveValue(uris.toTypedArray())
        pendingFiles = null
    }
    private val pickPhotos = registerForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(9)) { uris -> deliver(uris, photos = true) }
    private val pickPhoto = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> deliver(listOfNotNull(uri), photos = true) }
    private val pickAny = registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris -> deliver(uris) }
    private val shoot = registerForActivityResult(ActivityResultContracts.TakePicturePreview()) { bmp: Bitmap? ->
        val done = pendingCamera ?: return@registerForActivityResult
        pendingCamera = null
        if (bmp == null) { done(null); return@registerForActivityResult }
        val out = ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.JPEG, 88, it) }.toByteArray()
        done(Picked(photoName(), "image/jpeg", out))
    }
    private val askCamera = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) runCatching { shoot.launch(null) }.onFailure { pendingCamera?.invoke(null); pendingCamera = null }
        else { Desk.say("要在手机设置里允许 TDH 使用相机"); pendingCamera?.invoke(null); pendingCamera = null }
    }
    private val askMic = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        pendingMic?.invoke(ok)
        pendingMic = null
    }
    private val askNotify = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }
    private var pendingMedia: ((Boolean) -> Unit)? = null
    private val askMediaPerm = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { r ->
        pendingMedia?.invoke(r.values.any { it } || Media.allowed(this)); pendingMedia = null
    }

    private fun deliver(uris: List<Uri>, photos: Boolean = false) {
        val done = pendingPicked ?: return
        pendingPicked = null
        lifecycleScope.launch {
            val got = withContext(Dispatchers.IO) {
                if (photos) return@withContext uris.mapNotNull { Media.photo(this@MainActivity, it) }
                uris.mapNotNull { u ->
                    val name = runCatching {
                        contentResolver.query(u, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
                    }.getOrNull() ?: "文件"
                    val mime = contentResolver.getType(u) ?: "application/octet-stream"
                    val bytes = runCatching { contentResolver.openInputStream(u)?.use { it.readBytes() } }.getOrNull() ?: return@mapNotNull null
                    Picked(name, mime, bytes)
                }
            }
            done(got)
        }
    }

    private fun photoName() = Media.photoName()

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
        Chat.init(this)
        Pick.photos = { max, done ->
            pendingPicked = done
            val req = PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
            runCatching { if (max <= 1) pickPhoto.launch(req) else pickPhotos.launch(req) }.onFailure { pendingPicked = null; done(emptyList()) }
        }
        Pick.files = { done ->
            pendingPicked = done
            runCatching { pickAny.launch("*/*") }.onFailure { pendingPicked = null; done(emptyList()) }
        }
        Pick.camera = { done ->
            pendingCamera = done
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                runCatching { shoot.launch(null) }.onFailure { pendingCamera = null; done(null) }
            } else askCamera.launch(Manifest.permission.CAMERA)
        }
        Pick.askMedia = { done ->
            if (Media.allowed(this)) done(true)
            else {
                pendingMedia = done
                askMediaPerm.launch(if (Build.VERSION.SDK_INT >= 34) arrayOf(Manifest.permission.READ_MEDIA_IMAGES, "android.permission.READ_MEDIA_VISUAL_USER_SELECTED")
                    else if (Build.VERSION.SDK_INT >= 33) arrayOf(Manifest.permission.READ_MEDIA_IMAGES) else arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE))
            }
        }
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
                Layers.list.lastOrNull()?.let { if (it.back) it.close(); return }
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

    /** A notification tapped: its chat, or its conversation (as the iPhone's). */
    private fun takeTab(i: Intent?) {
        val topic = i?.getStringExtra("topic").orEmpty()
        val session = i?.getStringExtra("session").orEmpty()
        when {
            topic.isNotEmpty() -> { Shell.tab = Tab.Chat; ChatShell.room = topic }
            session.isNotEmpty() -> { Shell.tab = Tab.AI; Desk.openSession(session) }
            i?.getStringExtra("tab") == "chat" -> Shell.tab = Tab.Chat
        }
    }

    override fun onResume() {
        super.onResume()
        ChatWatch.inFront = true
        if (Session.phase == Phase.SignedIn) { Desk.cameBack(); Chat.check() } else Desk.foreground = true
    }

    override fun onPause() {
        ChatWatch.inFront = false
        Desk.foreground = false
        super.onPause()
    }

    override fun onDestroy() {
        if (isFinishing) Desk.destroy()
        super.onDestroy()
    }
}
