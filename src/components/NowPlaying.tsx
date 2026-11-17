/**
 * NowPlaying — the fullscreen cinematic mode.
 *
 * A pure presentation layer around the app's existing machinery: it holds no
 * playback, queue, lyrics or audio state of its own.
 *
 *   bottom   the exact PlayerBar the shell uses — the same component instance
 *            shape, unchanged; fullscreen adds no second transport.
 *   left     the artwork as the hero (deep shadow, a whisper of ambient glow,
 *            a barely-there breathing scale while audio plays), song
 *            information and the favourite action underneath, then a small
 *            ambient visualizer as decoration.
 *   right    the existing synced-lyrics view (LyricsView, `hero` scale) and
 *            the existing queue sheet (QueuePanel), switched by a
 *            Lyrics | Queue control.
 *   behind   the artwork's own colours — an ArtworkPalette floor plus a
 *            heavily blurred cover — crossfaded per track and held dark.
 *
 * Entering releases the shell into a true OS fullscreen; the mount/exit
 * choreography below is the same state machine the previous fullscreen mode
 * used, kept verbatim so the window behavior (Esc, rapid toggles, reduced
 * motion) is untouched.
 */
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, Heart, Music2, Loader2, Download, Check, MoreVertical, Timer } from "lucide-react";
// The desktop shell pieces are lazy: the phone never renders them, and the
// static imports used to pull Sidebar/RightRail/PlayerBar into the first
// paint bundle (see App.tsx — same chunks, shared by both import sites).
const PlayerBar = lazy(() => import("./PlayerBar").then((m) => ({ default: m.PlayerBar })));
const QueuePanel = lazy(() => import("./RightRail").then((m) => ({ default: m.QueuePanel })));
import { LyricsView } from "./SyncedLyrics";
import { requestLyrics } from "./LyricsCenter";
import { usePlayer } from "../stores/player";
import { useLibrary } from "../stores/library";
import { useSettings } from "../stores/settings";
import { useUI } from "../stores/ui";
import { useSleepTimer } from "../stores/sleepTimer";
import { useArtworkPalette, type ArtworkPalette } from "../lib/palette";
import { upgradeArtwork } from "../lib/artwork";
import { isLowMemoryDevice } from "../lib/device";
import { haptic } from "../lib/haptics";
import { useDrag } from "../lib/dnd";
import { useCanvas } from "../lib/canvas";
import { requestLyricsAlignment, useLyricsAlign } from "../lib/lyricsOffset";
import { useIsMobile } from "../lib/useIsMobile";
import { fmtTime } from "../lib/format";
import { startDownload, cancelDownload } from "../lib/downloads";
import { isAndroid } from "../lib/platform";
import { trackMenuItems } from "../lib/trackActions";
import { MobileSheet } from "../mobile/MobileShell";
import { MobileQueue } from "../mobile/MobileQueue";
import {
  SpLyrics,
  SpNext,
  SpPause,
  SpPlay,
  SpPrev,
  SpQueue,
  SpRepeat,
  SpRepeatOne,
  SpShuffle,
} from "./SpotifyIcons";
import type { LyricsResult } from "../types";

/* ================================================================ backdrop */

/**
 * One track's atmosphere: an ArtworkPalette floor, a heavily blurred
 * over-scaled cover (the artwork "lighting the room"), two slow palette
 * glows, and a scrim that keeps every word readable on any sleeve. Each
 * layer freezes its own artwork at mount, so a song change fades whole
 * layers over each other instead of repainting one in place.
 */
function FsBackdropLayer({
  artwork,
  boost,
  legacy,
  enter,
  playing = false,
}: {
  artwork: string | null;
  boost: boolean;
  legacy: boolean;
  enter: boolean;
  playing?: boolean;
}) {
  const palette = useArtworkPalette(artwork);
  // One palette per track: concurrent layers asking for the same artwork
  // share one extraction via the in-flight dedup in lib/palette.ts, and the
  // page palette in NowPlaying below reads the same cache.
  const lowRam = isLowMemoryDevice();
  return (
    <div className={`absolute inset-0 ${enter ? "fs-bg-in" : ""}`}>
      <div
        className="absolute inset-0"
        style={{ background: `linear-gradient(180deg, rgb(${palette.background}) 0%, #08080b 88%)` }}
      />
      {artwork && !legacy && (
        <img
          src={upgradeArtwork(artwork, 256)}
          alt=""
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover brightness-[0.88] saturate-[1.65] blur-[52px]"
          style={{
            transform: "scale(1.36)",
            opacity: boost ? 0.85 : 0.70,
            maskImage: "radial-gradient(ellipse 95% 82% at 50% 42%, black 45%, transparent 100%)",
            WebkitMaskImage: "radial-gradient(ellipse 95% 82% at 50% 42%, black 45%, transparent 100%)",
          }}
        />
      )}
      {/* Liquid Aurora moving gradient layer 1 (primary accent bloom) */}
      <div
        className={`absolute -inset-[35%] rounded-full liquid-aurora-blob-1 ${playing ? "" : "liquid-aurora-paused"}`}
        style={{
          background: `radial-gradient(circle 520px at 42% 42%, rgb(${palette.accent} / ${boost ? 0.44 : 0.32}), transparent 70%)`,
        }}
      />
      {/* Liquid Aurora moving gradient layer 2 (secondary wash bloom) */}
      <div
        className={`absolute -inset-[35%] rounded-full liquid-aurora-blob-2 ${playing ? "" : "liquid-aurora-paused"}`}
        style={{
          background: `radial-gradient(circle 480px at 58% 58%, rgb(${palette.wash} / ${boost ? 0.46 : 0.34}), transparent 70%)`,
        }}
      />
      {/* Liquid Aurora moving gradient layer 3 (flowing angled mesh wave).
          mix-blend-screen forces an extra compositing pass per frame, so
          low-RAM devices drop the blend and keep the plain gradient. */}
      <div
        className={`absolute -inset-[25%] liquid-aurora-wave ${lowRam ? "" : "mix-blend-screen"} pointer-events-none ${playing ? "" : "liquid-aurora-paused"}`}
        style={{
          background: `linear-gradient(130deg, transparent 15%, rgb(${palette.accent} / 0.24) 38%, transparent 55%, rgb(${palette.wash} / 0.28) 75%, transparent 95%)`,
        }}
      />
      {/* Legibility scrim — keeping typography and controls pristine */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/10 to-black/35" />
    </div>
  );
}

/**
 * The fullscreen background. Keeps the previous track's layer mounted
 * underneath while the new one fades in (1.3s), so a song change never
 * flashes or dips to black.
 */
function FsBackdrop({
  artwork,
  boost,
  legacy,
  playing = false,
}: {
  artwork: string | null;
  boost: boolean;
  legacy: boolean;
  playing?: boolean;
}) {
  const id = artwork ?? "none";
  const [layers, setLayers] = useState<string[]>([id]);

  useEffect(() => {
    setLayers((prev) => (prev[prev.length - 1] === id ? prev : [...prev.slice(-2), id]));
    const timer = window.setTimeout(() => {
      setLayers((prev) => (prev.length > 1 ? prev.filter((x) => x === id) : prev));
    }, 1300);
    return () => window.clearTimeout(timer);
  }, [id]);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      {/* Layers are distinct artworks by construction (the effect only
          appends when the id changed), so the artwork URL is a stable key. */}
      {layers.map((layerId, i) => (
        <FsBackdropLayer
          key={layerId}
          artwork={layerId === "none" ? null : layerId}
          boost={boost}
          legacy={legacy}
          enter={i === layers.length - 1}
          playing={playing}
        />
      ))}
    </div>
  );
}

