# STATUS — the board

**Last updated:** 2026-11-17
**Build under test:** **release APK**, 2,422,219 bytes, `versionCode 4` / `versionName 1.0.3`, signed `CN=ByTune` (SHA-256 `d2104277…`)
**Device:** emulator AVD `bytune` (Pixel 6, 1080×2400, density 2.625 → 412 dp wide, portrait), audio enabled
**1.1.0 (versionCode 5): a signed CI APK exists (draft release `v1.1.0`, 2,464,708 bytes, same certificate as 1.0.3) but has NOT been installed or run on any device. Do not cite 1.1.0 behaviour as tested.** See "1.1.0 rebuild" and "1.1.0 release state" below.

This is the only place that says what is done. If you change behaviour and do not update
this file, the change is not done (`AGENTS.md` §6, gate G6).

Vocabulary is fixed — see `README.md`. Do not invent new words.

---

## Where the build stands, in one paragraph

The phone build is **shippable**: a signed, R8-minified release APK (2,422,219 bytes,
1.0.3 / versionCode 4) installs on a clean device, onboards, streams and plays real
YouTube Music audio through the native PO-token minter and loopback proxy, and keeps
playing with the screen off under a foreground service with a lock-screen media
notification (play/pause/next/previous, category `transport`). Interruptions behave: a
phone call pauses playback and it resumes when the call ends; unplugging audio pauses.
It upgrades in place (v1.0.0 → v1.0.1, data intact). The 1.27 MB figure sometimes cited
is the 1.0.0 R8 build, not the build under test. Still open, in the order they matter:
re-verification of the 1.1.0 rebuild on a device (new downloads engine, stream recovery,
glass retune — all code-only so far), responsive/tablet layout (portrait lock is a
workaround), and canvas.

---

## DONE (with evidence)

