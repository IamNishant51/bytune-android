package com.bytune.music

import android.content.ComponentCallbacks2
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Edge-to-edge: content draws behind transparent system bars (see
        // styles.xml); the CSS already pads for env(safe-area-inset-*), so
        // content sits below the bars. Device verification owed for both
        // gesture nav and 3-button nav. targetSdk stays 34 (separate
        // decision); the 35 bump is recorded as a follow-up.
        enableEdgeToEdge()
        // The shell plugin must be registered before the bridge is created.
        registerPlugin(ByTuneShellPlugin::class.java)
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        super.onCreate(savedInstanceState)

        handleIncomingIntent(intent)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                bridge.eval("(function() { return window.__bytuneOnBackPressed ? window.__bytuneOnBackPressed() : false; })()") { result ->
                    if (result != "true") {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            }
        })
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        handleIncomingIntent(intent)
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        // Shed JS-side caches when the UI is backgrounded or memory is
        // tight. Foreground RUNNING_* levels are not delivered on API 34+,
        // so the JS side also polls the shell plugin's memoryInfo while
        // foregrounded; this hook covers backgrounding + older APIs.
        // No WebView settings are tuned here: measure first (dumpsys
        // meminfo), tune only if the measurement says so.
        val pressure = level == ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN ||
            level == ComponentCallbacks2.TRIM_MEMORY_MODERATE ||
            level == ComponentCallbacks2.TRIM_MEMORY_COMPLETE ||
            level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL
        if (!pressure) return
        try {
            bridge.eval("window.__bytuneMemoryPressure?.('trim')") { _ -> }
        } catch (_: Exception) {
            // Bridge/WebView gone while tearing down: nothing to notify.
        }
    }

    private fun handleIncomingIntent(intent: Intent?) {
        if (intent == null) return
        val action = intent.action
        val data = intent.data

        if (action == Intent.ACTION_VIEW && data != null && data.scheme == "bytune") {
            ByTuneShellPlugin.dispatchOAuthCallback(data.toString())
        } else if (action == Intent.ACTION_SEND && intent.type?.startsWith("text/") == true) {
            val text = intent.getStringExtra(Intent.EXTRA_TEXT)
            if (!text.isNullOrEmpty()) {
                ByTuneShellPlugin.dispatchSharedText(text)
            }
        }
    }
}
