/**
 * InnerTube (YouTube Music) client for the Android build.
 *
 * The desktop app gives this job to the Electron main process (youtubei.js).
 * Android has no Node process, so this is the same protocol spoken directly
 * over HTTP from the renderer. It deliberately reuses the desktop's raw
 * response parsers (`electron/ytm.ts`, `electron/audio-format.ts`) — those
 * take InnerTube JSON and are runtime-agnostic, so both targets agree on every
 * row, filter and rendition.
 *
 * Transport: `CapacitorHttp` on the device (native OkHttp, so YouTube's
 * responses are not subject to WebView CORS), plain `fetch` elsewhere.
 */
import { pickAudio, type PickedAudio } from "../../electron/audio-format";

/* eslint-disable @typescript-eslint/no-explicit-any */

const UA_PC =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface ClientSpec {
  name: string;
  ver: string;
  id: string;
  ua: string;
  deviceMake?: string;
  deviceModel?: string;
  osName?: string;
  osVersion?: string;
  android?: boolean;
}

/** Client identities. WEB_REMIX drives browse/search (validated against live
 *  YouTube Music); VISIONOS and other targets are used for stream resolution. */
export const CLIENTS: Record<string, ClientSpec> = {
  WEB_REMIX: { name: "WEB_REMIX", ver: "1.20240724.00.00", id: "67", ua: UA_PC },
  VISIONOS: {
    name: "VISIONOS",
    ver: "1.02",
    id: "101",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
    deviceMake: "Apple",
    deviceModel: "RealityDevice17,1",
    osName: "visionOS",
    osVersion: "26.5.23O471",
  },
  ANDROID_VR: {
    name: "ANDROID_VR",
    ver: "1.60.19",
    id: "28",
    ua: "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; GB) gzip",
    android: true,
  },
  IOS: {
    name: "IOS",
    ver: "19.29.1",
    id: "5",
    ua: "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)",
  },
};

export interface Session {
  visitorData: string;
  gl: string;
  hl: string;
  poToken: string | null;
}

export interface HttpResult {
  status: number;
  text: string;
  /**
   * Already-parsed body, set only when the transport parsed it (CapacitorHttp
   * hands back an object). Callers prefer this over re-parsing `text` — the
   * old parse → stringify → parse round-trip cost a full extra pass over
   * megabyte responses. The fetch fallback leaves it unset and `text` rules.
   */
  json?: unknown;
}

/**
 * Race a promise against an AbortSignal. For the fetch transport the signal
 * aborts the request itself; CapacitorHttp has no abort, so there the race
 * only settles the waiter promptly while the native request runs to
 * completion unobserved — the result is discarded either way.
 */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Aborted"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason ?? new Error("Aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}

/** One signal that aborts when any input aborts (AbortSignal.any, hand-rolled
 *  so it works on WebViews older than Chrome 116). */
function combineSignals(signals: AbortSignal[]): AbortSignal {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

/** Native transport on the device; fetch everywhere else. */
export async function httpPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  signal?: AbortSignal
): Promise<HttpResult> {
  const cap = (globalThis as any).Capacitor;
  if (cap?.isNativePlatform?.()) {
    const { CapacitorHttp } = await import("@capacitor/core");
    const res = await abortable(
      CapacitorHttp.request({
        url,
        method: "POST",
        headers,
        data: JSON.parse(body),
        connectTimeout: 20000,
        readTimeout: 30000,
      }),
      signal
    );
    // JSON fast path: CapacitorHttp already parsed the body — hand the
    // object straight through instead of stringifying it for a re-parse.
    if (typeof res.data === "string") return { status: res.status, text: res.data };
    if (res.data === null || typeof res.data === "object") {
      return { status: res.status, text: "", json: res.data };
    }
    return { status: res.status, text: String(res.data) };
  }
  const res = await fetch(url, { method: "POST", headers, body, signal });
  return { status: res.status, text: await res.text() };
}