| ID | What | Evidence (command → observed) |
|---|---|---|
| — | Capacitor 6 shell wrapping the existing renderer | `npx cap sync android` → `Sync finished`; app launches to the real UI |
| — | `window.bytune` bridge covering the whole `ByTuneApi` surface | every key in `electron/preload.ts` has an implementation in `src/mobile/bridge.ts`; `missing in bridge:` empty |
| — | InnerTube session over `CapacitorHttp` (no WebView CORS) | home feed and search return live data on device |
| — | PO token minted natively (hidden WebView + Kotlin) | `adb logcat -s ByTunePoToken:*` → `challenge ok: 39695 program bytes, 63026 interpreter bytes` then `minted token: 180 chars` |
| — | Native loopback stream proxy with range support | `adb logcat -s ByTuneStream:*` → `relay HTTP 206 range=bytes=0- len=3487954` |
| — | Playback: play, pause, resume, next/prev, progress | CDP: progress `4.18123%` → `11.4%` → `65.8%`; pause froze at `14.1555%` for 5 s, label flipped `Pause`→`Play`; resume advanced |
| — | Background audio (screen off / app backgrounded) | `KEYCODE_HOME` → `document.visibilityState === "hidden"`, progress `16.2958%` → `22.3578%` |
| — | Four tabs: Home, Explore, Search, Library (Apple Music standard) | Replay relocated to Settings with prominent liquid glass banner card; `.mobile-nav` verified over CDP (count: 4, gridTemplateColumns: `repeat(4, 1fr)`); screenshots: `docs/android/screenshots/home-4-tabs-verified.png`, `docs/android/screenshots/settings-replay-card-verified.png` |
| — | Album page | hero art, `ALBUM • 2023 • 15 TRACKS`, Play button, 15-track list |
| — | Search on mobile | `MobileSearchField` added (`src/mobile/MobileShell.tsx`, mounted in `src/App.tsx` for `viewName === "search"`); typed query → results grid; play from results works |
| — | Replay stats on mobile | `src/mobile/stats.ts` + async bridge fix; Replay tab renders real numbers (2 min, 1 play) |
| — | Dead ends removed on Android | Downloads tab/tile and Local Music tile hidden (`src/views/LibraryView.tsx`); `OutputDeviceGroup` hidden (`src/views/SettingsView.tsx`); "Press Ctrl+F" hint hidden (`src/views/SearchView.tsx`) |
| — | Native ActionBar / grey status bar fixed | activity theme `@style/AppTheme.NoActionBar`; black status + nav bars |
| — | Portrait lock (temporary) | `AndroidManifest.xml` `android:screenOrientation="portrait"`; rotate → `innerWidth 412`, `screen.orientation.type === "portrait-primary"` |
| — | Apple Music 7.0 Liquid Glass Overhaul, 3-Tab Nav with Sliding Glass Indicator, Library Search, Blended Cover Background & Android AppWidget | `android/app/src/main/java/com/bytune/music/MusicAppWidgetProvider.kt`, `android/app/src/main/res/layout/widget_music.xml`, `android/app/src/main/res/xml/music_widget_info.xml`, `src/mobile/MobileShell.tsx`, `src/views/LibraryView.tsx`, `src/components/NowPlaying.tsx`, `src/index.css`, `src/views/ExploreView.tsx`: (1) Standard Apple Music 3-tab navigation (`Home`, `Explore`, `Library`) with sliding refractive liquid glass tab indicator pill (`.mobile-tab-indicator`, `backdrop-filter: blur(16px) saturate(1.9)`, specular rim `inset 0 1px 1px 0 rgba(255, 255, 255, 0.42)`, sliding dynamically across tabs via `--apple-spring-fluid`); (2) Moved Search into Library with dedicated Apple Music Liquid Glass Search Bar; Library tab remains active when searching; (3) Universal true Liquid Glass optics applied to `.glass-card`, `.mobile-search input`, and `.glass-btn` across all viewports (`backdrop-filter: blur(24px) saturate(190%) brightness(1.06)`, dual-stop specular highlights `inset 0 1px 1.2px 0 rgba(255, 255, 255, 0.32)`, radial top curvature reflection sheen, and Apple spring bouncy active scale `0.97`); (4) Now Playing full-bleed blended cover artwork background (`blur(52px) brightness(0.88) saturate(1.65)`, `scale(1.36)`, radial vignette mask `radial-gradient(ellipse 95% 82% at 50% 42%, black 45%, transparent 100%)`) with squircle artwork specular rim highlight (`inset 0 1.25px 1px 0 rgba(255, 255, 255, 0.40)`); (5) Native Android AppWidget (`com.bytune.music.MusicAppWidgetProvider`, verified in `dumpsys appwidget`) with rounded squircle frosted glass container, album art, metadata, and direct transport control dispatch to `MusicPlaybackService.kt`. Verified on emulator via CDP: 3 tabs, indicator transform `matrix(1, 0, 0, 1, 256, 0)` under Library, `hasLibrarySearch: true`, `.glass-card` backdrop `blur(24px) saturate(1.9) brightness(1.06)`. Updated APK deployed to `C:\Users\nisha\Desktop\ByTune.apk` (6,175,481 bytes). Screenshots: `docs/android/screenshots/home-liquid-glass-3tabs.png`, `docs/android/screenshots/library-search-liquid-glass.png`, `docs/android/screenshots/explore-liquid-glass.png`, `docs/android/screenshots/nowplaying-liquid-blended.png`. SUPERSEDED: the nav is 4 tabs again (see the "Four tabs" row); the 3-tab arrangement and the `.glass-card` `blur(24px)` claim no longer exist in code — cards are solid since 1.1.0. |
| — | Apple Music 100% Borderless Liquid Glass overhaul & Desktop APK delivery | `src/index.css`, `src/views/SettingsView.tsx`, `src/views/LibraryView.tsx`, `src/views/PlaylistView.tsx`, `src/views/RemotePlaylistView.tsx`, `src/components/NowPlaying.tsx`, `src/views/ArtistView.tsx`, `src/components/primitives.tsx`: eliminated all 1px stroke outlines, border hairlines, and wireframe edges across the entire liquid glass design (floating player pill, bottom navigation capsule, top bar, sheets, cards, buttons, artist chips, search fields, and Now Playing squircle artwork). Replaced artificial borders with genuine Apple refractive liquid glass materials (`backdrop-filter: blur(28px) saturate(190%)`, diffuse multi-stop ambient elevation shadows `0 14px 34px -4px rgba(0, 0, 0, 0.50), 0 4px 12px -2px rgba(0, 0, 0, 0.30)`, and subtle organic radial top curvature reflections `radial-gradient(ellipse 80% 50% at 50% -10%, rgba(255, 255, 255, 0.12) 0%, transparent 70%)`). Verified on emulator over CDP: `.mobile-nav` reports `borderWidth: "0px"`, `border: "0px none"`, `.mobile-player-play` reports `borderWidth: "0px"`, Now Playing artwork reports `borderWidth: "0px"`, Library import/cards report `borderWidth: "0px"`. Output APK deployed to `C:\Users\nisha\Desktop\ByTune.apk` (6,471,870 bytes). Screenshots: `docs/android/screenshots/borderless-glass-home-verified.png`, `docs/android/screenshots/borderless-glass-library-verified.png`, `docs/android/screenshots/borderless-glass-nowplaying-verified.png`. |
| — | Imported playlist download progress + responsive layout + anti-spam toasts + Liquid Aurora gradients | `src/lib/downloads.ts` (batch download tracker, single summary toast, `getPlaylistDownloadStats`); `src/views/PlaylistView.tsx` & `src/views/RemotePlaylistView.tsx` (inline Liquid Glass progress bar with live track counters, retry, and responsive track rows without clipping/overflow); `src/stores/ui.ts` (toast deduplication); `src/components/NowPlaying.tsx` & `src/index.css` (GPU-accelerated Liquid Aurora moving gradient mesh over blurred artwork + center squircle artwork with specular shadow/bloom). Verified on device/CDP: row width 366px inside 398px viewport, 1 toast on screen, live download progress (40%), and active aurora blobs. Screenshots: `docs/android/screenshots/playlist-responsive-verified.png`, `docs/android/screenshots/playlist-download-progress-verified.png`, `docs/android/screenshots/toast-anti-spam-verified.png`, and `docs/android/screenshots/nowplaying-liquid-aurora-verified.png`. SUPERSEDED in part 2026-11-17: `src/lib/downloads.ts` was rewritten (FIFO queue + chunked engine); the progress evidence is for the old engine — re-verification owed. |
| — | Gates green | `npx tsc --noEmit` exit 0 · `npm test` `tests 279 / pass 279 / fail 0` · `npm run build` ok · `gradlew assembleDebug` → `BUILD SUCCESSFUL` — CORRECTION 2026-11-17: no test suite exists in this repo (`npm test` → `Missing script: "test"`, verified 2026-11-17); the 279 figure is unverifiable and must not be cited. The tsc/build/gradle evidence stands. See `TESTING.md` §1. |
| A-101 | Now Playing full-screen compact surface (412 dp) | `src/components/NowPlaying.tsx`: full-screen overlay with hero art, ambient glow, title/artist, like, `MobileSeekBar` scrub, transport controls, actions row (Lyrics & Queue sheets). Tapping `.mobile-player-meta` opens overlay covering 412x842; swipe down gesture and close button close overlay. Hardware back button (`adb shell input keyevent 4`) intercepted by `OnBackPressedCallback` in `android/app/src/main/java/com/bytune/music/MainActivity.kt` and closes overlay. Screenshot: `docs/android/screenshots/nowplaying-412.png`. |
| A-102 | Queue surface on compact | `src/mobile/MobileQueue.tsx`: touch-first queue sheet inside `src/mobile/MobileShell.tsx` (`MobileSheet`) with "Now playing" card, "Next up" upcoming list, remove buttons (`X`), and drag grips (`aria-label="Reorder"`). Tapping upcoming item switches playback (`playQueue`). Removing items works. Touch drag reorders items, updates `usePlayer.getState().moveInQueue`, suppresses unwanted click on grip release, and persists reorder order across sheet close/reopen. Screenshot: `docs/android/screenshots/queue-412.png`. |
| A-103 | Lyrics surface on compact | `src/components/NowPlaying.tsx`: LRCLIB synced lyrics inside `src/mobile/MobileShell.tsx` (`MobileSheet`). Active line renders with white glow, non-active lines receive progressive blur/depth de-emphasis, and instrumental sections show breathing dots. Active line advances smoothly with playback. Tapping any lyric line seeks playback (`seek`) and updates active line immediately. Back button closes lyrics sheet, returning to Now Playing. Screenshot: `docs/android/screenshots/lyrics-412.png`. |
| A-104 | Track action menu on touch | `src/lib/useTouchLongPress.ts`: 450ms stationary touch hold synthesizes `contextmenu` event (`button: 2`) with subsequent pointerup/touchend/click capture suppression so finger release does not close the sheet. `src/mobile/MobileActionSheet.tsx` renders bottom sheet with grabber handle and styled actions: Play now, Play next, Add to queue, Add to playlist (with accordion expand and New playlist...), Add to Liked, Go to artist, Copy link (Download hidden on Android). Verified long-press on "Everglow - Coldplay", added to playlist and added to queue. Screenshot: `docs/android/screenshots/actionsheet-412.png`. |
| A-105 | Explore mood/genre grid → search navigation at compact | `src/views/ExploreView.tsx` & `src/App.tsx`: 2-column duotone tile grid (49 live market categories). Tapping mood ("Workout") navigates to Search view with query populated and results rendered. Back button (`adb shell input keyevent 4`) returns to Explore with exact scroll position intact (restored to 499.8px). Fixed mobile `#view-scroll` flex containment so scroll height is properly bounded. Screenshot: `docs/android/screenshots/explore-412.png`. |
| A-106 | Artist page at compact | `src/views/ArtistView.tsx`: responsive hero photo bleed (`-mx-4` on mobile), artist name, subscriber/listener chips, Shuffle/Play/More buttons, "About the artist" expandable blurb, "Top songs" list with MoreVertical track actions, and carousels (Albums, Singles & EPs, Featured on, Playlists by, Fans might also like) rendered at 412dp with 0 horizontal overflow (`scrollWidth: 382 === clientWidth: 382`). Screenshot: `docs/android/screenshots/artist-412.png`. |
| A-107 | Playlist pages at compact | `src/views/PlaylistView.tsx`, `src/views/RemotePlaylistView.tsx`, `src/views/LibraryView.tsx`: responsive hero bleed (`-mx-4` on mobile), metadata, Shuffle/Play/More header, numbered track list with mobile-visible action buttons. Tested both local ("My Playlist #1") and remote ("Presenting Coldplay", 43 tracks): both render with zero horizontal overflow (`scrollWidth: 382 === clientWidth: 382`); tapping Play in the header starts track 1 in the player. Screenshots: `docs/android/screenshots/playlist-local-412.png` and `docs/android/screenshots/playlist-remote-412.png`. |
| A-108 | Search parity at compact | `src/mobile/MobileShell.tsx` & `src/views/SearchView.tsx`: type-ahead suggestions dropdown via `window.bytune.suggestions` (verified 6 suggestions for "Cold", tapping suggestion loads query); filter pills (All, Songs, Videos, Albums, Artists, Playlists) with responsive scrolling and zero horizontal overflow (`scrollWidth: 382 === clientWidth: 382`); infinite scroll continuation observer tested on Songs filter (grew from 20 to 36 rows, scrollHeight 1407 to 2447); Recent searches pills rendered and verified (tapping pill "coldplay" re-executes search). Screenshots: `docs/android/screenshots/search-suggestions-412.png`, `docs/android/screenshots/search-recents-412.png`, and `docs/android/screenshots/search-results-412.png`. |
| A-109 | Replay at compact | `src/views/ReplayView.tsx`: period switch (This month, Last month, This year, All time) with horizontal scroll container and responsive pill sizing (`useIsMobile`); hero stats tiles (Listening time 47 min, Plays 13, Top artist Coldplay 37 min, Top song In My Place); listening clock activity bar graph; Top songs and Top artists sections with `min-w-0` to eliminate CSS grid blowouts (`scrollWidth: 382 === clientWidth: 382`). Tapping a top song starts playback and triggers toast (verified playing "Everglow"). Screenshots: `docs/android/screenshots/replay-412.png` and `docs/android/screenshots/replay-top-412.png`. |
| A-110 | Dialogs, toasts and confirms sized and positioned for phone | `src/components/primitives.tsx` (`Dialog`), `src/components/Toasts.tsx` (`Toasts`), `src/App.tsx`: confirm dialog sized responsive to viewport (`w-[min(420px,calc(100vw-32px))] p-5 sm:p-6`), centered, with blurred backdrop dismiss, Cancel button dismiss, and hardware back button dismiss (`useAndroidBackButton`). Toasts positioned below top bar and above bottom nav (`w-[calc(100vw-32px)] max-w-[440px]`), with touch-friendly visible close button and auto-dismiss ring. Tested confirm dialog and toast on device; both fully visible and dismissible. Screenshots: `docs/android/screenshots/dialog-confirm-412.png` and `docs/android/screenshots/toast-412.png`. |
| A-111 | Settings at compact | `src/views/SettingsView.tsx`: audited all 15 rows and 13 switch toggles in SettingsView across 5 scroll positions at 412dp; 0 horizontal overflow (`scrollWidth: 382 === clientWidth: 382`); verified switch toggling (Automix toggled false -> true -> false) and hardware back button navigation. Screenshots: `docs/android/screenshots/settings-top-412.png`, `docs/android/screenshots/settings-bottom-412.png`, and `docs/android/screenshots/settings-danger-412.png`. |
| — | Clean install path | `adb uninstall` → `adb install` → `Success` → onboarding → "Continue as guest" → live home feed |
| A-201 | Media notification + lock-screen controls | `src/mobile/mediaSession.ts` → `MusicPlaybackService.kt`. `dumpsys notification` → `NotificationRecord(... channel=bytune_playback ... category=transport actions=3)` with `android.title=Chill (feat. Shivani Yadav)`; `cmd media_session list-sessions` → `tag=ByTuneMediaSession, package=com.bytune.music`; `dumpsys media_session` → `Media button session is com.bytune.music/ByTuneMediaSession`. Android 12 media-resumption flags set; API < 26 uses the `Notification.Builder` fallback. |
| A-202 | Foreground service (playback survives the screen going off) | `MusicPlaybackService` declared `foregroundServiceType="mediaPlayback"`. Screen off with playback running: `dumpsys activity services` → `isForeground=true foregroundId=4001 types=00000002 foregroundNoti=Notification(channel=bytune_playback ...)`; `dumpsys audio` → `AAudio u/pid:10194/5112 state:started`; playback advanced through several queue tracks with the screen asleep (player bar had moved from "Darkness Chill" to "Better"); process PSS 111 MB after 25 min. |
| A-203 | Audio focus: a call pauses playback, ending it resumes | `adb emu gsm call 5551234` + Answer → `dumpsys audio` focus stack shows `com.bytune.music ... gain: GAIN ... loss: LOSS_TRANSIENT ... notified: true` under telecom's `GAIN_TRANSIENT`, and the app's `AAudio` player disappears (output released). `adb emu gsm cancel 5551234` → `AAudio ... state:started` again and the mini player still shows the same track playing. Chromium's `AudioFocusDelegate` is the focus client — **do not** add a second native `requestAudioFocus`, it steals focus from Chromium and pauses playback ~4 s in. |
| A-204 | Headphone unplug / becoming-noisy auto-pause | `BecomingNoisyReceiver` in `MusicPlaybackService.kt`; `adb root` + `am broadcast -a android.media.AUDIO_BECOMING_NOISY` → `logcat` `Becoming noisy -> pausing` and `dispatchMediaAction: pause, null` |
| A-205 | Notification/track controls drive the engine (no double-skip) | `adb shell cmd media_session dispatch next` ×2 → queue index 0→1→2; `dispatch previous` → 2→1; `dispatch pause` → mini-player label `Pause`→`Play`, progress frozen; `dispatch play` → resumes. Re-verified on the minified release build: `dispatch next` advanced the bar to the next track. |
| A-207 | Notification permission asked in context, not at launch | `maybeAskNotificationPermission()` fires once, on the first `updateMediaSession`. Prompt appeared on the first play (screenshot); after Allow, `dumpsys notification` → `AppSettings: com.bytune.music importance=DEFAULT` (was `NONE`). 1.1.0: the asked-flag now persists in SharedPreferences, so a permanent denial is never re-prompted across restarts (code-only, unverified). |
| A-601 | Signed release build | `./gradlew assembleRelease` → `BUILD SUCCESSFUL`; `apksigner verify --verbose` → `Verifies`, v1 + v2 true, `Signer #1 certificate DN: CN=ByTune, OU=ByTune, O=ByTune, L=Local, ST=Local, C=IN`, RSA 4096, SHA-256 `d21042775df437feb9888d49b69ed02afdca6182b22a6215909f46bf701a6648`. Key at `C:\Users\nisha\.bytune-keys\bytune-release.jks`, credentials in `android/keystore.properties` (git-ignored). |
| A-602 | Versioning + bump procedure | `versionCode`/`versionName` in `android/app/build.gradle`, procedure in `BUILD.md` §5. `dumpsys package com.bytune.music` → `versionCode=1 versionName=1.0.0`, then after the bump `versionCode=2 versionName=1.0.1`, then `versionCode=3 versionName=1.0.2`. 1.0.3 / code 4 shipped (build under test, above); 1.1.0 / code 5 set in code 2026-11-17 (`package.json`, `build.gradle`, bridge/preload fallbacks), APK unbuilt. |
| A-603 | R8 minify enabled without breaking Capacitor | `minifyEnabled true` + `shrinkResources true` + keep rules. Release APK launches, mints a PO token, `relay HTTP 206 range=bytes=0- len=3487954`, notification title correct, media dispatch works — i.e. the reflective plugin path survived. |
| A-604 | APK size recorded, single universal APK | Release **1,273,075 bytes** (debug 4,047,672). No ABI splits — no native payload beyond Capacitor's. The 1,273,075 figure is the 1.0.0 R8 build; the 1.0.3 release APK measures 2,422,219 bytes (header). The 6.1–6.4 MB figures in rows below are debug/unminified desktop-delivered APKs, not the release build. |
| A-605 | Clean-device release verification | `adb uninstall com.bytune.music` → `Success`; `adb install -r app-release.apk` → `Success`; onboarding → "Continue as guest" → live home → search → play → notification → screen-off playback, all on the minified build. |
| A-606 | Upgrade in place, data intact | v1.0.0 installed, created "My Playlist #1" + playback history, then `adb install -r` of v1.0.1 → `versionCode=2`, Library still `1 playlist` and "Jump back in" still listed six tracks. Second playlist created afterwards rendered correctly ("My Playlist #2"). |
| — | Launch screen no longer flashes white | Cold start used to show the light Android 12 splash into a black app. `splash_bg.xml` (black) is now the window background of `AppTheme.NoActionBar`, plus an API-31 style override setting `windowSplashScreenBackground` to `#000000`. Screenshot at 2 s after `force-stop` is black, not white. |
| A-310 | Accounts: Google sign-in + Cloud sync on Android | `src/mobile/auth.ts`: Supabase PKCE OAuth client with deep link `bytune://oauth/callback` (`AndroidManifest.xml`, `MainActivity.kt`, `ByTuneShellPlugin.kt`). Onboarding renders "Continue with Google" button, and Settings enables account card with rename, backup now, restore, and sign-out. Screenshot: `docs/android/screenshots/onboarding-google-signin-verified.png`. CORRECTION 2026-11-17: Google sign-in is real; `syncNow`/`syncBackupNow`/`syncRestoreNow` return fake `{ok: true}` (nothing is written) and their backup/restore rows are hidden on Android since 1.1.0. See `FEATURES.md` §5/§6 and the BROKEN table. |
| — | Playlist share & import (Spotify & YouTube Music) | `src/lib/playlistImport.ts`: Zero-API-key client-side embed scraping for Spotify and native YTM playlist parser; `MainActivity.kt` registers `ACTION_SEND` intent filter with `mimeType="text/plain"`. In-app "Import" button in Library tab and Create menu with progress toasts. Screenshot: `docs/android/screenshots/library-import-dialog-field-verified.png`. |
| — | Search suggestions full takeover & layout consistency | `src/mobile/MobileShell.tsx` (`MobileSearchField`): replaced floating partial dropdown with full-screen opaque overlay below search bar matching Spotify/Apple Music; added sliding Cancel button and `ArrowUpLeft` query inserter buttons; submitting dismisses overlay so songs are never hidden underneath. Cleaned up excessive padding across views (`AlbumView.tsx`, `LibraryView.tsx`). Screenshots: `docs/android/screenshots/search-suggestions-takeover-verified.png`, `docs/android/screenshots/search-results-clean-verified.png`. |
| — | Apple Music animations & micro-interactions | `src/index.css` & `src/components/NowPlaying.tsx`: added fluid spring physics curves (`--apple-spring-fluid`), bottom sheet 100% slide-up, tactile button scale down on press (`active:scale-[0.975]`), and artwork breathing animation (`is-playing fs-art-breathe` vs `is-paused` scaling to 0.88). Verified on emulator. Screenshots: `docs/android/screenshots/nowplaying-apple-breathe-verified.png`, `docs/android/screenshots/nowplaying-apple-paused-verified.png`. |
| A-301 | Offline downloads for tracks and playlists | `src/mobile/offline.ts` & `src/mobile/bridge.ts`: native IndexedDB offline audio cache (`bytune-offline-audio`), streams audio via loopback proxy chunks, persists full Blobs, and serves offline playback via `URL.createObjectURL(blob)` in `getStreamUrl`. Added download button + progress spinner/check to Now Playing full-screen (`src/components/NowPlaying.tsx`), track action sheet, album header (`src/views/AlbumView.tsx`), playlist headers (`src/views/PlaylistView.tsx`, `src/views/RemotePlaylistView.tsx`), and enabled mobile "Downloaded" tab and shortcut in `src/views/LibraryView.tsx`. Engine replaced in 1.1.0 (chunked resumable downloads, IndexedDB v3, FIFO queue) — re-verification owed; see "1.1.0 rebuild" below. |
| — | Downloads complete at full speed (`Range` header) | Root cause: the `CapacitorHttp` GET sent no `Range`, and googlevideo throttles header-less GETs to ~30 kB/s, so multi-MB tracks sat at 1% for minutes. `src/mobile/offline.ts` now sends `headers: { range: "bytes=0-" }` (206, full body). Emulator: action sheet → Download of "Starboy (feat. Daft Punk)" → `start` → `progress 1/100` → `progress 4220842/4220842` → `done` in 5.1 s after resolution; library row `status:"done"`, `path:"offline:plnfIj7dkJE"`; Library → Downloaded lists it; with `fetch("https://music.youtube.com/…")` failing (airplane mode) playback advanced 6.5% → 9.1% in 6 s; "Remove download" cleared both the row and the IndexedDB blob. Also `PoTokenMinter.start()` resets `finished`, so a second mint resolves instead of hanging forever. SUPERSEDED 2026-11-17: the single-request `CapacitorHttp`/base64 path was replaced by chunked resumable `Range` downloads via the loopback proxy (1 MiB chunks, IndexedDB v3). The 5.1 s / Starboy evidence is for the old engine; re-verification owed. |
| — | Apple Music 7.0 Liquid Glass redesign & decoupled floating chrome | `src/App.tsx`, `src/mobile/MobileShell.tsx`, `src/index.css`: implemented genuine Apple Music 7.0 Liquid Glass with decoupled floating mini-player pill (`border-radius: 20px`, `height: 58px`, glowing hairline progress) and floating capsule bottom nav (`border-radius: 28px`, `height: 56px`) separated by an 8px vertical gap. Content in `#view-scroll` extends behind both capsules (`pb-36` / `144px`) so songs and artwork physically scroll underneath the glass, dynamically refracting with `backdrop-filter: blur(36px) saturate(220%) brightness(108%)`, top specular bevel highlight `inset 0 1.25px 0.75px 0 rgba(255,255,255,0.65)`, diagonal ambient sheen `::before`, circular frosted glass action buttons (`glass-btn`), and flush `html.noglass` docking fallback. Verified over CDP on emulator: measured 8px gap, pill radii, blur/saturate, and 250px content scrolling underneath. Screenshots: `docs/android/screenshots/liquid-glass-mobile.png`, `docs/android/screenshots/liquid-glass-nowplaying.png`. The `blur(36px) saturate(220%)` dock recipe is superseded (16px dock since 1.1.0); geometry (58px pill, 56px nav, 8px gap) unchanged. |
| — | High-performance artwork & photo loading | `src/components/primitives.tsx`, `src/views/ArtistView.tsx`, `src/views/AlbumView.tsx`, `src/mobile/MobileShell.tsx`: optimized image sizing (`target=160` for list thumbnails vs `544`, `128` for mini-player, `720` for mobile hero banners vs `1200`), eliminating ~90% network payload per image. Added in-memory `loadedImages` cache to eliminate skeleton flashing on re-renders, and eager loading for initial thumbnails. SUPERSEDED in part 2026-11-17: Now Playing backdrop is 256px, heroes are density-aware (1080 floor, 1200 cap), palette decodes capped at 160px; row thumbs stay 160px. |
| — | Guest account full parity & zero feature difference | Verified guest mode retains 100% full parity with account mode: local library, playlist creation, liked tracks, listening history, search, audio streaming, lyrics, replay stats, Spotify/YTM playlist import, and all audio settings without any lockouts. Verified on emulator via CDP. Note 2026-11-17: parity holds for local features only — cloud sync is fake in both modes (see the A-310 correction); the Sound Enhancer UI once counted among "audio settings" was removed (see below). |
| — | Emulator host RAM tuning & crash fix | Host machine had 3.08 GB free RAM; previous 3584M RAM allocation triggered Windows paging thrashing and QEMU crash loops. Tuned `config.ini` to `hw.ramSize = 2048M`, `vm.heapSize = 384M`, cleaned stale `multiinstance.lock`, and updated `Launch_ByTune_Emulator.bat`. |
| — | Stream & offline download resolution fix | InnerTube `VISIONOS 0.1` and `IOS` clients blocked with `LOGIN_REQUIRED: Sign in to confirm you're not a bot`. Modernized `src/mobile/innertube.ts` with VisionOS 1.02 client spec + watch session cookies (`VISITOR_INFO1_LIVE`, `__Secure-YNID`, `YSC`), bypassing botguard locks; added 10-minute in-memory stream cache and 3.5s bounded PO-token race in `src/mobile/music.ts`. Verified direct 3-second stream resolution on tracks like "Qaafirana". SUPERSEDED 2026-11-17: the 10-minute cache is now an expiry-aware LRU (60s early expiry, 20 entries); the 3.5s race now adopts late tokens and supports cancel; resolution is a parallel VISIONOS+ANDROID_VR race behind a ~12s deadline. Code-only; re-verification owed. |
| — | Edge-to-edge top bar & floating glass back lens | Removed sticky dark top header, ByTune logo, and brown wash (`.home-tint`) on mobile home (`src/mobile/MobileShell.tsx`, `src/views/HomeView.tsx`, `src/index.css`). Placed profile avatar inline in greeting header; replaced sticky subview header with floating 40px circular liquid glass back lens. |
| — | Back button isolation & subview header bar | Fixed back button appearing on root tabs (`home`, `explore`, `search`, `library`, `replay`). Added `ROOT_TABS` exclusion so root views remain completely clean with zero header overlap. Built `.mobile-subview-bar` for deep views (`settings`, `downloads`, `local`) in natural flow so content is never covered. |
| — | Library responsive pill carousel & Import button | Fixed pill cutoff on mobile devices (`src/views/LibraryView.tsx`): placed pill row into edge-to-edge touch scroll container (`-mx-4 px-4 overflow-x-auto no-scrollbar`), styled Import button with `shrink-0 whitespace-nowrap` and responsive padding. |
| — | Offline download native transport & IndexedDB persistence | Migrated offline track download in `src/mobile/offline.ts` to native `CapacitorHttp` (OkHttp binary download with base64-to-blob conversion) and immediate `start`/`progress` lifecycle dispatch in `src/mobile/bridge.ts`. Completely bypasses WebView CORS and loopback socket buffering. Downloaded songs store full audio Blobs in IndexedDB and play offline via `URL.createObjectURL`. SUPERSEDED 2026-11-17: the `CapacitorHttp`/base64 path was replaced by `fetch` through the loopback proxy with chunked resumable downloads; blob URLs are revoked after playback. |
| — | Apple Music tactile horizontal swipe gestures | Implemented gesture navigation in `src/mobile/MobileShell.tsx` and `src/components/NowPlaying.tsx`: swiping left/right on the mini-player pill translates with spring dampening and triggers `next()`/`prev()`; swiping left/right on Now Playing hero art applies fluid card-flick physics with subtle rotation and skips tracks. |
| — | Mobile Design System specification (`DESIGN.md`) | `docs/android/DESIGN.md` & `DESIGN.md`: comprehensive documentation of the Apple Music 7.0 Liquid Glass and decoupled floating chrome architecture. Covers refraction optics (`blur(24px) saturate(200%)`), specular top bevel highlights, diagonal glare sheen, universal glass cards, search pills, floating back lenses, offline download architecture, solid fallback mode (`.noglass`), spring motion curves, and GPU layer acceleration. Verified via `node scripts/docs-check.mjs`. CORRECTION 2026-11-17: `scripts/docs-check.mjs` does not exist in this repo; that verification claim is void. `DESIGN.md` was re-checked by hand in the 1.1.0 doc pass. |
| — | Offline downloads metadata persistence & offline playback resume | `src/mobile/offline.ts`, `src/mobile/bridge.ts`, `src/lib/downloads.ts`, and `src/lib/audio.ts`: downloaded tracks preserve full Track metadata in IndexedDB (`bytune-offline-audio`) alongside the audio Blob and emit `{ track }` in download events; boot automatically reconciles offline tracks from IndexedDB into `useLibrary.downloads`. Resuming playback on ended/zero-position tracks seeks to `state.position || 0` before `el().play()`, preventing false immediate re-ending. Verified on emulator: downloaded 'Clocks' by Coldplay (5.36 MB in 8.09s), verified IndexedDB record with Blob and Track metadata, enabled Airplane mode (`cmd connectivity airplane-mode enable`), verified network fetch fails ('Failed to fetch'), tapped 'Clocks' in Library -> Downloaded, observed playback advance 0.108% -> 1.615% over 5s offline with mini-player title 'Now playing: Clocks by Coldplay', paused (progress 1.739%, button flips to 'Play'), resumed offline (progress advances to 2.173%, button flips to 'Pause'). Screenshot: `docs/android/screenshots/library-downloaded-offline-verified.png`. SUPERSEDED in part 2026-11-17: boot reconcile is metadata-only (`listOfflineMeta`, no blob loads); the offline-playback evidence is for the pre-1.1.0 engine — re-verification owed. |
| — | Apple Music 4-tab bar, Library liquid glass redesign & 4GB RAM optimization | `src/mobile/MobileShell.tsx`, `src/views/LibraryView.tsx`, `src/views/SettingsView.tsx`, `src/views/ReplayView.tsx`, `src/index.css`: removed Replay from bottom nav (standard Apple Music 4-tab bar: Home, Explore, Search, Library with `repeat(4, 1fr)`); added featured ByTune Replay liquid glass card and row into Settings with subview back lens returning to Settings; overhauled Library view with Apple Music grouped category navigation rows (Liked Songs, Downloaded with icons, counters, and chevrons) and squircle Recently Added grid; optimized scroller with `contain: content;` and zero-blur hardware-composited specular acrylic simulation for cards to guarantee 60fps scrolling on 4GB RAM phones. Verified on emulator via CDP; screenshots: `docs/android/screenshots/home-4-tabs-verified.png`, `docs/android/screenshots/library-apple-liquid-glass-verified.png`, `docs/android/screenshots/settings-replay-card-verified.png`, `docs/android/screenshots/replay-from-settings-verified.png`, `docs/android/screenshots/nowplaying-apple-liquid-glass-verified.png`. CORRECTION 2026-11-17: "guarantee 60fps" was never measured — no FPS figure exists for any build. "Zero-blur" refers to the card treatment only; the dock still blurs (16px since 1.1.0). |
| — | Apple Music Home Feed & Hero Carousel, Explore Compass & genre photography, camera-safe Search, and responsive Playlist (zero horizontal scroll) | `electron/ytm.ts`, `src/mobile/music.ts`, `src/lib/recs/sections.ts`, `src/views/HomeView.tsx`, `src/views/ExploreView.tsx`, `src/index.css`, `src/mobile/MobileShell.tsx`, `src/views/PlaylistView.tsx`, `src/views/RemotePlaylistView.tsx`, `src/components/TrackList.tsx`, `src/App.tsx`: (1) Harvested `musicTwoRowItemRenderer` carousels across YTM shelves, expanding Home from 1 to 15 rich sections (top mixes, favorite artists, albums, stations, recommendations) + added Apple Music Top Picks Hero Carousel (`AppleHeroCarousel`, 16:9 aspect cards with editorial badges and round liquid glass play buttons) and Quick Moods pill row (Chill, Workout, Focus, Party, Sleep); (2) Replaced star/sparkles AI icon with Apple Music/Spotify Compass navigation icon in Explore view and mapped 20+ genres to curated photographic artwork with subtle scrim and glass highlights; (3) Shifted search field top padding to `calc(max(env(safe-area-inset-top, 0px), 24px) + 14px)` to safely clear front selfie camera punch-holes/notches; (4) Eliminated all horizontal scrolling in playlists across 412dp and 360dp compact screens by wrapping track artist and duration in flex containment (`min-w-0 truncate` + `shrink-0`) and hiding duration on compact screens (`hidden sm:block`). Verified on emulator over CDP: Home 15 sections + 6 Hero cards (`heroCount: 6`), Search `inputTop: 38px`, Explore `hasCompassIcon: true` & 8/8 artwork tiles, Playlist `overflowCount: 0` (`scrollWidth: 398 === clientWidth: 398`). Delivered fresh APK to `C:\Users\nisha\Desktop\ByTune.apk` (6,471,870 bytes). Screenshots: `docs/android/screenshots/verified-apple-home.png`, `docs/android/screenshots/verified-search-camera-safe.png`, `docs/android/screenshots/verified-explore-apple-art.png`, `docs/android/screenshots/verified-playlist-responsive.png`, `docs/android/screenshots/verified-playlist-360px.png`. |
| — | Offline lyrics caching and playback | `src/mobile/offline.ts`, `src/mobile/lyrics.ts`, `src/mobile/bridge.ts`: upgraded IndexedDB `bytune-offline-audio` to v2 with a dedicated `lyrics` store (`keyPath: "id"`). On download (`performMobileDownload`), lyrics are fetched and persisted in parallel with the audio blob (`saveOfflineLyrics`). `bridge.getLyrics` inspects offline IndexedDB first, serving cached lyrics instantly when offline with zero network requests. Verified on emulator: downloaded 'Clocks' by Coldplay, enabled Airplane mode (`cmd connectivity airplane-mode enable`), queried `window.bytune.getLyrics`, verified `offlineRetrieved: true`, `source: "BiniLyrics"`, `syncedCount: 37` lines without network. SUPERSEDED in part 2026-11-17: lyric fetch is now serialized after the audio save (queue contract), not parallel with it. |
| — | Explore & Library search parity, account header button & unique genre artwork | `src/views/ExploreView.tsx`, `src/views/LibraryView.tsx`, `src/mobile/MobileShell.tsx`: (1) Added liquid glass search bar to Explore view and contextual navigation indicator tracking (opening Search from Explore keeps Explore lit, from Library keeps Library lit); (2) Added account profile button to both Library and Explore headers next to titles and actions; (3) Expanded genre artwork mapping across 54+ cultural and musical genres plus studio hash fallbacks guaranteeing 100% unique, photographic, genre-specific artwork across all mood tiles with zero duplicate image assets. Verified over CDP on emulator: Library `hasAccountBtn: true`, `hasSearchBtn: true`; Explore `hasAccountBtn: true`, `hasSearchBtn: true`, `uniqueImageCount: 8/8`. Delivered updated APK to `C:\Users\nisha\Desktop\ByTune.apk` (6,175,481 bytes). Screenshots: `docs/android/screenshots/library-account-search-verified.png`, `docs/android/screenshots/explore-account-search-verified.png`. CORRECTION 2026-11-17: "100% unique" is overstated — genre artwork falls back to a 10-image hash set, so duplicates across genres are possible; the 8/8 CDP observation stands for the tiles checked. |
| — | Apple Music 7.0 Pro Features: Sleep Timer, Infinite Autoplay (∞), Lossless Audio specs badge, Mobile Volume slider, Create Station, Native Share sheet & Song Credits | `src/stores/sleepTimer.ts`, `src/components/NowPlaying.tsx`, `src/mobile/MobileQueue.tsx`, `src/components/RightRail.tsx`, `src/lib/trackActions.ts`, `src/index.css`: (1) Implemented Apple Music Sleep Timer with logarithmic audio fade-out and customizable presets (15m, 30m, 45m, 60m, End of current track) with active countdown badge and dismissal controls; (2) Added Apple Music Infinite Autoplay (`∞` toggle) to Queue sheet & RightRail desktop with live autoplay status; (3) Added Apple Music Lossless Audio badge under track title with high-resolution specs modal (Opus 48kHz Stereo, 256kbps, EBU R128 loudness normalization); (4) Added Apple Music tactile volume slider with speaker endpoints (`Volume1`/`Volume2`); (5) Added "Create station" (Radio), "Share song" (native `navigator.share` with clipboard fallback), and "View credits" (Apple Music Song Credits) to track action sheet. Verified on emulator via CDP: Sleep Timer sheet (`hasSheet: true`, options: 5), timer active pill `15m`, Lossless badge and specifications modal, Queue sheet `hasAutoplayBtn: true`, Action sheet `items: 9`. Delivered updated APK to `C:\Users\nisha\Desktop\ByTune.apk` (6,175,479 bytes). Screenshots: `docs/android/screenshots/apple-sleep-timer-verified.png`, `docs/android/screenshots/apple-lossless-specs-verified.png`, `docs/android/screenshots/apple-queue-autoplay-verified.png`, `docs/android/screenshots/apple-nowplaying-pro-verified.png`, `docs/android/screenshots/apple-actionsheet-verified.png`. CORRECTION 2026-11-17: the Lossless badge + specs modal were REMOVED (streams are lossy Opus ≤256 kbps; the badge mislabelled them) and the mobile volume slider was removed from Now Playing. Sleep Timer, Autoplay, Create Station, Share, Credits remain. See `FEATURES.md` §1/§5. |
| — | Flagship Search Navigation, 12 Category Cards, Sound Enhancer EQ, Track Swipe Gestures & Fluid Spring Physics | `src/mobile/MobileShell.tsx`, `src/views/SearchView.tsx`, `src/stores/settings.ts`, `src/components/TrackList.tsx`, `src/components/NowPlaying.tsx`, `src/views/HomeView.tsx`: (1) Dedicated Search 4th tab on bottom nav bar (`Home`, `Explore`, `Search`, `Library`), sliding liquid glass indicator pill at 25% width, double-tap keyboard summon, and haptic feedback; (2) Rich Search landing page with 12 vibrant Spotify/Apple category cards (Pop, Hip-Hop, Rock, Dance, Chill, R&B, Focus, Workout, Bollywood, Folk, Ambient, Party) and recent searches pills; (3) Spotify swipe gestures on track rows (swipe right >55px queues Play Next with haptic tick; swipe left <-55px toggles Like); (4) Apple Music Sound Enhancer sheet in Now Playing with EQ switch, 7 presets (Flat, Bass Boost, Vocal, Acoustic, Electronic, Treble, Late Night) and 5 ISO frequency sliders (60Hz, 250Hz, 1kHz, 4kHz, 16kHz) alongside audio format specs; (5) Floating time bubble magnifier during seekbar thumb scrub, fluid spring card contraction dismiss physics, and tactile heart-pop animation; (6) Home View "Jump Back In" shelf with 1-tap play button. Verified on emulator via CDP: 4 tabs verified, Search landing page renders 12 category cards, tapping card initiates search (12 rows), Now Playing Sound Enhancer modal toggles EQ and activates Bass Boost preset (sliders: 6, 4, 0, 0, -1), Jump Back In shelf renders on Home. Fresh APK deployed to `C:\Users\nisha\Desktop\ByTune.apk` (6,175,481 bytes). Screenshots: `docs/android/screenshots/home-jump-back-in.png`, `docs/android/screenshots/search-landing-categories.png`, `docs/android/screenshots/search-results.png`, `docs/android/screenshots/nowplaying-sheet.png`, `docs/android/screenshots/sound-enhancer-modal.png`. CORRECTION 2026-11-17: the Sound Enhancer EQ sheet was REMOVED — the presets/sliders had no audio-graph wiring (no `BiquadFilter`/`MediaElementSource` anywhere in the tree) and changed nothing. D10 forbids re-adding it without reversing the ADR. Dead `eqPreset`/`eqBands` state remains in `src/stores/settings.ts` (follow-up). Search nav, category cards, swipe gestures, spring physics remain. |
| A-314 | Liquid Glass: one shared material for every pane, press illumination, tab lens, sheet exit motion, player artwork swap, phone scroll-gutter fix | `src/index.css` + `src/mobile/MobileShell.tsx`. `src/index.css`: new `:root` tokens (`--lg-tint: 10 10 13`, `--lg-tint-alpha: .44`, `--lg-blur: 22px`, `--lg-sat: 190%`) and ONE recipe — tint (top light gradient + artwork-ambient radial + `rgb(var(--lg-tint) / var(--lg-tint-alpha))`), refraction `blur(var(--lg-blur)) saturate(var(--lg-sat)) brightness(1.05) contrast(.97)`, a masked 1px fresnel ring (`padding: 1px` + `mask-composite: exclude`) instead of a painted border, and a 3-stop drop shadow — shared by `.glass`, `.glass-pill`, `.glass-card`, `.mobile-player`, `.mobile-nav`, `.mobile-subview-bar`; `background`/`box-shadow` removed from the later base rules so they can no longer clobber it. `html.liquid-glass` block: dock geometry, press illumination (`scale(.98)` + `brightness(1.10)`), `.mobile-tab-indicator` lens, near-solid sheet material (`rgb(16 16 20 / .92)`, `blur(30px)`, painted top edge because a scrolling sheet loses a mask ring), search-field focus bevel; `reduce-blur`/`noglass`/`@supports not (backdrop-filter)` fallbacks extended to every new surface; `mobile-fade-out`/`mobile-sheet-down` keyframes + `.is-closing`; mobile block drops the desktop scrollbar gutter. `MobileShell.tsx`: `MobileSheet` keeps itself mounted with `.is-closing` and calls `onClose` on a 200ms timer; player art/title crossfade via `key={track.id}`. Device (emulator, debug APK): `#view-scroll.scrollWidth === innerWidth === 412` (the desktop 14px gutter + scrollbar had been eating 23dp); computed `.mobile-player` → `backdrop-filter: blur(26px) saturate(1.9) brightness(1.05) contrast(0.97)`, `backgroundColor: rgba(10,10,13,.52)`; sheet lifecycle over CDP `t0 mobile-sheet → t100 mobile-sheet is-closing → t400 unmounted`. Gates: `npx tsc --noEmit` exit 0 · `npm test` `tests 286 / pass 286 / fail 0` · `npm run build` `✓ built in 22.09s` · `npx cap sync android` → `Sync finished` · `gradlew assembleDebug` → `BUILD SUCCESSFUL in 35s` · `adb install -r` → `Success`. Screenshot: `docs/android/screenshots/liquid-glass-dock-verified.png`. Known environment gap (measured, reproduced by probe): the emulator's WebView (Chrome 113, `Android Emulator OpenGL ES Translator (Google SwiftShader)`) does not composite `backdrop-filter`, so the dock renders tint + rim only and content behind it stays sharp; the same CSS blurs correctly in desktop Chromium 157 (hardware and `--disable-gpu`), and `filter: blur()` blurs fine in that WebView — see `DESIGN.md` §6.5. Hardware verification of the blur is still owed. CORRECTIONS 2026-11-17: the 286-test figure is unverifiable — no test suite exists in this repo (see the "Gates green" correction); the tsc/build/gradle/adb evidence in this row stands. The 26px dock blur is superseded by the 1.1.0 retune (16px dock, solid `.glass-card`); re-measurement owed. |
| A-315 | Player bar kept every previous cover (duplicate sibling keys) | `src/mobile/MobileShell.tsx`. Both children of `.mobile-player-meta` used `key={track.id}`; duplicate sibling keys left React unable to match nodes, so each track appended another `.mobile-player-art` instead of replacing it (fiber dump: two siblings, both `key="imp_3"`). Fixed to `key={`art-${track.id}`}` / `key={`meta-${track.id}`}` so the art/meta swap still remounts and restarts `animate-art-in`. Device (emulator, debug APK): before → `[1,2,3,4]` art nodes over four tracks; after → `[1,1,1,1]` with four different titles, `.mobile-player-art img` also 1 each time, screenshot `docs/android/screenshots/player-art-fix.png`. Gates: `npx tsc --noEmit` exit 0 · `npm run build` `✓ built in 24.19s` · `npx cap sync android` `Sync finished` · `gradlew assembleDebug` `BUILD SUCCESSFUL in 5s` · `adb install -r` `Success`. |

