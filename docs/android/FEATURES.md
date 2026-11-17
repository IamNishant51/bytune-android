# FEATURES — desktop → Android parity matrix

The desktop is the reference. Every row is a thing a desktop user can do today. The Android
column is the honest state on the phone build.

**Do not trust `FEATURE_PARITY.md` at the repo root.** It claims JioSaavn sources, addons,
Last.fm, ListenBrainz and Discord Rich Presence — none exist in the current code (verified by
`grep -rli` over `electron/` and `src/`). This file is the live matrix.

Status words are defined in `README.md`. A row may only say `WORKS` if an evidence line exists
in `STATUS.md`.

---

## 1. Playback

| Feature | Desktop reference | Android | Notes / what is missing | Task |
|---|---|---|---|---|
| Stream YouTube Music audio | `electron/music-service.ts` → `getStreamUrl` | `WORKS` | InnerTube rotation + native proxy. `relay HTTP 206` observed | — |
| Quality ceiling | `src/views/SettingsView.tsx` "Streaming quality" | `UNVERIFIED` | Setting renders; ceiling not measured against a real file | A-312 |
| Loudness normalisation | `lufs` via `&meta=1` on the proxy URL | `UNVERIFIED` | Proxy answers `{"lufs":n}`; the gain path is in `src/lib/audio.ts`, unmeasured | A-312 |
| Play / pause / seek | `src/lib/audio.ts` | `WORKS` | Progress advanced; pause froze at 14.1555% for 5 s; resume worked | — |
| Next / previous | `src/stores/player.ts` | `WORKS` | Transport buttons present and wired; next verified via queue advance | — |
| Shuffle / repeat | `src/stores/player.ts` | `UNVERIFIED` | Controls exist in the desktop UI; not exercised on a phone | A-101 |
| Queue | `src/components/RightRail.tsx` | `WORKS` | Touch-first queue sheet inside Now Playing (`src/mobile/MobileQueue.tsx`): current track card, upcoming list, tap-to-jump, remove, drag-to-reorder | — |
| Autoplay / radio continuation | `src/lib/audio.ts` | `UNVERIFIED` | Same engine; not observed on device | A-102 |
| Crossfade | `src/lib/audio.ts` (dual element, equal power) | `UNVERIFIED` | Setting renders; boundary not heard on device | A-305 |
| Automix (beat-aligned fade) | `src/lib/analysis.ts` | `UNVERIFIED` | BPM path never exercised on device | A-306 |
| Skip silence | `src/lib/audio.ts` → `requestSilenceAnalysis` | `UNVERIFIED` | Full-file decode on a phone is the risk; not measured | A-307 |
| Playback speed (pitch-preserving) | `src/lib/audio.ts` | `UNVERIFIED` | Setting renders; pitch not measured | A-308 |
| Media notification / lock screen | `src/lib/audio.ts` → `navigator.mediaSession` | `WORKS` | Native `MediaSession` + `MusicPlaybackService` notification (`category=transport`, 3 actions, artwork, monochrome icon). Drives the real engine | — |
| Headset / Bluetooth controls | MediaSession handlers | `WORKS` | Media button session registered (`Media button session is com.bytune.music/ByTuneMediaSession`); `cmd media_session dispatch play/pause/next/previous` all act on the queue. A physical Bluetooth headset was not paired | A-201 |
| Audio focus (call interrupts) | — | `WORKS` | Chromium's `AudioFocusDelegate` holds focus: call → `LOSS_TRANSIENT`, audio output released; call ends → resumes. See D15 | — |
| Headphone unplug pauses | — | `WORKS` | `BecomingNoisyReceiver` → `Becoming noisy -> pausing` | — |
| Background playback | — | `WORKS` | Foreground service `mediaPlayback`: screen off, playback advanced across queue tracks, `AAudio state:started`, `isForeground=true` | — |
| Network switch recovery | `src/lib/audio.ts` error recovery | `UNVERIFIED` | Not exercised | A-206 |
| Stream error recovery / client rotation | `src/lib/audio.ts` | `UNVERIFIED` | Rotation code exists; forced-failure path untested | A-506 |

---

## 2. Browse and discovery

