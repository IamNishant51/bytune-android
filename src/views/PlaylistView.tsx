/**
 * A local playlist page — BitChord mobile's DetailScreen, same construction
 * as the album and remote-playlist pages: full-bleed cover hero with the
 * "PLAYLIST • N TRACKS • ABOUT 3:2X" metadata line, circular glass controls,
 * then the playlist's own numbered track rows.
 */
import { useMemo, useState } from "react";
import { Check, Download, Heart, ListMusic, ListPlus, Loader2, MoreHorizontal, Play, Shuffle } from "lucide-react";
import { downloadPlaylist, removeDownloadedPlaylist, getPlaylistDownloadStats } from "../lib/downloads";
import { DownloadBadge } from "../components/TrackList";
import { Artwork, EmptyState, EqBars, ExplicitBadge } from "../components/primitives";
import { playlistHeaderItems, playlistMenuItems, playlistSortMenuItem } from "../lib/trackActions";
import { sortTracks, type PlaylistSort } from "../lib/playlistSort";
import { useDrag } from "../lib/dnd";
import { fmtTime, plural } from "../lib/format";
import { useArtworkPalette } from "../lib/palette";
import { upgradeArtwork } from "../lib/artwork";
import { useLibrary, type Playlist } from "../stores/library";
import { usePlayer } from "../stores/player";
import { useUI } from "../stores/ui";
import { useIsMobile } from "../lib/useIsMobile";
import type { Track } from "../types";

