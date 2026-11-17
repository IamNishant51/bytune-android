package com.bytune.music

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.IBinder
import android.util.Log
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Native media session + foreground service.
 *
 * Audio focus is deliberately NOT requested here: the WebView's Chromium audio
 * layer already requests focus for the media element and pauses/resumes on
 * focus changes (verified in `dumpsys audio`). A second request from this
 * process makes Chromium lose focus to us, which pauses playback immediately.
 * This service only mirrors UI state and routes notification/lock-screen
 * controls back to the renderer.
 */
class MusicPlaybackService : Service() {

    companion object {
        private const val TAG = "ByTuneMediaSession"
        const val CHANNEL_ID = "bytune_playback"
        const val NOTIFICATION_ID = 4001
        // Notification large icons display small; decoding beyond this wastes
        // native pixel memory in the service process on a 4 GB phone.
        private const val MAX_ARTWORK_PX = 512

        const val ACTION_PLAY = "com.bytune.music.ACTION_PLAY"
        const val ACTION_PAUSE = "com.bytune.music.ACTION_PAUSE"
        const val ACTION_NEXT = "com.bytune.music.ACTION_NEXT"
        const val ACTION_PREV = "com.bytune.music.ACTION_PREV"
        const val ACTION_STOP = "com.bytune.music.ACTION_STOP"
        const val ACTION_UPDATE = "com.bytune.music.ACTION_UPDATE"

        var currentService: MusicPlaybackService? = null
    }

    private var mediaSession: MediaSession? = null
    private var noisyReceiverRegistered = false

    private var currentTitle = ""
    private var currentArtist = ""
    private var currentAlbum = ""
    private var currentArtworkUrl = ""
    private var currentArtworkBitmap: Bitmap? = null
    private var currentDurationSec = 0.0
    private var currentPositionSec = 0.0
    private var isPlaying = false
    private var currentPlaybackRate = 1.0f

