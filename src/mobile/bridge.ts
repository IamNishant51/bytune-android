import { getOfflineBlob, deleteOfflineBlob, downloadOfflineTrack, getAllOfflineEntries, saveOfflineLyrics, deleteOfflineLyrics } from "./offline";
/**
 * The `window.bytune` bridge, Android edition.
 *
 * On the desktop the renderer talks to the Electron main process over IPC.
 * Android has no main process, so this module installs the same surface —
 * every method the UI calls, in the same shape — backed by the on-device
 * implementations (InnerTube over native HTTP, LRCLIB, localStorage, and a
 * small native shell plugin for the two things JS cannot do: mint BotGuard PO
 * tokens and proxy googlevideo).
 *
 * Desktop-only features are honest no-ops here rather than missing methods:
 * a missing method would throw inside a view, a no-op just does nothing.
 * (Downloads, local-folder import, the PiP window, cloud accounts and window
 * chrome are the desktop's; on Android the app hides those surfaces.)
 */
import type { ByTuneApi } from "../../electron/preload";
import type { DownloadProgress, Track } from "../types";
import * as music from "./music";
import * as lyrics from "./lyrics";
import * as stats from "./stats";
import * as auth from "./auth";
import { importPlaylistFromUrl } from "../lib/playlistImport";
import { useUI } from "../stores/ui";
import { useLibrary } from "../stores/library";
import { usePlayer } from "../stores/player";

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ------------------------------------------------------------------ */
/* Local profile (guest mode — no account server on the phone build)    */
/* ------------------------------------------------------------------ */

const PROFILE_KEY = "bytune.mobile.profile";

interface Profile {
  mode: "guest" | "account" | null;
  userId: string | null;
  username: string | null;
  freshInstall: boolean;
}

function readProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) return JSON.parse(raw) as Profile;
  } catch {
    /* first run */
  }
  return { mode: null, userId: null, username: null, freshInstall: true };
}

