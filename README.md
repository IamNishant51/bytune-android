# ByTune for Android

A YouTube Music client for Android. The UI is the same React renderer the ByTune desktop
app uses; on the phone it runs inside a Capacitor WebView, backed by native Kotlin for
media playback, the InnerTube HTTP client and a loopback stream proxy.

<p>
  <a href="https://github.com/IamNishant51/bytune-android/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/IamNishant51/bytune-android?style=flat-square"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Android%205.1%2B-3ddc84?style=flat-square">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/IamNishant51/bytune-android?style=flat-square"></a>
</p>

## Install

Download the APK from [Releases](https://github.com/IamNishant51/bytune-android/releases/latest)
and open it on the phone (allow "install unknown apps" for the file manager), or:

```bash
adb install -r ByTune-1.0.3.apk
```

| | |
|---|---|
| Package | `com.bytune.music` |
| Version | `1.0.3` (versionCode `4`) |
| Android | 5.1+ (minSdk 22), targetSdk 34 |
| Signing | stable keystore — later builds upgrade in place, data intact |

## Features

- **Streaming** — search, moods, albums, artists, playlists and radio over InnerTube,
  through a native OkHttp client (`src/mobile/innertube.ts`) with PO-token minting
  (`PoTokenMinter.kt`) and a loopback proxy for the media stream (`StreamProxy.kt`).
- **Playback** — foreground `MediaSession` service with notification and lock-screen
  controls, audio-focus loss handling, background playback, downloads for offline use.
- **Library and history** — playlists, liked songs, replay/stats, all persisted locally.
- **Lyrics** — synced lyrics with provider fallback and offline caching.
- **Liquid Glass UI** — translucent dock, sheets and player pill: tint, masked fresnel
  rim, specular highlights, artwork-driven ambient light. `reduce-blur`, `no-glass` and
  reduced-motion fallbacks in Settings; heavy effects are skipped on WebViews without
  `backdrop-filter`.

## Architecture

One `window.bytune` contract, two implementations. The renderer is unchanged between
platforms; the phone supplies `src/mobile/bridge.ts` where the desktop uses Electron IPC.

| Layer | Path |
|---|---|
| Renderer (shared with desktop) | `src/` — views, components, stores, player |
| Phone bridge (replaces Electron IPC) | `src/mobile/bridge.ts` |
| InnerTube client + session | `src/mobile/innertube.ts` |
| Music service (phone) | `src/mobile/music.ts` — reuses the shared parsers in `electron/` |
| Playback / stats / lyrics / offline | `src/mobile/*.ts` |
| Native: playback service, proxy, PO token, shell plugin | `android/app/src/main/java/com/bytune/music/` |
| Shared TypeScript parsers (`ytm`, `market`, `moods`, `audio-format`, types) | `electron/` |

Only the `electron/` modules the renderer compiles directly are present here; the desktop
app itself lives in the upstream repository.

## Build

Requires Node 20+, JDK 17, and the Android SDK with platform 34 + build-tools.

```bash
npm ci
npm run build            # typecheck + vite build → dist/
npx cap sync android     # copy dist/ into android/app/src/main/assets/public
cd android && ./gradlew assembleRelease
```

`npm run sync` runs the first three steps; `npm run apk` also runs Gradle.

Release signing reads `android/keystore.properties` (not committed):

```properties
storeFile=/absolute/path/to/bytune-release.jks
storePassword=…
keyAlias=bytune
keyPassword=…
```

Without it the release build is unsigned. After editing `src/mobile/potoken-page.ts`, run
`npm run build:potoken` — `cap sync` does not regenerate
`android/app/src/main/assets/potoken.js`.

## Documentation

`docs/android/` is the working record, written against the full desktop + mobile tree:

| Document | Contents |
|---|---|
| [`STATUS.md`](docs/android/STATUS.md) | The status board — what is done, with evidence |
| [`FEATURES.md`](docs/android/FEATURES.md) | Feature-by-feature matrix (`WORKS` / `PARTIAL` / `HIDDEN`) |
| [`ROADMAP.md`](docs/android/ROADMAP.md) | Task list and acceptance criteria |
| [`DESIGN.md`](docs/android/DESIGN.md) | Glass material, tokens, layout |
| [`RESPONSIVE.md`](docs/android/RESPONSIVE.md) | Breakpoints and the device matrix |
| [`TESTING.md`](docs/android/TESTING.md) | Emulator, `adb` and CDP verification protocol |
| [`BUILD.md`](docs/android/BUILD.md) · [`DECISIONS.md`](docs/android/DECISIONS.md) · [`ARCHITECTURE.md`](docs/android/ARCHITECTURE.md) | Toolchain, ADRs, internal structure |

## Known limitations

- Glass blur needs a GPU-composited `backdrop-filter`. On the Android emulator's
  SwiftShader WebView the surfaces render as tint + rim with sharp content behind them;
  a real device renders the blur.
- PiP is desktop-only and hidden on Android. Accounts/cloud sync are not implemented;
  the app is guest-only.

## License

GPL-3.0 — see [LICENSE](LICENSE). Derived from
[rishiteja21/ByTune](https://github.com/rishiteja21/ByTune); the Android port is local
work. Not affiliated with YouTube or Google.
