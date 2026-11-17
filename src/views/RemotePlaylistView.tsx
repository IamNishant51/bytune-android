/**
 * A remote (YouTube) playlist page — BitChord mobile's DetailScreen for a
 * playlist browse: full-bleed cover hero with the curator/views credit line
 * and the "PLAYLIST • N TRACKS" metadata line, shuffle + play controls, then
 * the playlist's own numbered track rows.
 */
import { useEffect, useMemo, useState } from "react";
import { Check, Download, ListMusic, Loader2, MoreHorizontal, Play, Shuffle } from "lucide-react";
import { downloadPlaylist, removeDownloadedPlaylist, getPlaylistDownloadStats } from "../lib/downloads";
import { DownloadBadge } from "../components/TrackList";
import { useLibrary } from "../stores/library";
import { Artwork, ErrorState, ExplicitBadge, HeroSkeleton, ListSkeleton } from "../components/primitives";
import { playlistSortMenuItem, trackMenuItems } from "../lib/trackActions";
import { sortTracks, type PlaylistSort } from "../lib/playlistSort";
import { useDrag } from "../lib/dnd";
import { fmtTime } from "../lib/format";
import { useArtworkPalette } from "../lib/palette";
import { upgradeArtwork } from "../lib/artwork";
import { usePlayer } from "../stores/player";
import { useUI } from "../stores/ui";
import { useIsMobile } from "../lib/useIsMobile";
import type { RemotePlaylistPage, Track } from "../types";