/** Native GET transport on device; fetch everywhere else. */
export async function httpGet(
  url: string,
  headers: Record<string, string> = {},
  signal?: AbortSignal
): Promise<HttpResult & { headers?: Record<string, string> }> {
  const cap = (globalThis as any).Capacitor;
  if (cap?.isNativePlatform?.()) {
    const { CapacitorHttp } = await import("@capacitor/core");
    const res = await abortable(
      CapacitorHttp.request({
        url,
        method: "GET",
        headers,
        connectTimeout: 15000,
        readTimeout: 20000,
      }),
      signal
    );
    if (typeof res.data === "string") {
      return { status: res.status, text: res.data, headers: res.headers };
    }
    if (res.data === null || typeof res.data === "object") {
      return { status: res.status, text: "", json: res.data, headers: res.headers };
    }
    return { status: res.status, text: String(res.data), headers: res.headers };
  }
  const res = await fetch(url, { method: "GET", headers, signal });
  const respHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    respHeaders[k.toLowerCase()] = v;
  });
  return { status: res.status, text: await res.text(), headers: respHeaders };
}

let cachedWatchCookies: { cookieStr: string; visitorData: string; ts: number } | null = null;
/** In-flight watch-page fetch, shared by concurrent resolutions (C-11): the
 *  page is global state, so a second resolution must not fetch it again. */
let watchCookiesInflight: Promise<{ cookieStr: string; visitorData: string }> | null = null;

export async function getWatchCookies(videoId: string): Promise<{ cookieStr: string; visitorData: string }> {
  if (cachedWatchCookies && Date.now() - cachedWatchCookies.ts < 15 * 60 * 1000) {
    return cachedWatchCookies;
  }
  if (watchCookiesInflight) return watchCookiesInflight;
  const task = fetchWatchCookies(videoId);
  watchCookiesInflight = task;
  const clear = (): void => {
    if (watchCookiesInflight === task) watchCookiesInflight = null;
  };
  task.then(clear, clear);
  return task;
}

async function fetchWatchCookies(videoId: string): Promise<{ cookieStr: string; visitorData: string }> {
  try {
    const res = await httpGet(
      `https://www.youtube.com/watch?v=${videoId}&bpctr=9999999999&has_verified=1`,
      {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Cookie": "PREF=hl=en&tz=UTC; SOCS=CAI",
      }
    );
    const cookieMap: Record<string, string> = { PREF: "hl=en&tz=UTC", SOCS: "CAI" };
    const rawSetCookie = res.headers?.["set-cookie"] || "";
    if (rawSetCookie) {
      const parts = rawSetCookie.split(/,(?=[^;]+=[^;]+)/);
      for (const p of parts) {
        const item = p.split(";")[0]?.trim();
        const eq = item?.indexOf("=");
        if (eq && eq > 0) {
          cookieMap[item.slice(0, eq).trim()] = item.slice(eq + 1).trim();
        }
      }
    }
    const cookieStr = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join("; ");
    const visitorMatch = res.text.match(/"visitorData":"([^"]+)"/);
    const visitorData = visitorMatch ? visitorMatch[1] : "";
    cachedWatchCookies = { cookieStr, visitorData, ts: Date.now() };
    return cachedWatchCookies;
  } catch {
    return { cookieStr: "PREF=hl=en&tz=UTC; SOCS=CAI", visitorData: "" };
  }
}

function clientContext(spec: ClientSpec, s: Session): Record<string, any> {
  const client: Record<string, any> = {
    clientName: spec.name,
    clientVersion: spec.ver,
    hl: s.hl,
    gl: s.gl,
    visitorData: s.visitorData,
  };
  if (spec.deviceMake) client.deviceMake = spec.deviceMake;
  if (spec.deviceModel) client.deviceModel = spec.deviceModel;
  if (spec.osName) client.osName = spec.osName;
  if (spec.osVersion) client.osVersion = spec.osVersion;
  if (spec.android) {
    Object.assign(client, { androidSdkVersion: 30, osName: "Android", osVersion: "11" });
  }
  return {
    client,
    user: { lockedSafetyMode: false },
    request: { useSsl: true },
  };
}

