# ARCHITECTURE — how the Android build actually works

Read this before changing anything on the phone side. Every claim here is checkable against
the files named. If you find a claim that is no longer true, fix it in the same change.

---

## 1. The shape of it

The desktop app is Electron: a Chromium renderer (`src/`) talking over IPC to a Node main
process (`electron/`). Android has no Node, so the port keeps the renderer **verbatim** and
replaces the main process with three things:

```
┌──────────────────────────────────────────────────────────────────┐
│ WebView (Capacitor 6), origin https://localhost, assets from dist │
│                                                                  │
│   src/  — the desktop renderer, unchanged                          │
│     ├─ reads window.bytune  ─────────────┐                        │
│     └─ src/mobile/bootstrap.ts installs  │                        │
│                                          ▼                        │
│   src/mobile/bridge.ts — window.bytune, Android edition           │
│     ├─ src/mobile/music.ts   ──► src/mobile/innertube.ts          │
│     │                            ├─ CapacitorHttp (native OkHttp) │
│     │                            └─ electron/ytm.ts parsers (shared) │
│     ├─ src/mobile/lyrics.ts  ──► lazy 14-provider engine + LRCLIB │
│     ├─ src/mobile/stats.ts   ──► localStorage                     │
│     ├─ src/mobile/offline.ts ──► IndexedDB (downloads, v3)        │
│     └─ Capacitor.Plugins.ByTuneShell ──┐                          │
└────────────────────────────────────────┼──────────────────────────┘
                                         ▼
┌──────────────────────────────────────────────────────────────────┐
│ Kotlin (android/app/src/main/java/com/bytune/music/)              │
│   ByTuneShellPlugin.kt  — plugin: mintPoToken, registerStream,     │
│                             cancelPoToken, haptic, memoryInfo,     │
│                             media-session + notification plumbing  │
│   PoTokenMinter.kt      — hidden WebView + native att/get + GenerateIT │
│   StreamProxy.kt        — loopback HTTP server, range relay       │
│   MusicPlaybackService.kt — foreground service + MediaSession     │
│   MusicAppWidgetProvider.kt — home-screen widget                  │
│   MainActivity.kt       — plugin, edge-to-edge, intents, back     │
└──────────────────────────────────────────────────────────────────┘
```

Two facts follow from this, and they explain most design decisions:

1. **The renderer is shared, so the UI is identical by construction.** Desktop and Android
   render the same React tree with the same CSS. Differences are layout (breakpoints) and
   hidden surfaces, never a second implementation of a screen.
2. **Anything that needed a Node API must be re-implemented in JS or Kotlin.** That is the
   whole of `src/mobile/` and the `.kt` files.

---

## 2. Boot sequence (what happens on a cold launch)

| # | Step | Where |
|---|---|---|
| 1 | Capacitor loads `dist/index.html` from `https://localhost` | `capacitor.config.ts` (`webDir: "dist"`) |
| 2 | `src/main.tsx` first imports `./mobile/bootstrap` | `src/main.tsx` line 1 — **order matters** |
| 3 | `bootstrap.ts` checks `Capacitor.isNativePlatform()`; if native, calls `installMobileBridge()` | `src/mobile/bootstrap.ts` |
| 4 | `installMobileBridge()` builds the full `ByTuneApi` object and assigns `window.bytune` | `src/mobile/bridge.ts` |
| 5 | `src/lib/platform.ts` reads `window.bytune.platform` at import time → `"android"`; adds `.platform-android` to `<html>` | `src/lib/platform.ts` |
| 6 | React renders `<App/>`; `useSession` reads the local profile | `src/App.tsx`, `src/lib/session.ts` |
| 7 | No profile → `OnboardingView`; guest chosen → profile written → shell renders | `src/views/OnboardingView.tsx` |
| 8 | `useIsMobile()` evaluates `matchMedia("(max-width: 860px)")` → mobile shell | `src/lib/useIsMobile.ts` |
| 9 | Music: first `openSession()` reads/persists `bytune.visitor`, mints a PO token lazily | `src/mobile/innertube.ts` |

Step 2 is a trap: if `bootstrap.ts` is imported after `platform.ts`, `window.bytune` is
undefined at import time and the app thinks it is a Mac. Keep the import first.

---

## 3. Module map

### 3.1 Renderer (shared, unmodified except where noted)

Line counts measured 2026-11-17 (`wc -l`); re-measure, do not guess.