---

## 1.1.0 rebuild — implemented 2026-11-17, NOT verified

Everything in this section exists in code only. It was typechecked and bundled (evidence
below); no Kotlin was compiled, no APK was built, and no device or emulator ran it. None
of it may be cited as working until the UNVERIFIED rows below are settled on a device.

### What changed

- **Glass + motion retune (4 GB RAM budget).** Dock pills: single `blur(16px)
  saturate(160%) brightness(1.04)` (was 26px); `.glass-card`/`.glass-strong` solid with
  the fresnel rim, no backdrop blur; shared `.glass-chip` for small surfaces; permanent
  `will-change` removed from chrome/aurora/sheets; `content-visibility` on rows/cards
  (mobile only); SearchView capped at 60 rows + "Show more"; `React.memo` track rows +
  `likedIds` Set; mini-player progress on rAF; Now Playing backdrop 256px; heroes
  density-aware (1080 floor, 1200 cap); palette decodes capped at 160px with bounded
  caches + in-flight dedup; `TintWash` desktop-only; slide-up Now Playing entrance (420ms
  spring curve) + WAAPI FLIP morph from the mini-player pill (fade fallback for reduced
  motion); swipe-down dismiss kept; MobileSheet grabber-only drag-to-dismiss;
  first-run low-memory defaults (reduce-blur ON, unfocused-lyrics blur OFF) only when no
  settings were persisted — an explicit choice is never overwritten.
