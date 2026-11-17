# DECISIONS — architecture decision records

One record per choice that someone will otherwise re-litigate. Format: context → decision →
consequences → what would reverse it.

Rules: new dependency, new native module, new storage layer or a change to the shared renderer
requires an ADR **before** the code (`AGENTS.md` §2.5). Supersede, never delete.

Status values: `ACCEPTED` · `SUPERSEDED by D##` · `REVISIT`.

---

## D1 — Wrap the existing renderer with Capacitor, do not rewrite

**Status:** ACCEPTED

**Context.** The app is Electron: a React renderer plus a Node main process. The owner's
requirement is "the same thing as desktop, as a mobile app". A native rewrite (Compose/Flutter)
would mean re-implementing ~40 views, the player state machine, the design system and the
InnerTube layer, and then keeping two products in sync forever.

**Decision.** Ship the existing Vite/React renderer inside a Capacitor 6 WebView. Keep the
Electron build untouched. Replace only the main process.

**Consequences.**
- Every screen exists on day one, with the same CSS and the same components. Layout work is
  CSS work, not a second UI.
- Renderer bugs fix both platforms at once.
- Costs: WebView performance ceiling, no native list virtualisation, and all Node-only
  features (downloads, local files, filesystem backup) must be rebuilt or dropped.
- The WebView is Chromium, so the desktop audio engine (`src/lib/audio.ts`) runs unchanged.

**Would reverse if** the WebView could not sustain playback or scrolling on a mid-range phone.
Not observed.

---

## D2 — One `window.bytune` contract, two implementations

**Status:** ACCEPTED

**Context.** The renderer calls `window.bytune.*` for everything that is not pure UI
(`electron/preload.ts` defines `ByTuneApi`). Android has no IPC.

**Decision.** `src/mobile/bridge.ts` implements the **entire** `ByTuneApi` surface in JS, backed
by on-device services. `src/mobile/bootstrap.ts` installs it before any module reads it.
Desktop-only features are honest no-ops whose UI is hidden.

**Consequences.**
- The renderer needs no platform branches for data access — only for layout and hiding.
- A missing method throws inside a view; a wrong promise-ness throws `.then is not a function`
  (this happened with `statsSummary`). The contract is promise-ness too, not just names.
- Adding a method to `electron/preload.ts` obliges a matching Android implementation in the
  same change, or a deliberate no-op with its UI hidden.

**Would reverse if** the two surfaces diverge so much that a single interface stops making
sense. No sign of that.

---

## D3 — Mint PO tokens in a hidden WebView, with the POSTs done natively

**Status:** ACCEPTED

**Context.** YouTube Music will not hand out playable URLs without a WebPO token, and the token
is only valid when the BotGuard VM snapshot is taken from a page whose origin is
`https://www.youtube.com`. The desktop does this with JSDOM (`electron/po-token.ts`). JSDOM is
not viable in a WebView bundle.

**Decision.** Use a hidden `WebView` in `PoTokenMinter.kt`:
- its document URL is `https://www.youtube.com/`, so the snapshot scores as valid;
- `shouldInterceptRequest` answers the page's GETs from OkHttp with
  `Access-Control-Allow-Origin: *`, so the page believes it is on that origin;
- the two POSTs that cannot be intercepted (`/youtubei/v1/att/get` and `GenerateIT`) are
  performed natively in Kotlin, because `shouldInterceptRequest` cannot supply a request body;
- the JS side (`src/mobile/potoken-page.ts`, bundled to `assets/potoken.js`) runs the
  interpreter, takes the snapshot, and mints the token.

**Consequences.**
- Works, and was verified: `minted token: 180 chars`.
- The hidden WebView costs memory while it runs; it is destroyed after the callback.
- The flow is a moving target. If Google changes BotGuard, streaming degrades first; browse and
  search keep working on `WEB_REMIX` without a token.
- `visitorData` must persist (`bytune.visitor`) because the token is bound to it.

**Would reverse if** Google offers a supported token path, or the hidden-WebView approach is
blocked.

---

## D4 — Loopback HTTP proxy in Kotlin for playback

**Status:** ACCEPTED

**Context.** Resolved `googlevideo` URLs are bound to the client identity and user agent that
requested them. An `<audio>` element in the WebView sends its own UA and receives 403. The
desktop solves this with `electron/stream-proxy.ts`.

**Decision.** `StreamProxy.kt` runs a `ServerSocket` on `127.0.0.1:<random>` and mirrors the
desktop proxy: `/s/<key>?v=1` relays with the correct headers, forwards `Range` verbatim
(206 + `Content-Range`), and `&meta=1` returns `{"lufs":n}` instead of audio.

