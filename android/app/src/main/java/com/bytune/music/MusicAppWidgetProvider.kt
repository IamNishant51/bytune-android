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

        // Cache last known values for new widget instances
        private var lastTitle = ""
        private var lastArtist = ""
        private var lastArtwork: Bitmap? = null
        private var lastIsPlaying = false

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

            if (artwork != null) {
                try {
                    val rounded = getRoundedCornerBitmap(artwork, (artwork.width * 0.18f))
                    views.setImageViewBitmap(R.id.widget_art, rounded)
                } catch (e: Exception) {
                    views.setImageViewBitmap(R.id.widget_art, artwork)
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
        val views = buildRemoteViews(context, lastTitle, lastArtist, lastArtwork, lastIsPlaying)
        for (id in appWidgetIds) {
            appWidgetManager.updateAppWidget(id, views)
        }
    }
}