export function PlaylistView({ playlistId }: { playlistId: string }) {
  const isMobile = useIsMobile();
  const playlist = useLibrary((s) => s.playlists.find((p) => p.id === playlistId) ?? null);
  const playQueue = usePlayer((s) => s.playQueue);
  const openContextMenu = useUI((s) => s.openContextMenu);
  const downloads = useLibrary((s) => s.downloads);
  const toast = useUI((s) => s.toast);

  // Sorting is a view over the stored order — "Custom order" puts the user's
  // own arrangement back, so nothing here rewrites the playlist.
  const [sort, setSort] = useState<PlaylistSort>("custom");
  const [sortDesc, setSortDesc] = useState(false);
  const tracks = useMemo(
    () => sortTracks(playlist?.tracks ?? [], sort, sortDesc),
    [playlist?.tracks, sort, sortDesc]
  );

  // Artist-imported playlists wear the artist's photo, not a song cover —
  // the page tint and the hero read from that same artwork. The palette is
  // also the hero image's loading placeholder colour.
  const coverThumb = playlist?.artistThumb ?? playlist?.tracks[0]?.thumb ?? null;
  const palette = useArtworkPalette(coverThumb);

  // Dropping songs onto this page is handled panel-wide in App (usePanelDrop).

  if (!playlist) {
    return (
      <EmptyState
        icon={ListMusic}
        title="This playlist no longer exists"
        body="It may have been deleted. Head back to your playlists to find the rest."
        className="pt-10"
      />
    );
  }

  const allDownloaded = tracks.length > 0 && tracks.every((t) => downloads[t.id]?.status === "done");
  const dlStats = getPlaylistDownloadStats(tracks, downloads);
  const anyDownloading = dlStats.downloading > 0;
  const totalSec = tracks.reduce((acc, t) => acc + t.duration, 0);
  // Spotify's model: a fresh playlist reads "PLAYLIST" — the "0 tracks"
  // count only appears once there's something to count.
  const meta = [
    "Playlist",
    tracks.length ? plural(tracks.length, "track", "tracks") : "",
    totalSec > 0 ? `about ${fmtTime(totalSec)}` : "",
  ]
    .filter(Boolean)
    .join(" • ")
    .toUpperCase();

  const play = (shuffle: boolean): void => {
    if (!tracks.length) return;
    if (shuffle) {
      usePlayer.setState({ shuffle: true });
      playQueue(tracks, Math.floor(Math.random() * tracks.length));
    } else {
      playQueue(tracks, 0);
    }
  };

  const openHeaderMenu = (x: number, y: number): void => {
    const [renameItem, deleteItem] = playlistHeaderItems(playlist);
    openContextMenu(x, y, [
      ...(tracks.length > 1
        ? [
            playlistSortMenuItem(sort, sortDesc, (key, desc) => {
              setSort(key);
              setSortDesc(desc);
            }),
          ]
        : []),
      {
        label: "Add all to queue",
        icon: ListPlus,
        action: () => {
          usePlayer.getState().addToQueue(tracks);
          toast("Playlist added to queue");
        },
      },
      { ...renameItem, separatorBefore: true },
      deleteItem,
    ]);
  };

  return (
    <div className="page-tint -mt-5 w-full max-w-full overflow-x-hidden">
      {/* Hero — the playlist cover full-bleed, name + metadata over its lower edge. */}
      <div className={`relative ${isMobile ? "-mx-4" : "-mx-10"} overflow-hidden`}>
        <div className="absolute inset-0">
          {coverThumb ? (
            <img
              src={upgradeArtwork(coverThumb, 1200)}
              alt=""
              decoding="async"
              style={{ backgroundColor: `rgb(${palette.wash})` }}
              className="w-full h-full object-cover"
            />
          ) : (
            /* Default cover — ByTune violet gradient with a big soft note
               watermark, Spotify's default-playlist-cover model. The bottom
               fade below still melts it into the page background. */
            <div
              className="relative w-full h-full overflow-hidden"
              style={{
                background:
                  "linear-gradient(140deg, rgb(109 40 217 / 0.85) 0%, rgb(59 7 100 / 0.9) 42%, rgb(30 27 75 / 0.92) 70%, rgb(var(--page-bg)) 100%)",
              }}
            >
              {/* sheen — keeps the violet from reading flat */}
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "radial-gradient(ellipse 55% 45% at 18% 12%, rgb(255 255 255 / 0.14), transparent 70%)",
                }}
              />
              <ListMusic
                className="absolute -right-8 -bottom-10 w-[280px] h-[280px] text-white/[0.08] rotate-[-10deg]"
                aria-hidden
              />
            </div>
          )}
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(to bottom,
                rgb(var(--page-bg) / 0.20) 0%,
                rgb(var(--page-bg) / 0.45) 50%,
                rgb(var(--page-bg) / 0.90) 80%,
                rgb(var(--page-bg)) 100%)`,
            }}
          />
        </div>

        <div className={`relative flex flex-col items-center text-center px-4 ${isMobile ? "pt-[160px]" : "pt-[244px]"} pb-5`}>
          {/* leading-[1.35]: Segoe UI's ascent+descent needs ~1.33em — any
              tighter and line-clamp's overflow:hidden slices the descenders. */}
          <h1 className={`font-display ${isMobile ? "text-[26px]" : "text-[34px]"} leading-[1.35] font-extrabold tracking-[-0.03em] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.55)] break-words max-w-3xl line-clamp-2`}>
            {playlist.name}
          </h1>
          <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/70 mt-1.5 drop-shadow-[0_1px_6px_rgba(0,0,0,0.5)]">
            {meta}
          </div>

          <div className="flex items-center justify-center gap-2.5 mt-4">
            {/* No `disabled` dimming when empty — play() no-ops on an empty
                list, and grayed-out buttons made fresh playlists look broken. */}
            <button
              onClick={() => play(true)}
              title="Shuffle"
              aria-label="Shuffle"
              className="w-11 h-11 grid place-items-center rounded-full glass-btn text-white transition-all active:scale-[0.92]"
            >
              <Shuffle className="w-[18px] h-[18px]" />
            </button>
            <button
              onClick={() => play(false)}
              className="inline-flex items-center gap-2 h-11 px-6 rounded-full bg-primary text-on-primary text-[14.5px] font-semibold transition-all active:scale-[0.95] shadow-lg shadow-primary/25 hover:brightness-110"
            >
              <Play className="w-[18px] h-[18px] fill-current" />
              Play
            </button>
            <button
              onClick={() => {
                if (allDownloaded) {
                  removeDownloadedPlaylist(tracks);
                } else {
                  void downloadPlaylist(playlist.name, tracks);
                }
              }}
              disabled={!tracks.length}
              title={allDownloaded ? "Downloaded (click to remove)" : anyDownloading ? `Downloading (${dlStats.done}/${dlStats.total} • ${dlStats.percent}%)` : "Download playlist"}
              aria-label="Download playlist"
              className={`w-11 h-11 grid place-items-center rounded-full glass-btn transition-all active:scale-[0.92] ${
                allDownloaded ? "text-primary" : anyDownloading ? "text-primary" : "text-white"
              }`}
            >
              {anyDownloading ? (
                <Loader2 className="w-[18px] h-[18px] animate-spin text-primary" />
              ) : allDownloaded ? (
                <Check className="w-[18px] h-[18px] stroke-[2.5]" />
              ) : (
                <Download className="w-[18px] h-[18px]" />
              )}
            </button>
            <button
              onClick={(e) => openHeaderMenu(e.clientX, e.clientY)}
              title="More options"
              aria-label="More options"
              className="w-11 h-11 grid place-items-center rounded-full glass-btn text-white transition-all active:scale-[0.92]"
            >
              <MoreHorizontal className="w-[18px] h-[18px]" />
            </button>
          </div>

          {anyDownloading && (
            <div className="w-full max-w-xs sm:max-w-sm mt-4 px-4 py-2.5 rounded-2xl glass-card shadow-lg animate-fade-in text-left">
              <div className="flex items-center justify-between text-[12px] font-medium mb-1.5">
                <span className="flex items-center gap-1.5 text-white/90">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                  Downloading {dlStats.done} of {dlStats.total}
                </span>
                <span className="font-semibold tabular-nums text-primary">
                  {dlStats.percent}%
                </span>
              </div>
              <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary to-emerald-400 rounded-full transition-all duration-300 ease-out shadow-[0_0_8px_rgba(var(--primary-rgb),0.5)]"
                  style={{ width: `${Math.max(3, dlStats.percent)}%` }}
                />
              </div>
              {dlStats.failed > 0 && (
                <div className="text-[11px] text-amber-300/90 mt-1 flex items-center justify-between">
                  <span>{dlStats.failed} failed</span>
                  <button
                    onClick={() => void downloadPlaylist(playlist.name, tracks)}
                    className="underline hover:text-white transition-colors"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className={`${isMobile ? "px-0" : "px-8"} pb-12 pt-2`}>
        {tracks.length ? (
          <div>
            {(() => {
              // The same track can appear twice in a playlist, so keys
              // carry an occurrence number per id — stable across
              // re-renders, unlike a raw index suffix.
              const occurrence = new Map<string, number>();
              return tracks.map((track, i) => {
                const n = occurrence.get(track.id) ?? 0;
                occurrence.set(track.id, n + 1);
                const key = n === 0 ? track.id : `${track.id}#${n}`;
                return (
                  <div key={key} className="cv-row">
                    <PlaylistTrackRow
                      track={track}
                      index={i}
                      queue={tracks}
                      playlist={playlist}
                      placeholderColor={`rgb(${palette.wash})`}
                    />
                    {i < tracks.length - 1 && <div className={`h-px bg-ink-hi/[0.05] ${isMobile ? "ml-[68px] mr-2" : "ml-[112px] mr-3"}`} />}
                  </div>
                );
              });
            })()}
          </div>
        ) : (
          <EmptyState
            icon={ListMusic}
            title="Let's find something for your playlist"
            body={
              isMobile
                ? "Search for songs you love, or browse Explore to discover something new — then long-press any track to add it here."
                : "Search for songs you love, or browse Explore to discover something new — then right-click any track to add it here."
            }
            action={
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => {
                    useUI.getState().navigate({ name: "home" });
                    // The search field lives in the top bar; focus it once
                    // home has painted so typing starts immediately.
                    window.setTimeout(() => document.getElementById("global-search")?.focus(), 80);
                  }}
                  className="h-10 px-5 rounded-full bg-primary text-on-primary text-[13.5px] font-semibold hover:brightness-110 hover:shadow-[0_10px_36px_-10px_rgb(var(--primary)/0.55)] transition-all active:scale-[0.98]"
                >
                  Search for songs
                </button>
                <button
                  onClick={() => useUI.getState().navigate({ name: "explore" })}
                  className="h-10 px-5 rounded-full bg-panel border border-ink-hi/[0.09] text-[13.5px] font-semibold text-ink-hi hover:bg-ink-hi/[0.05] hover:border-ink-hi/[0.2] transition-all active:scale-[0.98]"
                >
                  Browse Explore
                </button>
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}

