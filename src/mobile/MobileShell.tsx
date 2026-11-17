/**
 * Mobile shell chrome — the same app, rearranged for one column.
 *
 * Desktop is three panes over a black canvas (sidebar · content · right rail).
 * A phone has one pane, so: a slim glass top bar, the content, a compact
 * player bar, and a five-tab bottom nav that carries the navigation the
 * sidebar holds on the desktop. Same tokens, same type scale, same artwork
 * tinting — only the arrangement changes.
 */
import { useEffect, useRef, useState } from "react";
import type { SearchSuggestion } from "../types";
import { ArrowUpLeft, Compass, History, Home, Library, Pause, Play, Search, SkipBack, SkipForward, X } from "lucide-react";
import { useLibrary } from "../stores/library";
import { usePlayer } from "../stores/player";
import { useRecents } from "../stores/recents";
import { useUI } from "../stores/ui";
import { upgradeArtwork } from "../lib/artwork";
import { haptic } from "../lib/haptics";
import { useSession } from "../lib/session";
import { ConnectivityBanner } from "./ConnectivityBanner";

const TABS = [
  { view: "home", label: "Home", Icon: Home },
  { view: "explore", label: "Explore", Icon: Compass },
  { view: "search", label: "Search", Icon: Search },
  { view: "library", label: "Library", Icon: Library },
] as const;

/** Bottom navigation. Library-family views (playlist/album/artist/local…)
 *  keep the Library tab lit, the way a native app does. */