/* =============================================================== visualizer */

const VIZ_BARS = 32;

/**
 * Ambient decoration, not an instrument: a thin symmetric waveform whose bars
 * dance on staggered CSS loops while audio plays and settle smoothly to rest
 * when it pauses. Pure CSS — no second audio pipeline (the engine plays
 * plain HTMLAudio elements; tapping them into WebAudio would break
 * cross-origin streams for a decoration).
 */
function FsVisualizer({ playing }: { playing: boolean }) {
  const bars = useMemo(
    () =>
      Array.from({ length: VIZ_BARS }, (_, i) => {
        const r1 = ((i * 137) % 101) / 101;
        const r2 = ((i * 61) % 97) / 97;
        return {
          dur: `${(2.2 + r1 * 1.6).toFixed(2)}s`,
          delay: `${(-r2 * 3).toFixed(2)}s`,
          rest: (0.12 + r1 * 0.1).toFixed(2),
        };
      }),
    [],
  );
  return (
    <div
      aria-hidden
      className={`fs-viz flex h-9 w-[min(300px,72%)] items-center justify-center gap-[5px] ${
        playing ? "is-playing" : ""
      }`}
    >
      {bars.map((b, i) => (
        <span
          key={i}
          className="fs-viz-bar"
          style={{ "--dur": b.dur, "--delay": b.delay, "--rest": b.rest } as CSSProperties}
        />
      ))}
    </div>
  );
}

/* ============================================================ mode switch */

function FsModeSwitch({
  mode,
  onChange,
}: {
  mode: "lyrics" | "queue";
  onChange: (m: "lyrics" | "queue") => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] p-1">
      {(["lyrics", "queue"] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          aria-pressed={mode === m}
          className={`h-8 rounded-full px-4 text-[13px] font-semibold transition-all active:scale-[0.97] ${
            mode === m ? "bg-white/[0.14] text-white" : "text-white/55 hover:text-white/90"
          }`}
        >
          {m === "lyrics" ? "Lyrics" : "Queue"}
        </button>
      ))}
    </div>
  );
}

function MobileTransportButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`relative grid h-10 w-10 place-items-center rounded-full transition-colors active:scale-95 ${
        active ? "text-white" : "text-white/60 hover:text-white"
      }`}
    >
      {children}
      {active && (
        <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white" />
      )}
    </button>
  );
}

function MobileSeekBar() {
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const buffered = usePlayer((s) => s.buffered);
  const seek = usePlayer((s) => s.seek);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const max = duration > 0 ? duration : 1;
  const shown = dragValue ?? Math.min(position, max);
  const pct = Math.min(100, (shown / max) * 100);
  const bufPct = Math.min(100, Math.max(buffered * 100, pct));
  const isScrubbing = dragValue !== null;

  const commit = () => {
    if (dragValue !== null) seek(Math.min(dragValue, max));
    setDragValue(null);
  };

  return (
    <div className="relative w-full flex flex-col gap-1.5" onTouchStart={(e) => e.stopPropagation()}>
      {/* Floating Time Bubble Magnifier */}
      {isScrubbing && (
        <div
          className="pointer-events-none absolute -top-11 z-30 -translate-x-1/2 transition-transform duration-75 ease-out animate-scale-in"
          style={{ left: `${Math.max(6, Math.min(94, pct))}%` }}
        >
          <div className="relative flex items-center gap-1.5 rounded-full bg-white/25 px-3 py-1 shadow-2xl glass-chip border border-white/30">
            <span className="font-display text-[12.5px] font-extrabold tabular-nums text-white drop-shadow">
              {fmtTime(shown)}
            </span>
            <span className="text-[10px] font-semibold text-white/70 tabular-nums">
              / {fmtTime(duration)}
            </span>
            {/* Bubble caret */}
            <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent border-t-[6px] border-t-white/30" />
          </div>
        </div>
      )}

      <input
        type="range"
        aria-label="Seek"
        min={0}
        max={max}
        step={0.5}
        value={shown}
        onChange={(e) => setDragValue(Number(e.target.value))}
        onPointerUp={commit}
        onTouchEnd={commit}
        onKeyUp={commit}
        className={`slider w-full cursor-pointer transition-all ${isScrubbing ? "h-2.5" : "h-1.5"}`}
        style={{ "--fill": `${pct}%`, "--buffered": `${bufPct}%` } as CSSProperties}
      />
      <div className="flex items-center justify-between text-[11.5px] font-medium text-white/50 px-0.5 tabular-nums">
        <span>{fmtTime(shown)}</span>
        <span>{fmtTime(duration)}</span>
      </div>
    </div>
  );
}