| Path | Lines | Role |
|---|---|---|
| `src/App.tsx` | 549 | Shell switch: `isMobile ? <MobileTopBar/> : <TopBar/>`, three panes vs one |
| `src/mobile/MobileShell.tsx` | 633 | `MobileNav`, `MobilePlayerBar`, `MobileTopBar`, `MobileSearchField`, `MobileSheet` (used: queue, lyrics, action sheets) |
| `src/lib/useIsMobile.ts` | 21 | The single width query, mirrored in CSS |
| `src/lib/platform.ts` | 24 | `isAndroid` / `isMobileApp` flags + `<html>` class |
| `src/lib/audio.ts` | 1695 | Playback engine: dual-element crossfade, speed, silence skip, MediaSession metadata, error recovery, prefetch, network park |
| `src/lib/analysis.ts` | 396 | BPM + edge-silence analysis via `OfflineAudioContext.decodeAudioData` |
| `src/lib/downloads.ts` | 511 | Download queue + chunked engine contracts (shared with `src/mobile/offline.ts`) |
| `src/lib/lyricsEngine.ts` | 2199 | Ported 14-provider lyrics engine, lazy-loaded (D20) |
| `src/stores/*` | — | Zustand stores, `persist` to localStorage: `library`, `player`, `settings`, `recents`, `listening`, `artistMeta`, `ui` |
| `src/index.css` | 2323 | All styling; the mobile block is `@media (max-width: 860px)` |

### 3.2 Android services

| Path | Lines | Role |
|---|---|---|
| `src/mobile/bridge.ts` | 532 | `window.bytune`; profile + storage; honest no-ops/rejects for desktop-only features (§7) |
| `src/mobile/music.ts` | 532 | Browse/search/artist/album/playlist/mood/stream surface, function-for-function the desktop service |
| `src/mobile/innertube.ts` | 624 | Client identities, `call()`, session bootstrap, stream resolution race + rotation |
| `src/mobile/lyrics.ts` | 77 | LRCLIB fetch + `parseLrc`; lazy-loads the multi-provider engine |
| `src/mobile/stats.ts` | 218 | Replay summary/record/reset in localStorage |
| `src/mobile/offline.ts` | 1303 | Chunked resumable downloads, IndexedDB v3 stores, queue, eviction (D19) |
| `src/mobile/mediaSession.ts` | 128 | Native session subscriber: drives `ByTuneShellPlugin` from `src/stores/player.ts` |
| `src/mobile/auth.ts` | 295 | Supabase PKCE Google sign-in + deep-link callback (D18) |
| `src/mobile/potoken-page.ts` | 156 | BotGuard recipe run inside the hidden WebView; bundled to `assets/potoken.js` |
| `src/mobile/bootstrap.ts` | 100 | Installs the bridge when native; memory-pressure hook; low-memory first-run defaults |
| `src/lib/connectivity.ts` | 36 | `useConnectivity()` online/offline signal |
| `src/lib/device.ts` | 43 | `isLowMemoryDevice()` (≤4 GB RAM heuristic) |
| `src/lib/haptics.ts` | 62 | Typed bridge haptics + `navigator.vibrate` fallback |

### 3.3 Native

| Path | Lines | Role |
|---|---|---|
| `ByTuneShellPlugin.kt` | 263 | `mintPoToken`, `registerStream`, `cancelPoToken`, `haptic`, `memoryInfo`, media-session/notification plumbing, shared-text intents |
| `PoTokenMinter.kt` | 362 | Hidden WebView at `https://www.youtube.com/`, native `att/get` + `GenerateIT`, token callback; serialized, 15 s timeout, cancellable |
| `StreamProxy.kt` | 221 | `ServerSocket` on 127.0.0.1, `/s/<key>?v=1`, `&meta=1` → `{"lufs":…}`, range relay, 4-thread pool, 8-entry LRU |
| `MusicPlaybackService.kt` | 469 | Foreground service (`mediaPlayback`), `MediaSession`, notification, becoming-noisy |
| `MusicAppWidgetProvider.kt` | 216 | Home-screen widget: artwork ≤256px, transport dispatch, last-known track |
| `MainActivity.kt` | 79 | Registers the plugin before `super.onCreate`; edge-to-edge; `onTrimMemory` hook; back-press + share intents; WebView debugging in debug builds |

### 3.4 Shared with the desktop (do not fork)

`electron/ytm.ts` (975 lines of InnerTube parsing), `electron/market.ts` (region resolution),
`electron/audio-format.ts` (rendition picking via `pickAudio`). These are pure TypeScript with
no Node dependency, so `src/mobile/music.ts` imports them directly. **A parser fix belongs in
`electron/ytm.ts`, not in a copy.**

---

## 4. The PO-token flow (the hardest part)

YouTube Music refuses to serve playable audio URLs to clients that cannot prove they are a real
browser. The proof is a WebPO token bound to a `visitorData` value. It has to be minted inside
a page whose origin is `https://www.youtube.com`, because BotGuard scores the VM snapshot
against that origin.

