/** Download orchestration on the renderer side. */
import { useLibrary, type DownloadItem } from "../stores/library";
import { useSettings } from "../stores/settings";
import { useUI } from "../stores/ui";
import type { Track } from "../types";
import { requireBridge } from "./bridge";
import { staleDownloadIds } from "./download-reconcile";
import { isLowMemoryDevice } from "./device";
import { isAndroid } from "./platform";
import { fmtBytes } from "./format";
import { cancelOfflineDownload, enforceOfflineStorageCap } from "../mobile/offline";

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

  // Android downloads go through the bounded FIFO queue below: the bridge
  // call is fire-and-forget, so without the queue a playlist download
  // would start every track at once (D-04).
  if (isAndroid) {
    enqueueDownload(track);
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
  // Drop queued work and stop the engine for active work. The bridge call
  // below still runs: for a finished download it deletes the stored blob
  // (the Downloads view delete flow), and for an active one it aborts the
  // bridge-side controller (Track B wires it to cancelOfflineDownload).
  // cancelQueuedDownload deliberately never calls the bridge itself, so
  // bridge.cancelDownload can delegate to it without recursing.
  if (isAndroid) cancelQueuedDownload(id);
  void window.bytune?.cancelDownload(id);
  useLibrary.getState().patchDownload(id, { status: "failed", progress: 0 });
}

/* ------------------------------------------------------------------ */
/* Bounded FIFO download queue (Android, D-04)                         */
/*                                                                     */
/* The bridge's startDownload returns as soon as the download is       */
/* launched, so serializing here is the only thing standing between a   */
/* 43-track playlist download and 43 concurrent downloads + 43 lyric   */
/* fetches. Concurrency is 2, or 1 on low-memory devices. A slot is    */
/* released by the terminal download event (done/failed/cancelled) —   */
/* the same events DownloadsView and PlaylistView already subscribe    */
/* to, with unchanged names and payloads.                              */
/*                                                                     */
/* CONTRACT with Track B (bridge delegation — read carefully): the     */
/* bridge's startDownload delegates to enqueueDownload, and the queue  */
/* pump launches a claimed slot by calling window.bytune.startDownload */
/* again. That re-entrant call MUST reach performMobileDownload        */
/* directly: the bridge must check getDownloadQueueState() and, when   */
/* the id already holds an active slot, run the executor instead of    */
/* delegating back to enqueueDownload (whose queued-row guard would    */
/* no-op, stalling the slot forever with no terminal event). Without   */
/* that branch every download stalls silently; the launch watchdog in  */
/* runQueuedDownload turns the stall into a loud failure instead. The  */
/* bridge may delegate cancelDownload to cancelQueuedDownload +        */
/* cancelOfflineDownload (no recursion: cancelQueuedDownload never     */
/* calls the bridge).                                                  */
/* ------------------------------------------------------------------ */

export interface DownloadQueueState {
  /** Ids waiting for a slot, in FIFO order. */
  pending: string[];
  /** Ids holding a slot (launched, awaiting a terminal event). */
  active: string[];
}

const pendingQueue: Track[] = [];
const activeDownloadIds = new Set<string>();
let queueEventListenerInstalled = false;

/** Ids whose `start` event arrived — the launch watchdog's signal that
 *  the bridge actually executed the download instead of delegating into
 *  a no-op. Cleaned up on terminal events and cancels. */
const launchedDownloadIds = new Set<string>();
const launchWaiters = new Map<string, Set<(launched: boolean) => void>>();

function resolveLaunchWaiters(id: string, launched: boolean): void {
  const waiters = launchWaiters.get(id);
  if (!waiters) return;
  launchWaiters.delete(id);
  for (const resolve of waiters) resolve(launched);
}

function queueConcurrencyLimit(): number {
  return isLowMemoryDevice() ? 1 : 2;
}

export function getDownloadQueueState(): DownloadQueueState {
  return { pending: pendingQueue.map((t) => t.id), active: [...activeDownloadIds] };
}

function ensureQueueEventListener(): void {
  if (queueEventListenerInstalled) return;
  // The queue lives for the app lifetime; this subscription is never
  // removed. Terminal events release the slot and pump the next item.
  // Releasing is idempotent: a cancelled download may already have been
  // removed from the active set by cancelQueuedDownload. The flag is set
  // only when a subscription actually installed, so a bridge that appears
  // later still gets subscribed on the next enqueue/pump.
  const off = window.bytune?.onDownloadEvent?.((e) => {
    if (e.type === "start") {
      launchedDownloadIds.add(e.id);
      resolveLaunchWaiters(e.id, true);
      return;
    }
    if (e.type === "done" || e.type === "failed" || e.type === "cancelled") {
      launchedDownloadIds.delete(e.id);
      resolveLaunchWaiters(e.id, false);
      if (activeDownloadIds.delete(e.id)) void pumpDownloadQueue();
    }
  });
  if (off) queueEventListenerInstalled = true;
}

/** Enqueue one track. Duplicate, in-flight, and already-downloaded tracks
 *  are ignored, matching startDownload's guards. */
export function enqueueDownload(track: Track): void {
  const lib = useLibrary.getState();
  const existing = lib.downloads[track.id];
  if (existing?.status === "downloading" || existing?.status === "queued") return;
  if (existing?.status === "done") {
    useUI.getState().toast("Already downloaded — see the Downloads view", "info");
    return;
  }
  if (pendingQueue.some((t) => t.id === track.id) || activeDownloadIds.has(track.id)) return;
  lib.setDownload(track.id, {
    track,
    path: existing?.path ?? null,
    status: "queued",
    progress: 0,
    downloaded: 0,
    total: 0,
  });
  pendingQueue.push(track);
  ensureQueueEventListener();
  void pumpDownloadQueue();
}

