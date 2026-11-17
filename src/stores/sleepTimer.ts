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
        // Smoothly pause playback
        usePlayer.getState().setPlaying(false);
        useUI.getState().toast("Sleep timer finished — playback paused");
      } else {
        set({ secondsRemaining: secondsRemaining - 1 });
      }
    }, 1000);
  },

  setEndOfTrack: () => {
    cleanup();
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
        useUI.getState().toast("Sleep timer finished — playback paused");
      }
    });
  },

  cancelTimer: () => {
    cleanup();
    set({ active: false, mode: null, secondsRemaining: 0, initialMinutes: null });
    useUI.getState().toast("Sleep timer turned off");
  },
}));