Desktop (`electron/po-token.ts`) does this with JSDOM. Android does it with a hidden WebView:

```
JS  (src/mobile/music.ts)
 └─ needs a token ──► Capacitor.Plugins.ByTuneShell.mintPoToken(visitorData)
                        │
Kotlin (PoTokenMinter)  ▼
 1. Create an off-screen WebView.
 2. webViewClient.shouldInterceptRequest answers GETs to youtube.com from OkHttp and adds
    Access-Control-Allow-Origin: * — the page believes it is on youtube.com.
 3. Load the bundled page (assets/potoken.js) at document URL https://www.youtube.com/.
 4. evaluateJavascript("window.__bytuneMintPoToken(<visitorData>)")
                        │
JS  (potoken-page.ts)   ▼
 5. Read the BotGuard challenge: the homepage's embedded challenge, else /att/get.
 6. Run the interpreter, snapshot the VM state.
 7. Hand the snapshot to native: window.__bytuneIT.generateIT(snapshot)
                        │
Kotlin                  ▼
 8. POST jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT via OkHttp.
    (Native because shouldInterceptRequest cannot supply a POST body, and because the
     endpoint is cross-origin from the WebView.)
 9. Return the integrity token to JS.
                        │
JS                      ▼
10. WebPoMinter mints the WebPO token bound to visitorData.
11. window.__bytunePoDone(JSON) → Kotlin resolves the plugin call with {token}.
```

Facts worth keeping:

- `visitorData` is persisted in `localStorage` under `bytune.visitor` (`src/mobile/innertube.ts`)
  because the token is bound to it. Losing it invalidates the token.
- A token is not strictly required on every network — stream resolution sometimes succeeds
  without one. That is a fallback, not the design.
- Since 1.1.0 (code-only): minting serializes (an overlapping mint is rejected, not
  queued), the previous WebView is destroyed in `start()`, the timeout is 15 s, JS adopts
  a late-arriving token instead of discarding it, and JS can cancel a mint
  (`cancelPoToken`). See D3's evolution note.
- The whole flow is a moving target. If Google changes BotGuard, **stream resolution degrades
  first**; browse and search keep working because they use `WEB_REMIX` without a token.

---

## 5. Stream resolution and playback

### 5.1 Resolution

`resolveStreamWith()` in `src/mobile/innertube.ts` mirrors the desktop rotation, with a
parallel race in front (1.1.0):

```
VISIONOS and ANDROID_VR race in parallel (loser cancelled), ~12s overall deadline
then IOS, then WEB_REMIX, then Piped (last, behind the deadline)
if adaptiveFormats present → pickAudio(formats, maxKbps) → first plain URL wins
throw last error
```

Resolved URLs are cached in an expiry-aware LRU (20 entries, 60 s early expiry,
`forceRefresh` bypasses it). `pickAudio` is the shared `electron/audio-format.ts`, so the
same quality ceiling applies on both platforms. `maxKbps` comes from the
`streamingQuality` setting (low ≤64, medium ≤128, high uncapped).

### 5.2 The proxy (why it exists)

The resolved `googlevideo` URL is bound to the client identity and user agent that asked for
it. A WebView `<audio>` element sends its own UA and gets 403. Desktop solves this with
`electron/stream-proxy.ts`; Android solves it with `StreamProxy.kt`:

- Listens on `127.0.0.1:<random port>` (`ServerSocket(0)`), bound to loopback only.
- `register(key, url, lufs)` returns `http://127.0.0.1:<port>/s/<key>?v=1`.
- Relays with the client's headers; **forwards `Range` verbatim**, so seeking is native and
  returns `206` + `Content-Range`.
- `&meta=1` answers `{"lufs": n}` instead of audio — the loudness value used for
  normalisation, carried on the same URL so no extra channel is needed.

Consequences that must stay true:

- `capacitor.config.ts` has `allowMixedContent: true` (https page → http loopback).
- `android/app/src/main/res/xml/network_security_config.xml` permits cleartext for
  `127.0.0.1` and `localhost` **only**.
- `index.html` CSP allows `http://127.0.0.1:*` in `media-src` and `connect-src`.
- The port is random per launch, so nothing may cache a proxy URL across restarts.

### 5.3 The audio element

`src/lib/audio.ts` is shared with the desktop. It gets a URL from `bridge.getStreamUrl(...)`,
which on Android calls `registerStream` and returns the loopback URL. Crossfade, speed,
skip-silence and MediaSession metadata all run exactly as on the desktop; the
Android-relevant paths added in 1.1.0 (next-track prefetch, network-failure park, 403
recovery with position restore, blob-URL revoke) live here too, behind the same engine.

