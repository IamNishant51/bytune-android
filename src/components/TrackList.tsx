import { Fragment, memo, useCallback, useMemo, useRef, useState } from "react";
import { useIsMobile } from "../lib/useIsMobile";
import { haptic } from "../lib/haptics";
import { AlertCircle, Check, Download, Heart, ListStart, Loader2, MoreHorizontal, Pause, Play } from "lucide-react";
import { useLibrary } from "../stores/library";
import { usePlayer } from "../stores/player";
import { tintHoverHandlers, useUI, type MenuItem } from "../stores/ui";
import { trackMenuItems } from "../lib/trackActions";
import { useDrag } from "../lib/dnd";
import { fmtTime } from "../lib/format";
import { Artwork, EqBars, EmptyState, ExplicitBadge } from "./primitives";
import type { Track } from "../types";

/** Download state glyph for a track row — spinner / green check / red fail. */
export function DownloadBadge({ id }: { id: string }) {
  const dl = useLibrary((s) => s.downloads[id]);
  if (!dl) return null;
  if (dl.status === "downloading") {
    return (
      <span className="p-1.5 rounded-md text-ink-hi" title="Downloading…">
        <Loader2 className="w-4 h-4 animate-spin" />
      </span>
    );
  }
  if (dl.status === "done") {
    return (
      <span className="p-1.5 rounded-md text-emerald-400" title="Downloaded">
        <Check className="w-4 h-4" />
      </span>
    );
  }
  return (
    <span className="p-1.5 rounded-md text-red-400" title="Download failed">
      <AlertCircle className="w-4 h-4" />
    </span>
  );
}

interface TrackRowProps {
  track: Track;
  index: number;
  isCurrent: boolean;
  isPlaying: boolean;
  liked: boolean;
  onPlay: (index: number) => void;
  menuFor: (track: Track) => MenuItem[];
  showAlbum: boolean;
}

/**
 * Memoized: the list re-renders on every play/pause (it subscribes to player
 * state), and without memo every row re-rendered with it. Props are kept
 * referentially stable by TrackList (useCallback handlers, a primitive
 * `liked` from the shared Set) so only the rows that actually changed
 * re-render. The `liked` lookup is O(1) — the old per-row
 * `liked.some(...)` selector was O(rows × liked) on every library change.
 */
const TrackRow = memo(function TrackRow({ track, index, isCurrent, isPlaying, liked, onPlay, menuFor, showAlbum }: TrackRowProps) {
  const toggleLike = useLibrary((s) => s.toggleLike);
  const openContextMenu = useUI((s) => s.openContextMenu);
  const navigate = useUI((s) => s.navigate);
  const drag = useDrag({ track });
  const isMobile = useIsMobile();

  const [swipeX, setSwipeX] = useState(0);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isSwiping = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isSwiping.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (!isSwiping.current && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      isSwiping.current = true;
    }
    if (isSwiping.current) {
      const dampened = dx > 0 ? Math.min(85, dx * 0.65) : Math.max(-85, dx * 0.65);
      setSwipeX(dampened);
    }
  };

  const handleTouchEnd = () => {
    if (isSwiping.current) {
      if (swipeX > 55) {
        usePlayer.getState().addToQueue(track, true);
        haptic("light");
        useUI.getState().toast(`Queued next: ${track.title}`, "info");
      } else if (swipeX < -55) {
        toggleLike(track);
        haptic("success");
        useUI.getState().toast(liked ? "Removed from Liked Songs" : "Added to Liked Songs", "info");
      }
    }
    setSwipeX(0);
    setTimeout(() => {
      isSwiping.current = false;
    }, 50);
  };

  const openMenu = (x: number, y: number): void => {
    openContextMenu(x, y, menuFor(track));
  };

  return (
    <div className="relative overflow-hidden rounded-lg select-none cv-row">
      {/* Swipe reveal action layer */}
      {isMobile && Math.abs(swipeX) > 4 && (
        <div
          className={`absolute inset-0 flex items-center justify-between px-4 transition-colors ${
            swipeX > 0 ? "bg-emerald-600 text-white" : liked ? "bg-zinc-700 text-white/80" : "bg-rose-600 text-white"
          }`}
        >
          {swipeX > 0 ? (
            <div className="flex items-center gap-2 font-bold text-[13px]">
              <ListStart className="w-5 h-5" />
              <span>Play Next</span>
            </div>
          ) : <div />}
          {swipeX < 0 ? (
            <div className="flex items-center gap-2 font-bold text-[13px]">
              <span>{liked ? "Remove" : "Like"}</span>
              <Heart className={`w-5 h-5 ${liked ? "fill-current" : ""}`} />
            </div>
          ) : <div />}
        </div>
      )}

      <div
        {...tintHoverHandlers(track.thumb)}
        {...drag.props}
        onClick={() => {
          if (isSwiping.current || Math.abs(swipeX) > 6) return;
          onPlay(index);
        }}
        onTouchStart={isMobile ? handleTouchStart : undefined}
        onTouchMove={isMobile ? handleTouchMove : undefined}
        onTouchEnd={isMobile ? handleTouchEnd : undefined}
        style={{
          transform: swipeX !== 0 ? `translate3d(${swipeX}px, 0, 0)` : undefined,
          transition: swipeX === 0 ? "transform 260ms cubic-bezier(0.2, 0.9, 0.3, 1)" : "none",
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openMenu(e.clientX, e.clientY);
        }}
        className={`group flex items-center gap-3.5 h-[60px] px-3 rounded-lg cursor-pointer select-none relative bg-canvas ${
          isCurrent ? "bg-ink-hi/[0.14]" : "hover:bg-ink-hi/[0.05]"
        } ${drag.dragging ? "opacity-40" : ""}`}
      >
      {/* index / hover play / eq */}
      <div className="w-7 shrink-0 grid place-items-center text-[13px] text-ink-faint tabular-nums">
        {isCurrent && isPlaying ? (
          <EqBars />
        ) : (
          <>
            <span className={`group-hover:hidden ${isCurrent ? "text-ink-hi font-medium" : ""}`}>{index + 1}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isCurrent) {
                  // clicking play on the current row toggles playback
                  usePlayer.getState().toggle();
                } else {
                  onPlay(index);
                }
              }}
              className="hidden group-hover:block text-ink-hi hover:text-ink-hi transition-colors"
              title={isCurrent && isPlaying ? "Pause" : "Play"}
              aria-label={isCurrent && isPlaying ? "Pause" : `Play ${track.title}`}
            >
              {isCurrent && isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            </button>
          </>
        )}
      </div>

      <Artwork
        src={track.thumb}
        trackId={track.id}
        className="w-[52px] h-[52px] rounded-lg shrink-0"
        iconClassName="w-4 h-4"
        alt=""
      />

      {/* min-w floor: with showAlbum the fixed columns (index · artwork · album ·
          controls · time) can exceed a narrow list and, because the title's flex
          basis is 0, it would collapse to zero width before anything else gives.
          The floor keeps the title visible; the album column shrinks instead. */}
      <div className="flex-1 min-w-[120px]">
        <div className={`flex items-center gap-1.5 text-[16px] font-semibold tracking-[-0.2px] ${isCurrent ? "text-ink-hi" : "text-ink-hi"}`}>
          {track.explicit && <ExplicitBadge />}
          <span className="truncate">{track.title}</span>
        </div>
        <div className="text-[14px] truncate text-ink-dim mt-0.5">
          {track.artist}
        </div>
      </div>

      {showAlbum && (
        <div className="w-52 hidden xl:block text-xs text-ink-faint truncate">
          {track.albumId ? (
            <button
              className="hover:text-ink hover:underline text-left transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                navigate({ name: "album", param: track.albumId });
              }}
            >
              {track.album ?? "Single"}
            </button>
          ) : (
            track.album ?? ""
          )}
        </div>
      )}

      <div className="w-[88px] shrink-0 flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleLike(track);
            haptic("success");
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
          aria-label="More options"
          className="p-1.5 rounded-md text-ink-faint hover:text-ink-hi hover:bg-ink-hi/[0.07] transition-colors"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      <div className="w-11 shrink-0 text-right text-xs text-ink-faint tabular-nums">
        {track.duration > 0 ? fmtTime(track.duration) : "—"}
      </div>
    </div>
    </div>
  );
});