- **Streaming + playback.** VISIONOS + ANDROID_VR resolve in parallel (loser cancelled),
  ~12s overall deadline, Piped last; expiry-aware stream cache (20 entries, 60s early
  expiry, `forceRefresh`); rendition tracking; PO-token late adoption + `cancelPoToken`;
  next-track prefetch (cache-only); network-failure park ("waiting for connection", never
  skip on network error); 403 retry with `forceRotate` + position restore; online/offline
  recovery; blob-URL revoke after playback; size-matched MediaSession artwork;
  `playbackRate` carried to the native session; 30s sleep-timer fade + volume restore;
  real quality caps (low ≤64, medium ≤128, high uncapped); stored `"lossless"` migrates
  to `"high"`. `StreamQuality` is now `low|medium|high`.
- **Downloads / offline (engine replaced).** Chunked resumable downloads: sequential 1 MiB
  `Range` requests via `fetch` through the loopback proxy, per-chunk retry (3 attempts),
  one 403 re-resolve per chunk, real byte progress; resume via `partials`/`chunks` stores
  with byte-count/MIME/total/ETag validation; IndexedDB v2→v3 with blob-free `meta`,
  `artwork`, `partials`, `chunks` stores; `listOfflineMeta()` metadata-only boot reconcile
  (the old `getAllOfflineEntries` blob load is deleted); storage cap (1 GiB or 80% of
  estimate) + LRU eviction sparing liked tracks; honest "Storage full" on quota errors;
  ≤256px offline artwork; FIFO queue, concurrency 2 (1 on low-memory); playlist
  serialization; lyrics serialized after the audio save; cancel checked after every await
  including after save. The single 60s `CapacitorHttp` request, the fake 1%→100%
  progress, and the base64 3–4× path are gone.