/* ================================================================ the view */

export function NowPlaying() {
  const open = useUI((s) => s.nowPlayingOpen);
  const close = useUI((s) => s.toggleNowPlaying);

  /**
   * Fullscreen transition state machine — enter/exit choreography without
   * touching layout or functionality:
   * - open → mount and replay the entrance (fresh mounts animate on their
   *   own); reopening mid-exit cancels the exit timer and snaps back with
   *   no remount, so rapid toggling never storms effects or media.
   * - close intent → play the 210ms exit on the still-mounted overlay while
   *   the OS leaves fullscreen underneath, then unmount. One timer, no
   *   stacking, always cleaned up.
   * - reduced motion → no exit delay at all, mount/unmount instantly.
   */
  const [mounted, setMounted] = useState(open);
  const [exiting, setExiting] = useState(false);
  const mountedRef = useRef(open);
  const exitTimer = useRef<number | null>(null);
  /** True when THIS view put the window into fullscreen — an F11 fullscreen
      the user already had must survive closing the view. */
  const enteredFsRef = useRef(false);
  useEffect(() => {
    if (open) {
      // Reopening mid-exit: cancel the exit and snap back — no remount, so
      // rapid toggling never storms effects or media. A fresh mount needs
      // nothing: newly inserted nodes play the entrance on their own.
      if (exitTimer.current !== null) {
        window.clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
      mountedRef.current = true;
      setMounted(true);
      setExiting(false);
      enteredFsRef.current = !useUI.getState().osFullscreen;
      void window.bytune?.setFullScreen(true);
      return undefined;
    }
    if (!mountedRef.current) return undefined;
    // OS leaves fullscreen in parallel with the fade — but only when this
    // view entered it; an F11 fullscreen predating the view stays.
    if (enteredFsRef.current) {
      enteredFsRef.current = false;
      void window.bytune?.setFullScreen(false);
    }
    if (
      document.documentElement.classList.contains("reduce-motion") ||
      (typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    ) {
      mountedRef.current = false;
      setMounted(false);
      return undefined;
    }
    setExiting(true);
    exitTimer.current = window.setTimeout(() => {
      exitTimer.current = null;
      mountedRef.current = false;
      setMounted(false);
      setExiting(false);
    }, 210);
    return () => {
      if (exitTimer.current !== null) {
        window.clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
    };
  }, [open]);

  const track = usePlayer((s) => s.queue[s.index] ?? null);
  const playing = usePlayer((s) => s.playing);

  const liked = useLibrary((s) => (track ? s.liked.some((t) => t.id === track.id) : false));
  const toggleLike = useLibrary((s) => s.toggleLike);

  const dl = useLibrary((s) => (track ? s.downloads[track.id] : undefined));
  const isDlDone = dl?.status === "done";
  const isDlActive = dl?.status === "downloading" || dl?.status === "queued";

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!track) return;
    if (isDlDone) {
      if (isAndroid) {
        useLibrary.getState().removeDownload(track.id);
        void window.bytune?.cancelDownload(track.id);
        useUI.getState().toast("Removed from downloads");
      } else {
        useUI.getState().toast("Song already downloaded", "info");
      }
    } else if (isDlActive) {
      cancelDownload(track.id);
      useUI.getState().toast("Download cancelled");
    } else {
      void startDownload(track);
      useUI.getState().toast("Downloading for offline listening…", "info");
    }
  };

  // Appearance switches that shape this view: full-bleed art strengthens the
  // room's artwork presence (the atmosphere is always artwork-driven now),
  // legacy mesh drops the blurred-cover layer, animated canvas swaps the
  // sleeve for its looping video when one exists.
  const boost = useSettings((st) => st.fullBleedArtwork);
  const legacyMesh = useSettings((st) => st.legacyMeshGradient);
  const animatedCanvas = useSettings((st) => st.animatedCanvas);
  const canvasUrl = useCanvas(track ?? null);
  const canvasVideoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = canvasVideoRef.current;
    if (!v) return;
    if (playing) void v.play().catch(() => undefined);
    else v.pause();
  }, [playing, canvasUrl]);

  const palette: ArtworkPalette = useArtworkPalette(track?.thumb ?? null);

  // Lyrics — the same cached lookup the centre-pane lyrics view uses (warmed
  // by prefetchLyrics the moment a track starts), plus the same audio-anchored
  // alignment check. No second lyrics pipeline.
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
      // Version-mismatch check — the same audio-anchored alignment the
      // centre lyrics use, so both agree on the timeline.
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

  // 0 until the audio-anchored alignment lands, then lyrics re-sync to it.
  const lyricsOffset = useLyricsAlign((s) => s.offsets[track?.id ?? ""] ?? 0);

  const [mode, setMode] = useState<"lyrics" | "queue">("lyrics");

  // The live lyric line rests at the album cover's centre height. The panel
  // is measured against the artwork tile (boxes move with the viewport and
  // with maximize/restore), so the anchor is a fraction re-derived whenever
  // either box changes. The artwork row's entrance animation settles inside
  // the first ~400ms, hence the two timed re-measures.
  const artRef = useRef<HTMLDivElement | null>(null);
  const lyricsPanelRef = useRef<HTMLDivElement | null>(null);
  const [lyricsAnchor, setLyricsAnchor] = useState(0.5);
  useEffect(() => {
    if (mode !== "lyrics" || !open) return;
    const measure = (): void => {
      const art = artRef.current;
      const panel = lyricsPanelRef.current;
      if (!art || !panel) return;
      const a = art.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      if (p.height < 40) return;
      const fraction = (a.top + a.height / 2 - p.top) / p.height;
      const next = Math.min(0.6, Math.max(0.08, fraction));
      setLyricsAnchor((prev) => (Math.abs(prev - next) > 0.002 ? next : prev));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (artRef.current) ro.observe(artRef.current);
    if (lyricsPanelRef.current) ro.observe(lyricsPanelRef.current);
    window.addEventListener("resize", measure);
    const settles = [60, 400].map((ms) => window.setTimeout(measure, ms));
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      settles.forEach((t) => window.clearTimeout(t));
    };
  }, [mode, open, track?.id]);

  // Spotify's entry hint: "To exit full screen, press Esc" — fades in with the
  // view, lingers ~3s, fades back out.
  const [escToastShown, setEscToastShown] = useState(false);
  useEffect(() => {
    if (!open) return;
    setEscToastShown(true);
    const t = window.setTimeout(() => setEscToastShown(false), 3000);
    return () => window.clearTimeout(t);
  }, [open]);

  const heroDrag = useDrag({ track: track ?? { id: "", title: "", artist: "", duration: 0, thumb: "" } });

  const isMobile = useIsMobile();
  const buffering = usePlayer((s) => s.buffering);
  const toggle = usePlayer((s) => s.toggle);
  const prev = usePlayer((s) => s.prev);
  const next = usePlayer((s) => s.next);
  const shuffle = usePlayer((s) => s.shuffle);
  const toggleShuffle = usePlayer((s) => s.toggleShuffle);
  const repeat = usePlayer((s) => s.repeat);
  const cycleRepeat = usePlayer((s) => s.cycleRepeat);

  const [mobileSheet, setMobileSheet] = useState<"queue" | null>(null);
  const [showSleepTimer, setShowSleepTimer] = useState(false);
  const timerActive = useSleepTimer((s) => s.active);
  const timerSeconds = useSleepTimer((s) => s.secondsRemaining);
  const timerMode = useSleepTimer((s) => s.mode);
  const setTimer = useSleepTimer((s) => s.setTimer);
  const setEndOfTrack = useSleepTimer((s) => s.setEndOfTrack);
  const cancelTimer = useSleepTimer((s) => s.cancelTimer);

  // Lyrics take the artwork's place in one column (Apple-style), with the same
  // LyricsView `hero` treatment the desktop fullscreen panel uses — same type
  // scale, glow, blur depth and auto-scroll. Not a second implementation.
  const [mobileLyrics, setMobileLyrics] = useState(false);

  useEffect(() => {
    (window as any).__bytuneCloseMobileSheet = (): boolean => {
      if (showSleepTimer) {
        setShowSleepTimer(false);
        return true;
      }
      if (mobileLyrics) {
        setMobileLyrics(false);
        return true;
      }
      if (mobileSheet) {
        setMobileSheet(null);
        return true;
      }
      if (open) {
        close();
        return true;
      }
      return false;
    };
    return () => {
      delete (window as any).__bytuneCloseMobileSheet;
    };
  }, [mobileSheet, mobileLyrics, showSleepTimer, open, close]);

  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const touchStartY = useRef(0);
  const touchStartTime = useRef(0);

  const [artDragX, setArtDragX] = useState(0);
  const artTouchStartX = useRef(0);
  const artTouchStartY = useRef(0);
  const isArtSwiping = useRef(false);

  const handleArtTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    artTouchStartX.current = e.touches[0].clientX;
    artTouchStartY.current = e.touches[0].clientY;
    isArtSwiping.current = false;
  };

  const handleArtTouchMove = (e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - artTouchStartX.current;
    const dy = e.touches[0].clientY - artTouchStartY.current;
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
      isArtSwiping.current = true;
      setArtDragX(dx);
    }
  };

  const handleArtTouchEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (isArtSwiping.current) {
      if (artDragX < -45) {
        next(true);
      } else if (artDragX > 45) {
        prev();
      }
    }
    setArtDragX(0);
    isArtSwiping.current = false;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, button, [role="button"], .mobile-sheet')) return;
    touchStartY.current = e.touches[0].clientY;
    touchStartTime.current = Date.now();
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - touchStartY.current;
    if (deltaY > 0) {
      setDragY(deltaY);
    } else {
      setDragY(0);
    }
  };

  const handleTouchEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    const elapsed = Date.now() - touchStartTime.current;
    const velocity = dragY / (elapsed || 1);
    if (dragY > 80 || (dragY > 25 && velocity > 0.4)) {
      close();
    }
    setDragY(0);
  };

  // Entrance, decided once per opening (layout effect so the choice lands
  // before the first painted frame):
  // - "flip": on mobile with the mini-player pill on screen, the overlay
  //   morphs from the pill's rect via WAAPI (transform/opacity only) — the
  //   Apple Music hero morph, reusing the pill's own geometry.
  // - "slide": everywhere else, the CSS slide-up (translateY 100% -> 0).
  // - "fade": reduced motion — a plain fade, no travel at all.
  // If any measurement fails, the FLIP effect below simply does nothing and
  // the overlay opens at identity — never a half-morphed frame.
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [enterMode, setEnterMode] = useState<"flip" | "slide" | "fade">("slide");
  const prevOpenRef = useRef(open);
  useLayoutEffect(() => {
    if (open && !prevOpenRef.current) {
      const reduced =
        document.documentElement.classList.contains("reduce-motion") ||
        (typeof window.matchMedia === "function" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      const pill = document.querySelector(".mobile-player");
      setEnterMode(reduced ? "fade" : pill && isMobile ? "flip" : "slide");
    }
    prevOpenRef.current = open;
  }, [open, isMobile]);

  useLayoutEffect(() => {
    if (!mounted || enterMode !== "flip" || exiting) return;
    const root = overlayRef.current;
    const pill = document.querySelector(".mobile-player");
    if (!root || !pill) return;
    const r = pill.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (r.width < 8 || r.height < 8 || vw === 0 || vh === 0) return;
    const anim = root.animate(
      [
        {
          transform: `translate(${r.left}px, ${r.top}px) scale(${r.width / vw}, ${r.height / vh})`,
          transformOrigin: "top left",
          opacity: 0.6,
        },
        { transform: "translate(0px, 0px) scale(1, 1)", transformOrigin: "top left", opacity: 1 },
      ],
      { duration: 420, easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "both" }
    );
    // Release the animation once it finishes so the swipe-down drag (inline
    // transform) owns the element again; cancelling returns it to identity.
    void anim.finished.then(() => anim.cancel()).catch(() => undefined);
    return () => anim.cancel();
  }, [mounted, enterMode, exiting]);

  if (!mounted) return null;

  return (
    <div
      ref={overlayRef}
      className={`fixed inset-0 z-[100] overflow-hidden bg-black select-none ${
        exiting ? "fs-exiting" : enterMode === "slide" ? "np-enter" : enterMode === "fade" ? "animate-fade-in" : ""
      }`}
      style={{
        transform: isMobile && dragY > 0 ? `translate3d(0, ${dragY}px, 0) scale(${Math.max(0.86, 1 - dragY * 0.0006)})` : undefined,
        transformOrigin: "center top",
        borderRadius: isMobile && dragY > 0 ? `${Math.min(32, 12 + dragY * 0.08)}px` : undefined,
        transition: isDragging ? "none" : "transform 240ms cubic-bezier(0.2, 0.9, 0.3, 1), border-radius 240ms ease",
      }}
    >
      <FsBackdrop artwork={track?.thumb ?? null} boost={boost} legacy={legacyMesh} playing={playing} />

      {isMobile ? (
        <div
          className="relative h-full flex flex-col justify-between px-6 pt-3 pb-8"
          style={{
            paddingTop: "max(12px, env(safe-area-inset-top))",
            paddingBottom: "max(24px, env(safe-area-inset-bottom))",
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Header & Grabber */}
          <div className="shrink-0 flex flex-col items-center">
            <div className="w-10 h-1 rounded-full bg-white/20 mb-2" aria-hidden />
            <div className="w-full flex items-center justify-between">
              <button
                onClick={close}
                title="Close"
                aria-label="Close Now Playing"
                className="p-2 -ml-2 rounded-full text-white/70 hover:text-white transition-colors"
              >
                <ChevronDown className="w-6 h-6" />
              </button>
              <span className="text-[11px] font-bold tracking-widest text-white/50 uppercase">
                {mobileLyrics ? "Lyrics" : "Now Playing"}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowSleepTimer(true)}
                  aria-label="Sleep timer"
                  title="Sleep timer"
                  className={`p-2 rounded-full transition-colors ${
                    timerActive ? "text-primary" : "text-white/70 hover:text-white"
                  }`}
                >
                  <Timer className="w-5 h-5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (track) useUI.getState().openContextMenu(e.clientX, e.clientY, trackMenuItems(track));
                  }}
                  aria-label="More options"
                  className="p-2 -mr-2 rounded-full text-white/70 hover:text-white transition-colors"
                >
                  <MoreVertical className="w-6 h-6" />
                </button>
              </div>
            </div>
          </div>

          {!track ? (
            <div className="flex-1 grid place-items-center">
              <div className="text-center">
                <div className="w-16 h-16 rounded-[18px] glass grid place-items-center mx-auto mb-5">
                  <Music2 className="w-7 h-7 text-white/55" />
                </div>
                <p className="text-sm text-white/85">Nothing playing yet</p>
                <p className="text-[13px] text-white/55 mt-1">Play something and it will show up here.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Hero Artwork — or the lyrics, in its place */}
              {mobileLyrics ? (
                <div
                  className="flex-1 min-h-0 flex py-2"
                  onTouchStart={(e) => e.stopPropagation()}
                >
                  <LyricsView
                    key={track.id}
                    trackKey={track.id}
                    lyrics={lyrics}
                    loading={lyricsLoading}
                    hero
                    offset={lyricsOffset}
                  />
                </div>
              ) : (
              <div
                className="flex-1 min-h-0 flex items-center justify-center my-2 select-none"
                onTouchStart={handleArtTouchStart}
                onTouchMove={handleArtTouchMove}
                onTouchEnd={handleArtTouchEnd}
                style={{
                  transform: artDragX !== 0 ? `translateX(${artDragX * 0.55}px) rotate(${artDragX * 0.02}deg)` : undefined,
                  transition: artDragX === 0 ? "transform 280ms cubic-bezier(0.2, 0.9, 0.3, 1)" : "none",
                }}
              >
                <div className={`fs-art-wrap ${playing ? "is-playing fs-art-breathe" : "is-paused"}`}>
                  <div
                    className="relative rounded-[28px] overflow-hidden aspect-square w-[min(72vw,300px,35vh)] grid place-items-center bg-white/[0.04] transition-all duration-300"
                    style={{
                      boxShadow: `inset 0 1.25px 1px 0 rgba(255, 255, 255, 0.40), inset 0 -0.5px 1px rgba(0, 0, 0, 0.30), 0 24px 50px -12px rgba(0,0,0,0.7), 0 10px 30px -8px rgb(${palette.accent} / 0.45)`,
                    }}
                  >
                    {canvasUrl && animatedCanvas ? (
                      <>
                        <img src={upgradeArtwork(track.thumb, 1200)} alt="" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
                        <video
                          key={canvasUrl}
                          ref={canvasVideoRef}
                          src={canvasUrl}
                          autoPlay
                          loop
                          muted
                          playsInline
                          className="relative w-full h-full object-cover animate-fade-in"
                        />
                      </>
                    ) : track.thumb ? (
                      <img
                        key={track.id}
                        src={upgradeArtwork(track.thumb, 1200)}
                        alt="" decoding="async"
                        className="w-full h-full object-cover animate-art-in"
                      />
                    ) : (
                      <Music2 className="w-16 h-16 text-white/35" />
                    )}
                  </div>
                </div>
              </div>
              )}

              {/* Track Info & Like / Download */}
              <div className="shrink-0 flex items-center justify-between gap-3 mb-3">
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[20px] font-bold tracking-tight text-white truncate" title={track.title}>
                    {track.title}
                  </div>
                  <div className="text-[13.5px] text-white/60 truncate mt-0.5" title={track.artist}>
                    {track.artist}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {timerActive && (
                      <button
                        onClick={() => setShowSleepTimer(true)}
                        title="Sleep timer active"
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[5px] bg-primary/20 text-primary active:scale-95 transition-all text-[10px] font-bold tracking-wide"
                      >
                        <Timer className="w-2.5 h-2.5 animate-pulse" />
                        <span>{timerMode === "end-of-track" ? "Track end" : `${Math.ceil(timerSeconds / 60)}m`}</span>
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={handleDownload}
                    aria-label={
                      isDlDone
                        ? "Downloaded for offline playback (tap to remove)"
                        : isDlActive
                        ? "Downloading..."
                        : "Download song for offline listening"
                    }
                    title={isDlDone ? "Downloaded" : isDlActive ? "Downloading..." : "Download"}
                    className={`p-2 rounded-full transition-all active:scale-90 ${
                      isDlDone
                        ? "text-primary"
                        : isDlActive
                        ? "text-primary"
                        : "text-white/70 hover:text-white"
                    }`}
                  >
                    {isDlActive ? (
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    ) : isDlDone ? (
                      <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center">
                        <Check className="w-4 h-4 stroke-[3]" />
                      </div>
                    ) : (
                      <Download className="w-6 h-6" />
                    )}
                  </button>

                  <button
                    onClick={() => {
                      toggleLike(track);
                      haptic("success");
                    }}
                    aria-label={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
                    aria-pressed={liked}
                    className="p-2 -mr-1 rounded-full text-white/70 hover:text-white transition-all active:scale-90"
                  >
                    <Heart className={`w-6 h-6 ${liked ? "fill-primary text-primary animate-heart-pop" : ""}`} />
                  </button>
                </div>
              </div>

              {/* Seek Bar */}
              <div className="shrink-0 mb-3" onTouchStart={(e) => e.stopPropagation()}>
                <MobileSeekBar />
              </div>

              {/* Transport Controls */}
              <div className="shrink-0 flex items-center justify-between px-2 mb-3">
                <MobileTransportButton
                  onClick={toggleShuffle}
                  active={shuffle}
                  title={shuffle ? "Disable Shuffle" : "Enable Shuffle"}
                >
                  <SpShuffle className="w-5 h-5" />
                </MobileTransportButton>

                <button
                  onClick={() => prev()}
                  aria-label="Previous"
                  className="p-2 text-white/80 hover:text-white active:scale-95 transition-transform"
                >
                  <SpPrev className="w-6 h-6" />
                </button>

                <button
                  onClick={() => {
                    toggle();
                    haptic("light");
                  }}
                  aria-label={playing ? "Pause" : "Play"}
                  className="grid h-16 w-16 place-items-center rounded-full bg-white text-black active:scale-95 transition-transform shadow-lg"
                >
                  {buffering ? (
                    <Loader2 className="w-7 h-7 animate-spin" />
                  ) : playing ? (
                    <SpPause className="w-7 h-7" />
                  ) : (
                    <SpPlay className="w-7 h-7 translate-x-[1px]" />
                  )}
                </button>

                <button
                  onClick={() => next(true)}
                  aria-label="Next"
                  className="p-2 text-white/80 hover:text-white active:scale-95 transition-transform"
                >
                  <SpNext className="w-6 h-6" />
                </button>

                <MobileTransportButton
                  onClick={cycleRepeat}
                  active={repeat !== "off"}
                  title={repeat === "off" ? "Enable repeat" : repeat === "all" ? "Disable repeat" : "Enable repeat one"}
                >
                  {repeat === "one" ? <SpRepeatOne className="w-5 h-5" /> : <SpRepeat className="w-5 h-5" />}
                </MobileTransportButton>
              </div>

              {/* Actions Row */}
              <div className="shrink-0 flex items-center justify-between px-3 text-white/60">
                <button
                  onClick={() => setMobileLyrics((v) => !v)}
                  aria-pressed={mobileLyrics}
                  className={`flex items-center gap-1.5 p-2 rounded-lg transition-colors ${
                    mobileLyrics ? "text-white" : "text-white/60 hover:text-white"
                  }`}
                  aria-label={mobileLyrics ? "Hide lyrics" : "Show lyrics"}
                >
                  <SpLyrics className="w-5 h-5" />
                  <span className="text-[12px] font-semibold">Lyrics</span>
                </button>
                <button
                  onClick={() => setMobileSheet("queue")}
                  className="flex items-center gap-1.5 p-2 rounded-lg hover:text-white transition-colors"
                  aria-label="Show queue"
                >
                  <SpQueue className="w-5 h-5" />
                  <span className="text-[12px] font-semibold">Queue</span>
                </button>
              </div>
            </>
          )}

          {/* Queue sheet (lyrics are a full-screen swap above, not a sheet) */}
          {mobileSheet === "queue" && (
            <MobileSheet onClose={() => setMobileSheet(null)} label="Queue">
              <MobileQueue onClose={() => setMobileSheet(null)} />
            </MobileSheet>
          )}

          {/* Apple Music Sleep Timer Sheet */}
          {showSleepTimer && (
            <MobileSheet onClose={() => setShowSleepTimer(false)} label="Sleep timer">
              <div className="pt-2.5 pb-1 flex justify-center" data-sheet-grabber>
                <span className="block h-1 w-10 rounded-full bg-white/20" aria-hidden />
              </div>
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center">
                      <Timer className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-[17px] font-bold text-white">Sleep Timer</h3>
                      <p className="text-[12px] text-white/50">Stop audio playback smoothly</p>
                    </div>
                  </div>
                  {timerActive && (
                    <span className="text-[12px] font-semibold text-primary px-2.5 py-1 rounded-full bg-primary/15">
                      {timerMode === "end-of-track" ? "End of track" : `${Math.ceil(timerSeconds / 60)}m left`}
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 pt-1">
                  {[15, 30, 45, 60].map((mins) => (
                    <button
                      key={mins}
                      onClick={() => {
                        setTimer(mins);
                        setShowSleepTimer(false);
                      }}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.10] active:scale-[0.98] transition-all text-[14.5px] font-medium text-white"
                    >
                      <span>{mins} minutes</span>
                      {timerActive && timerSeconds > 0 && Math.abs(timerSeconds / 60 - mins) < 0.5 && (
                        <Check className="w-4 h-4 text-primary" />
                      )}
                    </button>
                  ))}

                  <button
                    onClick={() => {
                      setEndOfTrack();
                      setShowSleepTimer(false);
                    }}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.10] active:scale-[0.98] transition-all text-[14.5px] font-medium text-white"
                  >
                    <span>When Current Song Ends</span>
                    {timerActive && timerMode === "end-of-track" && (
                      <Check className="w-4 h-4 text-primary" />
                    )}
                  </button>

                  {timerActive && (
                    <button
                      onClick={() => {
                        cancelTimer();
                        setShowSleepTimer(false);
                      }}
                      className="w-full mt-3 px-4 py-3 rounded-xl bg-red-500/15 text-red-400 hover:bg-red-500/25 active:scale-[0.98] transition-all text-[14.5px] font-semibold text-center"
                    >
                      Turn Off Sleep Timer
                    </button>
                  )}
                </div>
              </div>
            </MobileSheet>
          )}

        </div>
      ) : (
        <div className="relative h-full flex flex-col">
          {/* Fullscreen entry hint — Spotify's "To exit full screen, press Esc".
              Parked inside the header band so it never covers the mode switch
              that sits at the top of the lyrics column. */}
          <div
            aria-live="polite"
            className={`absolute left-1/2 top-2 z-30 -translate-x-1/2 pointer-events-none transition-all duration-300 ${
              escToastShown ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-3"
            }`}
          >
            <div className="flex items-center gap-2.5 rounded-xl bg-[#1c1c1e]/95 px-4 py-3 shadow-float glass-chip">
              <span className="text-[14.5px] text-white">To exit full screen, press</span>
              <kbd className="grid h-7 min-w-[36px] place-items-center rounded-[6px] bg-white/15 px-2 text-[13px] font-semibold text-white">
                Esc
              </kbd>
            </div>
          </div>

          {/* Header — close (mobile: the iOS sheet-grabber). */}
          <div className="relative h-14 shrink-0 flex items-center justify-between px-4">
            <button
              onClick={close}
              title="Close (Esc)"
              aria-label="Close Now Playing"
              className="relative z-10 p-2 -ml-1 rounded-full text-white/75 hover:text-white hover:bg-white/[0.08] transition-colors"
            >
              <ChevronDown className="w-5 h-5" />
            </button>
            <button
              onClick={() => {
                useUI.getState().openDialog({
                  title: "Sleep Timer",
                  body: timerActive
                    ? `Sleep timer is currently active (${timerMode === "end-of-track" ? "End of track" : Math.ceil(timerSeconds / 60) + " min left"}). Turn off?`
                    : "Set sleep timer for 30 minutes to smoothly stop playback:",
                  confirmLabel: timerActive ? "Turn Off" : "Set 30 min",
                  cancelLabel: "Cancel",
                  onConfirm: () => {
                    if (timerActive) cancelTimer();
                    else setTimer(30);
                  },
                });
              }}
              title="Sleep timer"
              className={`relative z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors ${
                timerActive ? "bg-primary/20 text-primary" : "text-white/60 hover:text-white hover:bg-white/[0.08]"
              }`}
            >
              <Timer className="w-4 h-4" />
              <span>{timerActive ? (timerMode === "end-of-track" ? "Track end" : `${Math.ceil(timerSeconds / 60)}m`) : "Sleep Timer"}</span>
            </button>
          </div>

          {!track ? (
            <div className="flex-1 grid place-items-center">
              <div className="text-center">
                <div className="w-16 h-16 rounded-[18px] glass grid place-items-center mx-auto mb-5">
                  <Music2 className="w-7 h-7 text-white/55" />
                </div>
                <p className="text-sm text-white/85">Nothing playing yet</p>
                <p className="text-[13px] text-white/55 mt-1">Play something and it will show up here.</p>
              </div>
            </div>
          ) : (
            /* Body — artwork column and lyrics column share the space between
               the header and the play bar. Percent-based widths + min() sizing,
               so the composition holds from 16:9 laptops to ultrawides. */
            <div className="flex-1 min-h-0 min-w-0 flex flex-col lg:flex-row items-stretch justify-center gap-8 lg:gap-12 xl:gap-20 px-8 lg:px-14 pb-4">
              {/* LEFT — the artwork is the hero; info and visualizer stay compact. */}
              <div className="flex-1 lg:flex-none lg:w-[44%] xl:w-[42%] max-w-[640px] min-w-0 min-h-0 flex flex-col items-center justify-center">
                <div className="relative w-full flex justify-center fs-enter">
                  {/* Ambient glow — the sleeve's own accent, spilling behind it. */}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 aspect-square w-[min(52vh,44vw,660px)] rounded-full"
                    style={{
                      background: `radial-gradient(50% 50% at 50% 52%, rgb(${palette.accent} / 0.13), transparent 70%)`,
                      filter: "blur(48px)",
                    }}
                  />
                  {/* Breathing scale lives on its own wrapper: the entrance
                      animation above and the pulse below never fight over the
                      same transform. Pausing removes the pulse and the wrapper's
                      transition settles the scale back instead of snapping. */}
                  <div className={`fs-art-wrap ${playing ? "is-playing fs-art-breathe" : "is-paused"}`}>
                    <div
                      ref={artRef}
                      {...heroDrag.props}
                      className={`relative rounded-3xl overflow-hidden aspect-square w-[min(38vh,32vw,480px)] grid place-items-center bg-white/[0.04] transition-all duration-300 ${
                        heroDrag.dragging ? "opacity-60" : ""
                      }`}
                      style={{
                        boxShadow: `0 24px 60px -12px rgba(0,0,0,0.7), 0 12px 30px -8px rgb(${palette.accent} / 0.35)`,
                      }}
                      title="Drag to a playlist to add this song"
                    >
                      {canvasUrl && animatedCanvas ? (
                        <>
                          {/* Still art underneath: if the video stalls, the cover stands. */}
                          <img src={upgradeArtwork(track.thumb, 1200)} alt="" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
                          <video
                            key={canvasUrl}
                            ref={canvasVideoRef}
                            src={canvasUrl}
                            autoPlay
                            loop
                            muted
                            playsInline
                            className="relative w-full h-full object-cover animate-fade-in"
                          />
                        </>
                      ) : track.thumb ? (
                        <img
                          key={track.id}
                          src={upgradeArtwork(track.thumb, 1200)}
                          alt="" decoding="async"
                          className="w-full h-full object-cover animate-art-in"
                        />
                      ) : (
                        <Music2 className="w-16 h-16 text-white/35" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Song information — keyed per track so a song change replays
                    the small fade instead of hard-swapping the words. */}
                <div
                  key={`fsmeta-${track.id}`}
                  className="mt-7 flex flex-col items-center text-center max-w-full animate-meta-in"
                >
                  <div
                    className="font-display text-[26px] xl:text-[30px] font-extrabold tracking-[-0.03em] text-white truncate max-w-full"
                    title={track.title}
                  >
                    {track.title}
                  </div>
                  <div className="text-[14px] xl:text-[15px] text-white/55 mt-1.5 truncate max-w-full">
                    {track.artist}
                  </div>
                  <div className="mt-4 inline-flex items-center gap-2.5">
                    <button
                      onClick={() => {
                        toggleLike(track);
                        haptic("success");
                      }}
                      title={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
                      aria-pressed={liked}
                      className="inline-flex items-center gap-2 h-8 px-4 rounded-full bg-white/[0.06] hover:bg-white/[0.11] text-white/60 hover:text-white text-[12.5px] font-semibold transition-all active:scale-95"
                    >
                      <Heart className={`w-3.5 h-3.5 shrink-0 ${liked ? "fill-current" : ""}`} />
                      {liked ? "In Your Library" : "Add to Library"}
                    </button>
                    <button
                      onClick={handleDownload}
                      title={isDlDone ? "Downloaded" : isDlActive ? "Downloading..." : "Download song for offline listening"}
                      className="inline-flex items-center gap-2 h-8 px-4 rounded-full bg-white/[0.06] hover:bg-white/[0.11] text-white/60 hover:text-white text-[12.5px] font-semibold transition-all active:scale-95"
                    >
                      {isDlActive ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                      ) : isDlDone ? (
                        <Check className="w-3.5 h-3.5 text-primary stroke-[3]" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      {isDlDone ? "Downloaded" : isDlActive ? "Downloading…" : "Download"}
                    </button>
                  </div>
                </div>

                {/* Full-width row so the visualizer's percentage width resolves
                    against the column, not a fit-content wrapper — a fit-content
                    parent made the container resolve narrow and hug left. */}
                <div className="mt-7 w-full flex justify-center fs-enter fs-d2">
                  <FsVisualizer playing={playing} />
                </div>
              </div>

              {/* RIGHT — the mode switch over the existing lyrics / queue views. */}
              <div className="flex-1 min-w-0 min-h-0 max-w-[780px] flex flex-col py-1">
                <div className="shrink-0 flex justify-center lg:justify-start fs-enter fs-d1">
                  <FsModeSwitch mode={mode} onChange={setMode} />
                </div>
                <div className="flex-1 min-h-0 mt-5 flex flex-col">
                  {mode === "lyrics" ? (
                    <div ref={lyricsPanelRef} className="flex-1 min-h-0 flex">
                      <LyricsView
                        key={track.id}
                        trackKey={track.id}
                        lyrics={lyrics}
                        loading={lyricsLoading}
                        hero
                        anchor={lyricsAnchor}
                        offset={lyricsOffset}
                      />
                    </div>
                  ) : (
                    <Suspense fallback={<div className="flex-1" aria-hidden />}>
                      <QueuePanel onClose={() => setMode("lyrics")} />
                    </Suspense>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* The existing play bar — unchanged for desktop */}
          <div className="shrink-0">
            <Suspense fallback={<div aria-hidden />}>
              <PlayerBar />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
}
