/**
 * Lyrics, Android edition.
 *
 * Same engine as the desktop (`src/lib/lyricsEngine.ts`): fourteen providers
 * raced, word-synced answers first, deadline-bounded. The only difference is
 * transport — `getText` inside the engine routes through CapacitorHttp on the
 * device because a WebView fetch to a third-party origin is blocked by CORS.
 *
 * The YouTube-session helpers the desktop passes (`ytMusicPlain`,
 * `ytTranscript`) are not wired here yet: they need the device InnerTube
 * client to expose its `get_transcript` / lyrics-tab calls.
 * `shortcut: no YouTube captions/lyrics-tab source on Android yet, add them to
 * src/mobile/innertube.ts when a track disappears on the HTTP providers.`
 */
import type { LyricsResult } from "../types";
import { getOfflineLyrics, saveOfflineLyrics, hasOfflineBlob } from "./offline";

// The engine loads on the first lyrics request, not at boot: it is fourteen
// providers' worth of parsing code that most sessions never touch. The
// dynamic import is cached by the module loader, so later requests pay
// nothing extra.
async function loadEngine(): Promise<typeof import("../lib/lyricsEngine")> {
  return import("../lib/lyricsEngine");
}

const cache = new Map<string, Promise<LyricsResult | null>>();

export async function getLyrics(meta: {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
}): Promise<LyricsResult | null> {
  if (!meta?.id) return null;
  const hit = cache.get(meta.id);
  if (hit) return hit;

  const offline = await getOfflineLyrics(meta.id);
  if (offline) {
    const p = Promise.resolve(offline);
    cache.set(meta.id, p);
    return offline;
  }

  const run = loadEngine()
    .then((engine) =>
      engine.fetchLyrics(
        {
          id: meta.id,
          title: meta.title ?? "",
          artist: meta.artist ?? "",
          album: meta.album,
          duration: Number.isFinite(meta.duration) ? Math.round(meta.duration ?? 0) : 0,
        },
        { prioritizeWordSync: true },
        {}
      )
    )
    .then(async (r): Promise<LyricsResult | null> => {
      const result: LyricsResult | null = r
        ? { synced: r.synced, plain: r.plain, source: r.source, wordSynced: r.wordSynced }
        : null;
      if (result && (await hasOfflineBlob(meta.id))) {
        await saveOfflineLyrics(meta.id, result);
      }
      return result;
    })
    .catch(() => null);

  cache.set(meta.id, run);
  if (cache.size > 24) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return run;
}
