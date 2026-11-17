/**
 * MobileQueue — the touch-first queue surface for compact widths.
 *
 * Implements A-102:
 * - "Now playing" card with artwork and active EQ indicator
 * - "Next up" upcoming list
 * - Tap to jump to any track
 * - Remove item from queue
 * - Clear upcoming queue
 * - Touch drag-and-drop live reorder via pointer capture and moveInQueue
 * - Recently played tab
 */
import { useRef, useState } from "react";
import { ChevronDown, Infinity, Music2, Repeat, Repeat1, Shuffle, X } from "lucide-react";
import { EqBars } from "../components/primitives";
import { usePlayer } from "../stores/player";
import { useLibrary } from "../stores/library";
import { useSettings } from "../stores/settings";
import { upgradeArtwork } from "../lib/artwork";
import { fmtTime } from "../lib/format";
import type { Track } from "../types";

export function MobileQueue({ onClose }: { onClose?: () => void }) {
  const [tab, setTab] = useState<"queue" | "recent">("queue");
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const playing = usePlayer((s) => s.playing);
  const shuffle = usePlayer((s) => s.shuffle);
  const toggleShuffle = usePlayer((s) => s.toggleShuffle);
  const repeat = usePlayer((s) => s.repeat);
  const cycleRepeat = usePlayer((s) => s.cycleRepeat);
  const history = useLibrary((s) => s.history);
  const playTrack = usePlayer((s) => s.playTrack);
  const autoplay = useSettings((s) => s.autoplay);
  const setAutoplay = useSettings((s) => s.setAutoplay);

  const current = queue[index] ?? null;
  const upcoming = queue.slice(index + 1);

  const listRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ from: number } | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const wasDragging = useRef(false);

  const occurrence = new Map<string, number>();
  const stableKey = (id: string): string => {
    const n = occurrence.get(id) ?? 0;
    occurrence.set(id, n + 1);
    return `${id}#${n}`;
  };

  const findIndexUnder = (clientY: number): number => {
    const rows = listRef.current?.children;
    if (!rows || rows.length === 0) return -1;
    for (let i = 0; i < rows.length; i++) {
      const r = (rows[i] as HTMLElement).getBoundingClientRect();
      if (clientY < r.bottom) return i;
    }
    return rows.length - 1;
  };

  const onGripDown = (e: React.PointerEvent<HTMLDivElement>, qi: number): void => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { from: qi };
    wasDragging.current = false;
    setDragFrom(qi);
  };

  const onGripMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    wasDragging.current = true;
    const toUpcoming = findIndexUnder(e.clientY);
    if (toUpcoming >= 0) {
      const toQueue = index + 1 + toUpcoming;
      if (toQueue !== drag.current.from && toQueue >= index + 1 && toQueue < queue.length) {
        usePlayer.getState().moveInQueue(drag.current.from, toQueue);
        drag.current.from = toQueue;
        setDragFrom(toQueue);
      }
    }
  };

  const onGripUp = (): void => {
    drag.current = null;
    setDragFrom(null);
    setTimeout(() => { wasDragging.current = false; }, 150);
  };

  return (
    <div className="h-[75vh] flex flex-col">
      {/* Header with tabs and close */}
      <div className="h-14 shrink-0 flex items-center justify-between px-5 border-b border-white/[0.08]">
        <div className="flex items-center gap-5 h-full">
          <button
            onClick={() => setTab("queue")}
            aria-pressed={tab === "queue"}
            className={`relative h-full px-1 text-[14px] font-bold tracking-[-0.2px] transition-colors ${
              tab === "queue" ? "text-white" : "text-white/55 active:text-white"
            }`}
          >
            Queue
            <span
              className={`absolute left-0 right-0 bottom-0 h-[3px] rounded-full transition-opacity bg-white ${
                tab === "queue" ? "opacity-100" : "opacity-0"
              }`}
            />
          </button>
          <button
            onClick={() => setTab("recent")}
            aria-pressed={tab === "recent"}
            className={`relative h-full px-1 text-[14px] font-bold tracking-[-0.2px] transition-colors ${
              tab === "recent" ? "text-white" : "text-white/55 active:text-white"
            }`}
          >
            Recently played
            <span
              className={`absolute left-0 right-0 bottom-0 h-[3px] rounded-full transition-opacity bg-white ${
                tab === "recent" ? "opacity-100" : "opacity-0"
              }`}
            />
          </button>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close queue"
            className="p-1.5 -mr-1 rounded-full text-white/55 hover:text-white active:scale-95 transition-all"
          >
            <ChevronDown className="w-5 h-5" />
          </button>
        )}
      </div>

      {tab === "queue" ? (
        <div className="flex-1 min-h-0 flex flex-col p-4 overflow-hidden">
          {/* Now playing card */}
          <div className="shrink-0 flex items-center justify-between px-1 pb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-white/45">Now playing</span>
            {upcoming.length > 0 && (
              <button
                onClick={() => usePlayer.getState().clearUpcoming()}
                className="text-[12px] font-semibold text-white/60 active:text-white hover:text-white transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          {current ? (
            <div className="flex items-center gap-3 h-14 px-3 rounded-lg bg-white/[0.12] shrink-0 mb-3">
              <span className="w-10 h-10 shrink-0 rounded-md overflow-hidden bg-white/10">
                {current.thumb ? (
                  <img src={upgradeArtwork(current.thumb)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Music2 className="w-5 h-5 m-auto text-white/40" />
                )}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-semibold truncate text-white flex items-center gap-2">
                  <span className="truncate">{current.title}</span>
                  {playing && <EqBars />}
                </div>
                <div className="text-[11.5px] truncate text-white/55 mt-0.5">{current.artist}</div>
              </div>
            </div>
          ) : (
            <div className="py-6 text-center text-[13px] text-white/45">Nothing playing yet.</div>
          )}

          {/* Next up header with Apple Music Shuffle, Repeat, and Autoplay (∞) */}
          <div className="pt-2 pb-1.5 px-1 shrink-0 flex items-center justify-between">
            <h3 className="text-[15px] font-extrabold tracking-[-0.3px] text-white">Next up</h3>
            <div className="flex items-center gap-1.5">
              <button
                onClick={toggleShuffle}
                title={shuffle ? "Disable shuffle" : "Enable shuffle"}
                aria-pressed={shuffle}
                className={`p-1.5 rounded-full transition-all active:scale-90 ${
                  shuffle ? "text-primary bg-primary/15" : "text-white/45 hover:text-white"
                }`}
              >
                <Shuffle className="w-4 h-4" />
              </button>
              <button
                onClick={cycleRepeat}
                title={repeat === "off" ? "Repeat all" : repeat === "all" ? "Repeat one" : "Repeat off"}
                aria-pressed={repeat !== "off"}
                className={`p-1.5 rounded-full transition-all active:scale-90 ${
                  repeat !== "off" ? "text-primary bg-primary/15" : "text-white/45 hover:text-white"
                }`}
              >
                {repeat === "one" ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setAutoplay(!autoplay)}
                title={autoplay ? "Autoplay is on (endless music)" : "Turn on autoplay (endless music)"}
                aria-pressed={autoplay}
                className={`p-1.5 rounded-full transition-all active:scale-90 ${
                  autoplay ? "text-primary bg-primary/15" : "text-white/45 hover:text-white"
                }`}
              >
                <Infinity className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Upcoming list */}
          {upcoming.length === 0 ? (
            autoplay ? (
              <div className="py-8 text-center text-[13px] text-white/60 flex flex-col items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center">
                  <Infinity className="w-4 h-4 animate-pulse" />
                </div>
                <span>Autoplay is on. Similar songs will play next.</span>
              </div>
            ) : (
              <div className="py-8 text-center text-[13px] text-white/45">Your queue is empty.</div>
            )
          ) : (
            <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto scroll-host space-y-1 pr-1">
              {upcoming.map((t, i) => {
                const qi = index + 1 + i;
                const isDraggingThis = dragFrom === qi;
                return (
                  <div
                    key={stableKey(t.id)}
                    className={`flex items-center gap-3 h-12 px-2.5 rounded-lg select-none transition-colors cursor-pointer ${
                      isDraggingThis ? "bg-white/[0.16] shadow-md" : "bg-white/[0.04] hover:bg-white/[0.08]"
                    }`}
                    onClick={() => {
                      if (wasDragging.current || dragFrom !== null) return;
                      usePlayer.getState().playQueue(queue, qi);
                    }}
                  >
                    <span className="w-9 h-9 shrink-0 rounded-md overflow-hidden bg-white/5">
                      {t.thumb ? (
                        <img src={upgradeArtwork(t.thumb)} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Music2 className="w-4 h-4 m-auto text-white/30" />
                      )}
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
                    {/* Remove button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        usePlayer.getState().removeAt(qi);
                      }}
                      title="Remove from queue"
                      aria-label="Remove from queue"
                      className="p-1.5 shrink-0 rounded text-white/45 hover:text-red-400 active:text-red-400 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    {/* Reorder drag grip */}
                    <div
                      aria-label="Reorder"
                      title="Drag to reorder"
                      onClick={(e) => e.stopPropagation()}
                      className="flex-none touch-none p-1.5 -mr-1 cursor-grab active:cursor-grabbing text-white/50 hover:text-white transition-colors"
                      onPointerDown={(e) => onGripDown(e, qi)}
                      onPointerMove={onGripMove}
                      onPointerUp={onGripUp}
                      onPointerCancel={onGripUp}
                    >
                      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
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
      ) : (
        /* Recently played tab */
        <div className="flex-1 min-h-0 overflow-y-auto scroll-host p-4 space-y-1">
          {history.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-white/45">
              Nothing here yet — tracks you play land in Recently played.
            </div>
          ) : (
            history.slice(0, 50).map((t, i) => (
              <div
                key={`${t.id}-${i}`}
                onClick={() => playTrack(t)}
                className="flex items-center gap-3 h-12 px-2.5 rounded-lg select-none transition-colors cursor-pointer bg-white/[0.04] hover:bg-white/[0.08]"
              >
                <span className="w-9 h-9 shrink-0 rounded-md overflow-hidden bg-white/5">
                  {t.thumb ? (
                    <img src={upgradeArtwork(t.thumb)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Music2 className="w-4 h-4 m-auto text-white/30" />
                  )}
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
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
