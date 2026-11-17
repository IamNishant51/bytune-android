/**
 * Native IndexedDB offline audio cache for mobile.
 *
 * Stores full audio Blobs in IndexedDB, enabling offline playback of
 * downloaded songs and playlists without network or main-process
 * dependencies.
 *
 * Schema (v3):
 * - `tracks`: the audio blob + track record (keyPath `id`).
 * - `lyrics`: cached lyrics (keyPath `id`).
 * - `meta`: blob-free metadata for every download (keyPath `id`) — boot
 *   reconciliation and storage accounting read this store only, never
 *   `getAll()` on the blob store.
 * - `artwork`: one small (<=256px) cover blob per download (keyPath `id`).
 * - `partials`: resume anchors for interrupted downloads (keyPath `id`).
 * - `chunks`: persisted 1 MiB download chunks (keyPath `key`, where
 *   `key` is `<id>:<zero-padded index>` so cursor order is chunk order).
 *
 * Downloads are chunked 1 MiB `Range` requests through the loopback proxy
 * (fetch + reader — the same streaming path the web fallback always used),
 * with per-chunk retry, persisted chunk progress for resume, real byte
 * progress, and a per-id cancel set that is checked between chunks and
 * after every await. A cancelled download never persists a blob.
 */
import type { LyricsResult, Track } from "../types";
import { upgradeArtwork } from "../lib/artwork";
import { resolveStream } from "./music";
import { proxyUrl } from "./bridge";

const DB_NAME = "bytune-offline-audio";
const DB_VERSION = 3;
const STORE_NAME = "tracks";
const LYRICS_STORE = "lyrics";
const META_STORE = "meta";
const ARTWORK_STORE = "artwork";
const PARTIALS_STORE = "partials";
const CHUNKS_STORE = "chunks";

/** Download chunk size: 1 MiB `Range` requests, persisted per chunk. */
export const DOWNLOAD_CHUNK_BYTES = 1024 * 1024;
const CHUNK_ATTEMPTS = 3;
const CHUNK_RETRY_DELAYS_MS = [1000, 3000];
const ARTWORK_FETCH_TIMEOUT_MS = 10000;
const MAX_OFFLINE_ARTWORK_BYTES = 512 * 1024;

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/** Thrown when a download is cancelled. Named `AbortError` so the existing
 *  bridge cancel handling (which checks `err.name` / "cancelled" in the
 *  message) keeps emitting `cancelled` instead of `failed`. */
class DownloadCancelledError extends Error {
  constructor() {
    super("Download cancelled");
    this.name = "AbortError";
  }
}

