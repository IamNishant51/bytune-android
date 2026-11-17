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
}

/** Native transport on the device; fetch everywhere else. */
export async function httpPost(
  url: string,
  headers: Record<string, string>,
  body: string
): Promise<HttpResult> {
  const cap = (globalThis as any).Capacitor;
  if (cap?.isNativePlatform?.()) {
    const { CapacitorHttp } = await import("@capacitor/core");
    const res = await CapacitorHttp.request({
      url,
      method: "POST",
      headers,
      data: JSON.parse(body),
      connectTimeout: 20000,
      readTimeout: 30000,
    });
    return {
      status: res.status,
      text: typeof res.data === "string" ? res.data : JSON.stringify(res.data),
    };
  }
  const res = await fetch(url, { method: "POST", headers, body });
  return { status: res.status, text: await res.text() };
}

/** Native GET transport on device; fetch everywhere else. */
export async function httpGet(
  url: string,
  headers: Record<string, string> = {}
): Promise<HttpResult & { headers?: Record<string, string> }> {
  const cap = (globalThis as any).Capacitor;
  if (cap?.isNativePlatform?.()) {
    const { CapacitorHttp } = await import("@capacitor/core");
    const res = await CapacitorHttp.request({
      url,
      method: "GET",
      headers,
      connectTimeout: 15000,
      readTimeout: 20000,
    });
    return {
      status: res.status,
      text: typeof res.data === "string" ? res.data : JSON.stringify(res.data),
      headers: res.headers,
    };
  }
  const res = await fetch(url, { method: "GET", headers });
  const respHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    respHeaders[k.toLowerCase()] = v;
  });
  return { status: res.status, text: await res.text(), headers: respHeaders };
}

let cachedWatchCookies: { cookieStr: string; visitorData: string; ts: number } | null = null;

export async function getWatchCookies(videoId: string): Promise<{ cookieStr: string; visitorData: string }> {
  if (cachedWatchCookies && Date.now() - cachedWatchCookies.ts < 15 * 60 * 1000) {
    return cachedWatchCookies;
  }
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
  clientKey: keyof typeof CLIENTS = "WEB_REMIX"
): Promise<any> {
  const spec = CLIENTS[clientKey];
  const origin = clientKey === "WEB_REMIX" ? "https://music.youtube.com" : "https://www.youtube.com";
  const url = `${origin}/youtubei/v1/${api}?prettyPrint=false`;

  let watchCookies = "";
  let visitorId = session.visitorData;
  if (api === "player" && clientKey === "VISIONOS") {
    const wc = await getWatchCookies(payload.videoId || "");
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
  const res = await httpPost(url, headers, JSON.stringify(body));
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${api} (${clientKey}) → HTTP ${res.status}: ${res.text.slice(0, 160)}`);
  }
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

async function resolveViaPiped(videoId: string): Promise<string> {
  if (!/^[\w-]{6,20}$/.test(videoId)) throw new Error("Invalid video id");
  for (const base of PIPED_INSTANCES) {
    try {
      const res = await httpGet(`${base}/streams/${videoId}`);
      if (res.status !== 200) continue;
      const data: any = JSON.parse(res.text);
      const audio: any[] = (data?.audioStreams ?? []).filter((s: any) => typeof s?.url === "string");
      if (!audio.length) continue;
      audio.sort((a, b) => (b?.bitrate ?? 0) - (a?.bitrate ?? 0));
      const pick = audio.find((s) => /mp4|webm|opus/i.test(String(s?.mimeType ?? ""))) ?? audio[0];
      if (pick?.url) return pick.url;
    } catch {
      /* try next instance */
    }
  }
  throw new Error("No mirror had a playable stream");
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
}

/**
 * Resolve a playable audio URL. Mirrors the desktop's rotation: each client is
 * asked with the session's PO token, and the first rendition that comes back
 * with a plain URL wins.
 */
export async function resolveStreamWith(
  videoId: string,
  session: Session,
  maxKbps?: number
): Promise<ResolvedStream> {
  let lastErr: unknown = null;
  for (const key of STREAM_CLIENTS) {
    try {
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
        key
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
      return { ...picked, client: key };
    } catch (err) {
      lastErr = err;
    }
  }

  try {
    const url = await resolveViaPiped(videoId);
    return { url, mime: "audio/webm", lufs: null, client: "PIPED" };
  } catch {
    /* fallback failed, throw lastErr */
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