**Consequences.**
- Playback works, and seeking is native. Verified: `relay HTTP 206 range=bytes=0- len=3487954`.
- Requires `allowMixedContent: true` in `capacitor.config.ts`, a `network_security_config.xml`
  scoped to loopback only, and `http://127.0.0.1:*` in the CSP `media-src`/`connect-src`.
- The port is random per launch; nothing may cache a proxy URL across restarts.
- The loudness value rides the audio URL, so no second channel is needed.

**Would reverse if** WebView media could set its own UA per request. It cannot.

---

## D5 — `localStorage` instead of a filesystem

**Status:** ACCEPTED

**Context.** The desktop persists library, playlists, settings, history and profile as JSON
files through IPC. Android has no filesystem access from JS.

**Decision.** Map the same data onto `localStorage`: `bytune.data.<name>` for the generic
data blobs, `bytune.mobile.profile` for the profile, `bytune.visitor` for YouTube session
state, and the Zustand `persist` names for the stores.

**Consequences.**
- Zero native code, and the store layer is unchanged.
- ~5–10 MB quota, synchronous writes, no partial-write protection. Quota exhaustion is
  swallowed so the in-memory store keeps working — a silent persistence loss that must be
  surfaced if data grows.
- Downloads, artwork blobs and backups cannot live here. That is part of why they are deferred.
- Uninstall clears everything. There is no backup until A-309.

**Would reverse when** downloads or local files land (A-301/A-302): those need real storage,
and the storage layer becomes a Capacitor plugin or Kotlin.

---

## D6 — Portrait lock for v1

**Status:** ACCEPTED — **temporary**, removed by A-409

**Context.** The only breakpoint is `860px`. A landscape phone reports `innerWidth 866`, which
crosses it into the three-pane desktop layout squeezed into 364 dp of height. Observed on the
emulator: `.mobile-nav` disappeared, three panes rendered.

**Decision.** `android:screenOrientation="portrait"` on `MainActivity` until the size-class
refactor (A-401 → A-403) makes medium-width layouts real.

**Consequences.**
- No broken landscape, at the cost of no landscape at all.
- Tablets are also locked, which is wrong for them — another reason this must not survive P4.
- The lock hides a real layout bug; do not treat it as a fix.

**Would reverse when** A-403 passes at 866×364 and A-410's matrix is green.

---

## D7 — Guest-only on Android for v1

**Status:** ACCEPTED — revisit in A-310

**Context.** Accounts use Supabase (`supabase/`, `electron/sync-merge.ts`). Porting sign-in,
token refresh, sync merge and conflict resolution is a project of its own, and the desktop
account UI assumes a browser-based OAuth flow that does not exist in a WebView without
additional plumbing.

**Decision.** Android is guest-only. The local profile lives in `localStorage`; the account
group in Settings is hidden.

**Consequences.**
- Data does not sync between desktop and phone. That is a real product limitation, stated in
  `FEATURES.md`.
- No auth surface to break, no secrets in the APK.
- The account group must stay hidden — a visible "Sign in" that does nothing is a defect.

**Would reverse when** the owner wants cross-device sync (A-310).

---

## D8 — Hide a feature rather than stub its UI

**Status:** ACCEPTED

**Context.** Several desktop features have no Android implementation: downloads, local music,
PiP window, cloud sync, backup files, output-device picking. The bridge provides no-op methods
so views do not throw.

**Decision.** Where the bridge is a no-op, the **UI surface is hidden**, and the reason is
recorded in `FEATURES.md`. No visible control that silently does nothing.

**Consequences.**
- The phone build has no dead ends (this session removed the Downloads tab/tile, the Local Music
  tile and the output-device group).
- Hiding is a claim: it must be undone in the same change that implements the feature.
- The bridge no-ops remain, so a stray call is harmless.

**Would reverse for** nothing. This is a standing rule.

---

## D9 — LRCLIB only for lyrics on Android

**Status:** ACCEPTED — revisit in A-304

**Context.** `electron/lyrics.ts` is 2139 lines and multiple providers, including word-level
timing. Porting all of it is a large amount of network-specific code.

**Decision.** Android uses LRCLIB (`src/mobile/lyrics.ts`) with line-synced LRC, parsed by the
same `parseLrc`.

**Consequences.**
- Lyrics work for the common case; some tracks that have lyrics on desktop will show none.
- No word-level/karaoke highlighting on the phone.
- The `SyncedLyrics` component is shared, so a provider added later needs no UI work.

