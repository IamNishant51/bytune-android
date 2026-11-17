/**
 * MobileNowPlaying — the full-screen player surface for compact widths.
 *
 * The desktop cinematic view (src/components/NowPlaying.tsx) is laid out for a
 * wide window (artwork column + lyrics/queue column); at 412 dp it clips. This
 * is the same view in one column: the same stores for state, the same
 * requestLyrics cache, the same LyricsView and SeekBar components, the same
 * track menu — no second implementation of the machinery.
 *
 * Opened by tapping the mini player (`useUI.toggleNowPlaying`). Closed by the
 * chevron, by a swipe down on the artwork zone, and by the Android back button
 * (bridged in src/mobile/bootstrap.ts).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Heart,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { LyricsView } from "../components/SyncedLyrics";
import { requestLyrics } from "../components/LyricsCenter";
import { SeekBar } from "../components/Controls";
import { EqBars } from "../components/primitives";
import { usePlayer } from "../stores/player";
import { useLibrary } from "../stores/library";
import { useUI } from "../stores/ui";
import { useArtworkPalette } from "../lib/palette";
import { upgradeArtwork } from "../lib/artwork";
import { requestLyricsAlignment, useLyricsAlign } from "../lib/lyricsOffset";
import { trackMenuItems } from "../lib/trackActions";
import { fmtTime } from "../lib/format";
import type { LyricsResult } from "../types";

type Mode = "info" | "lyrics" | "queue";

/* ------------------------------------------------------------------ queue */

/** The real queue (RightRail's QueuePanel data) reworked for touch: tap to
 *  jump, X to remove, and live pointer-reorder off the grip — the drag lands
 *  in the same `moveInQueue` the desktop drag-and-drop uses, so order and the
 *  current index stay consistent and persist with the queue. */
