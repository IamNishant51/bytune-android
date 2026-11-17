package com.bytune.music

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * Mints YouTube PO tokens on the device.
 *
 * The recipe is the desktop's (`electron/po-token.ts`): fetch the BotGuard
 * challenge, run the interpreter, snapshot it, exchange the snapshot for an
 * integrity token, mint a WebPO token bound to the visitor data.
 *
 * Two things cannot happen in a plain page here:
 *  - the snapshot is only scored valid when the document origin is
 *    https://www.youtube.com/, so the work runs in a hidden WebView whose
 *    document URL is exactly that (`loadDataWithBaseURL`),
 *  - GenerateIT lives on jnn-pa.googleapis.com — cross-origin from the
 *    WebView — so the POST is done here, over HttpURLConnection, where CORS
 *    does not exist.
 */
class PoTokenMinter(private val context: Context) {

    private companion object {
        const val TAG = "ByTunePoToken"
        const val REQUEST_KEY = "O43z0dpjhgX20SCx4KAo"
        // Public web-client key for YouTube's InnerTube and BotGuard endpoints (the same
        // value ships in the upstream public project). GitHub secret scanning flags it;
        // it is not a credential this project owns and cannot be rotated here.
        const val GOOG_API_KEY = "AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw"
        const val UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        const val TIMEOUT_MS = 60_000L
    }

    private val main = Handler(Looper.getMainLooper())

    @Volatile private var webView: WebView? = null
    @Volatile private var finished = false
    private var timeout: Runnable? = null

