package com.bytune.music

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect
import android.graphics.RectF
import android.util.Log
import android.widget.RemoteViews

class MusicAppWidgetProvider : AppWidgetProvider() {

    companion object {
        private const val TAG = "ByTuneWidget"

        // Widget artwork displays at ~60dp: parceling a full-size bitmap
        // exceeds the ~1 MB Binder limit. Downscale before parceling.
        private const val MAX_WIDGET_ART_PX = 256
        private const val PREFS_NAME = "bytune_widget"
        private const val KEY_TITLE = "last_title"
        private const val KEY_ARTIST = "last_artist"
        private const val KEY_PLAYING = "last_playing"

        // Cache last known values for new widget instances
        private var lastTitle = ""
        private var lastArtist = ""
        private var lastArtwork: Bitmap? = null
        private var lastIsPlaying = false
        private var staticsLoaded = false

        // Corner-rounding allocates a full ARGB copy; do it once per artwork
        // and reuse it across the 2.5s sync updates.
        private var roundedSource: Bitmap? = null
        private var roundedArtwork: Bitmap? = null

        fun updateAllWidgets(
            context: Context,
            title: String,
            artist: String,
            artwork: Bitmap?,
            isPlaying: Boolean
        ) {
            lastTitle = title
            lastArtist = artist
            lastArtwork = artwork
            lastIsPlaying = isPlaying
            staticsLoaded = true

            // Statics die with the process; persist the track so onUpdate
            // after a restart shows real content instead of placeholders.
            // Artwork itself is not persisted (no bitmap in preferences).
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_TITLE, title)
                .putString(KEY_ARTIST, artist)
                .putBoolean(KEY_PLAYING, isPlaying)
                .apply()

            val appWidgetManager = AppWidgetManager.getInstance(context) ?: return
            val componentName = ComponentName(context, MusicAppWidgetProvider::class.java)
            val widgetIds = appWidgetManager.getAppWidgetIds(componentName)
            if (widgetIds == null || widgetIds.isEmpty()) return

            val views = buildRemoteViews(context, title, artist, artwork, isPlaying)
            for (id in widgetIds) {
                appWidgetManager.updateAppWidget(id, views)
            }
        }

        fun buildRemoteViews(
            context: Context,
            title: String,
            artist: String,
            artwork: Bitmap?,
            isPlaying: Boolean
        ): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_music)

            val displayTitle = if (title.isNotBlank()) title else "ByTune Music"
            val displayArtist = if (artist.isNotBlank()) artist else "Tap to open"

            views.setTextViewText(R.id.widget_title, displayTitle)
            views.setTextViewText(R.id.widget_artist, displayArtist)

            val playIcon = if (isPlaying) R.drawable.ic_widget_pause else R.drawable.ic_widget_play
            views.setImageViewResource(R.id.widget_btn_play, playIcon)

            if (artwork != null && !artwork.isRecycled) {
                try {
                    val rounded = roundedArtworkFor(artwork)
                    views.setImageViewBitmap(R.id.widget_art, rounded)
                } catch (e: Exception) {
                    views.setImageViewBitmap(R.id.widget_art, downscaleForWidget(artwork))
                }
            } else {
                views.setImageViewResource(R.id.widget_art, R.mipmap.ic_launcher)
            }

            // PendingIntent for launching app
            val appIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val openPendingIntent = PendingIntent.getActivity(
                context, 0, appIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_root, openPendingIntent)
            views.setOnClickPendingIntent(R.id.widget_art, openPendingIntent)

            // Transport controls pending intents to MusicPlaybackService
            val prevIntent = PendingIntent.getService(
                context, 10,
                Intent(context, MusicPlaybackService::class.java).setAction(MusicPlaybackService.ACTION_PREV),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_btn_prev, prevIntent)

            val playPauseAction = if (isPlaying) MusicPlaybackService.ACTION_PAUSE else MusicPlaybackService.ACTION_PLAY
            val playPauseIntent = PendingIntent.getService(
                context, 11,
                Intent(context, MusicPlaybackService::class.java).setAction(playPauseAction),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_btn_play, playPauseIntent)

            val nextIntent = PendingIntent.getService(
                context, 12,
                Intent(context, MusicPlaybackService::class.java).setAction(MusicPlaybackService.ACTION_NEXT),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_btn_next, nextIntent)

            return views
        }

        /**
         * Returns the downscaled, corner-rounded artwork for [source],
         * reusing the cached copy when the source bitmap is unchanged.
         * The cached copy is an independent bitmap: recycling the old
         * cached copy on replacement is safe (RemoteViews parcels a copy
         * at update time).
         */
        private fun roundedArtworkFor(source: Bitmap): Bitmap {
            val cached = roundedArtwork
            if (source === roundedSource && cached != null && !cached.isRecycled) return cached
            val old = roundedArtwork
            val scaled = downscaleForWidget(source)
            val rounded = getRoundedCornerBitmap(scaled, scaled.width * 0.18f)
            roundedSource = source
            roundedArtwork = rounded
            if (old != null && old !== rounded && !old.isRecycled) old.recycle()
            return rounded
        }

        /** Scales [bitmap] down so its longest side is at most 256px. */
        private fun downscaleForWidget(bitmap: Bitmap): Bitmap {
            val largest = maxOf(bitmap.width, bitmap.height)
            if (largest <= MAX_WIDGET_ART_PX) return bitmap
            val scale = MAX_WIDGET_ART_PX.toFloat() / largest
            val width = (bitmap.width * scale).toInt().coerceAtLeast(1)
            val height = (bitmap.height * scale).toInt().coerceAtLeast(1)
            return Bitmap.createScaledBitmap(bitmap, width, height, true)
        }

        private fun getRoundedCornerBitmap(bitmap: Bitmap, cornerRadius: Float): Bitmap {
            val output = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(output)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)
            val rect = Rect(0, 0, bitmap.width, bitmap.height)
            val rectF = RectF(rect)

            canvas.drawARGB(0, 0, 0, 0)
            paint.color = -0x1
            canvas.drawRoundRect(rectF, cornerRadius, cornerRadius, paint)

            paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
            canvas.drawBitmap(bitmap, rect, rect, paint)
            return output
        }
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        // After process death the statics above are empty: fall back to the
        // persisted track so the widget shows real content, not placeholders.
        // (Artwork cannot persist; the launcher icon shows until playback
        // syncs again.)
        val title: String
        val artist: String
        val artwork: Bitmap?
        val playing: Boolean
        if (staticsLoaded) {
            title = lastTitle
            artist = lastArtist
            artwork = lastArtwork
            playing = lastIsPlaying
        } else {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            title = prefs.getString(KEY_TITLE, "") ?: ""
            artist = prefs.getString(KEY_ARTIST, "") ?: ""
            artwork = null
            playing = prefs.getBoolean(KEY_PLAYING, false)
        }
        val views = buildRemoteViews(context, title, artist, artwork, playing)
        for (id in appWidgetIds) {
            appWidgetManager.updateAppWidget(id, views)
        }
    }
}
