# ROADMAP — Android to daily-driver quality

Task IDs are minted **here and only here**. `STATUS.md` moves them; it never invents them.
Every task has an acceptance check that a device can settle. If a task cannot be checked,
it is not a task yet — rewrite it.

Order is deliberate: **P1 makes the app usable, P2 makes it survive a phone, P3 closes the
feature gap, P4 makes it right on every screen, P5 makes it not fall over, P6 ships it.**

Legend: `[ ]` open · `[~]` in progress · `[x]` done (mirrored in STATUS.md).

---

## P1 — Shell parity on a phone (the app must feel complete before anything else)

The desktop has three panes. A phone has one. Today the phone shell has: top bar, content,
mini player, five tabs — and **no Now Playing surface, no queue, no lyrics, no track actions**.
That is the single biggest gap. `MobileSheet` is defined in `src/mobile/MobileShell.tsx` and
**never rendered**; the desktop `NowPlaying` overlay is reachable from the mini player but is
laid out for a desktop window.

| ID | Task | Acceptance check |
|---|---|---|
| A-101 | Now Playing full-screen surface for compact widths: artwork, title/artist, seek, transport, like, shuffle/repeat, actions row. Opened by tapping the mini player, closed by swipe-down and by a back gesture. | Tap mini player → overlay covers viewport, no clipped controls at 412×842; swipe down closes; Android back closes. |
| A-102 | Queue surface on compact: "Up next" list, current track highlighted, tap-to-jump, drag-to-reorder, remove. Desktop equivalent is `src/components/RightRail.tsx`. | Queue opens from Now Playing, shows the real queue, tapping an item plays it, reorder persists after closing. |
| A-103 | Lyrics surface on compact: synced lines, active-line scroll, tap-to-seek, no-lyrics state. | Open lyrics for a track with LRCLIB data → active line advances with playback; tap a line → seeks. |
| A-104 | Track action menu on touch: long-press a row → the same actions as the desktop context menu (`src/components/ContextMenu.tsx`), presented as a sheet. | Long-press a track row → sheet lists Play next, Add to queue, Add to playlist, Like, Go to artist, Go to album; each performs the action. |
| A-105 | Explore: mood/genre grid → mood page (`src/views/ExploreView.tsx`), verified at compact width. | Tap a mood chip → page lists that mood's shelves; back returns to the grid with scroll position intact. |
| A-106 | Artist page at compact (`src/views/ArtistView.tsx`): hero, top songs, albums, singles, about. | Artist page renders all sections at 412dp with no horizontal overflow. |
| A-107 | Playlist pages at compact: local (`PlaylistView`) and remote (`RemotePlaylistView`), including the header action row and track list. | Both page types render; play from the header starts the playlist at track 1. |
| A-108 | Search parity at compact: suggestions while typing, recent searches, filter chips, infinite scroll. | Typing shows suggestions; submitting shows All/Songs/Videos/Albums/Artists/Playlists; scrolling loads more. |
| A-109 | Replay at compact (`src/views/ReplayView.tsx`): period switch, summary tiles, top tracks/artists. | Replay renders real numbers after ≥1 play; switching period re-renders without layout break. |
| A-110 | Dialogs, toasts and confirms sized and positioned for a phone (no off-screen dialog, no toast under the nav bar). | Trigger a confirm dialog and a toast → both fully visible, dismissible, above the bottom nav. |
| A-111 | Settings at compact: every group that survives on Android renders with rows that do not overflow. | Scroll the whole Settings page at 412dp; no clipped switch, no horizontal scroll. |

---

## P2 — Android playback lifecycle (the part the desktop never had to solve)

Background audio works today, but there is **no `MediaSessionService`, no notification, no
audio-focus handling and no foreground service** — Android can reclaim the process, and the
lock screen has no controls. `src/lib/audio.ts` calls `navigator.mediaSession` for metadata,
but the WebView's implementation does not create a system notification.

| ID | Task | Acceptance check |
|---|---|---|
| A-201 | Native media session: `MediaSessionCompat` + `MediaStyle` notification with artwork, title/artist, play/pause, prev/next, seek. Bridge to JS for state, JS to native for commands. | Play a track → notification appears with correct metadata; pressing pause in the notification pauses playback. |
| A-202 | Foreground service (`mediaPlayback` type) so the OS keeps the process alive while playing. | Play, screen off, wait 30 min → playback still advancing in `logcat`/notification. |
| A-203 | Audio focus: request on play, pause on loss, duck on transient loss, resume on gain. | Start a call / another player → ByTune pauses; end it → resumes (configurable). |
| A-204 | Becoming-noisy: headphone unplug pauses playback. | Unplug headphones while playing → playback pauses. |
| A-205 | Lock-screen / notification controls drive the real engine (no drift after long pause, no double-skip). | 20 play/pause/next/prev from the notification → player state and UI stay in sync. |
| A-206 | Network transition recovery: Wi-Fi ↔ mobile mid-track resumes instead of dying. | Toggle airplane mode for 10 s mid-track → playback recovers or shows a retry state, never a silent hang. |
| A-207 | `POST_NOTIFICATIONS` permission (API 33+) requested at the right moment, denial handled gracefully. | Fresh install on API 33+ → permission asked once; denying still plays audio (no notification). |

