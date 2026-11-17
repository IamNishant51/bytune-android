package com.bytune.music

import android.util.Log
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.util.concurrent.ConcurrentHashMap

/**
 * Loopback media proxy — the phone's copy of `electron/stream-proxy.ts`.
 *
 * The renderer plays `<audio src>` from http://127.0.0.1:<port>/… instead of
 * googlevideo directly, for two reasons:
 *  - the resolved URL is a signed, expiring one that YouTube checks against
 *    the requesting client; proxying keeps that traffic in one place,
 *  - the loudness metadata rides the same URL (`&meta=1`), so the audio
 *    engine's gain staging works unchanged.
 *
 * Range requests are forwarded verbatim, so seeking stays native (206
 * responses with Content-Range).
 */
object StreamProxy {

    private const val TAG = "ByTuneStream"
    private const val UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

    private data class Entry(val url: String, val lufs: Double?)

    private val entries = ConcurrentHashMap<String, Entry>()
    private var server: ServerSocket? = null

    @Volatile
    var port: Int = 0
        private set

    /** Starts the proxy on first use; returns its loopback port. */
    @Synchronized
    fun ensureStarted(): Int {
        if (port != 0) return port
        val socket = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
        port = socket.localPort
        server = socket
        Thread({
            while (!socket.isClosed) {
                try {
                    val client = socket.accept()
                    Thread({ serve(client) }, "bytune-stream").start()
                } catch (err: IOException) {
                    if (!socket.isClosed) Log.w(TAG, "accept failed", err)
                }
            }
        }, "bytune-stream-accept").apply { isDaemon = true }.start()
        return port
    }

    /**
     * Registers a resolved upstream URL under `key` and returns the loopback
     * URL for it. The `?v=1` is not decoration: the audio engine appends
     * `&meta=1` to whatever this returns, so the URL must already have a query.
     */
    fun register(key: String, url: String, lufs: Double?): String {
        val p = ensureStarted()
        entries[key] = Entry(url, lufs)
        return "http://127.0.0.1:$p/s/$key?v=1"
    }

    private fun serve(client: Socket) {
        client.use { socket ->
            try {
                val input = BufferedInputStream(socket.getInputStream())
                val requestLine = readLine(input) ?: return
                val headers = HashMap<String, String>()
                while (true) {
                    val line = readLine(input) ?: break
                    if (line.isEmpty()) break
                    val colon = line.indexOf(':')
                    if (colon > 0) headers[line.substring(0, colon).trim().lowercase()] = line.substring(colon + 1).trim()
                }
                val parts = requestLine.split(' ')
                if (parts.size < 2) return
                val method = parts[0]
                val target = parts[1]
                val path = target.substringBefore('?')
                val query = target.substringAfter('?', "")
                val out = BufferedOutputStream(socket.getOutputStream())

                if (method == "OPTIONS") {
                    writeHead(out, 204, emptyMap(), 0, cors = true)
                    out.flush()
                    return
                }
                if (!path.startsWith("/s/")) {
                    writeHead(out, 404, emptyMap(), 0, cors = true)
                    out.flush()
                    return
                }
                val entry = entries[path.removePrefix("/s/")]
                if (entry == null) {
                    writeHead(out, 404, emptyMap(), 0, cors = true)
                    out.flush()
                    return
                }
                if (query.split('&').contains("meta=1")) {
                    val body = entry.lufs?.let { "{\"lufs\":$it}" } ?: "{}"
                    val bytes = body.toByteArray()
                    writeHead(out, 200, mapOf("Content-Type" to "application/json"), bytes.size.toLong(), cors = true)
                    if (method != "HEAD") out.write(bytes)
                    out.flush()
                    return
                }
                relay(entry.url, method, headers["range"], out)
            } catch (err: Throwable) {
                Log.w(TAG, "request failed", err)
            }
        }
    }

    private fun relay(upstream: String, method: String, range: String?, out: BufferedOutputStream) {
        val conn = URL(upstream).openConnection() as HttpURLConnection
        conn.requestMethod = if (method == "HEAD") "HEAD" else "GET"
        conn.instanceFollowRedirects = true
        conn.connectTimeout = 15_000
        conn.readTimeout = 30_000
        conn.setRequestProperty("user-agent", UA)
        if (range != null) conn.setRequestProperty("Range", range)

        val code = conn.responseCode
        val passthrough = listOf("content-type", "content-length", "content-range", "accept-ranges", "cache-control")
        val headers = HashMap<String, String>()
        for (name in passthrough) {
            conn.getHeaderField(name)?.let { headers[name] = it }
        }
        val length = headers["content-length"]?.toLongOrNull() ?: 0L
        Log.d(TAG, "relay HTTP $code range=${range ?: "-"} len=$length")
        writeHead(out, code, headers, length, cors = true)
        if (method != "HEAD") {
            val body = (if (code in 200..299) conn.inputStream else conn.errorStream)
            if (body != null) {
                val buffer = ByteArray(64 * 1024)
                BufferedInputStream(body).use { stream ->
                    while (true) {
                        val read = stream.read(buffer)
                        if (read <= 0) break
                        out.write(buffer, 0, read)
                    }
                }
            }
        }
        out.flush()
        conn.disconnect()
    }

    private fun writeHead(
        out: BufferedOutputStream,
        code: Int,
        headers: Map<String, String>,
        length: Long,
        cors: Boolean
    ) {
        val reason = when (code) {
            200 -> "OK"
            204 -> "No Content"
            206 -> "Partial Content"
            404 -> "Not Found"
            else -> "Error"
        }
        val sb = StringBuilder("HTTP/1.1 $code $reason\r\n")
        for ((k, v) in headers) sb.append(k).append(": ").append(v).append("\r\n")
        if (cors) {
            sb.append("Access-Control-Allow-Origin: *\r\n")
            sb.append("Access-Control-Allow-Headers: range\r\n")
            sb.append("Access-Control-Expose-Headers: content-range, content-length, accept-ranges\r\n")
        }
        if (!headers.keys.any { it.equals("content-length", true) } && code != 204) {
            sb.append("Content-Length: ").append(length).append("\r\n")
        }
        if (code == 206) sb.append("Accept-Ranges: bytes\r\n")
        sb.append("Connection: close\r\n\r\n")
        out.write(sb.toString().toByteArray())
    }

    private fun readLine(input: BufferedInputStream): String? {
        val sb = StringBuilder()
        while (true) {
            val b = input.read()
            if (b < 0) return if (sb.isEmpty()) null else sb.toString()
            if (b == '\n'.code) return sb.toString().trimEnd('\r')
            sb.append(b.toChar())
            if (sb.length > 8192) return null
        }
    }
}
