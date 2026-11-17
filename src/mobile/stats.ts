/**
 * Listening statistics, Android edition.
 *
 * Same model as the desktop's `electron/stats.ts` — monthly buckets of
 * tracks / artists / albums / hours / days, a play credited once a listen
 * crosses the mobile rule — just persisted in the WebView instead of in a
 * JSON file. Storage is the shared `bytune-mobile-stats` key.
 */
import type { Track } from "../types";

export type ReplayPeriod = "month" | "lastMonth" | "year" | "all";

interface TrackEntry {
  title: string;
  artist: string;
  thumb: string;
  ms: number;
  plays: number;
  lastAt: number;
}

interface NameEntry {
  name: string;
  artist?: string;
  thumb?: string;
  ms: number;
  plays: number;
}

interface MonthBucket {
  month: string;
  tracks: Record<string, TrackEntry>;
  artists: Record<string, NameEntry>;
  albums: Record<string, NameEntry>;
  hours: number[];
  days: Record<string, number>;
}

export interface ReplaySummary {
  totalMs: number;
  plays: number;
  tracks: (TrackEntry & { id: string })[];
  artists: NameEntry[];
  albums: NameEntry[];
  hours: number[];
  days: { date: string; ms: number }[];
  period: ReplayPeriod;
  months: string[];
}

const KEY = "bytune-mobile-stats";
const KEEP_MONTHS = 36;
const PLAY_FLOOR_MS = 30_000;
const PLAY_CEILING_MS = 4 * 60_000;

const monthKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

function load(): Map<string, MonthBucket> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as MonthBucket[]) : [];
    return new Map(parsed.map((b) => [b.month, b]));
  } catch {
    return new Map();
  }
}

let open: Map<string, MonthBucket> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const ruleMs = new Map<string, number>();
const ruleCounted = new Set<string>();

function buckets(): Map<string, MonthBucket> {
  if (!open) open = load();
  return open;
}

function save(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const all = [...buckets().values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-KEEP_MONTHS);
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
      /* quota — the summary still works for this session */
    }
  }, 1500);
}

function newBucket(month: string): MonthBucket {
  return { month, tracks: {}, artists: {}, albums: {}, hours: new Array(24).fill(0), days: {} };
}

/** A new listen of this track began — re-arm the one-play rule. */
export function noteTrackStart(trackId: string): void {
  if (!trackId) return;
  ruleMs.delete(trackId);
  ruleCounted.delete(trackId);
}

export function recordListening(track: Track, listenedMs: number, at = new Date()): void {
  if (!track?.id || listenedMs <= 0) return;
  const store = buckets();
  const month = monthKey(at);
  const b = store.get(month) ?? newBucket(month);
  store.set(month, b);

  const t = (b.tracks[track.id] ??= { title: track.title, artist: track.artist, thumb: track.thumb, ms: 0, plays: 0, lastAt: 0 });
  t.title = track.title;
  t.artist = track.artist;
  if (track.thumb) t.thumb = track.thumb;
  t.ms += listenedMs;
  t.lastAt = at.getTime();

  const artistKey = (track.artist || "Unknown artist").toLowerCase();
  const a = (b.artists[artistKey] ??= { name: track.artist || "Unknown artist", ms: 0, plays: 0 });
  a.ms += listenedMs;
  if (!a.thumb && track.artistImage) a.thumb = track.artistImage;

  if (track.album) {
    const ak = `${track.album.toLowerCase()}|${artistKey}`;
    const al = (b.albums[ak] ??= { name: track.album, artist: track.artist, ms: 0, plays: 0 });
    al.ms += listenedMs;
    if (!al.thumb && track.thumb) al.thumb = track.thumb;
  }

  b.hours[at.getHours()] += listenedMs;
  const day = `${month}-${String(at.getDate()).padStart(2, "0")}`;
  b.days[day] = (b.days[day] ?? 0) + listenedMs;

  if (!ruleCounted.has(track.id)) {
    const listened = (ruleMs.get(track.id) ?? 0) + listenedMs;
    ruleMs.set(track.id, listened);
    const durMs = track.duration > 0 ? track.duration * 1000 : PLAY_FLOOR_MS;
    if (listened >= Math.min(Math.max(durMs / 2, PLAY_FLOOR_MS), PLAY_CEILING_MS)) {
      ruleCounted.add(track.id);
      t.plays += 1;
      a.plays += 1;
      if (track.album) b.albums[`${track.album.toLowerCase()}|${artistKey}`].plays += 1;
    }
  }
  save();
}

function monthsFor(period: ReplayPeriod): string[] {
  const now = new Date();
  if (period === "month") return [monthKey(now)];
  if (period === "lastMonth") return [monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1))];
  if (period === "year") {
    const out: string[] = [];
    for (let m = 0; m <= now.getMonth(); m++) out.push(`${now.getFullYear()}-${String(m + 1).padStart(2, "0")}`);
    return out;
  }
  return [...buckets().keys()].sort();
}

export function summary(period: ReplayPeriod): ReplaySummary {
  const months = monthsFor(period);
  const data = months.map((m) => buckets().get(m)).filter((b): b is MonthBucket => !!b);
  const tracks = new Map<string, TrackEntry & { id: string }>();
  const artists = new Map<string, NameEntry>();
  const albums = new Map<string, NameEntry>();
  const hours = new Array(24).fill(0);
  const days = new Map<string, number>();
  let totalMs = 0;
  let plays = 0;

  for (const b of data) {
    for (const [id, t] of Object.entries(b.tracks)) {
      const cur = tracks.get(id) ?? { ...t, id, ms: 0, plays: 0 };
      cur.ms += t.ms;
      cur.plays += t.plays;
      tracks.set(id, cur);
      totalMs += t.ms;
      plays += t.plays;
    }
    for (const [k, a] of Object.entries(b.artists)) {
      if (k === "unknown artist") continue;
      const cur = artists.get(k) ?? { ...a, ms: 0, plays: 0 };
      cur.ms += a.ms;
      cur.plays += a.plays;
      artists.set(k, cur);
    }
    for (const [k, al] of Object.entries(b.albums)) {
      const cur = albums.get(k) ?? { ...al, ms: 0, plays: 0 };
      cur.ms += al.ms;
      cur.plays += al.plays;
      albums.set(k, cur);
    }
    for (let h = 0; h < 24; h++) hours[h] += b.hours[h] ?? 0;
    for (const [d, ms] of Object.entries(b.days)) days.set(d, (days.get(d) ?? 0) + ms);
  }

  return {
    totalMs,
    plays,
    tracks: [...tracks.values()].sort((x, y) => y.ms - x.ms).slice(0, 50),
    artists: [...artists.values()].sort((x, y) => y.ms - x.ms).slice(0, 50),
    albums: [...albums.values()].sort((x, y) => y.ms - x.ms).slice(0, 50),
    hours,
    days: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, ms]) => ({ date, ms })),
    period,
    months,
  };
}

/** Wipe Replay (Settings → reset). */
export function reset(): void {
  open = new Map();
  ruleMs.clear();
  ruleCounted.clear();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
