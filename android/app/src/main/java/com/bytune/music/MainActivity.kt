package com.bytune.music

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
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