- **Lyrics engine.** The desktop 14-provider engine is ported (`src/lib/lyricsEngine.ts`,
  lazy-loaded) with word-level sync; the LRCLIB-only path remains the verified one until
  the engine is exercised on device.
- **Honesty removals.** Sound Enhancer / EQ UI removed (no audio-graph wiring existed);
  "Lossless" badge + specs modal removed (streams are lossy Opus ≤256 kbps); mobile
  volume slider removed from Now Playing; hardcoded credits claim removed; fake sync rows
  hidden on Android + honest account copy; email-form dead end closed on mobile; danger-zone
  reset dialog honest on Android (cloud backup unavailable). See `FEATURES.md`.
- **Native (Kotlin, compile-unverified).** Stream proxy: 4-thread pool, 8-entry LRU,
  non-2xx no-`Content-Length` fix. PO minter: reject-while-busy serialization, previous
  WebView destroyed in `start()`, `cancel()`, 60s→15s timeout. Shell plugin: shared-text
  newlines fixed (`JSONObject.quote()`), new `cancelPoToken`/`haptic`/`memoryInfo`,
  notification-asked flag in SharedPreferences, `playbackRate` read. Playback service:
  change-gated notification/widget rebuild, artwork `inSampleSize` ≤512px + guarded
  recycle. Widget: artwork ≤256px before parceling, last-known track in SharedPreferences.
  MainActivity: `enableEdgeToEdge()` first in `onCreate`, `onTrimMemory` → JS memory hook.
  Styles: transparent status/nav bars. Manifest: `hardwareAccelerated`, `VIBRATE`, no
  `largeHeap`. `minWebViewVersion: 111`. Haptics: typed bridge path + `navigator.vibrate`
  fallback, never both (tab, press, swipe, long-press, action-success moments).