| Feature | Desktop reference | Android | Notes | Task |
|---|---|---|---|---|
| Home feed | `src/views/HomeView.tsx` | `WORKS` | Live shelves rendered on a fresh install | — |
| Explore mood grid | `src/views/ExploreView.tsx` | `WORKS` | 2-col responsive duotone grid; tapping a mood searches results; back restores scroll position | — |
| Search: results + filters | `src/views/SearchView.tsx` | `WORKS` | Typed query → All/Songs/Videos/Albums/Artists/Playlists; album opened from results | — |
| Search suggestions | `src/mobile/MobileShell.tsx` | `WORKS` | Floating glass suggestions dropdown with debounce and touch selection | — |
| Recent searches | `src/stores/recents.ts` | `WORKS` | Panel renders on the Search tab; tapping pill searches; clear all works | — |
| Search infinite scroll | `src/views/SearchView.tsx` | `WORKS` | IntersectionObserver sentinel fetches next page continuation on scroll near bottom | — |
| Album page | `src/views/AlbumView.tsx` | `WORKS` | Hero, metadata, Play, 15-track list | — |
| Artist page | `src/views/ArtistView.tsx` | `WORKS` | Hero photo bleed, name, subscribers/monthly listeners, Play/Shuffle, About blurb, Top songs, section carousels | — |
| Local playlist page | `src/views/PlaylistView.tsx` | `WORKS` | Hero cover bleed, metadata, Shuffle/Play/More header, numbered track list, play from header | — |
| Remote (YouTube) playlist page | `src/views/RemotePlaylistView.tsx` | `WORKS` | Hero cover bleed, curator credit, metadata, Shuffle/Play/More, numbered track list, play from header | — |
| Charts | `electron/ytm.ts` → `parseChartsShelves` | `UNVERIFIED` | Parser wired; surface not opened | A-105 |
| Artist radio / related | `electron/music-service.ts` | `UNVERIFIED` | Not exercised | A-106 |

---

## 3. Library

| Feature | Desktop reference | Android | Notes | Task |
|---|---|---|---|---|
| Liked songs | `src/stores/library.ts` | `WORKS` | Tile, tab, Now Playing like button, and track action menu ("Add to Liked") | — |
| Create playlist | `src/views/LibraryView.tsx` | `WORKS` | Create menu + dialog flow creates new local playlist and navigates to it | — |
| Rename / delete playlist | `src/views/LibraryView.tsx` | `UNVERIFIED` | Not exercised | A-107 |
| Folders (organise playlists) | `src/views/LibraryView.tsx` | `PARTIAL` | Folder count hidden on Android; folder UI unverified | A-107 |
| Pin / reorder | `src/stores/library.ts` | `UNVERIFIED` | Desktop uses drag-and-drop; touch reorder not built | A-104 |
| Add to playlist | `src/lib/trackActions.ts` | `WORKS` | Long-press action sheet opens inline playlist list with New playlist... | — |
| Downloads | `electron/downloads.ts` | `WORKS` | Offline IndexedDB audio cache (`src/mobile/offline.ts`), `Range: bytes=0-` on the native GET so googlevideo streams at full speed, instant blob playback, playlist download/remove, track download badge | A-301 |
| Local music import | `electron/local-library.ts` | `HIDDEN` | Bridge returns `null`; tile removed | A-302 |
| Playlist drag-and-drop | `src/lib/dnd.ts` | `MISSING` | HTML5 DnD does not work on touch | A-104 |
| Sort playlist tracks | `src/lib/playlistSort.ts` | `WORKS` | "⋯" → Sort: Title / Artist / Album / Duration + Custom order; re-tapping the ticked key reverses. View-level, stored order untouched. No Date added sort (`Track` has no `addedAt`) | — |
| Replay statistics | `electron/stats.ts` → `src/mobile/stats.ts` | `WORKS` | Real numbers after a play (2 min, 1 play) | — |
| Listening history / recently played | `src/stores/listening.ts` | `UNVERIFIED` | Store persists; surface not inspected | A-109 |

---

## 4. Now Playing, lyrics, artwork

| Feature | Desktop reference | Android | Notes | Task |
|---|---|---|---|---|
| Now Playing overlay | `src/components/NowPlaying.tsx` | `WORKS` | Compact overlay at 412dp: hero art, glow, title/artist, seek bar, transport, sheet toggles, swipe down / back gesture dismiss | — |
| Queue inside Now Playing | `src/components/RightRail.tsx` + `NowPlaying` switch | `WORKS` | `src/mobile/MobileShell.tsx` (`MobileSheet`) with `src/mobile/MobileQueue.tsx`: current track card, upcoming list, jump, remove, touch drag reorder | — |
| Lyrics view | `src/components/LyricsCenter.tsx`, `src/components/SyncedLyrics.tsx` | `WORKS` | LRCLIB synced lyrics inside `src/mobile/MobileShell.tsx` (`MobileSheet`), active line advance, breathing dots, blur de-emphasis | — |
| Lyrics providers | `electron/lyrics.ts` (2139 lines, multi-provider) | `PARTIAL` | Android has LRCLIB only (`src/mobile/lyrics.ts`) | A-304 |
| Word-level / karaoke lyrics | `electron/lyrics.ts` | `MISSING` | Line-sync only on Android | A-304 |
| Lyrics offset / tap-to-seek | `src/components/SyncedLyrics.tsx` | `WORKS` | Tap any lyric line seeks playback and updates active line immediately | — |
| Canvas (animated artwork) | `electron/canvas.ts` → `src/lib/canvas.ts` | `STUB` | `getCanvas` returns `null`; falls back to static art | A-303 |
| Fullscreen / ambient mode | `NowPlaying.tsx` | `UNVERIFIED` | Overlay untested | A-101 |
| Mini player | `src/mobile/MobileShell.tsx` → `MobilePlayerBar` | `WORKS` | Artwork, titles, prev/play/next, progress bar | — |

