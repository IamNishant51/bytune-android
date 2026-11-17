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
                updatePlayback(title, artist, album, artworkUrl, duration, position, playing)
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
        playing: Boolean
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
                    conn.connectTimeout = 5000
                    conn.readTimeout = 5000
                    conn.connect()
                    val bmp = BitmapFactory.decodeStream(conn.inputStream)
                    if (bmp != null) {
                        currentArtworkBitmap = bmp
                        updateSessionAndNotification()
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to load artwork bitmap: ${e.message}")
                }
            }
        }

        updateSessionAndNotification()
    }

    fun clearPlayback() {
        isPlaying = false
        unregisterNoisyReceiver()
        currentArtworkBitmap = null
        currentArtworkUrl = ""
        currentTitle = ""
        currentArtist = ""

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
        stopSelf()
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
            .setState(state, (currentPositionSec * 1000).toLong(), 1.0f)
            .build()
        session.setPlaybackState(playbackState)

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
