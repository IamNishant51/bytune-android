/**
 * Sleep Timer store — Apple Music style sleep timer with gradual fade out.
 */
import { create } from "zustand";
import { usePlayer } from "./player";
import { useUI } from "./ui";

interface SleepTimerState {
  active: boolean;
  mode: "duration" | "end-of-track" | null;
  secondsRemaining: number;
  initialMinutes: number | null;
  setTimer: (minutes: number) => void;
  setEndOfTrack: () => void;
  cancelTimer: () => void;
}

let timerInterval: number | null = null;
let endOfTrackUnsub: (() => void) | null = null;

/** Player volume captured when a fade starts, restored when it ends. */
let fadeSavedVolume: number | null = null;
/** Fade the volume down over the last this-many seconds before expiry. */
const FADE_SECONDS = 30;

function restoreFadedVolume(): void {
  if (fadeSavedVolume !== null) {
    usePlayer.getState().setVolume(fadeSavedVolume);
    fadeSavedVolume = null;
  }
}

/** Scale the player volume toward silence as expiry approaches. The first
 *  tick captures the user's volume; later ticks scale from that capture, so
 *  the ramp is monotonic even though the store volume keeps changing. A
 *  muted or silent player is left alone — fading it would unmute it. */
function applySleepFade(secondsRemaining: number): void {
  const player = usePlayer.getState();
  if (player.muted || player.volume <= 0) return;
  if (fadeSavedVolume === null) fadeSavedVolume = player.volume;
  const factor = Math.max(0, Math.min(1, secondsRemaining / FADE_SECONDS));
  const next = fadeSavedVolume * factor;
  // Skip no-op writes: the end-of-track fade runs inside a player
  // subscription, and an unchanged setVolume would re-fire it forever.
  if (Math.abs(player.volume - next) < 0.001) return;
  player.setVolume(next);
}

function cleanup(): void {
  if (timerInterval !== null) {
    window.clearInterval(timerInterval);
    timerInterval = null;
  }
  if (endOfTrackUnsub) {
    endOfTrackUnsub();
    endOfTrackUnsub = null;
  }
}

export const useSleepTimer = create<SleepTimerState>((set, get) => ({
  active: false,
  mode: null,
  secondsRemaining: 0,
  initialMinutes: null,

  setTimer: (minutes: number) => {
    cleanup();
    restoreFadedVolume();
    const totalSeconds = minutes * 60;
    set({
      active: true,
      mode: "duration",
      secondsRemaining: totalSeconds,
      initialMinutes: minutes,
    });
    useUI.getState().toast(`Sleep timer set for ${minutes} min`);

    timerInterval = window.setInterval(() => {
      const { secondsRemaining, active } = get();
      if (!active) {
        cleanup();
        return;
      }

      if (secondsRemaining <= 1) {
        cleanup();
        set({ active: false, mode: null, secondsRemaining: 0, initialMinutes: null });
        // Fade finished: pause, then restore the user's volume for next time.
        usePlayer.getState().setPlaying(false);
        restoreFadedVolume();
        useUI.getState().toast("Sleep timer finished — playback paused");
      } else {
        if (secondsRemaining <= FADE_SECONDS) applySleepFade(secondsRemaining);
        set({ secondsRemaining: secondsRemaining - 1 });
      }
    }, 1000);
  },

  setEndOfTrack: () => {
    cleanup();
    restoreFadedVolume();
    const currentTrackId = usePlayer.getState().current()?.id;
    set({
      active: true,
      mode: "end-of-track",
      secondsRemaining: 0,
      initialMinutes: null,
    });
    useUI.getState().toast("Sleep timer set: pause after current track");

    endOfTrackUnsub = usePlayer.subscribe((state, prevState) => {
      // If song changed or stopped playing after being played
      const newId = state.queue[state.index]?.id;
      if (currentTrackId && newId && newId !== currentTrackId) {
        cleanup();
        set({ active: false, mode: null, secondsRemaining: 0, initialMinutes: null });
        state.setPlaying(false);
        restoreFadedVolume();
        useUI.getState().toast("Sleep timer finished — playback paused");
        return;
      }
      // Fade over the last 30s of the current track when its duration is
      // known. Scrubbing away from the end restores the volume.
      if (newId === currentTrackId && state.duration > 0) {
        const remaining = state.duration - state.position;
        if (remaining > 0 && remaining <= FADE_SECONDS) {
          applySleepFade(Math.ceil(remaining));
        } else if (remaining > FADE_SECONDS) {
          restoreFadedVolume();
        }
      }
    });
  },

  cancelTimer: () => {
    cleanup();
    restoreFadedVolume();
    set({ active: false, mode: null, secondsRemaining: 0, initialMinutes: null });
    useUI.getState().toast("Sleep timer turned off");
  },
}));
