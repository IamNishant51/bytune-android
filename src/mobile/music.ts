/**
 * The music service, Android edition.
 *
 * Function-for-function the desktop `electron/music-service.ts` surface, minus
 * the main process: same InnerTube endpoints, same shared parsers, same
 * market resolution, same stream rotation. Everything a view calls through the
 * bridge lands here.
 */
import {
  SEARCH_FILTER_PARAMS,
  callBrowse,
  callSearch,
  callSearchContinuation,
  collectRenderers,
  parseArtistPage,
  parseBrowseItem,
  parseChartsShelves,
  parseMoods,
  parseReleasePage,
  parseRemotePlaylistPage,
  parseResponsiveListItem,
  parseSearchPage,
  parseTwoRowItem,
} from "../../electron/ytm";
import { resolveMarket } from "../../electron/market";
import type { MoodEntry } from "../../electron/moods";
import type {
  Album,
  Artist,
  ArtistPageData,
  HomeItem,
  HomeShelf,
  RemotePlaylistPage,
  SearchFilter,
  SearchPageResult,
  SearchResults,
  SearchRow,
  SearchSuggestion,
  Track,
} from "../types";
import {
  call,
  openSession,
  resolveStreamWith,
  videoDuration,
  ytmShim,
  type ResolvedStream,
  type Session,
} from "./innertube";

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

let sessionPromise: Promise<Session> | null = null;
let session: Session | null = null;

export function marketCountry(): string {
  const m = resolveMarket({
    osRegion: null,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    override: null,
    isDev: false,
  });
  return m.country;
}

function displayLanguage(): string {
  const tag = (typeof navigator !== "undefined" && navigator.language) || "en";
  const base = tag.split("-")[0].toLowerCase();
  return /^[a-z]{2,3}$/.test(base) ? base : "en";
}

/** Ask the native shell to mint a BotGuard PO token for this visitor. */
async function mintPoToken(visitorData: string, gl: string, hl: string): Promise<string | null> {
  const minter = (globalThis as any).Capacitor?.Plugins?.ByTuneShell;
  if (!minter?.mintPoToken) return null;
  try {
    const res = await minter.mintPoToken({ visitorData, gl, hl });
    return typeof res?.token === "string" && res.token ? res.token : null;
  } catch {
    return null;
  }
}

export function getSession(): Promise<Session> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const gl = marketCountry();
      const hl = displayLanguage();
      // Visitor data first: the PO token is bound to it.
      const base = await openSession(gl, hl, null);
      // Bounded PO-token minting (3.5s timeout) so slow initial botguard challenge doesn't stall audio playback
      const poToken = await Promise.race([
        mintPoToken(base.visitorData, gl, hl),
        new Promise<null>((r) => setTimeout(() => r(null), 3500)),
      ]);
      session = { ...base, poToken };
      return session;
    })().catch((err) => {
      sessionPromise = null;
      throw err;
    });
  }
  return sessionPromise;
}

export function currentSession(): Session | null {
  return session;
}

const yt = async (): Promise<any> => ytmShim(await getSession());
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, attempts = 2, delayMs = 600): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(delayMs * (i + 1));
    }
  }
  throw lastErr;
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export async function searchPage(query: string, filter: SearchFilter): Promise<SearchPageResult> {
  const q = query.trim();
  if (!q) return { rows: [], continuation: null };
  const y = await yt();
  const response = await withRetry(() => callSearch(y, q, SEARCH_FILTER_PARAMS[filter] ?? null));
  return parseSearchPage(response, filter === "videos");
}

export async function searchMore(token: string, filter: SearchFilter): Promise<SearchPageResult> {
  const y = await yt();
  return parseSearchPage(await withRetry(() => callSearchContinuation(y, token)), filter === "videos");
}