**Would reverse when** A-304 audits which providers actually matter.

---

## D10 — No real-time Web Audio graph; offline decoding only

**Status:** ACCEPTED

**Context.** Crossfade, speed and skip-silence are built on two `<audio>` elements
(`src/lib/audio.ts`). Automix and silence detection decode files with
`OfflineAudioContext.decodeAudioData` (`src/lib/analysis.ts`).

**Decision.** Keep that architecture on Android. Do not route playback through
`createMediaElementSource` or an `AudioContext` graph.

**Consequences.**
- The engine is byte-identical to the desktop's, so behaviour matches by construction.
- Decoding a full track for skip-silence costs memory and CPU on a phone — a real risk that
  A-307 must measure, not assume.
- `decodeAudioData` needs the bytes; on Android they come through the loopback proxy, which is
  an extra fetch of the whole file.

**Would reverse if** device testing shows decode-based analysis is too slow or memory-hungry.
The fallback is to disable skip-silence/automix on low-RAM devices rather than change the
engine.

---

## D11 — One `860px` breakpoint, to be replaced by size classes

**Status:** ACCEPTED for v1 — **SUPERSEDED by the plan in `RESPONSIVE.md`** (A-401)

**Context.** The desktop layout is three panes; below some width it must become one. The
original port picked `860px` and mirrored it in `src/index.css` and
`src/lib/useIsMobile.ts`.

**Decision at the time.** One breakpoint, two definitions, one shell switch.

**Consequences.**
- Cheap, and it works for phones in portrait.
- Wrong for landscape phones (866 dp → three panes), tablets (phone layout at 700 dp) and
  foldables. It also forced D6 (portrait lock).
- Two definitions of the same number is a drift hazard.

**Superseded by** `RESPONSIVE.md`: compact `<600`, medium `600–839`, expanded `≥840`, with one
definition per boundary. A-401 tracks the work.

---

## D12 — No splash-screen plugin

**Status:** ACCEPTED

**Context.** Capacitor templates ship `@capacitor/splash-screen`, and the generated
`AppTheme.NoActionBarLaunch` inherits `Theme.SplashScreen` with a `postSplashScreenTheme`.

**Decision.** Do not install the plugin. Point the activity at `AppTheme.NoActionBar` directly
and let the WebView paint.

**Consequences.**
- No plugin, no extra dependency, no splash API to keep in sync.
- The original generated theme left a native ActionBar and a grey status bar on screen, because
  `postSplashScreenTheme` is only applied by the plugin. Fixed by changing the activity theme.
- Cold start shows black until the WebView paints (~1–2 s on the emulator). Acceptable.

**Would reverse if** the black gap becomes noticeable on a real device (A-501 measures it).

---

## D13 — No native media session in v1

**Status:** ACCEPTED — **must not survive P2** (A-201)

**Context.** `src/lib/audio.ts` sets `navigator.mediaSession` metadata and action handlers.
In a WebView this does not create a system notification or a lock-screen control surface, and
there is no foreground service, so Android may reclaim the process during long background
playback.

**Decision at the time.** Ship without it; background audio was observed working for the short
window that was tested.

**Consequences.**
- No lock-screen controls, no notification, no headset-button routing.
- A phone call or another player will not pause playback (no audio-focus handling).
- Long background sessions are at the mercy of the OEM's process killer. This is the single
  biggest "not a real music app yet" gap.

**SUPERSEDED by D14** (implemented in A-201/A-202).

---

## D14 — Native MediaSession and Foreground Service via standard Android APIs

**Status:** ACCEPTED

**Context.** In Android WebView, `navigator.mediaSession` does not publish a system media notification
or lock screen controls, and the app has no foreground service to prevent the OS from killing the
process during prolonged background playback. Android 13+ (API 33+) also requires `POST_NOTIFICATIONS`
permission and `foregroundServiceType="mediaPlayback"`.

**Decision.** Implement a native `MusicPlaybackService` and `MediaSession` using the built-in Android
framework APIs (`android.media.session.MediaSession`, `android.app.Notification.MediaStyle`,
`android.app.Service`). Drive native session state via `ByTuneShellPlugin` from a lightweight subscriber
on `src/stores/player.ts` in `src/mobile/mediaSession.ts`. Bridge notification/system media actions
back into JS through `window.__bytuneMediaAction`.

**Alternatives rejected.**
- External third-party Capacitor media plugins (e.g. `@capacitor-community/media-session`): added APK bloat,
  rigid external dependencies, and lack fine-grained integration with our existing WebView playback engine.
