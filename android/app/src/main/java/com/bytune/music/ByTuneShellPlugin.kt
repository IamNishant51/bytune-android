package com.bytune.music

import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import android.view.HapticFeedbackConstants
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject

/**
 * The native shell plugin for ByTune on Android:
 *
 *  - `mintPoToken` / `cancelPoToken` — BotGuard PO token minting from hidden WebView.
 *  - `registerStream` — loopback proxy for stable googlevideo playback.
 *  - `updateMediaSession` & `clearMediaSession` — native MediaSession and Foreground Service.
 *  - `haptic` — one-shot haptic tick via the WebView.
 *  - `memoryInfo` — foreground memory pressure for the JS low-memory mode.
 */
@CapacitorPlugin(name = "ByTuneShell")
class ByTuneShellPlugin : Plugin() {

    companion object {
        private const val TAG = "ByTuneShellPlugin"
        private const val PREFS_NAME = "bytune_shell_prefs"
        private const val KEY_NOTIFICATION_ASKED = "notification_permission_asked"
        private var instance: ByTuneShellPlugin? = null
        var pendingOAuthUrl: String? = null
        var pendingSharedText: String? = null

        fun dispatchOAuthCallback(url: String) {
            val plugin = instance
            if (plugin != null) {
                plugin.activity?.runOnUiThread {
                    // JSONObject.quote() produces a double-quoted, escaped JS
                    // string literal: no hand-rolled escaping to break out of.
                    plugin.bridge?.eval("(function() { window.__bytuneHandleOAuth && window.__bytuneHandleOAuth(${JSONObject.quote(url)}); })()") { _ -> }
                }
            } else {
                pendingOAuthUrl = url
            }
        }

        fun dispatchSharedText(text: String) {
            val plugin = instance
            if (plugin != null) {
                plugin.activity?.runOnUiThread {
                    // Shared text is attacker-influenced (arbitrary content
                    // from other apps): quote it, never interpolate it. Newlines
                    // now arrive intact instead of flattened to spaces.
                    plugin.bridge?.eval("(function() { window.__bytuneHandleSharedText && window.__bytuneHandleSharedText(${JSONObject.quote(text)}); })()") { _ -> }
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

    /**
     * Cancels an in-flight PO-token mint. The JS side calls this defensively
     * when its mint race times out, so the hidden WebView is destroyed
     * instead of running to the native timeout. Always resolves; a no-op
     * when no mint is running.
     */
    @PluginMethod
    fun cancelPoToken(call: PluginCall) {
        minter.cancel()
        call.resolve()
    }

    /**
     * One-shot haptic tick via the WebView, so it honours the system haptic
     * settings and needs no permission. `kind`: 'selection' | 'light' |
     * 'medium' | 'success'; unknown kinds fall back to 'selection'. Always
     * resolves, even with no WebView attached.
     */
    @PluginMethod
    fun haptic(call: PluginCall) {
        val kind = call.getString("kind") ?: "selection"
        val constant = when (kind) {
            "light" -> HapticFeedbackConstants.KEYBOARD_TAP
            "medium" -> HapticFeedbackConstants.LONG_PRESS
            "success" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                HapticFeedbackConstants.CONFIRM
            } else {
                HapticFeedbackConstants.LONG_PRESS
            }
            else -> HapticFeedbackConstants.CLOCK_TICK
        }
        val view = bridge?.webView
        if (view != null) {
            view.post {
                try {
                    view.performHapticFeedback(constant)
                } catch (_: Exception) {
                    // Haptics must never break a call: swallow and resolve.
                }
            }
        }
        call.resolve()
    }

    /**
     * Foreground memory pressure, polled by the JS side: foreground
     * TRIM_MEMORY_RUNNING_* levels are not delivered on API 34+, so polling
     * is the real mechanism (onTrimMemory still covers backgrounding).
     * Returns { lowMemory, availMemMB, thresholdMB }.
     */
    @PluginMethod
    fun memoryInfo(call: PluginCall) {
        val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        val info = ActivityManager.MemoryInfo()
        activityManager?.getMemoryInfo(info)
        val res = JSObject()
        res.put("lowMemory", info.lowMemory)
        res.put("availMemMB", info.availMem / (1024 * 1024))
        res.put("thresholdMB", info.threshold / (1024 * 1024))
        call.resolve(res)
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
        val rate = (call.getDouble("playbackRate") ?: 1.0).toFloat()
        val playbackRate = if (rate.isFinite() && rate > 0f) rate else 1.0f

        // Ask for the notification permission the first time audio actually starts:
        // that is the moment the user can understand why it is being asked for.
        if (isPlaying) maybeAskNotificationPermission()

        val ctx = context
        val service = MusicPlaybackService.currentService
        if (service != null) {
            service.updatePlayback(title, artist, album, artworkUrl, duration, position, isPlaying, playbackRate)
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
                putExtra("playbackRate", playbackRate)
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
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (prefs.getBoolean(KEY_NOTIFICATION_ASKED, false)) return
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val ctx = activity ?: context
        if (ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            return
        }
        // Persist before asking: a denial (including a permanent one) must
        // never re-prompt on the next cold start.
        prefs.edit().putBoolean(KEY_NOTIFICATION_ASKED, true).apply()
        activity?.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 101)
    }
}