function MobileQueue() {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const playing = usePlayer((s) => s.playing);
  const current = queue[index] ?? null;
  const upcoming = queue.slice(index + 1);

  const listRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ from: number } | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  const occurrence = new Map<string, number>();
  const stableKey = (id: string): string => {
    const n = occurrence.get(id) ?? 0;
    occurrence.set(id, n + 1);
    return `${id}#${n}`;
  };

  // Live reorder: the row under the pointer becomes the drag target as it
  // moves; crossing into a new row commits the same moveInQueue the desktop
  // drop would. No transform bookkeeping — the order flips under the finger.
  const findIndexUnder = (clientY: number): number => {
    const rows = listRef.current?.children;
    if (!rows) return -1;
    for (let i = 0; i < rows.length; i++) {
      const r = (rows[i] as HTMLElement).getBoundingClientRect();
      if (clientY < r.bottom) return i;
    }
    return rows.length - 1;
  };
  const onGripDown = (e: React.PointerEvent<HTMLDivElement>, i: number): void => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { from: i };
    setDragFrom(i);
  };
  const onGripMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    const to = findIndexUnder(e.clientY);
    if (to >= 0 && to !== drag.current.from) {
      usePlayer.getState().moveInQueue(drag.current.from, to);
      drag.current.from = to;
      setDragFrom(to);
    }
  };
  const onGripUp = (): void => {
    drag.current = null;
    setDragFrom(null);
  };

  if (!current) {
    return (
      <p className="flex-1 grid place-items-center px-6 text-center text-[13px] text-white/50">
        Nothing playing — start a track to see your queue here.
      </p>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 flex items-center justify-between px-1 pt-1 pb-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white/45">Now playing</span>
        {upcoming.length > 0 && (
          <button
            onClick={() => usePlayer.getState().clearUpcoming()}
            className="text-[12px] font-semibold text-white/60 active:text-white"
          >
            Clear
          </button>
        )}
      </div>
      <div className="flex items-center gap-3 h-14 px-2.5 rounded-lg bg-white/[0.14] shrink-0">
        <span className="w-9 h-9 shrink-0 rounded-md overflow-hidden bg-white/10">
          {current.thumb && <img src={upgradeArtwork(current.thumb)} alt="" className="w-full h-full object-cover" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-semibold truncate text-white flex items-center gap-1.5">
            <span className="truncate">{current.title}</span>
            {playing && <EqBars />}
          </div>
          <div className="text-[11.5px] truncate text-white/55 mt-0.5">{current.artist}</div>
        </div>
      </div>

      <div className="pt-3 pb-1 px-1">
        <h3 className="text-[15px] font-extrabold tracking-[-0.3px] text-white">Next up</h3>
      </div>
      {upcoming.length === 0 ? (
        <p className="px-1 py-4 text-[13px] text-white/50">Your queue is empty.</p>
      ) : (
        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto scroll-host pb-2 space-y-0.5">
          {upcoming.map((t, i) => {
            const qi = index + 1 + i;
            return (
              <div
                key={stableKey(t.id)}
                className={`group flex items-center gap-3 h-12 px-2 rounded-lg select-none transition-colors ${
                  dragFrom === qi ? "bg-white/[0.12]" : "bg-white/[0.04]"
                }`}
                onClick={() => usePlayer.getState().playQueue(queue, qi)}
              >
                <span className="w-9 h-9 shrink-0 rounded-md overflow-hidden bg-white/5">
                  {t.thumb && <img src={upgradeArtwork(t.thumb)} alt="" className="w-full h-full object-cover" />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] truncate font-semibold text-white">{t.title}</div>
                  <div className="text-[11.5px] truncate text-white/55 mt-0.5">{t.artist}</div>
                </div>
                {t.duration > 0 && (
                  <span className="w-9 text-right text-[11px] text-white/45 tabular-nums shrink-0">
                    {fmtTime(t.duration)}
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    usePlayer.getState().removeAt(qi);
                  }}
                  title="Remove from queue"
                  aria-label="Remove from queue"
                  className="p-1.5 shrink-0 text-white/45 active:text-red-400"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
                  </svg>
                </button>
                <div
                  aria-label="Reorder"
                  title="Drag to reorder"
                  className="flex-none touch-none px-1.5 py-3 cursor-grab active:cursor-grabbing"
                  onPointerDown={(e) => onGripDown(e, qi)}
                  onPointerMove={onGripMove}
                  onPointerUp={onGripUp}
                  onPointerCancel={onGripUp}
                  data-nolongpress
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4 text-white/60" fill="currentColor">
                    <circle cx="9" cy="6" r="1.6" />
                    <circle cx="15" cy="6" r="1.6" />
                    <circle cx="9" cy="12" r="1.6" />
                    <circle cx="15" cy="12" r="1.6" />
                    <circle cx="9" cy="18" r="1.6" />
                    <circle cx="15" cy="18" r="1.6" />
                  </svg>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- view */

export function MobileNowPlaying() {
  const open = useUI((s) => s.nowPlayingOpen);
  const close = useUI((s) => s.toggleNowPlaying);
  const track = usePlayer((s) => s.queue[s.index] ?? null);
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const toggle = usePlayer((s) => s.toggle);
  const next = usePlayer((s) => s.next);
  const prev = usePlayer((s) => s.prev);
  const toggleShuffle = usePlayer((s) => s.toggleShuffle);
  const cycleRepeat = usePlayer((s) => s.cycleRepeat);
  const liked = useLibrary((s) => (track ? s.liked.some((t) => t.id === track.id) : false));
  const toggleLike = useLibrary((s) => s.toggleLike);
  const palette = useArtworkPalette(track?.thumb ?? null);

  const [mode, setMode] = useState<Mode>("info");
  useEffect(() => {
    if (!open) setMode("info");
  }, [open]);

  // Same lyrics pipeline as the desktop overlay: the cache warmed by
  // prefetchLyrics, plus the audio-anchored alignment offset.
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  useEffect(() => {
    if (!open || !track) {
      setLyrics(null);
      return;
    }
    let cancelled = false;
    setLyrics(null);
    setLyricsLoading(true);
    void requestLyrics(track).then((r) => {
      if (cancelled) return;
      setLyrics(r ?? null);
      setLyricsLoading(false);
      const last = r?.synced?.[r.synced.length - 1];
      const end = last?.end ?? last?.time ?? 0;
      if (r?.synced?.length && track.duration) {
        requestLyricsAlignment(track.id, track.duration, end);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [track?.id, open]);
  const lyricsOffset = useLyricsAlign((s) => s.offsets[track?.id ?? ""] ?? 0);

  // Swipe down on the artwork zone to close — the chevron stays for
  // discoverability, the swipe matches the sheet gesture the phone expects.
  const swipeStart = useRef(0);
  const [dragY, setDragY] = useState<number | null>(null);
  const swipeZone = {
    style: { touchAction: "none" } as const,
    onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
      swipeStart.current = e.clientY;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDragY(0);
    },
    onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
      setDragY(Math.max(0, e.clientY - swipeStart.current));
    },
    onPointerUp() {
      setDragY((y) => {
        if (y !== null && y > 120) close();
        return null;
      });
    },
    onPointerCancel() {
      setDragY(null);
    },
  };

  const openMenu = (e: React.MouseEvent<HTMLButtonElement>): void => {
    if (!track) return;
    const rect = e.currentTarget.getBoundingClientRect();
    useUI.getState().openContextMenu(rect.left, rect.bottom + 6, trackMenuItems(track));
  };

  if (!open) return null;

  const panelOpen = mode !== "info";

  return (
    <div
      role="dialog"
      aria-label="Now playing"
      className="fixed inset-0 z-[100] overflow-hidden bg-black animate-fade-in"
      style={dragY ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
    >
      {/* Backdrop: the artwork lighting the room — one blurred cover, the
          palette floor and a scrim (the desktop crossfades layers; one layer
          is enough on a phone). */}
      {track?.thumb && (
        <img
          src={upgradeArtwork(track.thumb, 800)}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover scale-125 blur-3xl brightness-[0.42] saturate-[1.2] pointer-events-none"
        />
      )}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `linear-gradient(180deg, rgb(${palette.background} / 0.25) 0%, #0a0a0d 90%)`,
        }}
      />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/40 to-black/70 pointer-events-none" />

      <div
        className="relative h-full flex flex-col px-5 pt-1 pb-3"
        style={{ paddingBottom: `calc(env(safe-area-inset-bottom) + 12px)` }}
      >
        {/* Swipe-to-close zone: grabber, close chevron, artwork, title, like. */}
        <div className="shrink-0" {...swipeZone}>
          <div className="flex justify-center">
            <span className="block h-1.5 w-10 rounded-full bg-white/30" />
          </div>
          <div className="flex justify-end">
            <button onClick={close} aria-label="Close Now Playing" className="p-2 -mr-2 text-white/70 active:text-white">
              <ChevronDown className="w-6 h-6" />
            </button>
          </div>

          <div
            className={`relative mx-auto overflow-hidden rounded-[20px] bg-white/[0.05] shadow-art grid place-items-center transition-[max-width] duration-300 ${
              panelOpen ? "w-[128px] mt-1" : "w-full max-w-[320px] mt-2"
            }`}
            style={{ aspectRatio: "1 / 1" }}
          >
            {track?.thumb ? (
              <img key={track.id} src={upgradeArtwork(track.thumb, 800)} alt="" className="w-full h-full object-cover animate-art-in" />
            ) : (
              <Music2 className="w-10 h-10 text-white/35" />
            )}
          </div>

          <div className="mt-4 text-center" key={`meta-${track?.id ?? "none"}`}>
            <div className="font-display text-[21px] font-extrabold tracking-[-0.03em] text-white truncate">
              {track ? track.title : "Nothing playing"}
            </div>
            <div className="text-[13.5px] text-white/60 mt-1 truncate">
              {track ? track.artist : "Play something and it shows up here"}
            </div>
          </div>

          <div className="mt-2.5 flex items-center justify-center gap-2.5">
            <button
              onClick={() => track && toggleLike(track)}
              disabled={!track}
              aria-pressed={liked}
              aria-label={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
              className={`flex items-center gap-2 h-9 px-4 rounded-full bg-white/[0.08] active:bg-white/[0.15] text-[12.5px] font-semibold transition-all ${
                liked ? "text-white" : "text-white/65"
              }`}
            >
              <Heart className={`w-4 h-4 shrink-0 ${liked ? "fill-current" : ""}`} />
              {liked ? "Liked" : "Add to library"}
            </button>
            <button
              onClick={openMenu}
              disabled={!track}
              aria-label="More actions"
              className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.08] active:bg-white/[0.15] text-white/65"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Mode switch over the lyrics / queue panels — the same data the
            desktop overlay switches between. Tapping the open one closes it. */}
        <div className="shrink-0 mt-3 flex items-center justify-center">
          <div className="inline-flex items-center gap-1 rounded-full bg-white/[0.07] p-1">
            {(["lyrics", "queue"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode((prev) => (prev === m ? "info" : m))}
                aria-pressed={mode === m}
                className={`h-8 rounded-full px-4 text-[13px] font-semibold transition-all ${
                  mode === m ? "bg-white/[0.16] text-white" : "text-white/60 active:text-white/90"
                }`}
              >
                {m === "lyrics" ? "Lyrics" : "Queue"}
              </button>
            ))}
          </div>
        </div>

        {/* Lyrics / queue panel — flexes to take the space the artwork
            releases; nothing is reachable off-screen. */}
        {mode === "lyrics" ? (
          <div className="flex-1 min-h-0 mt-2 flex" data-nolongpress>
            <LyricsView
              key={track?.id}
              trackKey={track?.id}
              lyrics={lyrics}
              loading={lyricsLoading}
              hero
              offset={lyricsOffset}
            />
          </div>
        ) : mode === "queue" ? (
          <div className="flex-1 min-h-0 mt-2 flex" data-nolongpress>
            <MobileQueue />
          </div>
        ) : (
          <div className="flex-1" />
        )}

        {/* Seek + transport — the store the mobile bar and desktop bar use. */}
        <div className="shrink-0 mt-2">
          <SeekBar large showRemaining />
          <div className="mt-1 flex items-center justify-center gap-6">
            <button
              onClick={toggleShuffle}
              aria-label={shuffle ? "Disable shuffle" : "Enable shuffle"}
              className={`relative grid h-11 w-11 place-items-center rounded-full ${shuffle ? "text-white" : "text-white/55"} active:text-white`}
            >
              <Shuffle className="w-5 h-5" />
              {shuffle && <span className="absolute mt-7 h-1 w-1 rounded-full bg-white" />}
            </button>
            <button
              onClick={() => prev()}
              disabled={!track}
              aria-label="Previous"
              className="grid h-11 w-11 place-items-center rounded-full text-white active:text-white/70"
            >
              <SkipBack className="w-6 h-6" fill="currentColor" strokeWidth={0} />
            </button>
            <button
              onClick={() => toggle()}
              disabled={!track}
              aria-label={playing ? "Pause" : "Play"}
              className="grid h-14 w-14 place-items-center rounded-full bg-white text-black active:scale-95 transition-transform"
            >
              {buffering ? (
                <span className="mobile-player-spinner" />
              ) : playing ? (
                <Pause className="w-6 h-6" fill="currentColor" strokeWidth={0} />
              ) : (
                <Play className="w-6 h-6 translate-x-[1px]" fill="currentColor" strokeWidth={0} />
              )}
            </button>
            <button
              onClick={() => next(true)}
              disabled={!track}
              aria-label="Next"
              className="grid h-11 w-11 place-items-center rounded-full text-white active:text-white/70"
            >
              <SkipForward className="w-6 h-6" fill="currentColor" strokeWidth={0} />
            </button>
            <button
              onClick={cycleRepeat}
              aria-label={repeat === "off" ? "Enable repeat" : repeat === "all" ? "Disable repeat" : "Enable repeat one"}
              className={`relative grid h-11 w-11 place-items-center rounded-full ${repeat !== "off" ? "text-white" : "text-white/55"} active:text-white`}
            >
              {repeat === "one" ? <Repeat1 className="w-5 h-5" /> : <Repeat className="w-5 h-5" />}
              {repeat !== "off" && <span className="absolute mt-7 h-1 w-1 rounded-full bg-white" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