- `androidx.media2`: deprecated and adds unnecessary dependency weight.

**Consequences.**
- Native notification with artwork, transport controls (play/pause/prev/next), and seek bar.
- Lock screen and Android Quick Settings media player are fully driven by the real player state.
- Foreground service with `mediaPlayback` type keeps playback alive in background.
- Zero new external dependencies (0 KB added third-party library weight).

---

## D15 — Chromium owns audio focus; no native `requestAudioFocus`

**Status:** ACCEPTED

**Context.** A native `AudioManager.requestAudioFocus()` inside `MusicPlaybackService` was
added alongside D14. On device it produced an immediate `AUDIO_FOCUS_LOSS` for the app's own
client and paused playback ~4 s after every start. `dumpsys audio` showed the WebView's
`org.chromium.content.browser.AudioFocusDelegate` already holding `GAIN` as the focus client for
the same UID, so the native request was a second client fighting the first.

**Decision.** Delete the native focus request and every handler for it. The WebView's Chromium
layer owns focus: it requests `GAIN` when playback starts, receives `LOSS_TRANSIENT` on a call,
releases its audio output, and resumes when focus returns.

**Alternatives rejected.**
- Keeping both and forwarding native focus events into JS: doubles the clients, and the first
  one to drop focus wins — exactly the bug above.
- Muting instead of pausing on loss: keeps the audio session alive during a call and burns
  battery; also defeats the point.

**Consequences.**
- Verified on device: incoming call answers → focus stack shows ByTune `loss: LOSS_TRANSIENT`,
  the `AAudio` player disappears; hang up → `AAudio ... state:started`, same track continues.
- The pause/resume is Chromium's, so any future "duck instead of pause" tuning is not available
  without re-adding a native client and re-solving the double-client problem.
- Becoming-noisy (unplug) remains native in `MusicPlaybackService`, because Chromium does not
  surface that broadcast to the page.

**Would reverse if** a real device shows a call that does not pause playback, i.e. Chromium
stops requesting focus in a future WebView update.

---

## D16 — R8 on for release, with explicit keep rules

**Status:** ACCEPTED

**Context.** The debug APK is 4,047,672 bytes; release with `minifyEnabled false` was similar.
Capacitor resolves plugins by reflection (`@CapacitorPlugin`, `@PluginMethod`,
`@JavascriptInterface`), which R8 removes unless told otherwise, and the failure mode is a silent
no-op in the WebView rather than a crash.

**Decision.** `minifyEnabled true` + `shrinkResources true` with
`proguard-android-optimize.txt` and explicit keeps for `com.getcapacitor.**`, the plugin
annotation, `@PluginMethod`, `@JavascriptInterface` and `com.bytune.music.**`.

**Consequences.**
- Release APK 1,273,075 bytes (−68%). Verified behaviourally: launch, PO token, `relay HTTP 206`,
  notification, media dispatch.
- WebView debugging is off in release (`BuildConfig.DEBUG`), so on-device verification uses
  `adb`/`screencap`, not CDP. Build debug when the CDP harness is needed.
- Any new reflective entry point must be added to `proguard-rules.pro`; the symptom of forgetting
  is silence, not a build error.

**Would reverse if** a release-only bug is traced to a stripped class and the keep rule cannot be
expressed.

---

## D17 — Black launch window instead of the light Android 12 splash

**Status:** ACCEPTED

**Context.** With D12 (no splash plugin), a cold start painted the system's default splash: the
launcher icon on a light background, then a hard cut to the app's black. Two flashes per launch.

**Decision.** Give `AppTheme.NoActionBar` a `windowBackground` of `@drawable/splash_bg` (black,
no logo — an adaptive icon does not draw reliably inside a `layer-list`) and, from API 31, set
`android:windowSplashScreenBackground` to `#000000` in an API-31 style override.

**Consequences.**
- Cold start is black from tap to first paint; verified by screenshot 2 s after `force-stop`.
- No new dependency, no plugin, no image assets.
- The window background now differs from a flat black, so anything that assumes
  `windowBackground` is a colour must use the theme attribute, not `#000000`.

**Would reverse if** a branded launch screen is wanted — then use an SVG/PNG logo in the
layer-list, not the adaptive icon.

---

## Template for a new record

```
## D## — <short title>

**Status:** ACCEPTED | SUPERSEDED by D## | REVISIT

**Context.** What forced a choice. Facts, not preferences.

**Decision.** What was chosen, concretely enough to implement.

**Consequences.** What it buys, what it costs, what it forbids. Include the failure modes.

**Would reverse if** the observable condition that invalidates it.
```