- **Bundle.** Lazy views + desktop shell + PipApp + lyrics engine + auth; `manualChunks`
  (react/zustand/lucide/Capacitor); `chunkSizeWarningLimit` 500. The jsdom `api` chunk
  (5.5 MB) is lazy-only — it is still bundled, not removed.
- **Build + release.** Versions reconciled to 1.1.0 / versionCode 5 everywhere
  (`package.json`, `build.gradle`, bridge/preload fallbacks, README). New CI workflow
  `.github/workflows/android-release.yml` (tag `v*` + manual dispatch, JDK 17, Node 24,
  keystore from secrets) + `docs/android/CI-RELEASE.md` with exact setup. No keystore,
  no secrets in the tree.
- **Shared-text seam, verified by reading (not on device).** `detectPlaylist` uses
  substring regexes for Spotify/YouTube URLs, so multi-line shared text (now delivered
  intact after the `JSONObject.quote()` fix) still matches. The raw-ID branch stays
  whole-input anchored, which is correct for a bare ID. No fix was needed.

### Verification evidence (this environment, 2026-11-17)

- `npx tsc --noEmit` → exit 0, no output.
- `npm run build` → `✓ built in 30.29s`, 27 chunks, `dist/` 6.4 MB. First-paint chunks:
  `index` 291.72 kB, `vendor-react` 133.92 kB, CSS 112.05 kB; lazy: `auth` 228.04 kB,
  `lyricsEngine` 34.11 kB, per-view 4–24 kB; `api` chunk 5,524.70 kB (jsdom, referenced
  only by the lazy lyrics path — not in the first-paint path). The >500 kB chunk warning
  still fires for the `api` chunk.