    // Last inputs the notification/widget were actually built with. JS syncs
    // every 2.5s while playing; rebuilding the notification and re-parceling
    // the widget on every sync is wasted work when nothing visible changed.
    // The PlaybackState below is NOT gated — the lock-screen scrubber must
    // keep moving — only the metadata/notification/widget rebuild is.
    private var lastBuiltTitle: String? = null
    private var lastBuiltArtist: String? = null
    private var lastBuiltAlbum: String? = null
    private var lastBuiltPlaying: Boolean? = null
    private var lastBuiltArtwork: Bitmap? = null
    private var lastBuiltPositionBucket: Long? = null

    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
                Log.d(TAG, "Becoming noisy -> pausing")
                ByTuneShellPlugin.dispatchMediaAction("pause")
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        currentService = this
        createNotificationChannel()
        setupMediaSession()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PLAY -> ByTuneShellPlugin.dispatchMediaAction("play")
            ACTION_PAUSE -> ByTuneShellPlugin.dispatchMediaAction("pause")
            ACTION_NEXT -> ByTuneShellPlugin.dispatchMediaAction("next")
            ACTION_PREV -> ByTuneShellPlugin.dispatchMediaAction("prev")
            ACTION_STOP -> ByTuneShellPlugin.dispatchMediaAction("pause")
            ACTION_UPDATE -> {
                val title = intent.getStringExtra("title") ?: currentTitle
                val artist = intent.getStringExtra("artist") ?: currentArtist
                val album = intent.getStringExtra("album") ?: currentAlbum
                val artworkUrl = intent.getStringExtra("artworkUrl") ?: currentArtworkUrl
                val duration = intent.getDoubleExtra("duration", currentDurationSec)
                val position = intent.getDoubleExtra("position", currentPositionSec)
                val playing = intent.getBooleanExtra("isPlaying", isPlaying)
                val playbackRate = intent.getFloatExtra("playbackRate", currentPlaybackRate)
                updatePlayback(title, artist, album, artworkUrl, duration, position, playing, playbackRate)
            }
        }
        return START_NOT_STICKY
    }

    private fun setupMediaSession() {
        mediaSession = MediaSession(this, "ByTuneMediaSession").apply {
            setFlags(
                MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or
                MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS
            )
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() {
                    Log.d(TAG, "MediaSession.onPlay")
                    ByTuneShellPlugin.dispatchMediaAction("play")
                }

                override fun onPause() {
                    Log.d(TAG, "MediaSession.onPause")
                    ByTuneShellPlugin.dispatchMediaAction("pause")
                }

                override fun onSkipToNext() {
                    Log.d(TAG, "MediaSession.onSkipToNext")
                    ByTuneShellPlugin.dispatchMediaAction("next")
                }

                override fun onSkipToPrevious() {
                    Log.d(TAG, "MediaSession.onSkipToPrevious")
                    ByTuneShellPlugin.dispatchMediaAction("prev")
                }

                override fun onSeekTo(pos: Long) {
                    Log.d(TAG, "MediaSession.onSeekTo $pos ms")
                    ByTuneShellPlugin.dispatchMediaAction("seek", pos / 1000.0)
                }
            })
            isActive = true
        }
    }

    fun updatePlayback(
        title: String,
        artist: String,
        album: String,
        artworkUrl: String,
        duration: Double,
        position: Double,
        playing: Boolean,
        playbackRate: Float = 1.0f
    ) {
        val titleChanged = title != currentTitle || artist != currentArtist
        val artworkChanged = artworkUrl.isNotEmpty() && artworkUrl != currentArtworkUrl
        val playStateChanged = playing != isPlaying

        currentTitle = title
        currentArtist = artist
        currentAlbum = album
        currentDurationSec = duration
        currentPositionSec = position
        isPlaying = playing
        currentPlaybackRate = if (playbackRate.isFinite() && playbackRate > 0f) playbackRate else 1.0f

        if (playing) {
            registerNoisyReceiver()
        } else {
            unregisterNoisyReceiver()
        }

        // Fetch artwork in background if changed
        if (artworkChanged) {
            currentArtworkUrl = artworkUrl
            thread(name = "ByTune-ArtLoad") {
                try {
                    val url = URL(artworkUrl)
                    val conn = url.openConnection() as HttpURLConnection
                    try {
                        conn.connectTimeout = 5000
                        conn.readTimeout = 5000
                        conn.connect()
                        val bytes = conn.inputStream.use { it.readBytes() }
                        val bmp = decodeArtwork(bytes, MAX_ARTWORK_PX)
                        if (bmp != null) {
                            val previous = currentArtworkBitmap
                            currentArtworkBitmap = bmp
                            updateSessionAndNotification()
                            // The notification/widget now hold the new bitmap
                            // (parceled copies); free the old pixels now
                            // instead of waiting for the GC finalizer. Only
                            // recycle when nothing newer replaced it meanwhile.
                            if (previous != null && previous !== bmp &&
                                currentArtworkBitmap === bmp && !previous.isRecycled
                            ) {
                                previous.recycle()
                            }
                        }
                    } finally {
                        conn.disconnect()
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to load artwork bitmap: ${e.message}")
                }
            }
        }

        updateSessionAndNotification()
    }

    /**
     * Decodes artwork bytes sampled down so the longest side is at most
     * [maxPx]. Power-of-two sampling (the only size class honoured on all
     * API levels), so a 1200px source lands near 300px — plenty for a
     * notification icon. Null when the bytes are not a decodable image.
     */
    private fun decodeArtwork(bytes: ByteArray, maxPx: Int): Bitmap? {
        if (bytes.isEmpty()) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        val largest = maxOf(bounds.outWidth, bounds.outHeight)
        while (largest / sample > maxPx) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
    }

    fun clearPlayback() {
        isPlaying = false
        unregisterNoisyReceiver()
        val oldBitmap = currentArtworkBitmap
        currentArtworkBitmap = null
        currentArtworkUrl = ""
        currentTitle = ""
        currentArtist = ""
        resetBuiltCache()

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(true)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.cancel(NOTIFICATION_ID)
        } catch (e: Exception) {
            Log.w(TAG, "Error clearing playback: ${e.message}")
        }
        try {
            MusicAppWidgetProvider.updateAllWidgets(this, "", "", null, false)
        } catch (e: Exception) {
            Log.w(TAG, "Error clearing widgets: ${e.message}")
        }
        // The widget now holds no artwork; free the old pixels.
        if (oldBitmap != null && !oldBitmap.isRecycled) oldBitmap.recycle()
        stopSelf()
    }

    private fun resetBuiltCache() {
        lastBuiltTitle = null
        lastBuiltArtist = null
        lastBuiltAlbum = null
        lastBuiltPlaying = null
        lastBuiltArtwork = null
        lastBuiltPositionBucket = null
    }

    private fun updateSessionAndNotification() {
        val session = mediaSession ?: return

        // 1. Update PlaybackState
        val stateActions = PlaybackState.ACTION_PLAY or
                PlaybackState.ACTION_PAUSE or
                PlaybackState.ACTION_PLAY_PAUSE or
                PlaybackState.ACTION_SKIP_TO_NEXT or
                PlaybackState.ACTION_SKIP_TO_PREVIOUS or
                PlaybackState.ACTION_SEEK_TO

        val state = if (isPlaying) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED
        val playbackState = PlaybackState.Builder()
            .setActions(stateActions)
            .setState(state, (currentPositionSec * 1000).toLong(), currentPlaybackRate)
            .build()
        session.setPlaybackState(playbackState)

        // Skip the expensive rebuild when nothing visible changed. Position
        // is bucketed (5s): the scrubber above already moves every sync, so
        // the notification/widget need not rebuild for every position tick.
        val positionBucket = (currentPositionSec / 5).toLong()
        val visibleChanged = currentTitle != lastBuiltTitle ||
            currentArtist != lastBuiltArtist ||
            currentAlbum != lastBuiltAlbum ||
            isPlaying != lastBuiltPlaying ||
            currentArtworkBitmap !== lastBuiltArtwork ||
            positionBucket != lastBuiltPositionBucket
        if (!visibleChanged) return
        lastBuiltTitle = currentTitle
        lastBuiltArtist = currentArtist
        lastBuiltAlbum = currentAlbum
        lastBuiltPlaying = isPlaying
        lastBuiltArtwork = currentArtworkBitmap
        lastBuiltPositionBucket = positionBucket

        // 2. Update MediaMetadata
        val metadataBuilder = MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, currentTitle)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, currentArtist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, currentAlbum)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, (currentDurationSec * 1000).toLong())

        val bmp = currentArtworkBitmap
        if (bmp != null) {
            metadataBuilder.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, bmp)
            metadataBuilder.putBitmap(MediaMetadata.METADATA_KEY_ART, bmp)
        }
        session.setMetadata(metadataBuilder.build())

        // 3. Build Notification
        val notification = buildNotification(session)

        // 4. Foreground / Normal update
        try {
            if (isPlaying) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
                } else {
                    startForeground(NOTIFICATION_ID, notification)
                }
            } else {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    stopForeground(STOP_FOREGROUND_DETACH)
                } else {
                    @Suppress("DEPRECATION")
                    stopForeground(false)
                }
                val manager = getSystemService(NotificationManager::class.java)
                manager?.notify(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error posting notification: ${e.message}")
        }

        // 5. Update Android Home Screen Widgets
        try {
            MusicAppWidgetProvider.updateAllWidgets(
                this,
                currentTitle,
                currentArtist,
                currentArtworkBitmap,
                isPlaying
            )
        } catch (e: Exception) {
            Log.w(TAG, "Error updating widgets: ${e.message}")
        }
    }

    private fun buildNotification(session: MediaSession): Notification {
        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val openPendingIntent = PendingIntent.getActivity(
            this, 0, openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val prevIntent = PendingIntent.getService(
            this, 1, Intent(this, MusicPlaybackService::class.java).setAction(ACTION_PREV),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val playPauseIntent = PendingIntent.getService(
            this, 2, Intent(this, MusicPlaybackService::class.java).setAction(if (isPlaying) ACTION_PAUSE else ACTION_PLAY),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val nextIntent = PendingIntent.getService(
            this, 3, Intent(this, MusicPlaybackService::class.java).setAction(ACTION_NEXT),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val playPauseIcon = if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        val playPauseTitle = if (isPlaying) "Pause" else "Play"

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        builder
            .setContentTitle(if (currentTitle.isNotEmpty()) currentTitle else "ByTune")
            .setContentText(if (currentArtist.isNotEmpty()) currentArtist else "Playing")
            .setSubText(if (currentAlbum.isNotEmpty()) currentAlbum else null)
            .setSmallIcon(R.drawable.ic_stat_bytune)
            .setContentIntent(openPendingIntent)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(isPlaying)
            .addAction(Notification.Action.Builder(android.R.drawable.ic_media_previous, "Previous", prevIntent).build())
            .addAction(Notification.Action.Builder(playPauseIcon, playPauseTitle, playPauseIntent).build())
            .addAction(Notification.Action.Builder(android.R.drawable.ic_media_next, "Next", nextIntent).build())
            .setStyle(
                Notification.MediaStyle()
                    .setMediaSession(session.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )

        val bmp = currentArtworkBitmap
        if (bmp != null) {
            builder.setLargeIcon(bmp)
        }

        return builder.build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Music Playback",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Controls and information for currently playing music"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun registerNoisyReceiver() {
        if (!noisyReceiverRegistered) {
            val filter = IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
            registerReceiver(noisyReceiver, filter)
            noisyReceiverRegistered = true
        }
    }

    private fun unregisterNoisyReceiver() {
        if (noisyReceiverRegistered) {
            try {
                unregisterReceiver(noisyReceiver)
            } catch (_: Exception) {}
            noisyReceiverRegistered = false
        }
    }

    override fun onDestroy() {
        unregisterNoisyReceiver()
        mediaSession?.isActive = false
        mediaSession?.release()
        mediaSession = null
        currentService = null
        super.onDestroy()
    }
}
