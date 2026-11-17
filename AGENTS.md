# AGENTS.md — ByTune for Android

Mobile-only repository. The shared React renderer (`src/`) plus the Capacitor project
(`android/`). The desktop Electron app is **not** here; `electron/` contains only the
TypeScript modules the renderer compiles directly (`preload.ts` types, `ytm.ts`,
`market.ts`, `moods.ts`, `audio-format.ts`, `local-paths.ts`, `local-library.ts`,
`stats.ts`, `artwork.ts`, `persist.ts`).

`docs/android/` was written against the full upstream tree, so paths it cites under
`electron/` (e.g. `electron/main.ts`, `electron/stream-proxy.ts`) live in the desktop repo.

## Rules

1. Never claim something works without running it. Quote the command and its output.
2. Never fake a feature: implement it, or hide it and record the reason in
   `docs/android/FEATURES.md`.
3. Never weaken a check to make it pass (no deleted tests, no loosened assertions, no `any`).
4. No new dependency without an entry in `docs/android/DECISIONS.md`.
5. No secrets: `android/keystore.properties`, `*.jks`, `*.keystore` stay local.
6. Keep `docs/android/STATUS.md` true in the same change; it is the only status board.
7. GPL-3.0 — added code must stay GPL-compatible.

## Commands

```bash
npx tsc --noEmit          # typecheck, must be 0 errors
npm run build             # typecheck + vite build into dist/
npx cap sync android      # copy dist/ into the android project
npm run build:potoken     # rebuild android/app/src/main/assets/potoken.js after
                          # editing src/mobile/potoken-page.ts (cap sync does not)
cd android && ./gradlew assembleRelease   # JDK 17, Android SDK 34
```

`npm run sync` = build + cap sync. `npm run apk` = sync + Gradle release build.

## Verifying on a device

`docs/android/TESTING.md` has the emulator, `adb` and CDP protocol. Two known traps:

- The Android emulator's WebView does not composite `backdrop-filter`, so glass looks like
  tint + rim only there. Judge blur on a real phone.
- `potoken.js` is a build artifact shipped as a source asset; `cap sync` will not update it.
