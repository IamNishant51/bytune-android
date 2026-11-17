/** Download orchestration on the renderer side. */
import { useLibrary, type DownloadItem } from "../stores/library";
import { useSettings } from "../stores/settings";
import { useUI } from "../stores/ui";
import type { Track } from "../types";
import { requireBridge } from "./bridge";
import { staleDownloadIds } from "./download-reconcile";

export function getDownload(id: string): DownloadItem | undefined {
  return useLibrary.getState().downloads[id];
}

export function isDownloaded(id: string): boolean {
  return useLibrary.getState().downloads[id]?.status === "done";
}

export async function startDownload(track: Track, dirOverride?: string): Promise<void> {
  const lib = useLibrary.getState();
  const existing = lib.downloads[track.id];
  if (existing?.status === "downloading" || existing?.status === "queued") return;
  if (existing?.status === "done") {
    useUI.getState().toast("Already downloaded — see the Downloads view", "info");
    return;
  }

  lib.setDownload(track.id, {
    track,
    path: existing?.path ?? null,
    status: "queued",
    progress: 0,
    downloaded: 0,
    total: 0,
  });

  try {
    const s = useSettings.getState();
    const dir = dirOverride ?? s.downloadDir ?? undefined;
    // The main process queues it; lifecycle arrives over download:event.
    await requireBridge().startDownload(track, dir, s.downloadQuality, s.exportDownloads);
  } catch (err) {
    useLibrary.getState().patchDownload(track.id, { status: "failed", progress: 0 });
    useUI.getState().toast(
      `Download failed: ${err instanceof Error ? err.message : "unknown error"}`,
      "error"
    );
  }
}

export function cancelDownload(id: string): void {
  void window.bytune?.cancelDownload(id);
  useLibrary.getState().patchDownload(id, { status: "failed", progress: 0 });
}

/**
 * Per-id progress coalescer: keep the latest payload per id and apply it at
 * most once per tick. Main already throttles file progress to 250ms, but
 * every event used to patch the library store directly — re-rendering rows
 * and (before persist coalescing) rewriting the whole library at ~4Hz per
 * download. 500ms is still smooth for progress UI. Terminal events must
 * bypass the buffer (flush(id)) so state is never stale at completion.
 */
export function createProgressBuffer(
  apply: (id: string, downloaded: number, total: number) => void,
  tickMs: number
): { push: (id: string, downloaded: number, total: number) => void; flush: (id: string) => void } {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const args = new Map<string, { downloaded: number; total: number }>();
  return {
    push(id, downloaded, total) {
      args.set(id, { downloaded, total });
      if (timers.has(id)) return;
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          const a = args.get(id);
          args.delete(id);
          if (a) apply(id, a.downloaded, a.total);
        }, tickMs)
      );
    },
    flush(id) {
      const t = timers.get(id);
      if (t !== undefined) {
        clearTimeout(t);
        timers.delete(id);
      }
      args.delete(id);
    },
  };
}

/**
 * Boot reconciliation: the main process queue is memory-only, so registry
 * rows persisted as "queued"/"downloading" describe work that died with the
 * previous session — no event will ever update them, and startDownload
 * refuses to retry while a row claims to be active. Fail the stale rows
 * (failed stays retryable); rows still present in the live queue snapshot
 * are left alone.
 */
async function reconcileStaleDownloads(): Promise<void> {
  const bridge = window.bytune;
  if (!bridge?.downloadQueue) return;
  try {
    const snapshot = (await bridge.downloadQueue()) as { id?: unknown }[];
    const live = (Array.isArray(snapshot) ? snapshot : [])
      .map((row) => (typeof row?.id === "string" ? row.id : ""))
      .filter(Boolean);
    const lib = useLibrary.getState();
    for (const id of staleDownloadIds(lib.downloads, live)) {
      lib.patchDownload(id, { status: "failed", progress: 0 });
    }
  } catch {
    /* bridge unavailable — stale rows keep their status; cancel still works */
  }
}

interface BatchSession {
  playlistName: string;
  ids: Set<string>;
  total: number;
  done: number;
  failed: number;
}

const activeBatches: BatchSession[] = [];