/** Flat `SearchResults` for the callers that want one (recs, artist images). */
export async function searchAll(query: string): Promise<SearchResults> {
  const page = await searchPage(query, "all").catch(() => null);
  if (!page) return { songs: [], videos: [], albums: [], artists: [], playlists: [], top: null, related: [] };
  const topRow = page.rows.find((r): r is Extract<SearchRow, { kind: "top" }> => r.kind === "top") ?? null;
  const browseOf = <K extends "album" | "artist" | "playlist">(t: K) =>
    page.rows.filter((r): r is Extract<SearchRow, { kind: "browse" }> => r.kind === "browse" && r.item.type === t);
  return {
    songs: [
      ...(topRow ? [topRow.song] : []),
      ...page.rows.filter((r): r is Extract<SearchRow, { kind: "track" }> => r.kind === "track").map((r) => r.song),
    ],
    videos: [],
    albums: browseOf("album").map((r) => ({
      id: r.item.browseId,
      title: r.item.title,
      artist: r.item.subtitle,
      thumb: r.item.thumb,
    })),
    artists: browseOf("artist").map((r) => ({
      id: r.item.browseId,
      name: r.item.title,
      thumb: r.item.thumb,
      subtitle: r.item.subtitle,
    })),
    playlists: browseOf("playlist").map((r) => ({ id: r.item.browseId, title: r.item.title, thumb: r.item.thumb })),
    top: topRow ? { kind: "track", track: topRow.song } : null,
    related: [],
  };
}

export async function suggestions(query: string): Promise<{ items: SearchSuggestion[] }> {
  const q = query.trim();
  if (!q) return { items: [] };
  try {
    const res = await call("music/get_search_suggestions", { input: q }, await getSession());
    const out: SearchSuggestion[] = [];
    const seen = new Set<string>();
    for (const node of collectRenderers(res, "searchSuggestionRenderer")) {
      const text = (node?.suggestion?.runs ?? [])
        .map((r: any) => String(r?.text ?? ""))
        .join("")
        .trim();
      if (text && !seen.has(text.toLowerCase())) {
        seen.add(text.toLowerCase());
        out.push({ text });
      }
      if (out.length >= 10) break;
    }
    return { items: out };
  } catch {
    return { items: [] };
  }
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

export async function getArtistPage(artistId: string): Promise<ArtistPageData> {
  const parsed = parseArtistPage(await withRetry(async () => callBrowse(await shim(), artistId)));
  const artist: Artist = { id: artistId, name: parsed.name || "Unknown artist", thumb: parsed.thumb };
  return {
    artist,
    description: parsed.description,
    subscriberCount: parsed.subscriberCount,
    monthlyListeners: parsed.monthlyListeners,
    songs: parsed.songs.map((t) => ({
      ...t,
      artist: t.artist && t.artist !== "Unknown artist" ? t.artist : artist.name,
      artistId: t.artistId || artistId,
    })),
    shelves: parsed.shelves,
  };
}

// `callBrowse` takes the `yt` shim synchronously; the shim itself is cheap
// (it closes over the session), so the page loaders hold one per call site.
let ytShimCache: any = null;
async function shim(): Promise<any> {
  if (!ytShimCache) ytShimCache = await yt();
  return ytShimCache;
}

export async function getAlbum(albumId: string): Promise<{ album: Album; tracks: Track[] }> {
  const parsed = parseReleasePage(await withRetry(async () => callBrowse(await shim(), albumId)), albumId);
  const lines = (parsed.header?.subtitle ?? "")
    .split("•")
    .map((p) => p.trim())
    .filter(Boolean);
  const releaseType = lines.find((l) => ["album", "single", "ep"].includes(l.toLowerCase()));
  const year = [...lines].reverse().find((l) => /^\d{4}$/.test(l));
  const artist = lines.find((l) => l !== releaseType && l !== year) || parsed.tracks[0]?.artist || "Unknown artist";
  return {
    album: {
      id: albumId,
      title: parsed.header?.title || parsed.tracks[0]?.album || "Unknown album",
      artist,
      year,
      thumb: parsed.header?.thumb || parsed.tracks[0]?.thumb || "",
      releaseType: releaseType ? releaseType[0].toUpperCase() + releaseType.slice(1).toLowerCase() : undefined,
      description: parsed.description,
      artistId: parsed.header?.artistId,
    },
    tracks: parsed.tracks,
  };
}

export async function getPlaylistPage(playlistId: string): Promise<RemotePlaylistPage> {
  const id = playlistId.startsWith("VL") ? playlistId : `VL${playlistId}`;
  return parseRemotePlaylistPage(await withRetry(async () => callBrowse(await shim(), id)), id);
}

export async function getPlaylist(playlistId: string): Promise<{ title: string; tracks: Track[] }> {
  const res = await withRetry(async () => callBrowse(await shim(), `VL${playlistId.replace(/^VL/, "")}`));
  const page = parseRemotePlaylistPage(res, playlistId);
  return { title: page.title, tracks: page.tracks };
}

export async function getCharts(): Promise<HomeShelf[]> {
  const res = await withRetry(async () => callBrowse(await shim(), "FEmusic_charts"));
  return parseChartsShelves(res) as HomeShelf[];
}

export async function getMoods(): Promise<MoodEntry[]> {
  const res = await withRetry(async () => callBrowse(await shim(), "FEmusic_explore"));
  return parseMoods(res);
}

/* ------------------------------------------------------------------ */
/* Home                                                                */
/* ------------------------------------------------------------------ */

function runsText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node.simpleText === "string") return node.simpleText;
  return Array.isArray(node.runs) ? node.runs.map((r: any) => String(r?.text ?? "")).join("") : "";
}