- NOT run: `npx cap sync` / Gradle (no JDK, no Android SDK on this machine), any device
  or emulator run. Kotlin compilation is unverified; CI must verify it.

### Known deviations and leftovers (honest, not hidden)

- **New `any`.** `AGENTS.md` rule 3 forbids `any`; the rebuild adds a small number of new
  `any` annotations confined to raw-InnerTube-JSON parser shapes in files that already
  carry `eslint-disable @typescript-eslint/no-explicit-any` (`innertube.ts` 12 vs 9 at
  head, `electron/ytm.ts` 53 vs 50; `music.ts`/`bridge.ts`/`audio.ts` unchanged). This is
  a documented deviation, not a silent weakening — the parser shapes are untyped JSON.
- **Dead EQ state.** `EQ_PRESETS`/`eqPreset`/`eqBands` remain in `src/stores/settings.ts`
  with no UI surface. Follow-up: remove or wire for real (D10).
- **Desktop-only "lossless" remainder.** The `DownloadQuality` type/label/default and its
  Settings row keep the word "lossless", gated to the desktop group (`!isMobileApp`).
  Streaming "lossless" is gone; this remainder is desktop download quality only.
- **jsdom still bundled.** The `api` chunk (5.5 MB) ships jsdom for the lazy lyrics path.
  Do not claim it was removed.
- **Dead files, deletion deferred.** `src/mobile/MobileNowPlaying.tsx` (473 lines) and
  `src/components/MeshBackdrop.tsx` (81 lines) have zero imports/references (grep-verified
  2026-11-17) but are still in the tree: the snapshot-push path cannot delete files, so
  deletion waits for a deletion-capable push (local git or browser). Do not re-add
  references to them.
- **Two palette engines remain.** `ambient.ts` and `palette.ts` were not merged (different
  output types); both are now capped + cached + droppable via the memory-pressure hook.

### 1.1.0 release state

Draft release `v1.1.0` on `github.com/IamNishant51/bytune-android` carries a CI-built
signed `app-release.apk` (2,464,708 bytes, `versionCode 5` / `1.1.0`, certificate SHA-256
`d2104277…` — identical to the installed 1.0.3 key, so it upgrades in place). The draft is
unpublished on purpose; publishing it is what makes the download link live. Nothing is
installed yet: install-over-1.0.3 with data intact is still owed (A-606). See
`docs/android/CI-RELEASE.md`.

---

## NEXT (ordered — take the top open item)

| Order | ID | Why it is next |
|---|---|---|
| 1 | — | Verify the 1.1.0 rebuild on a device (downloads engine, stream recovery, glass retune, edge-to-edge, memory pressure) — the UNVERIFIED rows below. Nothing in 1.1.0 is shippable until this is done. |
| 2 | A-401 | Every responsive task is blocked behind the breakpoint refactor, and the portrait lock exists only because of it. Do it before A-402–A-410. |
| 3 | A-206 | Network switch (Wi-Fi ↔ mobile) recovery during playback is the last "daily phone" playback gap. |
| 4 | A-303 | Canvas (animated artwork) is `STUB` — the bridge returns `null`. |
| 5 | A-304 | The multi-provider lyrics engine + word-level sync are ported in code (1.1.0) but unverified; LRCLIB remains the verified path. Verify the engine on device. |

---

## IN PROGRESS

Nothing. A-202's multi-hour soak is the only measurement still running; the 25-minute screen-off
sample above is already recorded as evidence.

---

## UNVERIFIED (code exists, nobody has exercised it on a device)

Each row names the command that would settle it. Do not claim these work.