/**
 * Cancel queued or active work. A pending item is dropped without ever
 * starting. An active item is released from its slot immediately (so a
 * retry can re-enqueue it) and the engine is told to stop; the terminal
 * event that follows is a harmless no-op for the queue. Never calls the
 * bridge — see the contract note above.
 */
export function cancelQueuedDownload(id: string): void {
  const pendingIndex = pendingQueue.findIndex((t) => t.id === id);
  if (pendingIndex !== -1) {
    pendingQueue.splice(pendingIndex, 1);
    useLibrary.getState().patchDownload(id, { status: "failed", progress: 0 });
    return;
  }
  if (activeDownloadIds.has(id)) {
    activeDownloadIds.delete(id);
    launchedDownloadIds.delete(id);
    resolveLaunchWaiters(id, false);
    cancelOfflineDownload(id);
    void pumpDownloadQueue();
  }
}

async function pumpDownloadQueue(): Promise<void> {
  ensureQueueEventListener();
  const limit = queueConcurrencyLimit();
  while (activeDownloadIds.size < limit && pendingQueue.length > 0) {
    const next = pendingQueue.shift();
    if (!next) break;
    // Skip rows that finished or were removed while waiting in line.
    if (useLibrary.getState().downloads[next.id]?.status === "done") continue;
    activeDownloadIds.add(next.id);
    void runQueuedDownload(next);
  }
}

async function runQueuedDownload(track: Track): Promise<void> {
  try {
    await enforceStorageCapBeforeDownload();
    launchedDownloadIds.delete(track.id);
    await requireBridge().startDownload(track);
    // Launch watchdog: the bridge must emit `start` once it executes the
    // download. If it delegated back into the queue instead (the Track B
    // executor branch is missing), no `start` ever arrives — fail loudly
    // and free the slot instead of stalling the whole queue. A cancel in
    // the meantime removes the id from the active set first, so the
    // failure branch below stays silent for user cancels.
    const launched = await waitForLaunch(track.id, 10000);
    if (!launched && activeDownloadIds.delete(track.id)) {
      useLibrary.getState().patchDownload(track.id, { status: "failed", progress: 0 });
      useUI.getState().toast("Download failed to start — please retry.", "error");
      void pumpDownloadQueue();
    }
    // Completion arrives as a download event, which releases the slot.
  } catch (err) {
    // Only the bridge call itself can reject here; engine failures arrive
    // as `failed` events and release the slot through the listener.
    activeDownloadIds.delete(track.id);
    launchedDownloadIds.delete(track.id);
    resolveLaunchWaiters(track.id, false);
    useLibrary.getState().patchDownload(track.id, { status: "failed", progress: 0 });
    useUI.getState().toast(
      `Download failed: ${err instanceof Error ? err.message : "unknown error"}`,
      "error"
    );
    void pumpDownloadQueue();
  }
}

/** Resolves true when the `start` event for `id` arrives, false after
 *  `timeoutMs` without one. A `start` that arrived before the wait began
 *  resolves immediately. */
function waitForLaunch(id: string, timeoutMs: number): Promise<boolean> {
  if (launchedDownloadIds.has(id)) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let existing = launchWaiters.get(id);
    if (!existing) {
      existing = new Set();
      launchWaiters.set(id, existing);
    }
    const waiterSet: Set<(launched: boolean) => void> = existing;
    const wrapped = (launched: boolean): void => {
      clearTimeout(timer);
      resolve(launched);
    };
    const timer = setTimeout(() => {
      waiterSet.delete(wrapped);
      resolve(false);
    }, timeoutMs);
    waiterSet.add(wrapped);
  });
}

/** Before a download starts, evict least-recently-played downloads while
 *  the library is over the storage cap. Liked tracks are never evicted.
 *  Evictions are explained with a toast naming what was removed.
 *  Accounting failures never block the download. */
async function enforceStorageCapBeforeDownload(): Promise<void> {
  try {
    const likedIds = new Set(useLibrary.getState().liked.map((t) => t.id));
    const { evictedIds, freedBytes } = await enforceOfflineStorageCap((id) => likedIds.has(id));
    if (evictedIds.length === 0) return;
    const lib = useLibrary.getState();
    const titles = evictedIds.map((id) => lib.downloads[id]?.track.title ?? id);
    for (const id of evictedIds) lib.removeDownload(id);
    const named = titles.length === 1 ? `"${titles[0]}"` : `"${titles[0]}" and ${titles.length - 1} more`;
    useUI.getState().toast(
      `Storage cap reached: removed ${named} (${fmtBytes(freedBytes)} freed) — oldest unliked downloads go first. Liked downloads are never removed.`,
      "warning"
    );
  } catch {
    /* storage accounting must never block a download */
  }
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
      // A full disk is actionable, not generic: say so even inside a
      // batch, and point at the Downloads view where space is managed.
      const reason = e.reason ?? "unknown error";
      const storageFull = reason.startsWith("Storage full");
      if (storageFull) {
        useUI.getState().toast(`${reason} Manage downloads in the Downloads view.`, "error");
      }
      if (!checkBatchItem(e.id, false) && !storageFull) {
        useUI.getState().toast(`Download failed: ${reason}`, "error");
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