/** One InnerTube call. Returns the raw response JSON (parsers expect that). */
export async function call(
  api: string,
  payload: Record<string, any>,
  session: Session,
  clientKey: keyof typeof CLIENTS = "WEB_REMIX",
  opts?: { signal?: AbortSignal }
): Promise<any> {
  const spec = CLIENTS[clientKey];
  const origin = clientKey === "WEB_REMIX" ? "https://music.youtube.com" : "https://www.youtube.com";
  const url = `${origin}/youtubei/v1/${api}?prettyPrint=false`;
  const signal = opts?.signal;

  let watchCookies = "";
  let visitorId = session.visitorData;
  if (api === "player" && clientKey === "VISIONOS") {
    // The cookie fetch is shared (in-flight guard) and cached 15 min; racing
    // it against the caller's signal only unblocks THIS caller — the shared
    // fetch keeps running in the background and warms the cache.
    const wc = await abortable(getWatchCookies(payload.videoId || ""), signal);
    watchCookies = wc.cookieStr;
    if (wc.visitorData) visitorId = wc.visitorData;
  }

  const body: Record<string, any> = { context: clientContext(spec, { ...session, visitorData: visitorId }), ...payload };
  // A PO token is session-bound; it rides on every request that can carry it.
  if (session.poToken) {
    body.serviceIntegrityDimensions = { poToken: session.poToken };
  }
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": spec.ua,
    "x-youtube-client-name": spec.id,
    "x-youtube-client-version": spec.ver,
    origin,
    referer: `${origin}/`,
    "x-goog-visitor-id": visitorId,
  };
  if (watchCookies) {
    headers["Cookie"] = watchCookies;
  }
  const res = await httpPost(url, headers, JSON.stringify(body), signal);
  if (res.status < 200 || res.status >= 300) {
    const preview =
      res.text ||
      (res.json !== undefined
        ? (() => {
            try {
              return JSON.stringify(res.json).slice(0, 160);
            } catch {
              return "";
            }
          })()
        : "");
    throw new Error(`${api} (${clientKey}) → HTTP ${res.status}: ${preview}`);
  }
  // JSON fast path: CapacitorHttp already parsed the body — return it
  // directly instead of re-parsing a re-stringified copy.
  if (res.json !== undefined) return res.json;
  try {
    return JSON.parse(res.text);
  } catch {
    throw new Error(`${api} (${clientKey}) → non-JSON response`);
  }
}

/**
 * The `yt` object `electron/ytm.ts`'s handlers expect: `actions.execute(api,
 * payload, { client })` → `{ data }`. Keeping the same shape means the shared
 * parsers are called exactly as the desktop calls them.
 */