function checkBatchItem(id: string, success: boolean): boolean {
  for (let i = 0; i < activeBatches.length; i++) {
    const b = activeBatches[i];
    if (b.ids.has(id)) {
      b.ids.delete(id);
      if (success) b.done++;
      else b.failed++;
      if (b.ids.size === 0) {
        activeBatches.splice(i, 1);
        if (b.failed === 0) {
          useUI.getState().toast(`Downloaded all ${b.total} songs from "${b.playlistName}"`, "success");
        } else {
          useUI.getState().toast(`Downloaded ${b.done} songs (${b.failed} failed) from "${b.playlistName}"`, "warning");
        }
      }
      return true;
    }
  }
  return false;
}

export interface PlaylistDownloadStats {
  total: number;
  done: number;
  downloading: number;
  failed: number;
  percent: number;
}

export function getPlaylistDownloadStats(
  tracks: Track[],
  downloads: Record<string, DownloadItem | undefined>
): PlaylistDownloadStats {
  const total = tracks.length;
  if (!total) return { total: 0, done: 0, downloading: 0, failed: 0, percent: 0 };
  let done = 0;
  let downloading = 0;
  let failed = 0;
  for (const t of tracks) {
    const st = downloads[t.id]?.status;
    if (st === "done") done++;
    else if (st === "downloading" || st === "queued") downloading++;
    else if (st === "failed") failed++;
  }
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return { total, done, downloading, failed, percent };
}

/** Subscribe to queue lifecycle events from the main process. */
export function listenForDownloadProgress(): () => void {
  if (!window.bytune) return () => undefined;
  void reconcileStaleDownloads();
  const applyProgress = (id: string, downloaded: number, total: number): void => {
    useLibrary.getState().patchDownload(id, {
      status: "downloading",
      progress: total > 0 ? Math.min(1, downloaded / total) : 0,
      downloaded,
      total,
    });
  };
  const buffer = createProgressBuffer(applyProgress, 500);
  const offEvent = window.bytune.onDownloadEvent?.((e) => {
    const lib = useLibrary.getState();
    if (e.type === "start") {
      applyProgress(e.id, 0, 0);
    } else if (e.type === "progress") {
      buffer.push(e.id, e.downloaded ?? 0, e.total ?? 0);
    } else if (e.type === "done" && e.path) {
      buffer.flush(e.id);
      const item = lib.downloads[e.id];
      lib.setDownload(e.id, {
        track: item?.track && item.track.title !== item.track.id ? item.track : (e as any).track ?? item?.track ?? { id: e.id, title: e.id, artist: "", duration: 0, thumb: "" },
        path: e.path,
        status: "done",
        progress: 1,
        downloaded: 0,
        total: 0,
      });
      if (!checkBatchItem(e.id, true)) {
        useUI.getState().toast("Download finished", "success");
      }
    } else if (e.type === "failed") {
      buffer.flush(e.id);
      lib.patchDownload(e.id, { status: "failed", progress: 0 });
      if (!checkBatchItem(e.id, false)) {
        useUI.getState().toast(`Download failed: ${e.reason ?? "unknown error"}`, "error");
      }
    } else if (e.type === "cancelled") {
      buffer.flush(e.id);
      lib.patchDownload(e.id, { status: "failed", progress: 0 });
    }
  });
  // Legacy channel (kept for older event payloads).
  const offProgress = window.bytune.onDownloadProgress(({ id, downloaded, total }) => {
    buffer.push(id, downloaded, total);
  });
  return () => {
    offEvent?.();
    offProgress();
  };
}


export async function downloadPlaylist(playlistName: string, tracks: Track[]): Promise<void> {
  if (!tracks.length) return;
  const lib = useLibrary.getState();
  const ui = useUI.getState();
  const pending = tracks.filter((t) => lib.downloads[t.id]?.status !== "done");
  if (!pending.length) {
    ui.toast("All songs in this playlist are already downloaded", "info");
    return;
  }
  const batch: BatchSession = {
    playlistName,
    ids: new Set(pending.map((t) => t.id)),
    total: pending.length,
    done: 0,
    failed: 0,
  };
  activeBatches.push(batch);
  ui.toast(`Downloading ${pending.length} ${pending.length === 1 ? "song" : "songs"} from "${playlistName}"…`, "info");
  for (const track of pending) {
    await startDownload(track);
  }
}

export function removeDownloadedPlaylist(tracks: Track[]): void {
  const lib = useLibrary.getState();
  let count = 0;
  for (const track of tracks) {
    if (lib.downloads[track.id]?.status === "done") {
      lib.removeDownload(track.id);
      void window.bytune?.cancelDownload(track.id);
      count++;
    }
  }
  useUI.getState().toast(count > 0 ? `Removed ${count} downloaded songs` : "No downloaded songs to remove", "info");
}
