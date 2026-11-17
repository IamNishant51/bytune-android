package com.bytune.music

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * The native shell plugin for ByTune on Android:
 *
 *  - `mintPoToken` — BotGuard PO token minting from hidden WebView.
 *  - `registerStream` — loopback proxy for stable googlevideo playback.
 *  - `updateMediaSession` & `clearMediaSession` — native MediaSession and Foreground Service.
 */
@CapacitorPlugin(name = "ByTuneShell")
class ByTuneShellPlugin : Plugin() {

    companion object {
        private const val TAG = "ByTuneShellPlugin"
        private var instance: ByTuneShellPlugin? = null
        var pendingOAuthUrl: String? = null
        var pendingSharedText: String? = null

        fun dispatchOAuthCallback(url: String) {
            val plugin = instance
            if (plugin != null) {
                plugin.activity?.runOnUiThread {
                    val escaped = url.replace("'", "\\'")
                    plugin.bridge?.eval("(function() { window.__bytuneHandleOAuth && window.__bytuneHandleOAuth('$escaped'); })()") { _ -> }
                }
            } else {
                pendingOAuthUrl = url
            }
        }

        fun dispatchSharedText(text: String) {
            val plugin = instance
            if (plugin != null) {
                plugin.activity?.runOnUiThread {
                    val escaped = text.replace("'", "\\'").replace("\n", " ").replace("\r", " ")
                    plugin.bridge?.eval("(function() { window.__bytuneHandleSharedText && window.__bytuneHandleSharedText('$escaped'); })()") { _ -> }
                }
            } else {
                pendingSharedText = text
            }
        }

        fun dispatchMediaAction(action: String, data: Double? = null) {
            val plugin = instance ?: return
            plugin.activity?.runOnUiThread {
                val arg = if (data != null && !data.isNaN()) data.toString() else "null"
                Log.d(TAG, "dispatchMediaAction: $action, $arg")
                plugin.bridge?.eval("(function() { window.__bytuneMediaAction && window.__bytuneMediaAction('$action', $arg); })()") { _ -> }
            }
        }
    }

    private val minter by lazy { PoTokenMinter(context) }
    private var notificationPermissionAsked = false

    override fun load() {
        super.load()
        instance = this
    }

    @PluginMethod
    fun mintPoToken(call: PluginCall) {
        val visitorData = call.getString("visitorData") ?: ""
        if (visitorData.isEmpty()) {
            call.resolve(JSObject().put("token", null as String?))
            return
        }
        minter.mint(visitorData) { token ->
            call.resolve(JSObject().put("token", token))
        }
    }

    @PluginMethod
    fun registerStream(call: PluginCall) {
        val key = call.getString("key") ?: ""
        val url = call.getString("url") ?: ""
        if (key.isEmpty() || url.isEmpty()) {
            call.reject("registerStream needs key and url")
            return
        }
        val lufs = call.getDouble("lufs")
        val loopback = StreamProxy.register(key, url, lufs)
        call.resolve(JSObject().put("url", loopback))
    }

    @PluginMethod
    fun updateMediaSession(call: PluginCall) {
        val title = call.getString("title") ?: ""
        val artist = call.getString("artist") ?: ""
        val album = call.getString("album") ?: ""
        val artworkUrl = call.getString("artworkUrl") ?: ""
        val duration = call.getDouble("duration") ?: 0.0
        val position = call.getDouble("position") ?: 0.0
        val isPlaying = call.getBoolean("isPlaying") ?: false

        // Ask for the notification permission the first time audio actually starts:
        // that is the moment the user can understand why it is being asked for.
        if (isPlaying) maybeAskNotificationPermission()

        val ctx = context
        val service = MusicPlaybackService.currentService
        if (service != null) {
            service.updatePlayback(title, artist, album, artworkUrl, duration, position, isPlaying)
        } else {
            val intent = Intent(ctx, MusicPlaybackService::class.java).apply {
                action = MusicPlaybackService.ACTION_UPDATE
                putExtra("title", title)
                putExtra("artist", artist)
                putExtra("album", album)
                putExtra("artworkUrl", artworkUrl)
                putExtra("duration", duration)
                putExtra("position", position)
                putExtra("isPlaying", isPlaying)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && isPlaying) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
        }
        call.resolve()
    }

    @PluginMethod
    fun clearMediaSession(call: PluginCall) {        val service = MusicPlaybackService.currentService
        if (service != null) {
            service.clearPlayback()
        } else {
            context.stopService(Intent(context, MusicPlaybackService::class.java))
        }
        call.resolve()
    }

    @PluginMethod
    fun openExternalUrl(call: PluginCall) {
        val url = call.getString("url") ?: ""
        if (url.isEmpty()) {
            call.reject("url is required")
            return
        }
        val intent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
        call.resolve()
    }

    @PluginMethod
    fun getPendingAction(call: PluginCall) {
        val res = JSObject()
        res.put("oauthUrl", pendingOAuthUrl)
        res.put("sharedText", pendingSharedText)
        pendingOAuthUrl = null
        pendingSharedText = null
        call.resolve(res)
    }

    override fun handleOnDestroy() {
        if (instance == this) instance = null
        super.handleOnDestroy()
    }

    /** One ask, only on API 33+, only once. Denial leaves audio working without a notification. */
    private fun maybeAskNotificationPermission() {
        if (notificationPermissionAsked) return
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val ctx = activity ?: context
        if (ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            return
        }
        notificationPermissionAsked = true
        activity?.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 101)
    }
}