function PlaylistTrackRow({
  song,
  index,
  numbered,
  queue,
}: {
  song: Track;
  index: number;
  numbered: boolean;
  queue: Track[];
}) {
  const isMobile = useIsMobile();
  const playQueue = usePlayer((s) => s.playQueue);
  const openContextMenu = useUI((s) => s.openContextMenu);
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const drag = useDrag({ track: song });
  const openMenu = (x: number, y: number): void => {
    openContextMenu(x, y, trackMenuItems(song));
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
        currentId === song.id ? "bg-ink-hi/[0.14]" : "hover:bg-ink-hi/[0.05]"
      } ${drag.dragging ? "opacity-40" : ""}`}
    >
      {numbered ? (
        <div className="w-7 shrink-0 grid place-items-center text-[13px] text-ink-faint tabular-nums">
          {currentId === song.id ? (
            <span className="text-accent">▸</span>
          ) : (
            <span className="group-hover:hidden">{index + 1}</span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              playQueue(queue, index);
            }}
            className="hidden group-hover:block text-ink-hi hover:text-ink-hi transition-colors"
            title={`Play ${song.title}`}
            aria-label={`Play ${song.title}`}
          >
            <Play className="w-3.5 h-3.5 fill-current" />
          </button>
        </div>
      ) : null}
      <Artwork src={song.thumb} className={`${isMobile ? "w-[44px] h-[44px]" : "w-[52px] h-[52px]"} rounded-lg shrink-0`} iconClassName="w-4 h-4" alt="" />
      <div className="flex-1 min-w-0 pr-1">
        <div className="flex items-center gap-1.5 text-[15px] sm:text-[16px] font-semibold tracking-[-0.2px] text-ink-hi min-w-0">
          {song.explicit && <ExplicitBadge />}
          <span className="truncate">{song.title}</span>
        </div>
        <div className="text-[13px] sm:text-[14px] text-ink-dim mt-0.5 flex items-center min-w-0">
          <span className="truncate">{song.artist}</span>
          {isMobile && song.duration > 0 && (
            <span className="text-ink-faint shrink-0 ml-1"> • {fmtTime(song.duration)}</span>
          )}
        </div>
      </div>
      <div className="shrink-0 flex items-center justify-end gap-1">
        <span className="opacity-80">
          <DownloadBadge id={song.id} />
        </span>
        <div className={`text-[13px] text-ink-faint tabular-nums ${isMobile ? "hidden" : "block"}`}>
          {song.duration > 0 ? fmtTime(song.duration) : ""}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            openMenu(e.clientX, e.clientY);
          }}
          title="More options"
          aria-label={`More options for ${song.title}`}
          className="p-1.5 rounded-md text-ink-faint hover:text-ink-hi hover:bg-ink-hi/[0.07] transition-colors"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export function RemotePlaylistView({ playlistId }: { playlistId: string }) {
  const isMobile = useIsMobile();
  const [page, setPage] = useState<RemotePlaylistPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const playQueue = usePlayer((s) => s.playQueue);
  const toast = useUI((s) => s.toast);
  const downloads = useLibrary((s) => s.downloads);

  // Same view-level sort as local playlists: YouTube's own order stays the
  // "custom order" the user returns to.
  const [sort, setSort] = useState<PlaylistSort>("custom");
  const [sortDesc, setSortDesc] = useState(false);
  const tracks = useMemo(
    () => sortTracks(page?.tracks ?? [], sort, sortDesc),
    [page?.tracks, sort, sortDesc]
  );

  useArtworkPalette(page?.thumb ?? null);

  useEffect(() => {
    let cancelled = false;
    setPage(null);
    setError(null);
    window.bytune
      ?.getPlaylistPage(playlistId)
      .then((res) => {
        if (!cancelled) setPage(res as RemotePlaylistPage);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [playlistId, nonce]);

  if (error) {
    return (
      <ErrorState
        title="Couldn't load this playlist"
        body="This is usually a connection hiccup. Give it another try."
        onRetry={() => setNonce((n) => n + 1)}
        className="pt-10"
      />
    );
  }
  if (!page) {
    return (
      <div className={isMobile ? "px-0 pt-4" : "px-8 pt-6"}>
        <HeroSkeleton />
        <ListSkeleton rows={7} />
      </div>
    );
  }

  const allDownloaded = tracks.length > 0 && tracks.every((t) => downloads[t.id]?.status === "done");
  const dlStats = getPlaylistDownloadStats(tracks, downloads);
  const anyDownloading = dlStats.downloading > 0;
  const play = (shuffle: boolean): void => {
    if (!tracks.length) return;
    if (shuffle) {
      usePlayer.setState({ shuffle: true });
      playQueue(tracks, Math.floor(Math.random() * tracks.length));
    } else {
      playQueue(tracks, 0);
    }
  };

  return (
    <div className="page-tint -mt-5 w-full max-w-full overflow-x-hidden">
      {/* Hero — the playlist cover full-bleed, credit + metadata lines over it. */}
      <div className={`relative ${isMobile ? "-mx-4" : "-mx-10"} overflow-hidden`}>
        <div className="absolute inset-0">
          {page.thumb ? (
            <img src={upgradeArtwork(page.thumb, 1200)} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-ink-hi/[0.04] grid place-items-center">
              <ListMusic className="w-12 h-12 text-ink-hi/30" />
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
          <h1 className={`font-display ${isMobile ? "text-[26px]" : "text-[34px]"} leading-[1.35] font-extrabold tracking-[-0.03em] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.55)] break-words max-w-3xl line-clamp-2`}>
            {page.title}
          </h1>
          {page.credit && (
            <div className="text-[15px] font-medium text-accent mt-2 drop-shadow-[0_1px_6px_rgba(0,0,0,0.5)] line-clamp-1">
              {page.credit}
            </div>
          )}
          {page.meta && (
            <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/70 mt-1.5 drop-shadow-[0_1px_6px_rgba(0,0,0,0.5)]">
              {page.meta}
            </div>
          )}

          <div className="flex items-center justify-center gap-2.5 mt-4">
            <button
              onClick={() => play(true)}
              disabled={!tracks.length}
              title="Shuffle"
              aria-label="Shuffle"
              className="w-11 h-11 grid place-items-center rounded-full glass-btn text-white transition-all active:scale-[0.92] disabled:opacity-40"
            >
              <Shuffle className="w-[18px] h-[18px]" />
            </button>
            <button
              onClick={() => play(false)}
              disabled={!tracks.length}
              className="inline-flex items-center gap-2 h-11 px-6 rounded-full bg-primary text-on-primary text-[14.5px] font-semibold transition-all active:scale-[0.95] shadow-lg shadow-primary/25 hover:brightness-110 disabled:opacity-40"
            >
              <Play className="w-[18px] h-[18px] fill-current" />
              Play
            </button>
            <button
              onClick={() => {
                if (allDownloaded) {
                  removeDownloadedPlaylist(tracks);
                } else {
                  void downloadPlaylist(page.title, tracks);
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
              onClick={(e) =>
                useUI.getState().openContextMenu(e.clientX, e.clientY, [
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
                    action: () => {
                      usePlayer.getState().addToQueue(tracks);
                      toast("Playlist added to queue");
                    },
                  },
                ])
              }
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
                    onClick={() => void downloadPlaylist(page.title, tracks)}
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
            {tracks.map((song, i) => (
              <div key={`${song.id}-${i}`}>
                <PlaylistTrackRow song={song} index={i} numbered queue={tracks} />
                {i < tracks.length - 1 && <div className={`h-px bg-ink-hi/[0.05] ${isMobile ? "ml-[68px] mr-2" : "ml-[112px] mr-3"}`} />}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[13px] text-ink-dim py-10 text-center">This playlist is empty.</div>
        )}
      </div>
    </div>
  );
}
