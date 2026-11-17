/** User settings (persisted). Dark theme only — no theme switching. */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { storage } from "../lib/persist";

export type StreamQuality = "low" | "medium" | "high";
export type DownloadQuality = "standard" | "high" | "lossless";

export const STREAM_QUALITY_LABEL: Record<StreamQuality, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export const DOWNLOAD_QUALITY_LABEL: Record<DownloadQuality, string> = {
  standard: "Standard",
  high: "High",
  lossless: "Lossless",
};

export interface EqPreset {
  name: string;
  bands: [number, number, number, number, number];
}

export const EQ_PRESETS: EqPreset[] = [
  { name: "Flat", bands: [0, 0, 0, 0, 0] },
  { name: "Bass Boost", bands: [6, 4, 0, 0, -1] },
  { name: "Vocal", bands: [-1, 2, 5, 2, 0] },
  { name: "Acoustic", bands: [3, 1, 0, 2, 4] },
  { name: "Electronic", bands: [5, 2, -1, 3, 5] },
  { name: "Treble", bands: [-2, 0, 1, 4, 6] },
  { name: "Late Night", bands: [4, 1, -1, 2, 1] },
];

interface SettingsState {
  /* Downloads */
  downloadDir: string | null;
  downloadQuality: DownloadQuality;
  exportDownloads: boolean;

  /* Playback */
  streamingQuality: StreamQuality;
  crossfadeSeconds: number;
  smartFade: boolean;
  skipSilence: boolean;
  autoplay: boolean;
  /** 0.5..2 — persisted playback speed (pitch-preserving) */
  playbackSpeed: number;
  /** Audio output device (setSinkId). "" follows the system default. */
  audioSinkId: string;

  /* Appearance */
  reduceAnimation: boolean;
  reduceDynamicBlur: boolean;
  liquidGlass: boolean;
  fullBleedArtwork: boolean;
  legacyMeshGradient: boolean;
  animatedCanvas: boolean;
  syncedLyrics: boolean;
  blurUnfocusedLyrics: boolean;

  /* Local music */
  localMusicFolder: string | null;
  filterNonMusicAudio: boolean;

  /* Miscellaneous */
  dontRepeatSuggestions: boolean;
  hideVolumeBar: boolean;
  eqEnabled: boolean;
  eqPreset: string;
  eqBands: [number, number, number, number, number];
  setEqEnabled(v: boolean): void;
  setEqPreset(name: string): void;
  setEqBand(index: number, db: number): void;

  setDownloadDir(dir: string | null): void;
  setDownloadQuality(q: DownloadQuality): void;
  setExportDownloads(v: boolean): void;
  setStreamingQuality(q: StreamQuality): void;
  setCrossfadeSeconds(v: number): void;
  setSmartFade(v: boolean): void;
  setSkipSilence(v: boolean): void;
  setAutoplay(v: boolean): void;
  setPlaybackSpeed(v: number): void;
  setAudioSinkId(sinkId: string): void;
  setReduceAnimation(v: boolean): void;
  setReduceDynamicBlur(v: boolean): void;
  setLiquidGlass(v: boolean): void;
  setFullBleedArtwork(v: boolean): void;
  setLegacyMeshGradient(v: boolean): void;
  setAnimatedCanvas(v: boolean): void;
  setSyncedLyrics(v: boolean): void;
  setBlurUnfocusedLyrics(v: boolean): void;
  setLocalMusicFolder(v: string | null): void;
  setFilterNonMusicAudio(v: boolean): void;
  setDontRepeatSuggestions(v: boolean): void;
  setHideVolumeBar(v: boolean): void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      downloadDir: null,
      downloadQuality: "lossless",
      exportDownloads: false,

      streamingQuality: "high",
      crossfadeSeconds: 0,
      smartFade: false,
      skipSilence: false,
      autoplay: false,
      playbackSpeed: 1,
      audioSinkId: "",

      reduceAnimation: false,
      reduceDynamicBlur: false,
      liquidGlass: true,
      fullBleedArtwork: false,
      legacyMeshGradient: false,
      animatedCanvas: false,
      syncedLyrics: true,
      blurUnfocusedLyrics: true,

      localMusicFolder: null,
      filterNonMusicAudio: true,

      dontRepeatSuggestions: false,
      hideVolumeBar: false,
      eqEnabled: false,
      eqPreset: "Flat",
      eqBands: [0, 0, 0, 0, 0],

      setDownloadDir: (downloadDir) => set({ downloadDir }),
      setDownloadQuality: (downloadQuality) => set({ downloadQuality }),
      setExportDownloads: (exportDownloads) => set({ exportDownloads }),
      setStreamingQuality: (streamingQuality) => set({ streamingQuality }),
      setCrossfadeSeconds: (crossfadeSeconds) => set({ crossfadeSeconds }),
      setSmartFade: (smartFade) => set({ smartFade }),
      setSkipSilence: (skipSilence) => set({ skipSilence }),
      setAutoplay: (autoplay) => set({ autoplay }),
      setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed: Math.min(2, Math.max(0.5, playbackSpeed)) }),
      setAudioSinkId: (audioSinkId) => set({ audioSinkId }),
      setReduceAnimation: (reduceAnimation) => set({ reduceAnimation }),
      setReduceDynamicBlur: (reduceDynamicBlur) => set({ reduceDynamicBlur }),
      setLiquidGlass: (liquidGlass) => set({ liquidGlass }),
      setFullBleedArtwork: (fullBleedArtwork) => set({ fullBleedArtwork }),
      setLegacyMeshGradient: (legacyMeshGradient) => set({ legacyMeshGradient }),
      setAnimatedCanvas: (animatedCanvas) => set({ animatedCanvas }),
      setSyncedLyrics: (syncedLyrics) => set({ syncedLyrics }),
      setBlurUnfocusedLyrics: (blurUnfocusedLyrics) => set({ blurUnfocusedLyrics }),
      setLocalMusicFolder: (localMusicFolder) => set({ localMusicFolder }),
      setFilterNonMusicAudio: (filterNonMusicAudio) => set({ filterNonMusicAudio }),
      setDontRepeatSuggestions: (dontRepeatSuggestions) => set({ dontRepeatSuggestions }),
      setHideVolumeBar: (hideVolumeBar) => set({ hideVolumeBar }),
      setEqEnabled: (eqEnabled) => set({ eqEnabled }),
      setEqPreset: (eqPreset) => {
        const found = EQ_PRESETS.find((p) => p.name === eqPreset);
        set({ eqPreset, eqBands: found ? [...found.bands] : [0, 0, 0, 0, 0] });
      },
      setEqBand: (index, db) => {
        const bands = [...get().eqBands] as [number, number, number, number, number];
        bands[index] = Math.min(12, Math.max(-12, db));
        set({ eqBands: bands, eqPreset: "Custom" });
      },
    }),
    {
      name: "settings",
      storage: createJSONStorage(() => storage),
      version: 1,
      migrate: (persisted) => {
        // v0 → v1: the "lossless" streaming option never changed the
        // rendition (streams are lossy Opus/AAC) and no longer exists —
        // stored installs that picked it land on "high" (uncapped).
        const state = (persisted ?? {}) as Partial<SettingsState> & Record<string, unknown>;
        if ((state.streamingQuality as string) === "lossless") {
          state.streamingQuality = "high";
        }
        return state as SettingsState;
      },
    }
  )
);