---

## 6. Storage

No filesystem access from JS on the phone build. JSON data goes to `localStorage`; binary
data (downloads, artwork, lyrics, partial chunks) goes to IndexedDB.

| Desktop concept | Android store | Owner |
|---|---|---|
| Profile (mode, userId, username) | `localStorage`: `bytune.mobile.profile` | `src/mobile/bridge.ts` |
| Generic data blobs (`readData`/`writeData`) | `localStorage`: `bytune.data.<name>` | `src/mobile/bridge.ts` |
| YouTube visitor data | `localStorage`: `bytune.visitor` | `src/mobile/innertube.ts` |
| Library, player, settings, recents, listening, artist meta | `localStorage` (Zustand `persist` names) | `src/stores/*` |
| Downloaded audio + metadata + artwork + lyrics + partials | IndexedDB `bytune-offline-audio` v3 (`tracks`, `meta`, `artwork`, `lyrics`, `partials`, `chunks`) | `src/mobile/offline.ts` |

Implications:

- `localStorage` is ~5–10 MB and synchronous. Large payloads cannot live here — that is
  why downloads use IndexedDB (D19).
- Quota exhaustion is swallowed (`try/catch`) so the in-memory store keeps working. A user who
  hits quota loses persistence silently — acceptable today, must be surfaced if history grows.
  IndexedDB quota errors surface an honest "Storage full" message instead.
- Data is cleared by "clear app data" and by uninstall. There is no backup unless A-309 lands.

---

## 7. What the bridge must satisfy

`electron/preload.ts` defines `ByTuneApi`. `src/mobile/bridge.ts` implements it. The rule:

> **Every key in `ByTuneApi` exists on Android, with the same promise-ness.**

A missing method throws inside a view; a wrong promise-ness throws `.then is not a function`
(this actually happened with `statsSummary`). Desktop-only features are honest no-ops that
return `null`, `false` or a rejected promise **and whose UI surface is hidden** — a visible
button that silently does nothing is a bug (`AGENTS.md` §2.2).

Current honest no-ops / rejects (2026-11-17):

| Method | Android behaviour | UI |
|---|---|---|
| `downloadTrack` and the download family | Implemented: chunked resumable downloads via the queue (D19) | Download surfaces visible |
| `localTrackUrl`, `localArtBytes`, `pickFolder` | `null` | Local Music surface hidden |
| `getCanvas` | `null` | Falls back to static artwork |
| PiP window methods | no-op | No PiP entry point |
| `syncNow`, `syncBackupNow`, `syncRestoreNow` | **Fake success** `{ok: true}` — nothing is written (defect, see `STATUS.md`) | Backup/restore rows hidden on Android |
| `backupExport`, `backupImport` | Honest `{ok: false, reason: "Backup files are a desktop feature."}` | Rows hidden on Android |
| Email `authSignUp` / `authSignIn` | Throw ("use Google sign-in") | Email forms unreachable on mobile |
| Google sign-in (`authSignInGoogle`) | Real: Supabase PKCE + deep link | Visible in Onboarding + Settings |

---

## 8. Failure modes and where they surface

| Failure | Symptom | Where to look |
|---|---|---|
| BotGuard changed | Tracks resolve to nothing, or playback 403s | `adb logcat -s ByTunePoToken:*` |
| Visitor data lost | Token invalid, resolution fails | `localStorage["bytune.visitor"]` |
| PO mint overlap | Second mint rejected (serialization); late token adopted, or mint cancelled | `adb logcat -s ByTunePoToken:*` |
| Proxy port taken | `ensureStarted` fails, no audio | `adb logcat -s ByTuneStream:*` |
| Upstream URL expired | 403 mid-track; expiry-aware cache + `forceRotate` re-resolve with position restore | `ByTuneStream` relay lines |
| Bridge promise mismatch | `X is not a function` in the view | CDP console |
| CSS breakpoint crossed | Layout flips to three panes | `innerWidth` vs 860 |
| Activity theme wrong | Native ActionBar / grey status bar | `styles.xml`, manifest |

---

## 9. What is deliberately *not* here

- **No native music client.** All InnerTube logic is TypeScript; Kotlin only does what JS
  cannot (BotGuard origin, POST bodies, loopback server, the media session, the widget,
  and the shell plugin methods).
- **No second UI.** No Compose screens. If you find yourself writing a Kotlin view, stop.
- **No service worker / offline shell.** The WebView loads bundled assets; there is no PWA path.
- **No Node built-ins.** If a module needs `fs` or `path`, it cannot be imported by
  `src/mobile/*`. That is why `electron/local-library.ts` is imported type-only, never for
  runtime behaviour.