interface TrackListProps {
  tracks: Track[];
  onPlay?: (index: number) => void;
  showAlbum?: boolean;
  showHeader?: boolean;
  menuFor?: (track: Track) => MenuItem[];
  emptyLabel?: string;
  emptyTitle?: string;
}

export function TrackList({
  tracks,
  onPlay,
  showAlbum = true,
  showHeader = true,
  menuFor = trackMenuItems,
  emptyLabel,
  emptyTitle = "Nothing here yet",
}: TrackListProps) {
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const playing = usePlayer((s) => s.playing);
  const playQueue = usePlayer((s) => s.playQueue);
  const likedTracks = useLibrary((s) => s.liked);
  // One Set per library change; rows read O(1) from it via a primitive prop.
  const likedIds = useMemo(() => new Set(likedTracks.map((t) => t.id)), [likedTracks]);
  const play = useCallback(
    (i: number) => {
      if (onPlay) onPlay(i);
      else playQueue(tracks, i);
    },
    [onPlay, playQueue, tracks]
  );
  const menuForCb = useCallback((track: Track) => menuFor(track), [menuFor]);

  // Row keys: the same track id can legitimately appear twice in a playlist
  // or queue, so a bare id is not unique — but a raw index suffix shifts
  // every key when a row is inserted above. Occurrence numbers
  // (`id`, `id#1`, …) are stable across re-renders and track advances.
  const occurrence = new Map<string, number>();
  const rowKey = (id: string): string => {
    const n = occurrence.get(id) ?? 0;
    occurrence.set(id, n + 1);
    return n === 0 ? id : `${id}#${n}`;
  };

  if (!tracks.length) {
    return <EmptyState icon={Play} title={emptyTitle} body={emptyLabel ?? "Tracks will appear here."} />;
  }

  return (
    <div>
      {showHeader && (
        <div className="flex items-center gap-3 px-3 pb-2.5 mb-1 border-b border-ink-hi/[0.06] text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-ghost">
          <div className="w-7 shrink-0">#</div>
          <div className="w-[52px] shrink-0" />
          <div className="flex-1 min-w-0">Title</div>
          {showAlbum && <div className="w-52 shrink-0 hidden xl:block">Album</div>}
          <div className="w-[88px] shrink-0" />
          <div className="w-11 shrink-0 text-right">Time</div>
        </div>
      )}
      <div>
        {tracks.map((track, i) => (
          <Fragment key={rowKey(track.id)}>
            <TrackRow
              track={track}
              index={i}
              isCurrent={track.id === currentId}
              isPlaying={playing}
              liked={likedIds.has(track.id)}
              onPlay={play}
              menuFor={menuForCb}
              showAlbum={showAlbum}
            />
            {/* Hairline divider, inset to the title column — mobile's
                ROW_DIVIDER_INSET clears the 52dp artwork the same way. */}
            {i < tracks.length - 1 && <div className="h-px bg-ink-hi/[0.05] ml-[120px] mr-3" />}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