export function ytmShim(session: Session): any {
  return {
    actions: {
      execute: async (api: string, payload: any) => ({
        data: await call(api, payload, session, "WEB_REMIX"),
      }),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Session bootstrap                                                   */
/* ------------------------------------------------------------------ */

const VISITORS_KEY = "bytune.visitor";

/** Visitor data: reused across launches (a PO token is bound to it), refreshed
 *  only when YouTube hands us a new one. */
export async function openSession(gl: string, hl: string, poToken: string | null): Promise<Session> {
  let visitorData = "";
  try {
    visitorData = localStorage.getItem(VISITORS_KEY) ?? "";
  } catch {
    /* private mode */
  }
  if (!visitorData) {
    const res = await call("browse", { browseId: "FEmusic_home" }, { visitorData: "", gl, hl, poToken: null });
    visitorData = res?.responseContext?.visitorData ?? "";
  }
  if (!visitorData) throw new Error("Could not open a YouTube Music session");
  try {
    localStorage.setItem(VISITORS_KEY, visitorData);
  } catch {
    /* ignore */
  }
  return { visitorData, gl, hl, poToken };
}

/* ------------------------------------------------------------------ */
/* Player / stream                                                     */
/* ------------------------------------------------------------------ */

/** Player clients in preferred resolution order: VISIONOS first (direct streamable URLs). */
const STREAM_CLIENTS: Array<keyof typeof CLIENTS> = ["VISIONOS", "ANDROID_VR", "IOS", "WEB_REMIX"];

const PIPED_INSTANCES = [
  "https://pipedapi.in.projectsegfau.lt",
  "https://api.piped.private.coffee",
  "https://pipedapi.adminforge.de",
];

async function resolveViaPiped(
  videoId: string,
  signal?: AbortSignal
): Promise<{ url: string; mime: string; bitrateKbps: number | null; codec: string | null }> {
  if (!/^[\w-]{6,20}$/.test(videoId)) throw new Error("Invalid video id");
  for (const base of PIPED_INSTANCES) {
    if (signal?.aborted) throw new Error("Stream resolution timed out — check your connection and retry");
    try {
      const res = await httpGet(`${base}/streams/${videoId}`, {}, signal);
      if (res.status !== 200) continue;
      const data: any = res.json !== undefined ? res.json : JSON.parse(res.text);
      const audio: any[] = (data?.audioStreams ?? []).filter((s: any) => typeof s?.url === "string");
      if (!audio.length) continue;
      audio.sort((a, b) => (b?.bitrate ?? 0) - (a?.bitrate ?? 0));
      const pick = audio.find((s) => /mp4|webm|opus/i.test(String(s?.mimeType ?? ""))) ?? audio[0];
      if (pick?.url) {
        const mime = String(pick.mimeType ?? "audio/webm");
        const bitrate = typeof pick.bitrate === "number" && Number.isFinite(pick.bitrate) ? Math.round(pick.bitrate / 1000) : null;
        return { url: pick.url, mime, bitrateKbps: bitrate, codec: codecFromMime(mime) };
      }
    } catch {
      /* try next instance */
    }
  }
  throw new Error("No mirror had a playable stream");
}

/** Codec label from a MIME string — only what the string actually states. */
function codecFromMime(mime: string): string | null {
  const lower = mime.toLowerCase();
  if (lower.includes("opus")) return "Opus";
  if (lower.includes("mp4a") || lower.includes("aac")) return "AAC";
  if (lower.includes("mp4")) return "AAC";
  return null;
}

/** Raw InnerTube formats → the shape `pickAudio` ranks. */
function toParsedFormats(formats: any[]): any[] {
  return formats.map((f: any) => ({
    itag: f.itag,
    bitrate: f.bitrate,
    mime_type: f.mimeType ?? f.mime_type,
    has_audio: String(f.mimeType ?? "").startsWith("audio/"),
    has_video: String(f.mimeType ?? "").startsWith("video/"),
    url: f.url,
    loudness_db: f.loudnessDb,
    track_absolute_loudness_lkfs: f.trackAbsoluteLoudnessLkfs,
  }));
}

export interface ResolvedStream {
  url: string;
  mime: string;
  lufs: number | null;
  client: string;
  /** Wall-clock ms when this URL was resolved. */
  resolvedAt: number;
  /**
   * Wall-clock ms when the URL expires, parsed from the player response
   * (`streamingData.expiresInSeconds`) or the URL's `expire=` parameter —
   * never a hard-coded lifetime. Null when neither was present, in which
   * case the cache's own TTL is the only bound.
   */
  expiresAt: number | null;
  /** InnerTube itag of the picked rendition, when known. */
  itag: number | null;
  /** Declared bitrate of the picked rendition in kbps, when known. */
  bitrateKbps: number | null;
  /** Codec label of the picked rendition ("Opus"/"AAC"), when known. */
  codec: string | null;
}

/** Expiry for a resolved URL: `expiresInSeconds` first, `expire=` second. */
function expiryOf(res: any, url: string): { resolvedAt: number; expiresAt: number | null } {
  const resolvedAt = Date.now();
  const secs = Number(res?.streamingData?.expiresInSeconds);
  if (Number.isFinite(secs) && secs > 0) {
    return { resolvedAt, expiresAt: resolvedAt + secs * 1000 };
  }
  try {
    const param = new URL(url).searchParams.get("expire");
    const epoch = param ? Number(param) : NaN;
    if (Number.isFinite(epoch) && epoch > 0) return { resolvedAt, expiresAt: epoch * 1000 };
  } catch {
    /* unparseable URL — no expiry known */
  }
  return { resolvedAt, expiresAt: null };
}

/**
 * Rendition facts for the format pickAudio chose. On the mobile path
 * pickAudio never deciphers (no youtubei session is passed), so the picked
 * URL is exactly one of the formats' plain URLs and the match is exact.
 */
function renditionOf(picked: PickedAudio, formats: any[]): { itag: number | null; bitrateKbps: number | null; codec: string | null } {
  const match = formats.find((f: any) => f?.url === picked.url);
  const itag = typeof match?.itag === "number" ? match.itag : null;
  const bitrateKbps =
    typeof match?.bitrate === "number" && Number.isFinite(match.bitrate) ? Math.round(match.bitrate / 1000) : null;
  return { itag, bitrateKbps, codec: codecFromMime(picked.mime) };
}

/** First fulfillment wins; if every promise rejects, the first error wins. */
function firstSuccess<T>(promises: Array<Promise<T>>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let remaining = promises.length;
    let firstErr: unknown = null;
    if (remaining === 0) {
      reject(new Error("No clients to race"));
      return;
    }
    for (const p of promises) {
      p.then(resolve, (err) => {
        if (firstErr === null) firstErr = err;
        if (--remaining === 0) {
          reject(firstErr instanceof Error ? firstErr : new Error("Stream resolution failed"));
        }
      });
    }
  });
}

/** Overall cap on one stream resolution — the failure path must surface a
 *  retry state, never hang for minutes behind serial client timeouts. */
const RESOLVE_DEADLINE_MS = 12000;

/** One client's player call → picked rendition, or a throw. */
async function tryClient(
  videoId: string,
  session: Session,
  key: keyof typeof CLIENTS,
  maxKbps: number | undefined,
  signal: AbortSignal
): Promise<ResolvedStream> {
  const res = await call(
    "player",
    {
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
      playbackContext: {
        contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS" },
      },
    },
    session,
    key,
    { signal }
  );
  const status = res?.playabilityStatus?.status;
  const formats = toParsedFormats(res?.streamingData?.adaptiveFormats ?? []);
  if (!formats.length) throw new Error(`${key}: ${status ?? "no formats"} ${res?.playabilityStatus?.reason ?? ""}`);
  const picked: PickedAudio | null = await pickAudio(
    { streaming_data: { adaptive_formats: formats } },
    null,
    maxKbps,
    false
  );
  if (!picked) throw new Error(`${key}: no plain audio URL`);
  return { ...picked, client: key, ...expiryOf(res, picked.url), ...renditionOf(picked, formats) };
}

/**
 * Resolve a playable audio URL. VISIONOS and ANDROID_VR race in parallel —
 * the first plain URL wins and the loser is cancelled — then IOS and
 * WEB_REMIX are tried in order, and Piped stays the last resort. The whole
 * resolution is capped by one ~12s deadline so a flaky network surfaces a
 * retryable error instead of hanging.
 */
export async function resolveStreamWith(
  videoId: string,
  session: Session,
  maxKbps?: number
): Promise<ResolvedStream> {
  const deadline = AbortSignal.timeout(RESOLVE_DEADLINE_MS);
  let lastErr: unknown = null;

  // Phase 1 — parallel race. The VISIONOS leg may still be fetching the
  // watch-page cookies while ANDROID_VR answers, so the cookie fetch is no
  // longer on the critical path; it warms the 15-min cache for next time.
  const raceCtrl = new AbortController();
  const raceSignal = combineSignals([deadline, raceCtrl.signal]);
  try {
    const won = await firstSuccess([
      tryClient(videoId, session, "VISIONOS", maxKbps, raceSignal),
      tryClient(videoId, session, "ANDROID_VR", maxKbps, raceSignal),
    ]);
    raceCtrl.abort();
    return won;
  } catch (err) {
    lastErr = err;
    raceCtrl.abort();
  }

  // Phase 2 — remaining clients, in order, behind the same deadline.
  for (const key of ["IOS", "WEB_REMIX"] as const) {
    if (deadline.aborted) break;
    try {
      return await tryClient(videoId, session, key, maxKbps, deadline);
    } catch (err) {
      lastErr = err;
    }
  }

  // Phase 3 — Piped, last resort, behind the same deadline.
  if (!deadline.aborted) {
    try {
      const piped = await resolveViaPiped(videoId, deadline);
      return {
        url: piped.url,
        mime: piped.mime,
        lufs: null,
        client: "PIPED",
        resolvedAt: Date.now(),
        expiresAt: null,
        itag: null,
        bitrateKbps: piped.bitrateKbps,
        codec: piped.codec,
      };
    } catch {
      /* fallback failed, throw lastErr below */
    }
  }

  if (deadline.aborted) {
    throw new Error("Stream resolution timed out — check your connection and retry");
  }
  throw lastErr instanceof Error ? lastErr : new Error("Could not resolve a playable audio stream");
}

/** Basic duration lookup (the player response carries it, if any client answers). */
export async function videoDuration(videoId: string, session: Session): Promise<number> {
  for (const key of STREAM_CLIENTS) {
    try {
      const res = await call("player", { videoId, contentCheckOk: true, racyCheckOk: true }, session, key);
      const secs = Number(res?.videoDetails?.lengthSeconds ?? 0);
      if (secs > 0) return secs;
    } catch {
      /* next client */
    }
  }
  return 0;
}