function writeProfile(p: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

const authListeners = new Set<(info: Profile) => void>();

function announceAuth(): void {
  const p = readProfile();
  for (const fn of authListeners) {
    try {
      fn(p);
    } catch {
      /* ignore */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Storage — same names the desktop writes to JSON files                */
/* ------------------------------------------------------------------ */

const DATA_PREFIX = "bytune.data.";

const storage = {
  readData: async (name: string): Promise<unknown> => {
    try {
      const raw = localStorage.getItem(DATA_PREFIX + name);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  writeData: async (name: string, data: unknown): Promise<void> => {
    try {
      if (data == null) localStorage.removeItem(DATA_PREFIX + name);
      else localStorage.setItem(DATA_PREFIX + name, JSON.stringify(data));
    } catch {
      /* quota — the in-memory store keeps working */
    }
  },
};

/* ------------------------------------------------------------------ */
/* Native shell plugin (PO tokens + stream proxy)                      */
/* ------------------------------------------------------------------ */

function shell(): any {
  return (globalThis as any).Capacitor?.Plugins?.ByTuneShell ?? null;
}

/** Register a resolved upstream URL with the native proxy; the returned
 *  loopback URL is what the media element plays (and what carries `&meta=1`). */
export async function proxyUrl(upstream: string, lufs: number | null, key: string): Promise<string> {
  const native = shell();
  if (native?.registerStream) {
    const res = await native.registerStream({ key, url: upstream, lufs });
    if (typeof res?.url === "string" && res.url) return res.url;
  }
  // No native proxy (browser dev): play googlevideo directly.
  return upstream;
}


type DownloadListener = (e: { type: string; id: string; downloaded?: number; total?: number; path?: string; reason?: string; track?: Track }) => void;
const downloadListeners = new Set<DownloadListener>();
const activeControllers = new Map<string, AbortController>();
const inFlightQueue: { id: string; phase: string; downloaded?: number; total?: number }[] = [];

function emitDownloadEvent(e: { type: string; id: string; downloaded?: number; total?: number; path?: string; reason?: string; track?: Track }) {
  for (const fn of downloadListeners) {
    try { fn(e); } catch { /* ignore */ }
  }
}

async function performMobileDownload(track: Track): Promise<void> {
  const id = track.id;
  if (activeControllers.has(id)) return;
  const ctrl = new AbortController();
  activeControllers.set(id, ctrl);
  inFlightQueue.push({ id, phase: "running", downloaded: 0, total: 0 });
  emitDownloadEvent({ type: "start", id, track });
  emitDownloadEvent({ type: "progress", id, downloaded: 0, total: 100 });

  try {
    const audioPromise = downloadOfflineTrack(
      track,
      (p) => emitDownloadEvent({ type: "progress", id, downloaded: p.downloaded, total: p.total }),
      ctrl.signal
    );

    const lyricsPromise = lyrics
      .getLyrics({
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.duration,
      })
      .then(async (res) => {
        if (res) await saveOfflineLyrics(track.id, res);
      })
      .catch(() => {
        /* lyrics failure does not abort audio download */
      });

    const [blob] = await Promise.all([audioPromise, lyricsPromise]);
    activeControllers.delete(id);
    const idx = inFlightQueue.findIndex((q) => q.id === id);
    if (idx !== -1) inFlightQueue.splice(idx, 1);
    emitDownloadEvent({ type: "done", id, path: `offline:${id}`, total: blob.size, downloaded: blob.size, track });
  } catch (err: any) {
    activeControllers.delete(id);
    const idx = inFlightQueue.findIndex((q) => q.id === id);
    if (idx !== -1) inFlightQueue.splice(idx, 1);
    if (err.name === "AbortError" || err.message?.includes("cancelled")) {
      emitDownloadEvent({ type: "cancelled", id });
    } else {
      emitDownloadEvent({ type: "failed", id, reason: err.message || "Download failed" });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Downloads / local library                            */
/* ------------------------------------------------------------------ */

const noDownloads = (): Promise<never> =>
  Promise.reject(new Error("Downloads are available in the desktop app."));

const unsubscribe = (): (() => void) => () => undefined;

const emptyLibrary = { folders: [], tracks: [], albums: [], artists: [] };

/* ------------------------------------------------------------------ */
/* The bridge                                                          */
/* ------------------------------------------------------------------ */

const api = {
  platform: "android",
  versions: { app: "1.0.1", electron: "", chrome: "", node: "" },

  /* ---- music ---- */
  search: (query: string, light = false) => music.searchAll(query).then((r) => (light ? r : r)),
  searchPage: (query: string, filter: any) => music.searchPage(query, filter),
  searchMore: (token: string, filter: any) => music.searchMore(token, filter),
  suggestions: (query: string) => music.suggestions(query),
  getAlbum: (id: string) => music.getAlbum(id),
  getArtist: (id: string) => music.getArtistPage(id),
  getPlaylist: (id: string) => music.getPlaylist(id),
  getPlaylistPage: (id: string) => music.getPlaylistPage(id),
  getHome: () => music.getHome(),
  getCharts: () => music.getCharts(),
  getMoods: () => music.getMoods(),
  marketInfo: () => music.marketInfo(),
  getLyrics: (track: { id: string; title: string; artist: string; album?: string; duration?: number }) =>
    lyrics.getLyrics(track),
  enrichDurations: (ids: string[]) => music.enrichDurations(ids),
  playbackEvent: (event: { type: string; track?: Track; positionSec: number; playedSec: number; deltaMs: number }) => {
    if (event.type === "start") {
      // A fresh listen re-arms the one-play rule, exactly like the desktop.
      if (event.track?.id) stats.noteTrackStart(event.track.id);
      return;
    }
    if ((event.type === "progress" || event.type === "stop" || event.type === "pause") && event.track && (event.deltaMs ?? 0) > 0) {
      stats.recordListening(event.track, event.deltaMs);
    }
  },
  // Async to match the IPC contract: ReplayView chains .then() on this.
  statsSummary: async (period: string) => {
    const p = (["month", "lastMonth", "year", "all"] as const).find((x) => x === period) ?? "month";
    return stats.summary(p);
  },
  /** Resolves the stream (checking offline storage first) and hands back playable URL. */
  getStreamUrl: async (id: string, _forceRotate = false, quality?: string) => {
    const offline = await getOfflineBlob(id);
    if (offline) {
      return URL.createObjectURL(offline);
    }
    const maxKbps = quality === "low" ? 64 : undefined;
    const resolved = await music.resolveStream(id, maxKbps);
    return proxyUrl(resolved.url, resolved.lufs, id);
  },
  getCanvas: async () => null,

  /* ---- local library (none on Android yet) ---- */
  localLibrary: async () => emptyLibrary,
  scanLibrary: async () => emptyLibrary,
  setLibraryFolders: async () => emptyLibrary,
  addLibraryFolders: async () => emptyLibrary,
  renameLibraryFolder: async () => emptyLibrary,
  removeLibraryFolder: async () => emptyLibrary,
  libraryFolderStatuses: async () => ({}),
  localTrackUrl: async () => null,
  localArtBytes: async () => null,

  /* ---- window chrome — the OS owns it on Android ---- */
  windowMinimize: () => undefined,
  windowMaximizeToggle: () => undefined,
  windowClose: () => undefined,
  isMaximized: async () => false,
  setOverlayChrome: async () => undefined,
  setFullScreen: async () => undefined,
  onMaximizeChange: unsubscribe,
  onFullScreenChange: unsubscribe,

  /* ---- mini player (no second window on Android) ---- */
  pipToggle: async () => false,
  pipIsOpen: async () => false,
  pipClose: unsubscribe,
  pipMinimize: unsubscribe,
  pipShowMain: unsubscribe,
  pipSendState: unsubscribe,
  pipSendCommand: unsubscribe,
  onPipState: unsubscribe,
  onPipCommand: unsubscribe,
  onPipOpenChange: unsubscribe,
  onPipNeedState: unsubscribe,
  onPipCursorInside: unsubscribe,

  /* ---- persistence ---- */
  readData: storage.readData,
  writeData: storage.writeData,
  resetData: async () => {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith(DATA_PREFIX) || key.startsWith("bytune-mobile") || key === PROFILE_KEY)) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
    stats.reset();
    writeProfile({ mode: null, userId: null, username: null, freshInstall: false });
    announceAuth();
    setTimeout(() => location.reload(), 200);
    return { ok: true };
  },

  /* ---- backup (file pickers are desktop-only) ---- */
  backupExport: async () => ({ ok: false, reason: "Backup files are a desktop feature." }),
  backupImport: async () => ({ ok: false, reason: "Backup files are a desktop feature." }),

  /* ---- accounts (Google OAuth + guest on Android) ---- */
  authGetSession: async () => {
    return auth.readProfile();
  },
  authContinueGuest: async () => {
    auth.writeProfile({ mode: "guest", freshInstall: false, userId: auth.readProfile().userId ?? "local" });
    auth.announceAuth();
    return { ok: true };
  },
  authClearGuestProfile: async () => {
    auth.writeProfile({ mode: null, userId: null, username: null, freshInstall: true, needsUsername: false });
    auth.announceAuth();
    return { ok: true };
  },
  authSignUp: async () => {
    throw new Error("Email sign-up needs the desktop app — use Google sign-in.");
  },
  authSignIn: async () => {
    throw new Error("Email sign-in needs the desktop app — use Google sign-in.");
  },
  authSignInGoogle: async () => {
    return auth.signInGoogle();
  },
  authUsernameAvailable: async (username: string) => auth.authUsernameAvailable(username),
  authSetUsername: async (username: string) => auth.authSetUsername(username),
  authSkipUsername: async () => {
    auth.writeProfile({ needsUsername: false });
    auth.announceAuth();
    return { ok: true };
  },
  authSignOut: async () => {
    await auth.authSignOut();
    return { ok: true };
  },
  onAuthChanged: (cb: (info: any) => void) => {
    return auth.onAuthChanged(cb);
  },
  syncStatus: async () => ({ lastSyncAt: null, state: "idle", lastError: null, available: false }),
  syncNow: async () => ({ ok: true }),
  syncBackupNow: async () => ({ ok: true }),
  syncRestoreNow: async () => ({ ok: true }),
  onSyncRestored: unsubscribe,

  /* ---- menu (macOS desktop) ---- */
  onMenuCommand: unsubscribe,
  menuPushState: () => undefined,

  /* ---- filesystem ---- */
  defaultDownloadDir: async () => "",
  pickFolder: async () => null,
  revealPath: () => undefined,
  openPath: () => undefined,

  /* ---- downloads (offline storage) ---- */
  startDownload: async (track: Track) => {
    void performMobileDownload(track);
  },
  cancelDownload: async (id: string) => {
    const ctrl = activeControllers.get(id);
    if (ctrl) ctrl.abort();
    await deleteOfflineBlob(id);
    await deleteOfflineLyrics(id);
    emitDownloadEvent({ type: "cancelled", id });
  },
  downloadQueue: async () => [...inFlightQueue],
  onDownloadEvent: (cb: (e: any) => void) => {
    downloadListeners.add(cb);
    return () => downloadListeners.delete(cb);
  },
  onDownloadProgress: (_cb: (p: DownloadProgress) => void) => () => undefined,
};

/** Install the bridge before React mounts. */
export function installMobileBridge(): void {
  (window as any).bytune = api as unknown as ByTuneApi;
  document.documentElement.classList.add("platform-android");

  // These two stores hydrate while their modules evaluate — before this
  // function has installed the bridge — so they read the bare localStorage
  // keys and miss their `bytune.data.*` copies. Re-run hydration now that
  // `window.bytune.readData` exists (otherwise every launch starts empty).
  void useLibrary.persist.rehydrate();
  void usePlayer.persist.rehydrate();

  // Reconcile offline downloads from IndexedDB into the library store so offline tracks are never lost
  void getAllOfflineEntries().then((entries) => {
    const lib = useLibrary.getState();
    for (const entry of entries) {
      const existing = lib.downloads[entry.id];
      if (existing?.status === "done" && existing.track?.title && existing.track.title !== entry.id) {
        continue;
      }
      const track = entry.track ?? existing?.track ?? {
        id: entry.id,
        title: entry.id,
        artist: "",
        duration: 0,
        thumb: "",
      };
      lib.setDownload(entry.id, {
        track,
        path: `offline:${entry.id}`,
        status: "done",
        progress: 1,
        downloaded: entry.size,
        total: entry.size,
      });
    }
  }).catch(() => undefined);

  // Restore session
  void auth.initAuth();

  // Handle incoming OAuth callback
  (window as any).__bytuneHandleOAuth = (url: string) => {
    void auth.handleOAuthCallback(url);
  };

  // Handle incoming shared text (playlist link shared from Spotify or YT Music)
  (window as any).__bytuneHandleSharedText = async (text: string) => {
    try {
      useUI.getState().toast("Importing shared playlist…", "info");
      const res = await importPlaylistFromUrl(text);
      useUI.getState().toast(`Imported "${res.title}" (${res.trackCount} tracks)`, "success");
      useUI.getState().navigate({ name: "playlist", param: res.playlistId });
    } catch (err) {
      useUI.getState().toast(err instanceof Error ? err.message : "Could not import playlist", "error");
    }
  };

  // Query any pending native intent on cold start
  const native = shell();
  if (native?.getPendingAction) {
    native.getPendingAction().then((res: any) => {
      if (res?.oauthUrl) {
        void auth.handleOAuthCallback(res.oauthUrl);
      }
      if (res?.sharedText) {
        void (window as any).__bytuneHandleSharedText(res.sharedText);
      }
    }).catch(() => undefined);
  }
}