---

## P3 — Feature parity with the desktop

Today's honest gaps, all verified in `src/mobile/bridge.ts`: downloads **reject**, local
files return `null`, canvas returns `null`, no cloud sync, no backup import/export.

| ID | Task | Acceptance check |
|---|---|---|
| A-301 | Downloads on Android: resolve → download to app storage with progress, resume, delete, "Downloaded" tab and tile restored. | Download an album → files land on disk, the Downloaded tab lists it, it plays offline with the network off. |
| A-302 | Local music import via the system file picker (SAF), persisted as a content URI, playable after reboot. | Pick a folder/file → tracks appear in Local Music; force-stop, reopen → still playable. |
| A-303 | Canvas (the animated artwork behind Now Playing) on Android. Desktop: `electron/canvas.ts` → `src/lib/canvas.ts`. | Open Now Playing for a track with canvas → video loops behind the artwork; absent → static art, no error. |
| A-304 | Lyrics provider parity: audit which providers `electron/lyrics.ts` actually uses; match them where the network allows. | Side-by-side with desktop for 5 tracks → same lyrics source and same sync offsets. |
| A-305 | Crossfade verified on device (dual-element equal-power blend). | Set crossfade 4 s → track boundary has no gap and no volume dip; measured by listening + position log. |
| A-306 | Automix verified on device (BPM analysis via `src/lib/analysis.ts`). | Automix on → transition aligns to beats or shows the honest fallback toast; no crash on decode failure. |
| A-307 | Skip silence verified on device (decode-based edge scan). | Track with a 3 s intro silence → playback starts after it; head-trim offset applied to lyrics. |
| A-308 | Playback speed verified on device, pitch preserved, persisted across restart. | Set 1.5× → speed changes, pitch holds, reopening the app keeps 1.5×. |
| A-309 | Backup export/import (`src/views/SettingsView.tsx` → "Your data"). Currently desktop-only. | Export writes a file to a user-chosen location; import restores library and history on a wiped install. |
| A-310 | Accounts + cloud sync decision (Supabase exists in `supabase/`). Either implement Google sign-in + sync or keep guest-only and hide the account group permanently. | Decision recorded as an ADR; the UI matches the decision with no dead entry points. |
| A-311 | PiP mini-window: permanently `HIDDEN` on Android (OS-level PiP is a different feature; do not conflate). | No PiP entry point on Android; ADR records why. |
| A-312 | "Don't repeat suggestions", "Reduce motion", appearance/theme rows — confirm each behaves on Android or hide it. | Each Settings row is exercised once; row either changes behaviour or is hidden. |
| A-313 | Sort a playlist's tracks (local and remote): Title, Artist, Album, Duration, plus "Custom order" to restore the stored arrangement; tapping the active key reverses it. | Open a playlist → "⋯" → Sort → Title → rows reorder alphabetically; open a remote playlist → Sort → Duration → 49 rows arrive in ascending length order; Custom order restores the original order. |
| A-314 | One shared Liquid Glass material for every pane (tint · refraction · masked fresnel rim · light), Apple-style press illumination and tab lens, sheet exit animation, player artwork/meta swap, and removal of the desktop scroll gutter on the phone. | Computed `backdrop-filter`/`background` on `.mobile-player` at 412dp matches the recipe; the pill and nav are inset 14dp with `scrollWidth === innerWidth === 412`; a sheet mounts, gets `.is-closing` and unmounts after the exit animation. |
| A-315 | Player bar kept every previous cover: both siblings in `.mobile-player-meta` used `key={track.id}`, so React saw duplicate sibling keys and appended a new art node per track instead of replacing it. | Play four tracks in a row → `document.querySelectorAll(".mobile-player-art").length === 1` after each, and the row shows one cover with the title back at full width. |

---

## P4 — Responsive layout, done properly

Today there is exactly **one** breakpoint: `@media (max-width: 860px)` in `src/index.css`,
mirrored by `MOBILE_QUERY` in `src/lib/useIsMobile.ts`. That is why a landscape phone (866 dp)
flips into the three-pane desktop layout, and why the app is portrait-locked as a workaround.
Target: Android/Material 3 window size classes (see `RESPONSIVE.md`).