class HttpStatusError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Download failed: HTTP ${status}`);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

function errorName(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "name" in err) {
    const name = (err as { name: unknown }).name;
    return typeof name === "string" ? name : undefined;
  }
  return undefined;
}

function isAbortLike(err: unknown): boolean {
  return errorName(err) === "AbortError";
}

function isQuotaError(err: unknown): boolean {
  return errorName(err) === "QuotaExceededError";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/* Shared IndexedDB connection (D-09)                                  */
/* ------------------------------------------------------------------ */

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const oldVersion = event.oldVersion;
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(LYRICS_STORE)) {
          db.createObjectStore(LYRICS_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(ARTWORK_STORE)) {
          db.createObjectStore(ARTWORK_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(PARTIALS_STORE)) {
          db.createObjectStore(PARTIALS_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
          db.createObjectStore(CHUNKS_STORE, { keyPath: "key" });
        }
        // Backfill `meta` from existing v2 records, one cursor step at a
        // time — never getAll() on the blob store. Requests created here
        // keep the version-change transaction alive until the walk ends.
        // Any failure is harmless: listOfflineMeta() backfills lazily.
        const tx = req.transaction;
        if (tx && oldVersion > 0 && oldVersion < DB_VERSION) {
          try {
            const tracksStore = tx.objectStore(STORE_NAME);
            const metaStore = tx.objectStore(META_STORE);
            const cursorReq = tracksStore.openCursor();
            cursorReq.onsuccess = () => {
              const cursor = cursorReq.result;
              if (!cursor) return;
              const meta = toOfflineMeta(cursor.value as unknown);
              if (meta) {
                try {
                  metaStore.put(meta);
                } catch {
                  /* lazy backfill covers this record */
                }
              }
              cursor.continue();
            };
            cursorReq.onerror = () => {
              /* lazy backfill covers this */
            };
          } catch {
            /* lazy backfill covers this */
          }
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // Another context is upgrading: close so the upgrade is not
        // blocked forever, and drop the cached promise so the next
        // operation reopens on the new version.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
      req.onblocked = () => {
        /* Another tab holds an old connection; the open waits. */
      };
    });
    // A rejected open must not poison the cache for later operations.
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

/* ------------------------------------------------------------------ */
/* Small IndexedDB helpers                                             */
/* ------------------------------------------------------------------ */

async function idbGet<T>(
  storeName: string,
  key: string,
  parse: (value: unknown) => T | null
): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(parse(req.result as unknown));
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function idbPut(storeName: string, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted"));
    tx.objectStore(storeName).put(value);
  });
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB delete aborted"));
    tx.objectStore(storeName).delete(key);
  });
}

/* ------------------------------------------------------------------ */
/* Stored record shapes                                                */
/* ------------------------------------------------------------------ */

export interface OfflineMeta {
  id: string;
  track?: Track;
  size: number;
  mime: string;
  savedAt: number;
  lastPlayedAt: number;
  /** Measured loudness, when known at download time; null otherwise. */
  lufs: number | null;
}

interface OfflineTrackRecord {
  id: string;
  blob: Blob;
  track?: Track;
  size: number;
  mime: string;
  savedAt: number;
  lufs?: number | null;
}

interface PartialDownloadRecord {
  id: string;
  downloaded: number;
  /** 0 when the total was never learned (Range unsupported) — not resumable. */
  total: number;
  etag: string | null;
  mime: string;
  updatedAt: number;
}

interface ChunkRecord {
  key: string;
  id: string;
  index: number;
  data: ArrayBuffer;
}

function isTrackLike(value: unknown): value is Track {
  if (typeof value !== "object" || value === null) return false;
  const rec = value as Record<string, unknown>;
  return typeof rec.id === "string" && typeof rec.title === "string";
}

/** Project the scalar metadata fields out of a tracks-store or meta-store
 *  record. The blob (when present) is never touched. */
function toOfflineMeta(value: unknown): OfflineMeta | null {
  if (typeof value !== "object" || value === null) return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.id !== "string" || rec.id === "") return null;
  const size = typeof rec.size === "number" && Number.isFinite(rec.size) ? rec.size : 0;
  const savedAt = typeof rec.savedAt === "number" ? rec.savedAt : 0;
  const lastPlayedAt = typeof rec.lastPlayedAt === "number" ? rec.lastPlayedAt : savedAt;
  const lufs = typeof rec.lufs === "number" && Number.isFinite(rec.lufs) ? rec.lufs : null;
  return {
    id: rec.id,
    track: isTrackLike(rec.track) ? rec.track : undefined,
    size,
    mime: typeof rec.mime === "string" ? rec.mime : "",
    savedAt,
    lastPlayedAt,
    lufs,
  };
}

function toTrackRecord(value: unknown): OfflineTrackRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.id !== "string" || !(rec.blob instanceof Blob)) return null;
  return {
    id: rec.id,
    blob: rec.blob,
    track: isTrackLike(rec.track) ? rec.track : undefined,
    size: typeof rec.size === "number" ? rec.size : rec.blob.size,
    mime: typeof rec.mime === "string" ? rec.mime : rec.blob.type,
    savedAt: typeof rec.savedAt === "number" ? rec.savedAt : 0,
    lufs: typeof rec.lufs === "number" ? rec.lufs : null,
  };
}

function toPartialRecord(value: unknown): PartialDownloadRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.id !== "string") return null;
  if (typeof rec.downloaded !== "number" || typeof rec.total !== "number") return null;
  return {
    id: rec.id,
    downloaded: rec.downloaded,
    total: rec.total,
    etag: typeof rec.etag === "string" ? rec.etag : null,
    mime: typeof rec.mime === "string" ? rec.mime : "",
    updatedAt: typeof rec.updatedAt === "number" ? rec.updatedAt : 0,
  };
}

function toChunkRecord(value: unknown): ChunkRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.key !== "string" || typeof rec.id !== "string") return null;
  if (typeof rec.index !== "number" || !(rec.data instanceof ArrayBuffer)) return null;
  return { key: rec.key, id: rec.id, index: rec.index, data: rec.data };
}

/* ------------------------------------------------------------------ */
/* Blob reads                                                          */
/* ------------------------------------------------------------------ */

export async function getOfflineBlob(id: string): Promise<Blob | null> {
  const rec = await idbGet(STORE_NAME, id, toTrackRecord);
  return rec?.blob ?? null;
}

export async function hasOfflineBlob(id: string): Promise<boolean> {
  try {
    const db = await openDb();
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).count(id);
      req.onsuccess = () => resolve(req.result > 0);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/**
 * Async by necessity: IndexedDB has no synchronous read. This is the
 * contract Track A uses in the Artwork component for offline tracks.
 */
export async function isOfflineAvailable(id: string): Promise<boolean> {
  return hasOfflineBlob(id);
}

/* ------------------------------------------------------------------ */
/* Blob writes                                                         */
/* ------------------------------------------------------------------ */

export interface SaveOfflineOptions {
  /** Measured loudness from stream resolution, persisted for offline gain. */
  lufs?: number | null;
  /** Small (<=256px) cover blob, stored in the artwork store. Best-effort:
   *  a failure here never fails the audio save. */
  artwork?: Blob | null;
}

export async function saveOfflineBlob(
  id: string,
  blob: Blob,
  track?: Track,
  opts?: SaveOfflineOptions
): Promise<void> {
  const db = await openDb();
  const now = Date.now();
  const lufs = opts?.lufs ?? null;
  // One transaction across both stores: the blob and its metadata land
  // together, so listOfflineMeta() can never miss a saved download.
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, META_STORE], "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted"));
    tx.objectStore(STORE_NAME).put({
      id,
      blob,
      track: track ?? undefined,
      size: blob.size,
      mime: blob.type,
      savedAt: now,
      lufs,
    });
    tx.objectStore(META_STORE).put({
      id,
      track: track ?? undefined,
      size: blob.size,
      mime: blob.type,
      savedAt: now,
      lastPlayedAt: now,
      lufs,
    });
  });
  if (opts?.artwork) {
    await saveOfflineArtwork(id, opts.artwork).catch(() => undefined);
  }
}

export async function deleteOfflineBlob(id: string): Promise<void> {
  revokeCachedArtworkUrl(id);
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, META_STORE, ARTWORK_STORE], "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB delete aborted"));
      tx.objectStore(STORE_NAME).delete(id);
      tx.objectStore(META_STORE).delete(id);
      tx.objectStore(ARTWORK_STORE).delete(id);
    });
  } catch {
    /* delete is best-effort */
  }
  await deletePartialState(id);
  void deleteOfflineLyrics(id);
}

/* ------------------------------------------------------------------ */
/* Metadata-only listing (D-06) — boot must use this, never getAll()   */
/* on the blob store.                                                  */
/* ------------------------------------------------------------------ */

/**
 * Metadata for every download, without blobs. Reads the `meta` store
 * (blob-free records) — safe at boot for any library size.
 */
export async function listOfflineMeta(): Promise<OfflineMeta[]> {
  try {
    const db = await openDb();
    const metas = await new Promise<OfflineMeta[]>((resolve) => {
      const tx = db.transaction(META_STORE, "readonly");
      const req = tx.objectStore(META_STORE).getAll();
      req.onsuccess = () => {
        const rows: unknown[] = req.result ?? [];
        const out: OfflineMeta[] = [];
        for (const row of rows) {
          const meta = toOfflineMeta(row);
          if (meta) out.push(meta);
        }
        resolve(out);
      };
      req.onerror = () => resolve([]);
    });
    if (metas.length > 0) return metas;
    // Empty meta store with a non-empty library means the v2→v3 migration
    // backfill did not run (or found nothing yet): project the fields via
    // a cursor walk — still never getAll() on the blob store — and persist
    // the backfill for next time.
    return await backfillMetaFromTracks();
  } catch {
    return [];
  }
}

async function backfillMetaFromTracks(): Promise<OfflineMeta[]> {
  try {
    const db = await openDb();
    const metas: OfflineMeta[] = [];
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        const meta = toOfflineMeta(cursor.value as unknown);
        if (meta) metas.push(meta);
        cursor.continue();
      };
      req.onerror = () => resolve();
    });
    for (const meta of metas) {
      await idbPut(META_STORE, meta).catch(() => undefined);
    }
    return metas;
  } catch {
    return [];
  }
}

/** Record a play so LRU eviction keeps recently played downloads. The
 *  playback path (Track B) calls this on play start; it is deliberately
 *  not wired into getOfflineBlob, which also serves download checks. */
export async function touchOfflinePlayed(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(META_STORE, "readwrite");
      const store = tx.objectStore(META_STORE);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const meta = toOfflineMeta(getReq.result as unknown);
        if (meta) {
          try {
            store.put({ ...meta, lastPlayedAt: Date.now() });
          } catch {
            /* ignore */
          }
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Offline artwork (D-08)                                              */
/* ------------------------------------------------------------------ */

const artworkUrls = new Map<string, string>();

function revokeCachedArtworkUrl(id: string): void {
  const url = artworkUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    artworkUrls.delete(id);
  }
}

export async function saveOfflineArtwork(id: string, blob: Blob): Promise<void> {
  // A replaced cover must not leave the old object URL alive.
  revokeCachedArtworkUrl(id);
  await idbPut(ARTWORK_STORE, { id, blob, mime: blob.type, savedAt: Date.now() });
}

export async function getOfflineArtwork(id: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    return await new Promise<Blob | null>((resolve) => {
      const tx = db.transaction(ARTWORK_STORE, "readonly");
      const req = tx.objectStore(ARTWORK_STORE).get(id);
      req.onsuccess = () => {
        const rec = req.result as unknown;
        if (typeof rec === "object" && rec !== null) {
          const blob = (rec as Record<string, unknown>).blob;
          resolve(blob instanceof Blob ? blob : null);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Object URL for a download's cached cover, or null when no cover was
 * cached. The URL is cached per id (repeat calls return the same URL) and
 * revoked when the cover is replaced or the download deleted — callers
 * must not revoke it themselves. Async: IndexedDB has no sync read.
 */
export async function getOfflineArtworkURL(id: string): Promise<string | null> {
  const cached = artworkUrls.get(id);
  if (cached) return cached;
  const blob = await getOfflineArtwork(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  artworkUrls.set(id, url);
  return url;
}

/** Release a cached artwork URL early (e.g. component unmount). The next
 *  getOfflineArtworkURL() call re-creates it from the stored blob. */
export function releaseOfflineArtworkURL(id: string): void {
  revokeCachedArtworkUrl(id);
}

/* ------------------------------------------------------------------ */
/* Lyrics cache (unchanged behaviour, shared connection)               */
/* ------------------------------------------------------------------ */

export async function getOfflineLyrics(id: string): Promise<LyricsResult | null> {
  try {
    const db = await openDb();
    if (!db.objectStoreNames.contains(LYRICS_STORE)) return null;
    return await new Promise((resolve) => {
      const tx = db.transaction(LYRICS_STORE, "readonly");
      const req = tx.objectStore(LYRICS_STORE).get(id);
      req.onsuccess = () => {
        const rec = req.result as unknown;
        if (typeof rec === "object" && rec !== null) {
          const lyrics = (rec as Record<string, unknown>).lyrics;
          resolve((lyrics as LyricsResult | undefined) ?? null);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function saveOfflineLyrics(id: string, lyrics: LyricsResult): Promise<void> {
  try {
    const db = await openDb();
    if (!db.objectStoreNames.contains(LYRICS_STORE)) return;
    await idbPut(LYRICS_STORE, { id, lyrics, savedAt: Date.now() });
  } catch {
    /* ignore */
  }
}

export async function deleteOfflineLyrics(id: string): Promise<void> {
  try {
    const db = await openDb();
    if (!db.objectStoreNames.contains(LYRICS_STORE)) return;
    await idbDelete(LYRICS_STORE, id);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Storage accounting + cap policy (D-07)                              */
/* ------------------------------------------------------------------ */

/** Hard ceiling for offline audio: 1 GiB, or 80% of the storage estimate,
 *  whichever is smaller. */
export const OFFLINE_STORAGE_HARD_CAP_BYTES = 1024 * 1024 * 1024;
export const OFFLINE_STORAGE_WARN_FRACTION = 0.8;

export function offlineStorageCapBytes(quotaBytes: number | null): number {
  if (quotaBytes !== null && Number.isFinite(quotaBytes) && quotaBytes > 0) {
    return Math.min(OFFLINE_STORAGE_HARD_CAP_BYTES, Math.floor(quotaBytes * 0.8));
  }
  return OFFLINE_STORAGE_HARD_CAP_BYTES;
}

export interface OfflineStorageStats {
  totalBytes: number;
  trackCount: number;
  /** Whole-origin quota from navigator.storage.estimate(), when available. */
  quotaBytes: number | null;
  usageBytes: number | null;
  capBytes: number;
  warnAtBytes: number;
  overCap: boolean;
  nearCap: boolean;
}

export async function getOfflineStorageStats(): Promise<OfflineStorageStats> {
  const metas = await listOfflineMeta();
  const totalBytes = metas.reduce((sum, meta) => sum + meta.size, 0);
  let quotaBytes: number | null = null;
  let usageBytes: number | null = null;
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate) {
      quotaBytes = typeof estimate.quota === "number" ? estimate.quota : null;
      usageBytes = typeof estimate.usage === "number" ? estimate.usage : null;
    }
  } catch {
    /* estimate unavailable — the hard cap still applies */
  }
  const capBytes = offlineStorageCapBytes(quotaBytes);
  const warnAtBytes = Math.floor(capBytes * OFFLINE_STORAGE_WARN_FRACTION);
  return {
    totalBytes,
    trackCount: metas.length,
    quotaBytes,
    usageBytes,
    capBytes,
    warnAtBytes,
    overCap: totalBytes > capBytes,
    nearCap: totalBytes >= warnAtBytes,
  };
}

/**
 * LRU eviction: while the total is over the cap, delete the
 * least-recently-played download that `isProtected` does not protect.
 * Liked tracks are never evicted — callers pass a predicate that returns
 * true for liked ids. Returns what was actually removed (a failed delete
 * is not counted as freed). The caller owns the library-store rows and
 * the user-facing toast.
 */
export async function enforceOfflineStorageCap(
  isProtected?: (id: string) => boolean
): Promise<{ evictedIds: string[]; freedBytes: number }> {
  const stats = await getOfflineStorageStats();
  if (!stats.overCap) return { evictedIds: [], freedBytes: 0 };
  const metas = await listOfflineMeta();
  const candidates = metas
    .filter((meta) => !(isProtected?.(meta.id) ?? false))
    .sort((a, b) => (a.lastPlayedAt || a.savedAt) - (b.lastPlayedAt || b.savedAt));
  let total = stats.totalBytes;
  const evictedIds: string[] = [];
  let freedBytes = 0;
  for (const meta of candidates) {
    if (total <= stats.capBytes) break;
    await deleteOfflineBlob(meta.id);
    if (await hasOfflineBlob(meta.id)) continue;
    evictedIds.push(meta.id);
    freedBytes += meta.size;
    total -= meta.size;
  }
  return { evictedIds, freedBytes };
}

/* ------------------------------------------------------------------ */
/* Cancel (D-03)                                                       */
/* ------------------------------------------------------------------ */

/** Ids cancelled while a download is in flight. Checked between chunks
 *  and after every await in the download engine; cleared when a fresh
 *  download attempt starts for the id. */
const cancelledDownloadIds = new Set<string>();

/** CONTRACT: Track B's bridge.cancelDownload calls this. It marks the id
 *  cancelled (the chunk loop stops at the next check) and drops any
 *  persisted partial state. It never touches a completed blob — deleting
 *  a finished download stays deleteOfflineBlob's job. */
export function cancelOfflineDownload(id: string): void {
  cancelledDownloadIds.add(id);
  void deletePartialState(id);
}

function clearCancelledDownload(id: string): void {
  cancelledDownloadIds.delete(id);
}

function isDownloadCancelled(id: string): boolean {
  return cancelledDownloadIds.has(id);
}

function assertNotCancelled(id: string, signal?: AbortSignal): void {
  if (isDownloadCancelled(id) || signal?.aborted) throw new DownloadCancelledError();
}

/* ------------------------------------------------------------------ */
/* Partial / chunk persistence (resume)                                */
/* ------------------------------------------------------------------ */

function chunkKey(id: string, index: number): string {
  return `${id}:${String(index).padStart(6, "0")}`;
}

function chunkKeyRange(id: string): IDBKeyRange {
  // ':' (0x3A) < ';' (0x3B), so every `<id>:<index>` key sorts inside.
  return IDBKeyRange.bound(`${id}:`, `${id};`, false, true);
}

async function getPartialRecord(id: string): Promise<PartialDownloadRecord | null> {
  return idbGet(PARTIALS_STORE, id, toPartialRecord);
}

async function savePartialRecord(record: PartialDownloadRecord): Promise<void> {
  await idbPut(PARTIALS_STORE, record);
}

async function saveChunkRecord(id: string, index: number, data: ArrayBuffer): Promise<void> {
  await idbPut(CHUNKS_STORE, { key: chunkKey(id, index), id, index, data });
}

async function getChunkRecord(id: string, index: number): Promise<ChunkRecord | null> {
  return idbGet(CHUNKS_STORE, chunkKey(id, index), toChunkRecord);
}

async function listStoredChunkIndexes(id: string): Promise<number[]> {
  try {
    const db = await openDb();
    return await new Promise<number[]>((resolve) => {
      const tx = db.transaction(CHUNKS_STORE, "readonly");
      const req = tx.objectStore(CHUNKS_STORE).getAllKeys(chunkKeyRange(id));
      req.onsuccess = () => {
        const indexes: number[] = [];
        const keys: unknown[] = req.result ?? [];
        for (const key of keys) {
          if (typeof key !== "string") continue;
          const suffix = key.slice(key.lastIndexOf(":") + 1);
          const index = Number(suffix);
          if (Number.isSafeInteger(index) && index >= 0) indexes.push(index);
        }
        indexes.sort((a, b) => a - b);
        resolve(indexes);
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

function countContiguousFromZero(sortedIndexes: number[]): number {
  let count = 0;
  for (const index of sortedIndexes) {
    if (index !== count) break;
    count++;
  }
  return count;
}

/** Delete a download's resume anchor and every persisted chunk. Best
 *  effort: failures leave orphaned chunk records, which the next attempt
 *  discards (resume requires a matching partial record). */
async function deletePartialState(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction([PARTIALS_STORE, CHUNKS_STORE], "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
      tx.objectStore(PARTIALS_STORE).delete(id);
      const cursorReq = tx.objectStore(CHUNKS_STORE).openCursor(chunkKeyRange(id));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        try {
          cursor.delete();
        } catch {
          /* ignore */
        }
        cursor.continue();
      };
    });
  } catch {
    /* ignore */
  }
}

/** Validate a persisted partial download for resume. The stored byte
 *  count must match the contiguous chunk prefix exactly, the MIME must
 *  match the freshly resolved stream, and the total must be known. */
async function validateResume(
  id: string,
  mime: string
): Promise<{ downloaded: number; total: number; etag: string | null } | null> {
  const partial = await getPartialRecord(id);
  if (!partial) return null;
  if (partial.total <= 0 || partial.downloaded <= 0) return null;
  if (partial.downloaded > partial.total || partial.mime !== mime) return null;
  const indexes = await listStoredChunkIndexes(id);
  const contiguous = countContiguousFromZero(indexes);
  if (contiguous === 0) return null;
  if (partial.downloaded === contiguous * DOWNLOAD_CHUNK_BYTES) {
    return { downloaded: partial.downloaded, total: partial.total, etag: partial.etag };
  }
  // A complete file whose final chunk is short: the byte count must match
  // the full prefix plus the last chunk's actual length.
  if (partial.downloaded === partial.total) {
    const last = await getChunkRecord(id, contiguous - 1);
    if (
      last &&
      partial.downloaded === (contiguous - 1) * DOWNLOAD_CHUNK_BYTES + last.data.byteLength
    ) {
      return { downloaded: partial.downloaded, total: partial.total, etag: partial.etag };
    }
  }
  return null;
}

/** Assemble persisted chunks, in index order, into one pre-sized buffer.
 *  The total must match the assembled bytes exactly, or the download is
 *  corrupt and must not be saved. */
async function assembleChunks(id: string, total: number): Promise<Uint8Array<ArrayBuffer>> {
  const db = await openDb();
  const out: Uint8Array<ArrayBuffer> = new Uint8Array(total);
  let offset = 0;
  let expectedIndex = 0;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CHUNKS_STORE, "readonly");
    const req = tx.objectStore(CHUNKS_STORE).openCursor(chunkKeyRange(id));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      const rec = toChunkRecord(cursor.value as unknown);
      if (!rec || rec.index !== expectedIndex) {
        reject(new Error("Download failed: missing or out-of-order download chunk"));
        return;
      }
      const bytes = new Uint8Array(rec.data);
      if (offset + bytes.length > total) {
        reject(new Error("Download failed: downloaded data exceeds the expected size"));
        return;
      }
      out.set(bytes, offset);
      offset += bytes.length;
      expectedIndex++;
      cursor.continue();
    };
    req.onerror = () => reject(req.error ?? new Error("Failed to read download chunks"));
  });
  if (offset !== total) {
    throw new Error(`Download failed: incomplete data (${offset} of ${total} bytes)`);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Chunked download engine (D-01, D-02, D-05)                          */
/* ------------------------------------------------------------------ */

function parseContentRange(
  header: string | null
): { start: number; end: number; total: number | null } | null {
  if (!header) return null;
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(header.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === "*" ? null : Number(match[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;
  if (total !== null && (!Number.isSafeInteger(total) || total <= end)) return null;
  return { start, end, total };
}

function cancelResponseBody(res: Response): void {
  try {
    const done = res.body?.cancel();
    if (done) void done.catch(() => undefined);
  } catch {
    /* ignore */
  }
}

type ChunkFetchResult =
  | { kind: "chunk"; data: ArrayBuffer; total: number | null; etag: string | null }
  | { kind: "no-range" }
  | { kind: "unsatisfiable" };

/**
 * Fetch one chunk with per-chunk retry (3 attempts, 1s/3s backoff). A
 * 403/410 re-resolves the stream once and retries with the fresh URL.
 * A 200 means the server ignored the Range header: the body is cancelled
 * unread and the caller falls back to a streaming fetch.
 */
async function fetchChunkBytes(
  urlBox: { current: string },
  start: number,
  end: number,
  signal: AbortSignal | undefined,
  id: string,
  reResolve: () => Promise<string>
): Promise<ChunkFetchResult> {
  let reresolved = false;
  for (let attempt = 0; attempt < CHUNK_ATTEMPTS; attempt++) {
    assertNotCancelled(id, signal);
    try {
      const res = await fetch(urlBox.current, {
        // googlevideo throttles header-less GETs to ~30 kB/s; a byte range
        // gets the full pipe. Every chunk request carries a Range header.
        headers: { Range: `bytes=${start}-${end}` },
        signal,
      });
      if (res.status === 403 || res.status === 410) {
        cancelResponseBody(res);
        if (!reresolved) {
          reresolved = true;
          urlBox.current = await reResolve();
          assertNotCancelled(id, signal);
          continue;
        }
        throw new HttpStatusError(res.status);
      }
      if (res.status === 200) {
        cancelResponseBody(res);
        return { kind: "no-range" };
      }
      if (res.status === 416) {
        // Past the end of the file: with an unknown total this is the only
        // EOF signal for a file whose size is an exact chunk multiple.
        // Never retried — retrying the same range would 416 forever.
        cancelResponseBody(res);
        return { kind: "unsatisfiable" };
      }
      if (res.status !== 206) {
        cancelResponseBody(res);
        throw new HttpStatusError(res.status);
      }
      const range = parseContentRange(res.headers.get("content-range"));
      const data = await res.arrayBuffer();
      if (range && data.byteLength !== range.end - range.start + 1) {
        throw new Error(
          `Download failed: short read (${data.byteLength} bytes for a ${range.end - range.start + 1}-byte chunk)`
        );
      }
      if (data.byteLength > DOWNLOAD_CHUNK_BYTES) {
        throw new Error("Download failed: chunk larger than expected");
      }
      return { kind: "chunk", data, total: range?.total ?? null, etag: res.headers.get("etag") };
    } catch (err) {
      if (err instanceof DownloadCancelledError) throw err;
      if (isAbortLike(err) || isDownloadCancelled(id) || signal?.aborted) {
        throw new DownloadCancelledError();
      }
      if (isQuotaError(err)) throw err;
      if (attempt + 1 < CHUNK_ATTEMPTS) {
        await sleep(CHUNK_RETRY_DELAYS_MS[attempt] ?? 1000);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Download failed: chunk retries exhausted");
}

/** Best-effort small cover fetch for the offline record. Any failure
 *  (including CORS on the artwork host) just means no cached cover. */
async function fetchOfflineArtwork(track: Track): Promise<Blob | null> {
  const url = upgradeArtwork(track.thumb, 256);
  if (!url) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ARTWORK_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      const blob = await res.blob();
      return blob.size > 0 && blob.size <= MAX_OFFLINE_ARTWORK_BYTES ? blob : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/** Assemble, attach artwork + loudness, persist, and clean up partial
 *  state. A cancel landing during the save deletes the just-saved blob:
 *  a cancelled download must never persist. */
async function finishDownload(
  track: Track,
  mime: string,
  lufs: number | null,
  total: number,
  onProgress: ((progress: { downloaded: number; total: number }) => void) | undefined,
  signal: AbortSignal | undefined
): Promise<Blob> {
  const id = track.id;
  assertNotCancelled(id, signal);
  const bytes = await assembleChunks(id, total);
  assertNotCancelled(id, signal);
  const blob = new Blob([bytes], { type: mime });
  const artwork = await fetchOfflineArtwork(track);
  assertNotCancelled(id, signal);
  await saveOfflineBlob(id, blob, track, { lufs, artwork });
  if (isDownloadCancelled(id) || signal?.aborted) {
    await deleteOfflineBlob(id);
    await deletePartialState(id);
    throw new DownloadCancelledError();
  }
  await deletePartialState(id);
  onProgress?.({ downloaded: total, total });
  return blob;
}

/**
 * Range-based download loop. Chunks are fetched sequentially, persisted
 * as they land, and reported with real byte progress. A total/ETag
 * mismatch against the resume anchor restarts the download from zero —
 * at most once per attempt.
 */
async function downloadWithRanges(
  track: Track,
  mime: string,
  lufs: number | null,
  urlBox: { current: string },
  reResolve: () => Promise<string>,
  onProgress: ((progress: { downloaded: number; total: number }) => void) | undefined,
  signal: AbortSignal | undefined,
  resume: { downloaded: number; total: number; etag: string | null } | null
): Promise<Blob> {
  const id = track.id;
  let chunkIndex = resume ? resume.downloaded / DOWNLOAD_CHUNK_BYTES : 0;
  let downloaded = resume?.downloaded ?? 0;
  let total: number | null = resume?.total ?? null;
  let etag: string | null = resume?.etag ?? null;
  let restarted = false;

  // A resume that already holds every byte skips the loop and assembles.
  for (;;) {
    assertNotCancelled(id, signal);
    if (total !== null && downloaded >= total) break;
    const start = chunkIndex * DOWNLOAD_CHUNK_BYTES;
    const end =
      total !== null
        ? Math.min(start + DOWNLOAD_CHUNK_BYTES - 1, total - 1)
        : start + DOWNLOAD_CHUNK_BYTES - 1;
    const fetched = await fetchChunkBytes(urlBox, start, end, signal, id, reResolve);
    assertNotCancelled(id, signal);

    if (fetched.kind === "unsatisfiable") {
      if (total === null && downloaded > 0) {
        // Unknown total + exact chunk multiple: the 416 is the EOF signal.
        total = downloaded;
        break;
      }
      // A known total must never 416: the file shrank. Drop the partial
      // state so the next attempt starts fresh instead of resuming into
      // the same 416.
      await deletePartialState(id);
      throw new Error("Download failed: file changed during download");
    }

    if (fetched.kind === "no-range") {
      // The server ignored the Range header. Range is unsupported for this
      // URL, at any offset — discard partial state and stream the whole
      // file from the start rather than failing the download.
      await deletePartialState(id);
      return streamWholeFile(track, mime, lufs, urlBox, onProgress, signal);
    }

    if (total !== null && fetched.total !== null && fetched.total !== total) {
      if (restarted) throw new Error("Download failed: file size changed during download");
      restarted = true;
      await deletePartialState(id);
      chunkIndex = 0;
      downloaded = 0;
      total = null;
      etag = null;
      continue;
    }
    if (etag !== null && fetched.etag !== null && fetched.etag !== etag) {
      if (restarted) throw new Error("Download failed: file changed during download");
      restarted = true;
      await deletePartialState(id);
      chunkIndex = 0;
      downloaded = 0;
      total = null;
      etag = null;
      continue;
    }
    if (fetched.total !== null) total = fetched.total;
    if (fetched.etag !== null) etag = fetched.etag;

    await saveChunkRecord(id, chunkIndex, fetched.data);
    downloaded += fetched.data.byteLength;
    chunkIndex += 1;
    await savePartialRecord({ id, downloaded, total: total ?? 0, etag, mime, updatedAt: Date.now() });
    assertNotCancelled(id, signal);
    onProgress?.({ downloaded, total: total ?? downloaded });

    // With an unknown total, a short chunk is the end of the file.
    if (total === null && fetched.data.byteLength < DOWNLOAD_CHUNK_BYTES) {
      total = downloaded;
      break;
    }
  }

  if (total === null) total = downloaded;
  if (total <= 0) throw new Error("Download failed: empty audio stream");
  return finishDownload(track, mime, lufs, total, onProgress, signal);
}

/**
 * Fallback for servers that ignore Range: one streaming fetch, read via a
 * reader and persisted in 1 MiB chunk records as bytes arrive, with real
 * byte progress. Resume is only possible when the response carried a
 * Content-Length (otherwise the partial record holds total 0 and the next
 * attempt restarts).
 */
async function streamWholeFile(
  track: Track,
  mime: string,
  lufs: number | null,
  urlBox: { current: string },
  onProgress: ((progress: { downloaded: number; total: number }) => void) | undefined,
  signal: AbortSignal | undefined
): Promise<Blob> {
  const id = track.id;
  const res = await fetch(urlBox.current, { signal });
  if (!res.ok) throw new HttpStatusError(res.status);
  const contentLength = Number(res.headers.get("content-length") || 0);
  const total = Number.isSafeInteger(contentLength) && contentLength > 0 ? contentLength : null;
  const reader = res.body?.getReader();
  if (!reader) {
    const data = await res.arrayBuffer();
    if (data.byteLength === 0) throw new Error("Download failed: empty audio stream");
    let offset = 0;
    let chunkIndex = 0;
    while (offset < data.byteLength) {
      const piece = data.slice(offset, offset + DOWNLOAD_CHUNK_BYTES);
      await saveChunkRecord(id, chunkIndex, piece);
      chunkIndex += 1;
      offset += piece.byteLength;
    }
    return finishDownload(track, mime, lufs, data.byteLength, onProgress, signal);
  }

  let pending = new Uint8Array(0);
  let downloaded = 0;
  let chunkIndex = 0;
  for (;;) {
    assertNotCancelled(id, signal);
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    assertNotCancelled(id, signal);
    const merged = new Uint8Array(pending.length + value.length);
    merged.set(pending, 0);
    merged.set(value, pending.length);
    pending = merged;
    downloaded += value.length;
    while (pending.length >= DOWNLOAD_CHUNK_BYTES) {
      const piece = pending.slice(0, DOWNLOAD_CHUNK_BYTES);
      pending = pending.slice(DOWNLOAD_CHUNK_BYTES);
      await saveChunkRecord(id, chunkIndex, piece.buffer as ArrayBuffer);
      chunkIndex += 1;
      await savePartialRecord({
        id,
        downloaded: chunkIndex * DOWNLOAD_CHUNK_BYTES,
        total: total ?? 0,
        etag: null,
        mime,
        updatedAt: Date.now(),
      });
      assertNotCancelled(id, signal);
    }
    onProgress?.({ downloaded, total: total ?? downloaded });
  }
  if (pending.length > 0) {
    await saveChunkRecord(id, chunkIndex, pending.buffer as ArrayBuffer);
    chunkIndex += 1;
  }
  if (total !== null && downloaded !== total) {
    throw new Error(`Download failed: incomplete stream (${downloaded} of ${total} bytes)`);
  }
  if (downloaded <= 0) throw new Error("Download failed: empty audio stream");
  return finishDownload(track, mime, lufs, downloaded, onProgress, signal);
}

/**
 * Downloads a single track via chunked Range requests through the
 * loopback proxy, tracks real byte progress, and persists the audio Blob
 * (plus a small cover and the measured loudness) in IndexedDB.
 *
 * An interrupted download resumes from the last persisted chunk instead
 * of restarting, as long as the file's total length (and ETag, when the
 * server sends one) still matches. Cancel — via cancelOfflineDownload()
 * or the AbortSignal — stops the loop, deletes partial state, and never
 * persists a blob. Quota errors surface as an honest "Storage full"
 * message; other failures keep the partial state for the next retry.
 */
export async function downloadOfflineTrack(
  track: Track,
  onProgress?: (progress: { downloaded: number; total: number }) => void,
  signal?: AbortSignal
): Promise<Blob> {
  const id = track.id;
  clearCancelledDownload(id);
  const existing = await getOfflineBlob(id);
  if (existing) return existing;
  assertNotCancelled(id, signal);

  try {
    const resolved = await resolveStream(id);
    assertNotCancelled(id, signal);
    const urlBox = { current: await proxyUrl(resolved.url, resolved.lufs, id) };
    assertNotCancelled(id, signal);
    const mime = resolved.mime || "audio/webm";
    const resume = await validateResume(id, mime);
    if (!resume) await deletePartialState(id);
    // A re-resolve after a 403 must bypass the stream cache (forceRefresh),
    // or it may return the same expired URL the 403 came from.
    const reResolve = async (): Promise<string> => {
      const fresh = await resolveStream(id, undefined, true);
      return proxyUrl(fresh.url, fresh.lufs, id);
    };
    return await downloadWithRanges(track, mime, resolved.lufs, urlBox, reResolve, onProgress, signal, resume);
  } catch (err) {
    if (
      err instanceof DownloadCancelledError ||
      isAbortLike(err) ||
      isDownloadCancelled(id) ||
      signal?.aborted
    ) {
      await deletePartialState(id);
      throw new DownloadCancelledError();
    }
    if (isQuotaError(err)) {
      throw new Error("Storage full — delete some downloads to free space, then retry.");
    }
    throw err;
  }
}