export function MobileNav() {
  const view = useUI((s) => s.view);
  const navigate = useUI((s) => s.navigate);
  const lastSearchTapRef = useRef<number>(0);

  const active = (name: string): boolean => {
    if (view.name === name) return true;
    if (name === "library") {
      return ["library", "playlists", "playlist", "album", "artist", "ytplaylist", "local", "downloads"].includes(view.name);
    }
    return false;
  };

  const handleTabPress = (name: string) => {
    const now = Date.now();
    haptic("selection");
    if (name === "search") {
      if (view.name === "search" || now - lastSearchTapRef.current < 380) {
        window.dispatchEvent(new CustomEvent("bytune:focus-search"));
      }
      lastSearchTapRef.current = now;
    }
    navigate({ name: name as never });
  };

  const activeIdx = TABS.findIndex((t) => active(t.view));

  return (
    <>
      <ConnectivityBanner />
      <nav className="mobile-nav" aria-label="Main navigation">
      {/* Dynamic sliding liquid glass tab indicator */}
      {activeIdx >= 0 && (
        <div
          className="mobile-tab-indicator"
          style={{
            transform: `translateX(${activeIdx * 100}%)`,
            width: `calc(100% / ${TABS.length})`,
          }}
          aria-hidden
        />
      )}
      {TABS.map(({ view: name, label, Icon }) => {
        const on = active(name);
        return (
          // ONE handler per tab: the old pointerdown+click pair fired
          // handleTabPress twice per tap, so a single Search tap always
          // looked like a double-tap and opened the keyboard.
          <button
            key={name}
            onClick={() => handleTabPress(name)}
            className={`mobile-tab ${on ? "is-active" : ""}`}
            aria-current={on ? "page" : undefined}
          >
            <Icon className="h-[21px] w-[21px]" strokeWidth={on ? 2.4 : 1.9} />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
    </>
  );
}

/** Decoupled floating glass player bar: tap to open Now Playing, transport stops propagation. */
export function MobilePlayerBar() {
  const track = usePlayer((s) => s.queue[s.index] ?? null);
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const toggle = usePlayer((s) => s.toggle);
  const next = usePlayer((s) => s.next);
  const prev = usePlayer((s) => s.prev);
  const openNowPlaying = useUI((s) => s.toggleNowPlaying);

  const [dragX, setDragX] = useState(0);
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
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      isSwiping.current = true;
      setDragX(dx);
    }
  };

  const handleTouchEnd = () => {
    if (isSwiping.current) {
      if (dragX < -40) {
        next(true);
      } else if (dragX > 40) {
        prev();
      }
    }
    setDragX(0);
    setTimeout(() => {
      isSwiping.current = false;
    }, 50);
  };

  // Smooth progress: the store's position ticks at timeupdate rate (~4Hz),
  // which stepped the bar. A rAF loop interpolates between ticks by writing
  // the width straight to the span (no React re-render per frame), anchored
  // to the latest tick; pausing parks the bar on the last tick exactly.
  const progressRef = useRef<HTMLSpanElement | null>(null);
  const progressAnchor = useRef({ pos: 0, at: 0 });
  const trackId = track?.id ?? null;
  useEffect(() => {
    progressAnchor.current = { pos: position, at: performance.now() };
  }, [position, trackId]);
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  useEffect(() => {
    const el = progressRef.current;
    if (!el) return;
    if (!playing || duration <= 0) {
      el.style.width = `${pct}%`;
      return;
    }
    let raf = 0;
    const tick = (): void => {
      const p = Math.min(
        duration,
        progressAnchor.current.pos + (performance.now() - progressAnchor.current.at) / 1000
      );
      el.style.width = `${(p / duration) * 100}%`;
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [playing, duration, pct]);

  if (!track) return null;

  return (
    <div
      className="mobile-player"
      onClick={() => {
        if (isSwiping.current || Math.abs(dragX) > 5) return;
        openNowPlaying();
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        transform: dragX !== 0 ? `translateX(${dragX * 0.45}px)` : undefined,
        transition: dragX === 0 ? "transform 260ms cubic-bezier(0.2, 0.9, 0.3, 1)" : "none",
      }}
      role="button"
      tabIndex={0}
      aria-label={`Now playing: ${track.title} by ${track.artist}. Tap to open full player.`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openNowPlaying();
        }
      }}
    >
      <div className="mobile-player-progress" aria-hidden>
        <span ref={progressRef} style={{ width: `${pct}%` }} />
      </div>
      <div className="mobile-player-row">
        <div className="mobile-player-meta">
          {track.thumb ? (
            <span key={`art-${track.id}`} className="mobile-player-art art-hairline animate-art-in">
              <img src={upgradeArtwork(track.thumb, 128)} alt="" decoding="async" />
            </span>
          ) : null}
          <span key={`meta-${track.id}`} className="min-w-0 text-left animate-meta-in">
            <span className="mobile-player-title">{track.title}</span>
            <span className="mobile-player-artist">{track.artist}</span>
          </span>
        </div>
        <div className="mobile-player-controls" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => prev()} aria-label="Previous" className="hidden sm:grid">
            <SkipBack className="h-4 w-4" fill="currentColor" strokeWidth={0} />
          </button>
          <button
            onClick={() => {
              toggle();
              haptic("light");
            }}
            className="mobile-player-play"
            aria-label={playing ? "Pause" : "Play"}
          >
            {buffering ? (
              <span className="mobile-player-spinner" />
            ) : playing ? (
              <Pause className="h-4 w-4" fill="currentColor" strokeWidth={0} />
            ) : (
              <Play className="h-4 w-4 translate-x-[1px]" fill="currentColor" strokeWidth={0} />
            )}
          </button>
          <button onClick={() => next(true)} aria-label="Next">
            <SkipForward className="h-4 w-4" fill="currentColor" strokeWidth={0} />
          </button>
        </div>
      </div>
    </div>
  );
}

const ROOT_TABS = new Set(["home", "explore", "search", "library"]);

/** Glass back button & header for inner views. Root tabs never show a back button. */
export function MobileTopBar() {
  const view = useUI((s) => s.view);
  const goBack = useUI((s) => s.goBack);
  const navPast = useUI((s) => s.navPast);
  const canGoBack = navPast.length > 0 && !ROOT_TABS.has(view.name);

  if (!canGoBack) return null;

  const isHeroPage =
    view.name === "album" ||
    view.name === "artist" ||
    view.name === "playlist" ||
    view.name === "ytplaylist";

  const title =
    view.name === "settings"
      ? "Settings"
      : view.name === "replay"
      ? "Replay"
      : view.name === "downloads"
      ? "Downloads"
      : view.name === "local"
      ? "Local Music"
      : "";

  if (isHeroPage) {
    return (
      <div className="mobile-topbar-floating">
        <button
          onClick={() => goBack()}
          className="mobile-floating-back glass-btn"
          aria-label="Go back"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="mobile-subview-bar">
      <button
        onClick={() => goBack()}
        className="mobile-floating-back glass-btn shrink-0"
        aria-label="Go back"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {title && (
        <span className="font-display font-bold text-[17px] text-ink-hi truncate ml-3 flex-1">
          {title}
        </span>
      )}
      <div className="w-10 shrink-0" />
    </div>
  );
}

/** The desktop keeps its search field in the top bar, which a phone doesn't
 *  show — so the Search view gets its own field, pinned above the results. */
export function MobileSearchField() {
  const query = useUI((s) => s.searchQuery);
  const setQuery = useUI((s) => s.setSearchQuery);
  const navigate = useUI((s) => s.navigate);
  const [text, setText] = useState(query);
  const [suggests, setSuggests] = useState<SearchSuggestion[]>([]);
  const [focused, setFocused] = useState(false);
  const suggestSeq = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const recents = useRecents((s) => s.searches);
  const removeSearch = useRecents((s) => s.removeSearch);
  const clearSearches = useRecents((s) => s.clearSearches);

  useEffect(() => setText(query), [query]);

  useEffect(() => {
    const handleFocusSearch = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
      setFocused(true);
    };
    window.addEventListener("bytune:focus-search", handleFocusSearch);
    return () => window.removeEventListener("bytune:focus-search", handleFocusSearch);
  }, []);

  useEffect(() => {
    const q = text.trim();
    if (!focused || q.length < 2) {
      setSuggests([]);
      return;
    }
    const seq = ++suggestSeq.current;
    const timer = window.setTimeout(() => {
      window.bytune
        ?.suggestions(q)
        .then((res) => {
          if (suggestSeq.current !== seq) return;
          const items = ((res?.items ?? []) as SearchSuggestion[]).filter(
            (s) => s.text.trim().toLowerCase() !== q.toLowerCase()
          );
          setSuggests(items.slice(0, 10));
        })
        .catch(() => undefined);
    }, 140);
    return () => window.clearTimeout(timer);
  }, [text, focused]);

  const run = (value: string): void => {
    const t = value.trim();
    if (!t) return;
    setFocused(false);
    setQuery(t);
    navigate({ name: "search" });
    inputRef.current?.blur();
  };

  const cancel = (): void => {
    setFocused(false);
    inputRef.current?.blur();
  };

  const showOverlay = focused;

  return (
    <div className="relative z-40">
      <form
        className="mobile-search flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(text);
        }}
      >
        <div className="relative flex-1">
          <Search className="mobile-search-icon" aria-hidden />
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setFocused(true)}
            placeholder="Songs, albums, artists"
            aria-label="Search YouTube Music"
            enterKeyHint="search"
            inputMode="search"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {text.length > 0 && (
            <button
              type="button"
              className="mobile-search-clear"
              aria-label="Clear search"
              onClick={() => {
                setText("");
                setSuggests([]);
                inputRef.current?.focus();
              }}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {focused && (
          <button
            type="button"
            onClick={cancel}
            className="px-2 text-[14px] font-semibold text-accent active:opacity-70 transition-opacity"
          >
            Cancel
          </button>
        )}
      </form>

      {/* Full-bleed search suggestions / recents takeover (Apple Music / Spotify UX) */}
      {showOverlay && (
        <div
          className="fixed inset-x-0 bottom-0 z-50 bg-[#0f0f11] overflow-y-auto overscroll-contain px-3 pt-2 pb-24 animate-fade-in"
          style={{ top: "calc(max(env(safe-area-inset-top, 0px), 24px) + 70px)" }}
          role="listbox"
          aria-label="Search suggestions"
        >
          {text.trim().length >= 2 ? (
            <div>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(text)}
                className="w-full flex items-center gap-3.5 px-3 h-12 rounded-xl text-left active:bg-white/[0.08] transition-colors"
              >
                <Search className="w-4 h-4 text-accent shrink-0" />
                <span className="text-[15px] font-semibold text-ink-hi truncate">
                  Search “{text.trim()}”
                </span>
              </button>

              {(() => {
                // Suggestion texts can repeat (same text, different kinds),
                // so keys carry an occurrence number per text.
                const occurrence = new Map<string, number>();
                return suggests.map((s) => {
                  const n = occurrence.get(s.text) ?? 0;
                  occurrence.set(s.text, n + 1);
                  const key = n === 0 ? s.text : `${s.text}#${n}`;
                  return (
                    <div
                      key={key}
                      className="w-full flex items-center justify-between gap-2 px-3 h-12 rounded-xl transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setText(s.text);
                          run(s.text);
                        }}
                        className="flex items-center gap-3.5 min-w-0 flex-1 h-full text-left rounded-xl active:bg-white/[0.08] transition-colors"
                      >
                        <Search className="w-4 h-4 text-ink-dim shrink-0" />
                        <span className="min-w-0 flex-1 text-[15px] text-ink-hi truncate">{s.text}</span>
                      </button>
                      <button
                        type="button"
                        title="Insert search term"
                        aria-label={`Insert ${s.text} into search`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setText(s.text);
                          inputRef.current?.focus();
                        }}
                        className="p-2 text-ink-dim hover:text-ink-hi active:scale-90 transition-transform"
                      >
                        <ArrowUpLeft className="w-4 h-4" />
                      </button>
                    </div>
                  );
                });
              })()}
            </div>
          ) : (
            <div>
              {recents.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between px-3 py-2 text-[12px] font-semibold uppercase tracking-wider text-ink-dim">
                    <span>Recent Searches</span>
                    <button
                      onClick={clearSearches}
                      className="text-[12px] text-accent hover:underline font-normal"
                    >
                      Clear all
                    </button>
                  </div>
                  {recents.map((q) => (
                    <div
                      key={q}
                      className="w-full flex items-center justify-between gap-2 px-3 h-12 rounded-xl transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setText(q);
                          run(q);
                        }}
                        className="flex items-center gap-3.5 min-w-0 flex-1 h-full text-left rounded-xl active:bg-white/[0.08] transition-colors"
                      >
                        <History className="w-4 h-4 text-ink-dim shrink-0" />
                        <span className="min-w-0 flex-1 text-[15px] text-ink-hi truncate">{q}</span>
                      </button>
                      <button
                        type="button"
                        title="Remove"
                        aria-label={`Remove ${q} from recents`}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeSearch(q);
                        }}
                        className="p-2 text-ink-dim hover:text-ink-hi active:scale-90 transition-transform"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center text-ink-dim text-[14px]">
                  Search for songs, artists, albums or playlists
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Queue / details rail as a bottom sheet (the desktop shows it as a column).
 *  Dismissal animates out before the parent unmounts us — the close callback
 *  fires 200ms late on purpose, once the sheet is off screen.
 *
 *  Drag-to-dismiss reuses the NowPlaying touch-tracking + velocity pattern:
 *  a drag that starts on the grabber ([data-sheet-grabber] in the content)
 *  follows the finger, dismisses past 80px (or 25px with velocity > 0.4),
 *  and springs back otherwise. Content scrolling is untouched — only
 *  grabber touches ever start a drag. */
export function MobileSheet({
  children,
  onClose,
  label = "Panel",
}: {
  children: React.ReactNode;
  onClose: () => void;
  label?: string;
}) {
  const [closing, setClosing] = useState(false);
  const done = useRef(false);
  const closeTimer = useRef<number | null>(null);
  const close = () => {
    if (done.current) return;
    done.current = true;
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, 200);
  };
  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    []
  );

  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const touchStartY = useRef(0);
  const touchStartTime = useRef(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest("[data-sheet-grabber]")) return;
    touchStartY.current = e.touches[0].clientY;
    touchStartTime.current = Date.now();
    setIsDragging(true);
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const deltaY = e.touches[0].clientY - touchStartY.current;
    setDragY(Math.max(0, deltaY));
  };
  const handleTouchEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    const elapsed = Date.now() - touchStartTime.current;
    const velocity = dragY / (elapsed || 1);
    if (dragY > 80 || (dragY > 25 && velocity > 0.4)) {
      haptic("light");
      close();
      return;
    }
    setDragY(0);
  };

  return (
    <div className={`mobile-sheet-backdrop ${closing ? "is-closing" : ""}`} onClick={close} role="presentation">
      <div
        className={`mobile-sheet ${closing ? "is-closing" : ""} ${isDragging ? "is-dragging" : ""}`}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
          transition: isDragging ? "none" : "transform 240ms cubic-bezier(0.2, 0.9, 0.3, 1)",
        }}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        {children}
      </div>
    </div>
  );
}

/** Exported for the sheet's Library shortcut (kept out of the tab bar). */
export function useMobileLibraryCount(): number {
  return useLibrary((s) => s.liked.length + s.playlists.length);
}