| ID | Task | Acceptance check |
|---|---|---|
| A-401 | Replace the single 860px query with window size classes: compact `<600`, medium `600–839`, expanded `≥840`. One shared hook + CSS custom property, no duplicated magic numbers. | `grep` finds exactly one definition of each breakpoint; resizing across 599/600/839/840 flips layouts exactly once. |
| A-402 | Compact layout: single pane, bottom tab bar, mini player, full-screen Now Playing. | 360×640 and 412×842 screenshots: nothing clipped, nav reachable one-handed. |
| A-403 | Medium layout (small tablet, foldable unfolded, landscape phone): navigation rail instead of bottom bar, two-column content where it helps, Now Playing as a sheet at 60–80% height. | 700×900 and 866×364: rail visible, content not stretched, no three-pane squeeze. |
| A-404 | Expanded layout: the existing three-pane desktop shell, unchanged, with the sidebar collapsible. | 1024×768 and 1280×800: three panes, sidebar toggle works, desktop layout pixel-identical to the desktop build. |
| A-405 | Now Playing adapts: bottom sheet (compact) → side panel (expanded), keeping queue and lyrics reachable in both. | Same track open at 412 and 1024: controls present, queue reachable, no duplicate overlays. |
| A-406 | Edge-to-edge insets: status bar, navigation bar and cutout handled with `env(safe-area-inset-*)` everywhere chrome meets the screen edge; target the API 35 enforcement path. | On a gesture-nav device and a 3-button device: no content under the system bars, no double padding. |
| A-407 | Font scaling: 1.3× and 2.0× system font size without clipping or unreachable buttons. | Screenshots at both scales for Home, Now Playing, Settings. |
| A-408 | RTL: `dir="rtl"` locale renders mirrored, icons that imply direction flip, no text overflow. | Force RTL via developer options → nav, rows and progress bars mirror correctly. |
| A-409 | Unlock landscape once A-403 is real; delete `android:screenOrientation="portrait"`. | Rotate the device at every phase → correct layout, no reflow flash, playback uninterrupted. |
| A-410 | Device matrix executed and screenshotted: 360dp phone, 412dp phone, 600dp, 700dp tablet, 1024dp tablet, landscape, foldable. | A screenshot per size stored under `docs/android/screenshots/`, each read back and checked. |

---

## P5 — Performance and stability

| ID | Task | Acceptance check |
|---|---|---|
| A-501 | Cold start budget: measure to first meaningful paint; target < 2.5 s on a mid phone. | `adb shell am start -W` + a CDP timestamp; number recorded in STATUS. |
| A-502 | Error states: no network, YouTube failure, PO-token failure, expired stream. Each shows a retry affordance, never a white screen or a spinner forever. | Airplane mode on launch → visible offline state with Retry; retry works when the network returns. |
| A-503 | WebView memory: image cache bounded, long scroll on Home/Explore does not grow unbounded. | Scroll 200 shelves; `dumpsys meminfo` before/after stays within a stated bound. |
| A-504 | Local crash/diagnostic log (ring buffer) the user can export, since there is no Play Console. | Force an error → the log contains the stack; export produces a file. |
| A-505 | Session resilience: visitor data and PO token refresh failures degrade to a retry, not a broken app. | Clear `localStorage` visitor key mid-session → next request recovers. |
| A-506 | Stream proxy hardening: port collision, client abort, seek storm, very large files. | 20 rapid seeks → no `Broken pipe` crash, playback continues. |
| A-507 | Long-session soak: 4 h playback with screen off, no leak, no drift between UI position and audio. | Soak log recorded; drift < 1 s at the end. |

---

## P6 — Release (sideload, not Play Store)

| ID | Task | Acceptance check |
|---|---|---|
| A-601 | Release keystore generated and stored outside the repo; `signingConfigs.release` wired with credentials from a local, git-ignored properties file. | `./gradlew assembleRelease` produces a signed APK; `apksigner verify` passes. |
| A-602 | Versioning: `versionCode` monotonic, `versionName` semantic; documented bump procedure. | Two consecutive builds install over each other with data intact. |
| A-603 | R8/ProGuard: enable minify for release, keep rules for Capacitor + the plugin; verify no reflection breakage. | Release APK launches, mints a PO token, plays audio. |
| A-604 | APK size and ABI strategy: single universal APK unless size demands splits; record the size. | Release APK size recorded; installs on the owner's phone. |
| A-605 | Clean-device release verification: uninstall, install release APK, onboarding → play → background → notification → offline. | Full pass on a device with no prior install. |
| A-606 | Upgrade-in-place: data (library, playlists, history, settings) survives release→release. | Install v1, create data, install v2, data intact. |

---

## Explicit non-goals (do not build these, do not promise them)

- **Play Store publishing** — no AAB, no store listing, no review compliance work.
- **Android Auto / Automotive** — separate surface, out of scope.
- **Home-screen widgets** — out of scope.
- **Chromecast / Spotify Connect-style casting** — out of scope.
- **Multi-user profiles** — out of scope.
- **A rewrite of the renderer in native Compose** — rejected in ADR D1; the shared renderer is the point.

## Phase exit criteria

| Phase | Exits when |
|---|---|
| P1 | Every row in `FEATURES.md` marked `HIDDEN` has a reason, and every phone surface a desktop user touches exists at 412dp. |
| P2 | Audio survives 30 min screen-off, a phone call, a headset unplug and a network switch, and the lock screen controls work. |
| P3 | No row in `FEATURES.md` is `STUB` or `MISSING` without an ADR saying why. |
| P4 | A-410's screenshot set exists and every size passes review; portrait lock is gone. |
| P5 | A-507 soak passes and no known path produces a white screen. |
| P6 | A-605 and A-606 pass on a clean device. |