---

## 5. Settings

Every group from `src/views/SettingsView.tsx`, and what Android does with it.

| Group | Rows | Android | Task |
|---|---|---|---|
| Audio quality | Streaming quality | `PARTIAL` — renders, ceiling unmeasured | A-312 |
| Audio output | Output device | `HIDDEN` — sink picking is a desktop audio-stack feature; Android follows the system | — |
| Downloads | Download folder, quality, export-compatible | `HIDDEN` — downloads are app-local IndexedDB audio; folder/quality/export rows are desktop-only | A-301 |
| Playback | Crossfade, Automix, Skip silence, Autoplay, Playback speed | `PARTIAL` — all render; none measured on device | A-305…A-308 |
| Appearance | Theme, reduce motion, accent | `UNVERIFIED` | A-312 |
| Local music | Folder, rescan | `HIDDEN` — no SAF import | A-302 |
| Your data | Replay, Export, Import | `PARTIAL` — Replay works; export/import are desktop-only | A-309 |
| Miscellaneous | Don't repeat suggestions, and similar | `UNVERIFIED` | A-312 |
| Danger zone | Clear data, delete account | `UNVERIFIED` — must not be a dead end | A-312 |
| ByTune account | Sign in, sync | `WORKS` | Supabase Google OAuth PKCE (`src/mobile/auth.ts`) + deep-link callback `bytune://oauth/callback` | A-310 |

---

## 6. Shell, system integration, platform

| Feature | Desktop reference | Android | Notes | Task |
|---|---|---|---|---|
| Three-pane shell | `src/App.tsx` | `HIDDEN` | Compact widths get one pane; expanded widths will get it back | A-404 |
| Sidebar navigation | `src/components/Sidebar.tsx` | `PARTIAL` | Replaced by a five-tab bottom bar | A-402 |
| Bottom tab bar | — (Android only) | `WORKS` | Home, Explore, Search, Library, Replay | — |
| Back navigation | `src/stores/ui.ts` → `goBack` | `WORKS` | Top-bar back arrow + Android back | — |
| Mobile search field | — (Android only) | `WORKS` | `MobileSearchField`; added this session | — |
| Keyboard shortcuts | `src/App.tsx` → `useKeyboardShortcuts` | `HIDDEN` | No hardware keyboard assumption | — |
| Window chrome (min/max/close) | `electron/main.ts` | `HIDDEN` | No window on a phone | — |
| PiP mini window | `src/pip/PipApp.tsx` | `HIDDEN` | Desktop-only Electron window; not Android PiP | A-311 |
| Tray / thumbar / media keys | `electron/main.ts`, `scripts/gen-thumbar-icons.mjs` | `WORKS` | Replaced by the Android media notification + `MediaSession` (A-201) | — |
| Portrait lock | — | `WORKS` (temporary) | Workaround for the 866 dp landscape bug | A-409 |
| Responsive layout | `@media (max-width: 860px)` | `BROKEN` | One breakpoint; tablets get the wrong layout | A-401 |
| Edge-to-edge insets | `env(safe-area-inset-*)` in places | `PARTIAL` | Some chrome uses insets; not audited | A-406 |
| Accounts / cloud sync | `supabase/`, `electron/sync-merge.ts` | `WORKS` | Google sign-in active in Onboarding and Settings | A-310 |
| Backup export / import | `src/views/SettingsView.tsx` → Your data | `HIDDEN` | Needs a file picker and a writer | A-309 |
| Crash reporting | Electron logs | `MISSING` | No Play Console; needs a local ring buffer | A-504 |

---

## 7. Summary counts

Counted from the rows above (recount when you edit, and keep this honest):

| Status | Count |
|---|---|
| `WORKS` | 37 |
| `PARTIAL` | 7 |
| `UNVERIFIED` | 19 |
| `MISSING` | 3 |
| `STUB` | 1 |
| `HIDDEN` | 9 |
| `BROKEN` | 1 |
| **Total rows** | **77** |

**Read this as:** playback is done — stream, notification, lock screen, focus, unplug,
background and upgrade-in-place are all verified on a device. What is left is breadth, not the
core: layout above phone width (`A-401`), downloads, canvas, and the extra lyric providers.

---

## 8. Adding a row

1. Name the desktop behaviour and its file.
2. State the Android status with the evidence you have. No evidence → `UNVERIFIED`.
3. Give it a task ID from `ROADMAP.md`, or `—` if it already works.
4. If it is `HIDDEN`, write **why** in the Notes column. A hidden feature with no reason is a
   defect.
