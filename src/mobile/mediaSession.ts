/**
 * Mobile MediaSession integration.
 *
 * Bridges the shared Zustand player store (`src/stores/player.ts`) to the native
 * Android MediaSession and Foreground Service via `ByTuneShellPlugin`.
 *
 * This provides:
 * 1. Lock screen media controls with album artwork, title, artist, and scrub bar.
 * 2. Ongoing system media notification with Play/Pause, Next, and Previous actions.
 * 3. Media session command routing back to the player:
 *    Native (Notification / Lock screen / Bluetooth) -> window.__bytuneMediaAction -> usePlayer
 */
import { usePlayer } from "../stores/player";

type PlayerStoreState = ReturnType<typeof usePlayer.getState>;

/* eslint-disable @typescript-eslint/no-explicit-any */

declare global {
  interface Window {
    __bytuneMediaAction?: (action: string, data?: number) => void;
  }
}

function shell(): any {
  return (globalThis as any).Capacitor?.Plugins?.ByTuneShell ?? null;
}

let lastTrackId: string | null = null;
let lastPlaying: boolean | null = null;
let lastPositionSec = 0;
let lastUpdateTime = 0;

export function setupMobileMediaSession(): () => void {
  (window as any).__bytunePlayer = usePlayer;
  // Install the global action dispatcher for native events.
  window.__bytuneMediaAction = (action: string, data?: number) => {
    const player = usePlayer.getState();
    switch (action) {
      case "play":
        player.setPlaying(true);
        break;
      case "pause":
        player.setPlaying(false);
        break;
      case "play_pause":
        player.toggle();
        break;
      case "next":
        player.next(true);
        break;
      case "prev":
        player.prev();
        break;
      case "seek":
        if (typeof data === "number" && Number.isFinite(data) && data >= 0) {
          player.seek(data);
        }
        break;
    }
  };

  const syncState = (state: PlayerStoreState, force = false) => {
    const native = shell();
    if (!native?.updateMediaSession) return;

    const track = state.current ? state.current() : (state.queue[state.index] ?? null);
    if (!track) {
      if (lastTrackId !== null) {
        lastTrackId = null;
        lastPlaying = null;
        native.clearMediaSession?.().catch(() => {});
      }
      return;
    }

    const trackChanged = track.id !== lastTrackId;
    const playingChanged = state.playing !== lastPlaying;
    const now = Date.now();
    const posDiff = Math.abs(state.position - lastPositionSec);

    // Throttle position updates: send on track/playing change, or when position jumped > 2s,
    // or at least once every 2.5s while playing.
    if (!force && !trackChanged && !playingChanged && posDiff < 2 && now - lastUpdateTime < 2500) {
      return;
    }

    lastTrackId = track.id;
    lastPlaying = state.playing;
    lastPositionSec = state.position;
    lastUpdateTime = now;

    native
      .updateMediaSession({
        title: track.title || "Unknown Title",
        artist: track.artist || "Unknown Artist",
        album: track.album || "ByTune",
        artworkUrl: track.thumb || "",
        duration: state.duration || 0,
        position: state.position || 0,
        isPlaying: state.playing,
      })
      .catch(() => {});
  };

  // Subscribe to Zustand player changes.
  const unsubscribe = usePlayer.subscribe((state) => {
    syncState(state);
  });

  // Initial sync.
  syncState(usePlayer.getState(), true);

  return () => {
    unsubscribe();
    window.__bytuneMediaAction = undefined;
  };
}
