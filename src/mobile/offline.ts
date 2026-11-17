/**
 * Native IndexedDB offline audio cache for mobile.
 *
 * Stores full audio Blobs in the browser standard library's IndexedDB,
 * enabling 100% offline playback of downloaded songs and playlists
 * without network or main-process dependencies.
 */
import type { LyricsResult, Track } from "../types";
import { resolveStream } from "./music";
import { proxyUrl } from "./bridge";

const DB_NAME = "bytune-offline-audio";
const DB_VERSION = 2;
const STORE_NAME = "tracks";
const LYRICS_STORE = "lyrics";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(LYRICS_STORE)) {
        db.createObjectStore(LYRICS_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getOfflineBlob(id: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result?.blob ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function hasOfflineBlob(id: string): Promise<boolean> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).count(id);
      req.onsuccess = () => resolve(req.result > 0);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

export async function saveOfflineBlob(id: string, blob: Blob, track?: Track): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).put({
      id,
      blob,
      track: track ?? undefined,
      size: blob.size,
      mime: blob.type,
      savedAt: Date.now(),
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getAllOfflineEntries(): Promise<{ id: string; blob: Blob; track?: Track; size: number }[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function deleteOfflineBlob(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const req = tx.objectStore(STORE_NAME).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    void deleteOfflineLyrics(id);
  } catch {
    /* ignore */
  }
}

export async function getOfflineLyrics(id: string): Promise<LyricsResult | null> {
  try {
    const db = await openDb();
    if (!db.objectStoreNames.contains(LYRICS_STORE)) return null;
    return await new Promise((resolve) => {
      const tx = db.transaction(LYRICS_STORE, "readonly");
      const req = tx.objectStore(LYRICS_STORE).get(id);
      req.onsuccess = () => resolve(req.result?.lyrics ?? null);
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
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LYRICS_STORE, "readwrite");
      const req = tx.objectStore(LYRICS_STORE).put({
        id,
        lyrics,
        savedAt: Date.now(),
      });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    /* ignore */
  }
}

export async function deleteOfflineLyrics(id: string): Promise<void> {
  try {
    const db = await openDb();
    if (!db.objectStoreNames.contains(LYRICS_STORE)) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LYRICS_STORE, "readwrite");
      const req = tx.objectStore(LYRICS_STORE).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    /* ignore */
  }
}

function base64ToBlob(b64: string, type: string): Blob {
  const clean = b64.includes(",") ? b64.split(",")[1] : b64;
  const binary = atob(clean);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type });
}

/**
 * Downloads a single track via native CapacitorHttp (or streaming proxy on dev),
 * tracks progress, and persists the audio Blob in IndexedDB.
 */
export async function downloadOfflineTrack(
  track: Track,
  onProgress?: (progress: { downloaded: number; total: number }) => void,
  signal?: AbortSignal
): Promise<Blob> {
  const existing = await getOfflineBlob(track.id);
  if (existing) return existing;

  const resolved = await resolveStream(track.id);

  // On Android native platform, download directly via CapacitorHttp (native OkHttp).
  // This bypasses WebView CORS, mixed content, and loopback socket buffering.
  const cap = (globalThis as any).Capacitor;
  if (cap?.isNativePlatform?.()) {
    const { CapacitorHttp } = await import("@capacitor/core");
    onProgress?.({ downloaded: 1, total: 100 });
    const res = await CapacitorHttp.request({
      url: resolved.url,
      method: "GET",
      // googlevideo throttles header-less GETs to ~30 kB/s; a byte range gets
      // the full pipe (2+ MB/s), and `bytes=0-` still returns the whole file.
      headers: { range: "bytes=0-" },
      responseType: "blob",
      connectTimeout: 30000,
      readTimeout: 60000,
    });
    if (res.status < 200 || res.status >= 300 || !res.data) {
      throw new Error(`Download failed: HTTP ${res.status}`);
    }
    const finalBlob =
      res.data instanceof Blob
        ? res.data
        : base64ToBlob(res.data, resolved.mime || "audio/webm");
    onProgress?.({ downloaded: finalBlob.size, total: finalBlob.size });
    await saveOfflineBlob(track.id, finalBlob, track);
    return finalBlob;
  }

  // Web / dev fallback: route via proxy
  const streamUrl = await proxyUrl(resolved.url, resolved.lufs, track.id);
  const res = await fetch(streamUrl, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch audio stream: HTTP ${res.status}`);
  }

  const contentLength = Number(res.headers.get("content-length") || 0);
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let downloaded = 0;

  if (reader) {
    while (true) {
      if (signal?.aborted) {
        throw new Error("Download cancelled");
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        downloaded += value.length;
        onProgress?.({ downloaded, total: contentLength || downloaded });
      }
    }
  } else {
    const b = await res.blob();
    chunks.push(new Uint8Array(await b.arrayBuffer()));
    downloaded = b.size;
  }

  const finalBlob = new Blob(chunks as any[], { type: resolved.mime || "audio/webm" });
  await saveOfflineBlob(track.id, finalBlob, track);
  return finalBlob;
}