function PlaylistTrackRow({
  track,
  index,
  queue,
  playlist,
  placeholderColor,
}: {
  track: Track;
  index: number;
  queue: Track[];
  playlist: Playlist;
  placeholderColor?: string;
}) {
  const playQueue = usePlayer((s) => s.playQueue);
  const openContextMenu = useUI((s) => s.openContextMenu);
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const playing = usePlayer((s) => s.playing);
  const liked = useLibrary((s) => s.liked.some((t) => t.id === track.id));
  const toggleLike = useLibrary((s) => s.toggleLike);
  const drag = useDrag({ track });
  const isMobile = useIsMobile();
  const isCurrent = currentId === track.id;

  const openMenu = (x: number, y: number): void => {
    openContextMenu(x, y, playlistMenuItems(playlist, track));
  };

  return (
    <div
      {...drag.props}
      onClick={() => playQueue(queue, index)}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(e.clientX, e.clientY);
      }}
      className={`group flex items-center gap-3.5 h-[64px] px-3 rounded-lg cursor-pointer select-none ${
        isCurrent ? "bg-ink-hi/[0.14]" : "hover:bg-ink-hi/[0.05]"
      } ${drag.dragging ? "opacity-40" : ""}`}
    >
      {/* The playlist's own running order — numbered rows, play on hover. */}
      <div className="w-7 shrink-0 grid place-items-center text-[13px] text-ink-faint tabular-nums">
        {isCurrent && playing ? (
          <EqBars />
        ) : (
          <>
            <span className={`group-hover:hidden ${isCurrent ? "text-ink-hi font-medium" : ""}`}>{index + 1}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isCurrent) usePlayer.getState().toggle();
                else playQueue(queue, index);
              }}
              className="hidden group-hover:block text-ink-hi hover:text-ink-hi transition-colors"
              title="Play"
              aria-label={`Play ${track.title}`}
            >
              <Play className="w-3.5 h-3.5 fill-current" />
            </button>
          </>
        )}
      </div>
      <Artwork src={track.thumb} trackId={track.id} placeholderColor={placeholderColor} className={`${isMobile ? "w-[44px] h-[44px]" : "w-[52px] h-[52px]"} rounded-lg shrink-0`} iconClassName="w-4 h-4" alt="" />
      <div className="flex-1 min-w-0 pr-1">
        <div className="flex items-center gap-1.5 text-[15px] sm:text-[16px] font-semibold tracking-[-0.2px] text-ink-hi min-w-0">
          {track.explicit && <ExplicitBadge />}
          <span className="truncate">{track.title}</span>
        </div>
        <div className="text-[13px] sm:text-[14px] text-ink-dim mt-0.5 flex items-center min-w-0">
          <span className="truncate">{track.artist}</span>
          {isMobile && track.duration > 0 && (
            <span className="text-ink-faint shrink-0 ml-1"> • {fmtTime(track.duration)}</span>
          )}
        </div>
      </div>
      <div className={`${isMobile ? "shrink-0 flex items-center justify-end gap-1" : "w-[88px] shrink-0 flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100"} focus-within:opacity-100 transition-opacity`}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleLike(track);
          }}
          title={liked ? "Remove from Liked" : "Add to Liked"}
          aria-label={liked ? "Remove from Liked" : "Add to Liked"}
          className="p-1.5 rounded-md text-ink-faint hover:text-ink-hi hover:bg-ink-hi/[0.07] transition-colors"
        >
          <Heart key={liked ? "liked" : "unliked"} className={`w-4 h-4 animate-icon-pop ${liked ? "fill-ink-hi text-ink-hi" : ""}`} />
        </button>
        <span className="opacity-80">
          <DownloadBadge id={track.id} />
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            openMenu(e.clientX, e.clientY);
          }}
          title="More options"
          aria-label={`More options for ${track.title}`}
          className="p-1.5 rounded-md text-ink-faint hover:text-ink-hi hover:bg-ink-hi/[0.07] transition-colors"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>
      <div className={`w-11 shrink-0 text-right text-xs text-ink-faint tabular-nums ${isMobile ? "hidden" : "block"}`}>
        {track.duration > 0 ? fmtTime(track.duration) : "—"}
      </div>
    </div>
  );
}