/** Raw home shelves → the `HomeShelf[]` the renderer's feed engine consumes. */
function parseHomeShelves(res: any): HomeShelf[] {
  const shelves: HomeShelf[] = [];
  const carousels = [
    ...collectRenderers(res, "musicCarouselShelfRenderer"),
    ...collectRenderers(res, "musicShelfRenderer"),
  ];
  for (const shelf of carousels) {
    const title =
      runsText(shelf?.header?.musicCarouselShelfBasicHeaderRenderer?.title) ||
      runsText(shelf?.header?.musicShelfRenderer?.title) ||
      runsText(shelf?.title?.musicCarouselShelfBasicHeaderRenderer?.title) ||
      "For you";
    const items: HomeItem[] = [];
    for (const row of collectRenderers(shelf, "musicResponsiveListItemRenderer")) {
      const track = parseResponsiveListItem(row);
      if (track) {
        items.push({ kind: "track", track });
        continue;
      }
      const browse = parseBrowseItem(row);
      if (!browse) continue;
      if (browse.type === "album") {
        items.push({ kind: "album", album: { id: browse.browseId, title: browse.title, artist: browse.subtitle, thumb: browse.thumb } });
      } else if (browse.type === "artist") {
        items.push({ kind: "artist", artist: { id: browse.browseId, name: browse.title, thumb: browse.thumb, subtitle: browse.subtitle } });
      } else if (browse.type === "playlist") {
        items.push({ kind: "playlist", playlist: { id: browse.browseId, title: browse.title, thumb: browse.thumb, subtitle: browse.subtitle } });
      }
      if (items.length >= 24) break;
    }
    if (items.length < 24) {
      for (const card of collectRenderers(shelf, "musicTwoRowItemRenderer")) {
        const parsed = parseTwoRowItem(card);
        if (parsed?.item) {
          items.push(parsed.item);
        }
        if (items.length >= 24) break;
      }
    }
    // Two-item shelves (a "Trending" pair) are noise on a phone feed.
    if (items.length >= 3) shelves.push({ title, items });
    if (shelves.length >= 14) break;
  }
  return shelves;
}

export async function getHome(): Promise<HomeShelf[]> {
  const res = await withRetry(async () => callBrowse(await shim(), "FEmusic_home"));
  return parseHomeShelves(res);
}

/** The market the feed was built for (diagnostics card in Settings). */
export async function marketInfo(): Promise<{ country: string; source: string }> {
  const s = await getSession();
  return { country: s.gl, source: "device" };
}

/* ------------------------------------------------------------------ */
/* Streams + durations                                                 */
/* ------------------------------------------------------------------ */

const durationCache = new Map<string, number>();
const streamCache = new Map<string, { stream: ResolvedStream; ts: number }>();
const STREAM_CACHE_TTL_MS = 10 * 60 * 1000;

export async function resolveStream(videoId: string, maxKbps?: number): Promise<ResolvedStream> {
  const cached = streamCache.get(videoId);
  if (cached && Date.now() - cached.ts < STREAM_CACHE_TTL_MS) {
    return cached.stream;
  }
  const s = await getSession();
  const stream = await resolveStreamWith(videoId, s, maxKbps);
  streamCache.set(videoId, { stream, ts: Date.now() });
  return stream;
}

export async function enrichDurations(ids: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const pending = [...new Set(ids.filter((id) => id && !durationCache.has(id)))].slice(0, 24);
  const s = await getSession();
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < pending.length) {
      const id = pending[cursor++];
      const secs = await videoDuration(id, s).catch(() => 0);
      if (secs > 0) {
        durationCache.set(id, secs);
        out[id] = secs;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker));
  for (const id of ids) {
    const hit = durationCache.get(id);
    if (hit) out[id] = hit;
  }
  return out;
}
