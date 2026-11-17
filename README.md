# ByTune for Android

Android (Capacitor) build of **ByTune** — a YouTube Music client. This repository holds
only the mobile build: the shared renderer (`src/`), the Android project (`android/`), the
`electron/` TypeScript modules the renderer compiles directly (InnerTube parsers, types,
stats), the mobile feature docs, and the signed release APK.

The desktop Electron app is not in this repo.

## Download

[`apk/ByTune-1.0.3.apk`](apk/ByTune-1.0.3.apk) — `versionCode 4`, `versionName 1.0.3`,
`minSdk 22`, `targetSdk 34`, signed with a stable keystore (upgrades install in place).

```bash
adb install -r apk/ByTune-1.0.3.apk
```

Or copy the file to the phone and open it (allow "install unknown apps" for the file
manager).

## Build

Requirements: Node 20+, JDK 17, Android SDK with platform 34 and build-tools.

```bash
npm ci
npm run build          # typecheck + vite build  (renderer into dist/)
npx cap sync android   # copies dist/ into android/app/src/main/assets/public
cd android && ./gradlew assembleRelease
```

`npm run sync` does the first three steps; `npm run apk` also runs the Gradle build.
Release signing reads `android/keystore.properties` (not committed — supply your own
`storeFile` / `storePassword` / `keyAlias` / `keyPassword`, or the build is unsigned).

After editing `src/mobile/potoken-page.ts`, run `npm run build:potoken`: `cap sync` does not
regenerate `android/app/src/main/assets/potoken.js`.

## What it does

- Streaming search, moods, albums, artists, playlists via InnerTube, through a native
  OkHttp client (`src/mobile/innertube.ts`) and a loopback stream proxy
  (`android/.../StreamProxy.kt`).
- Playback through a foreground `MediaSession` service with notification and lock-screen
  controls, audio focus handling, and offline downloads.
- Library, stats/replay, lyrics, settings, all rendered by the same React code the desktop
  app uses; the phone supplies a `window.bytune` implementation
  (`src/mobile/bridge.ts`) in place of Electron IPC.
- Liquid Glass styling on the dock, sheets and player pill (translucent tint, masked
  fresnel rim, specular highlights), with `reduce-blur` / `no-glass` / reduced-motion
  fallbacks in Settings.

`docs/android/STATUS.md` is the live status board; `FEATURES.md` is the feature-by-feature
matrix; `DESIGN.md` documents the glass material and layout rules. These docs were written
against the full desktop+mobile tree, so paths they cite under `electron/` refer to the
desktop app upstream.

## License

GPL-3.0 — see [LICENSE](LICENSE). Derived from
[rishiteja21/ByTune](https://github.com/rishiteja21/ByTune); the Android port and the
Liquid Glass work are local changes. Not affiliated with YouTube or Google.