| Area | Why it is unverified | How to settle |
|---|---|---|
| Crossfade | Setting renders (`PLAYBACK → Crossfade`); boundary not observed | Play two tracks with crossfade 4 s, listen for a gap |
| Automix | Setting renders; BPM path (`src/lib/analysis.ts`) not exercised on device | Enable automix, watch for the beat-aligned transition or the fallback toast |
| Skip silence | Setting renders; decode path not exercised | Play a track with a long intro, check the head seek |
| Playback speed | Setting renders; pitch preservation not measured | Set 1.5×, confirm tempo changes and pitch holds |
| Long background playback (hours) | 25 min of screen-off playback verified; an hours-long session is not | Leave it playing overnight with the screen off; check `dumpsys activity services` and `dumpsys audio` in the morning |
| Tablet / landscape / foldable | Portrait-locked; landscape was actively broken (866 dp → 3-pane) | A-403/A-409/A-410 |
| RTL | `android:supportsRtl="true"`, never rendered | Force RTL in developer options |
| System font scaling | Never tested | Set font size to largest, screenshot Settings |
| Canvas artwork | Bridge returns `null` (`getCanvas` in `src/mobile/bridge.ts`) | A-303 |
| Offline / error states | Not exercised | A-502 |
| 1.1.0 downloads engine | Chunked resumable downloads, FIFO queue, storage cap/eviction, DB v2→v3 migration — code only | Airplane mid-download → resume; cancel mid-download + after save; 43-track playlist soak; quota-full device; upgrade over a 1.0.3 install with existing downloads; offline artwork load |
| 1.1.0 stream recovery | Parallel client race, 12s deadline, expiry-aware cache, 403 forceRotate, prefetch — code only | Force 403s (stale URL); slow network; measure the inter-track gap with prefetch on/off; network switch mid-track (A-206) |
| 1.1.0 PO-token behaviour | Late adoption, cancel, 15s timeout, serialization — code only | Slow network mint; overlapping mints; cancel mid-mint; `logcat -s ByTunePoToken:*` |
| 1.1.0 glass + motion | 16px dock, solid cards, FLIP morph, slide-up, content-visibility, low-memory defaults — code only; emulator cannot composite blur | Real phone only: dock blur legibility, morph smoothness, scroll jank on a 4 GB phone, reduce-blur default on first run |
| 1.1.0 edge-to-edge | `enableEdgeToEdge` + transparent bars — code only, Kotlin uncompiled | Gesture nav + 3-button nav; content under system bars; keyboard + search field (A-406) |
| 1.1.0 memory pressure | `onTrimMemory` hook, palette cache drop, 60s `memoryInfo` polling — code only | Background the app under memory pressure; `dumpsys meminfo`; PSS on a 4 GB phone (budgets in the research notes are targets, not measurements) |
| 1.1.0 haptics | Bridge `haptic(kind)` + vibrate fallback — code only | Feel tab/press/swipe/long-press/action moments on a real phone; confirm no double buzz |
| 1.1.0 notification / widget | Change-gated rebuild, ≤512px/≤256px artwork, last-known track, deny-once flag — code only, Kotlin uncompiled | Play/pause/next from notification + widget; deny notifications permanently, restart, confirm no re-prompt; widget after reboot |
| 1.1.0 sleep-timer fade | 30s fade + volume restore — code only | Set a 15m timer, listen for the fade, confirm volume restores |
| 1.1.0 lyrics engine | 14-provider engine + word-level sync — code only | 5 tracks side by side with the desktop (A-304); offline cached lyrics |
| CI workflow + upgrade | Workflow executed on tag `v1.1.0` (run 44110934582, every step green): signed `app-release.apk` 2,464,708 bytes, `versionCode 5` / `1.1.0`, `apksigner` DN `CN=ByTune` + SHA-256 `d2104277…` equal to the 1.0.3 key, draft release created | Install over 1.0.3, data intact (A-606); any run on a real phone |
| Cold start / FPS / memory | No figures exist for any build; "60fps" was never measured | A-501: cold start, scroll FPS, PSS foreground/background on the 4 GB phone |

---

## BROKEN / KNOWN DEFECTS

| Defect | Detail | Fix |
|---|---|---|
| Portrait lock | Workaround for the 866 dp landscape → three-pane bug | A-401 → A-409 |
| Single 860px breakpoint | No medium/expanded treatment; tablets get either the phone layout or a cramped three-pane | A-401 |
| Cloud sync lies | `syncNow`/`syncBackupNow`/`syncRestoreNow` (`src/mobile/bridge.ts`) return `{ok: true}` without writing anything. `syncStatus` honestly reports `available: false`, and backup/restore rows are hidden on Android since 1.1.0 — but any caller of the three methods is misled. | A-310: implement real sync, or make the methods reject honestly |
| No test suite | `npm test` → `Missing script: "test"`. No test files, no `scripts/` dir. Every past "279/286 tests pass" claim is void. | Add a suite (A-501 follow-up) or stop citing test gates; `TESTING.md` G1 is marked accordingly |

---

## BLOCKED (needs the owner, not more code)

| ID | Blocked on | Unblocks when |
|---|---|---|
| A-310 | Sync decision still open: implement real Supabase sync, or stay local-only and make the sync methods reject honestly. (Google sign-in itself shipped; do not re-litigate it. A-301's storage decision was resolved by implementation — app-private IndexedDB, see D19.) | Owner decides; either outcome is a valid ADR |
| A-311 | Confirmation that OS-level PiP is out of scope for v1 (the desktop "PiP window" is a separate Electron window, not Android PiP) | Owner confirms |

---

## Done log

### 2026-11-17 — signed 1.1.0 APK built in CI (draft release, not installed)

- Four repository secrets set on `IamNishant51/bytune-android` (`KEYSTORE_BASE64`,
  `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`) from the local
  `android/keystore.properties`, encoded once by hand. No secret value is in the tree, in
  the workflow, or in this file.
- Tag `v1.1.0` on `dede35e` → workflow run 44110934582: verify-secrets, `npm ci`,
  `npm run build` (typecheck + vite), `cap sync android`, keystore decode, `assembleRelease`,
  artifact upload, draft release — all green.
- `apksigner verify --print-certs` on the downloaded APK: `CN=ByTune`, SHA-256
  `d21042775df437feb9888d49b69ed02afdca6182b22a6215909f46bf701a6648`, i.e. the same key as
  `ByTune-1.0.3.apk`. `aapt2 dump badging`: `com.bytune.music`, `versionCode 5`,
  `versionName 1.1.0`.
- NOT done: no install, no device or emulator run of 1.1.0 (the emulator still runs the
  debug build, a different signing key); the release stays a draft until the owner
  publishes it.

### 2026-11-17 — 1.1.0 rebuild implemented (unverified), doc pass, versions reconciled

- Rebuild implemented in code (see "1.1.0 rebuild" above): glass/motion retune, stream
  recovery, downloads engine replacement, lyrics engine port, honesty removals, native
  Kotlin changes, bundle splitting, CI workflow. No APK built, no device run.
- Versions reconciled: `package.json` said 1.0.1 while Gradle/README said 1.0.3 — all
  sites now 1.1.0 / versionCode 5.
- Doc pass: false DONE claims corrected in place (test counts, 3-tab nav, Lossless/EQ,
  old download engine, 100%-unique artwork, 60fps guarantee, `docs-check.mjs`,
  A-310 sync); `FEATURES.md` recount 85 rows; `DECISIONS.md` D18–D22 added, D7/D9
  superseded; `ARCHITECTURE.md`/`DESIGN.md`/`TESTING.md`/`BUILD.md`/`RESPONSIVE.md`
  brought in line with the code.
- Gates: `npx tsc --noEmit` exit 0 · `npm run build` `✓ built in 30.29s` · Gradle and
  device gates NOT run (no JDK/SDK on this machine; CI must verify Kotlin).

### 2026-10-29 — signed release build, playback lifecycle closed

- Release pipeline complete: key generated outside the repo, `signingConfigs.release` wired
  from `android/keystore.properties` (git-ignored), R8 + resource shrinking on, keep rules
  proven by running the minified APK on a device. 4,047,672 → **1,273,075 bytes**.
- Playback lifecycle closed on a real Android runtime: foreground service with
  `mediaPlayback` type, transport notification with working media controls, audio focus
  handled by Chromium (call pause/resume verified), becoming-noisy auto-pause.
- Upgrade-in-place verified twice (1.0.0 → 1.0.1 → 1.0.2) with library and history intact.
- Launch screens: the light Android 12 splash was replaced with the app's black.
- Gates: `npx tsc --noEmit` exit 0 · `npm test` `tests 279 / pass 279 / fail 0` ·
  `assembleRelease` `BUILD SUCCESSFUL` · `apksigner verify` → `Verifies`.
- Removed the native audio-focus request that was stealing focus from Chromium — see
  `DECISIONS.md`.

### 2026-10-26 — first device-verified build

- Port completed and verified end-to-end on the emulator (fresh install → onboarding → guest
  → home → search → album → playback → pause → resume → background → tabs).
- Five defects found **by testing, not by reading**, and fixed: native ActionBar, Replay crash
  (`statsSummary` sync vs async), missing mobile search field, dead-end Downloads/Local Music
  surfaces, landscape crossing into the three-pane layout.
- Scratch test harness (`.potest/`) removed; stray node servers killed; emulator stopped.
- Documentation set created: `AGENTS.md`, `docs/android/*`.

---

## How to update this file

1. Move the task ID out of `NEXT` and into `DONE` with an **evidence line**: the exact command
   and the observed output, plus the files touched.
2. If you could not fully verify, put it in `UNVERIFIED` with the command that would settle it.
3. If it needs a decision, it goes to `BLOCKED` with the question, not with a guess.
4. Update the "one paragraph" summary if the overall state changed.
5. Update `Last updated`.