    /** Resolves with the token, or null when minting failed (caller falls back). */
    fun mint(visitorData: String, onResult: (String?) -> Unit) {
        main.post {
            try {
                start(visitorData, onResult)
            } catch (err: Throwable) {
                Log.w(TAG, "mint failed to start", err)
                finish(null, onResult)
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun start(visitorData: String, onResult: (String?) -> Unit) {
        // One minter instance serves every mint: without this reset the second
        // call's finish() is swallowed and its promise never resolves.
        finished = false
        val html = buildPage()
        val view = WebView(context)
        webView = view
        view.settings.javaScriptEnabled = true
        view.settings.domStorageEnabled = true
        view.settings.userAgentString = UA
        view.addJavascriptInterface(Bridge(onResult), "__bytuneIT")

        timeout = Runnable {
            Log.w(TAG, "timed out")
            finish(null, onResult)
        }.also { main.postDelayed(it, TIMEOUT_MS) }

        view.webViewClient = object : android.webkit.WebViewClient() {
            override fun onPageFinished(v: WebView, url: String) {
                val arg = JSONObject.quote(visitorData)
                v.evaluateJavascript("window.__bytuneMintPoToken($arg)", null)
            }

            /**
             * The page's own fetches are answered here, natively, with an
             * `Access-Control-Allow-Origin: *` header. That is what makes the
             * minter work regardless of how the WebView classifies this
             * document's origin — and it keeps the request out of the
             * WebView's network stack entirely.
             */
            override fun shouldInterceptRequest(
                v: WebView,
                request: android.webkit.WebResourceRequest
            ): android.webkit.WebResourceResponse? {
                val url = request.url.toString()
                if (request.method != "GET" || !url.startsWith("https://www.youtube.com/")) return null
                return proxyGet(url, request.requestHeaders)
            }
        }
        // A base URL of https://www.youtube.com is what makes the snapshot
        // score as a real YouTube session; the page itself is ours.
        view.loadDataWithBaseURL("https://www.youtube.com", html, "text/html", "UTF-8", null)
    }

    private fun buildPage(): String {
        val js = context.assets.open("potoken.js").bufferedReader().use { it.readText() }
        return """
            <!doctype html><html><head><meta charset="utf-8">
            <script>
              window.__bytunePoDone = function (json) { window.__bytuneIT.mintDone(json); };
            </script>
            <script>$js</script>
            </head><body></body></html>
        """.trimIndent()
    }

    private fun proxyGet(url: String, headers: Map<String, String>?): android.webkit.WebResourceResponse {
        val cors = HashMap<String, String>()
        cors["Access-Control-Allow-Origin"] = "*"
        cors["Access-Control-Allow-Headers"] = "*"
        cors["Access-Control-Allow-Methods"] = "GET, OPTIONS"
        return try {
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.connectTimeout = 20_000
            conn.readTimeout = 30_000
            conn.setRequestProperty("user-agent", UA)
            headers?.forEach { (k, v) ->
                if (!k.equals("host", true) && !k.equals("origin", true) && !k.equals("referer", true)) {
                    conn.setRequestProperty(k, v)
                }
            }
            val code = conn.responseCode
            val contentType = conn.contentType ?: "application/octet-stream"
            val mime = contentType.substringBefore(';').trim()
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val response = android.webkit.WebResourceResponse(
                mime,
                "utf-8",
                code,
                conn.responseMessage ?: "OK",
                cors,
                stream ?: java.io.ByteArrayInputStream(ByteArray(0))
            )
            Log.d(TAG, "proxied $code ${url.take(80)}")
            response
        } catch (err: Throwable) {
            Log.w(TAG, "proxy failed for ${url.take(80)}", err)
            android.webkit.WebResourceResponse(
                "text/plain",
                "utf-8",
                502,
                "Bad Gateway",
                cors,
                java.io.ByteArrayInputStream(ByteArray(0))
            )
        }
    }

    private fun finish(token: String?, onResult: (String?) -> Unit) {
        if (finished) return
        finished = true
        timeout?.let { main.removeCallbacks(it) }
        val view = webView
        webView = null
        main.post {
            try {
                view?.destroy()
            } catch (err: Throwable) {
                Log.w(TAG, "webview destroy", err)
            }
            onResult(token)
        }
    }

    private inner class Bridge(private val onResult: (String?) -> Unit) {
        /**
         * The challenge, fetched natively: the page's own POST would need CORS,
         * and WebView request interception cannot carry a request body.
         */
        @JavascriptInterface
        fun attGet(): String {
            return try {
                challenge()
            } catch (err: Throwable) {
                Log.w(TAG, "att/get failed", err)
                JSONObject().put("error", err.message ?: "att/get failed").toString()
            }
        }

        /** Called on the JS bridge thread; returns the GenerateIT reply as JSON. */
        @JavascriptInterface
        fun generateIT(snapshot: String): String {
            return try {
                generateIntegrityToken(snapshot)
            } catch (err: Throwable) {
                Log.w(TAG, "GenerateIT failed", err)
                JSONObject().put("error", err.message ?: "GenerateIT failed").toString()
            }
        }

        @JavascriptInterface
        fun mintDone(json: String) {
            val token = try {
                JSONObject(json).optString("token").ifEmpty { null }
            } catch (err: Throwable) {
                Log.w(TAG, "bad mint result", err)
                null
            }
            if (token == null) Log.w(TAG, "no token: ${json.take(200)}") else Log.d(TAG, "minted token: ${token.length} chars")
            finish(token, onResult)
        }
    }

    /** /att/get → the BotGuard challenge (program, global name, interpreter). */
    private fun challenge(): String {
        val conn = URL("https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false")
            .openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.connectTimeout = 20_000
        conn.readTimeout = 30_000
        conn.doOutput = true
        conn.setRequestProperty("content-type", "application/json")
        conn.setRequestProperty("x-goog-api-key", GOOG_API_KEY)
        conn.setRequestProperty("x-user-agent", "grpc-web-javascript/0.1")
        conn.setRequestProperty("user-agent", UA)
        OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use {
            it.write(
                JSONObject()
                    .put(
                        "context",
                        JSONObject().put("client", JSONObject().put("clientName", "WEB").put("clientVersion", "2.20260817.01.00"))
                    )
                    .put("engagementType", "ENGAGEMENT_TYPE_UNBOUND")
                    .toString()
            )
        }
        val code = conn.responseCode
        val body = (if (code in 200..299) conn.inputStream else conn.errorStream)
            ?.bufferedReader()?.use { it.readText() } ?: ""
        conn.disconnect()
        if (code !in 200..299) throw IllegalStateException("att/get HTTP $code: ${body.take(120)}")

        val bg = JSONObject(body).optJSONObject("bgChallenge")
            ?: throw IllegalStateException("att/get: no bgChallenge")
        val program = bg.optString("program")
        val globalName = bg.optString("globalName")
        if (program.isEmpty() || globalName.isEmpty()) throw IllegalStateException("att/get: incomplete challenge")

        var interpreterJS = bg.optJSONObject("interpreterJavascript")
            ?.optString("privateDoNotAccessOrElseSafeScriptWrappedValue")
            ?.ifEmpty { null }
        if (interpreterJS == null) {
            val wrapped = bg.optJSONObject("interpreterUrl")
                ?.optString("privateDoNotAccessOrElseTrustedResourceUrlWrappedValue")
                ?.ifEmpty { null }
                ?: throw IllegalStateException("att/get: no interpreter")
            val js = URL("https:$wrapped").openConnection() as HttpURLConnection
            js.setRequestProperty("user-agent", UA)
            interpreterJS = js.inputStream.bufferedReader().use { it.readText() }
            js.disconnect()
        }
        Log.d(TAG, "challenge ok: ${program.length} program bytes, ${interpreterJS.length} interpreter bytes")
        return JSONObject()
            .put("program", program)
            .put("globalName", globalName)
            .put("interpreterJS", interpreterJS)
            .toString()
    }

    /** POST [REQUEST_KEY, snapshot]; the reply is [ttl, ?, ?, integrityToken]. */
    private fun generateIntegrityToken(snapshot: String): String {
        val url = URL("https://jnn-pa.googleapis.com/\$rpc/google.internal.waa.v1.Waa/GenerateIT")
        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.connectTimeout = 20_000
        conn.readTimeout = 30_000
        conn.doOutput = true
        conn.setRequestProperty("content-type", "application/json+protobuf")
        conn.setRequestProperty("x-goog-api-key", GOOG_API_KEY)
        conn.setRequestProperty("x-user-agent", "grpc-web-javascript/0.1")
        conn.setRequestProperty("user-agent", UA)
        OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use {
            it.write(JSONArray().put(REQUEST_KEY).put(snapshot).toString())
        }
        val code = conn.responseCode
        val body = (if (code in 200..299) conn.inputStream else conn.errorStream)
            ?.bufferedReader()?.use { it.readText() } ?: ""
        conn.disconnect()
        if (code !in 200..299) throw IllegalStateException("GenerateIT HTTP $code: ${body.take(120)}")

        val parsed = JSONArray(body)
        var integrityToken: String? = null
        var ttl: Number? = null
        for (i in 0 until parsed.length()) {
            when (val v = parsed.opt(i)) {
                is String -> if (integrityToken == null && v.length >= 40) integrityToken = v
                is Number -> if (ttl == null) ttl = v
                else -> Unit
            }
        }
        if (integrityToken == null) throw IllegalStateException("no integrity token: ${body.take(120)}")
        return JSONObject()
            .put("integrityToken", integrityToken)
            .put("ttl", ttl ?: JSONObject.NULL)
            .toString()
    }
}
