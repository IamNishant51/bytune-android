# Mobile Design System — Liquid Glass & Floating Chrome

This document defines the mobile design system, optical physics, motion curves, and
performance architecture implemented in the ByTune Android application.

---

## 1. Design Philosophy

ByTune Mobile adapts the Apple Music 7.0 Liquid Glass aesthetic into a high-performance,
touch-first Android client. The core principle is **depth through true optical refraction**:
interface controls do not obscure content with flat opaque panels; instead, they float
above the content stream as refracting glass lenses that magnify, illuminate, and blur
the colorful album art and media rolling beneath them.

```
+-------------------------------------------------------+
|  Status Bar (Transparent / Edge-to-Edge)              |
+-------------------------------------------------------+
|                                                       |
|  Content Viewport (`#view-scroll`)                    |
|  - Edge-to-edge scroll view with `pb-36` clearance    |
|  - Album art, playlists, carousels, and search grids  |
|                                                       |
|  +-------------------------------------------------+  |
|  | Floating Mini-Player Pill (`.mobile-player`)    |  | <-- 14px floating inset
|  | - Glass: blur(26px) saturate(190%) + fresnel    |  |
|  | - Specular top bevel highlight + diagonal sheen |  |
|  +-------------------------------------------------+  |
|                                                       |
|  +-------------------------------------------------+  |
|  | Floating Capsule Nav (`.mobile-nav`)            |  | <-- Independent floating pill
|  | - 5-tab navigation: Home, Explore, Search, etc. |  |
|  +-------------------------------------------------+  |
|                                                       |
+-------------------------------------------------------+
```

---

## 2. Decoupled Floating Chrome Architecture

Unlike traditional mobile applications with a docked bottom bar glued to the viewport
edge, ByTune features **dual decoupled floating chrome pills**:

1. **Floating Mini-Player Pill (`.mobile-player`)**:
   - Lives in `.mobile-chrome-dock` (`position: fixed`, `inset-inline: 0`, `bottom: 0`),
     inside a `max-width: 480px` column with `padding-inline: 14px`, `8px` gap to the nav.
   - `height: 58px`, `border-radius: 20px`.
   - Integrated track progress hairline bar along its bottom perimeter.
   - Tapping metadata expands into the full-screen Now Playing sheet (`src/components/NowPlaying.tsx`).
   - Horizontal swipe (touch, `|dx| > 40px`) skips tracks; the pill follows the finger at
     `0.45×` and springs back on release.

2. **Floating Capsule Bottom Navigation (`.mobile-nav`)**:
   - Same dock column, below the player: `height: 56px`, `border-radius: 28px`.
   - 4 evenly distributed tactile targets (Home, Explore, Search, Library).
   - A `.mobile-tab-indicator` glass lens slides under the active tab.
   - Tapping tabs provides subtle spring feedback without jarring page reloads.

3. **Optical Pass-Through**:
   - The scroll container (`#view-scroll`) enforces `padding-bottom: 9rem` (`pb-36`), ensuring
     that the last row of tracks or albums scrolls fully into clear view above the floating pills
     while allowing underlying artwork to remain visible through the glass lens during scroll.

---

## 3. Optical Physics of Liquid Glass

Every pane of glass in the app shares one recipe declared in `src/index.css`
(`.glass, .glass-pill, .glass-card, .mobile-player, .mobile-nav, .mobile-subview-bar`).
It is the four layers light actually meets, per Apple's Liquid Glass (WWDC25 §3) and its
26 refinement (darker edge, brighter specular highlights):

### A. Tint
```css
--lg-tint: 10 10 13;      /* the material's own colour */
--lg-tint-alpha: 0.44;    /* .mobile-player: .52, .mobile-nav: .54 */
background:
  linear-gradient(180deg, rgba(255,255,255,.09), rgba(255,255,255,.015) 44%, rgba(255,255,255,0) 70%),
  radial-gradient(120% 140% at 50% -20%, rgb(var(--ambient-0) / .10), transparent 70%),
  rgb(var(--lg-tint) / var(--lg-tint-alpha));
```
The dock's alpha floor is higher than a raw material sample: the pills sit over scrolling
text, and below `~.5` the lines behind stayed readable. The top gradient is the light the
face catches; the radial one lets the current artwork's ambience tint the glass faintly.

### B. Refraction
```css
backdrop-filter: blur(var(--lg-blur)) saturate(var(--lg-sat)) brightness(1.05) contrast(.97);
```
- **Blur** `22px` (`26px` in the dock): diffuses the lines beneath into colour fields.
- **Saturate** `190%`: re-amplifies colour the dark tint flattens.
- **Brightness 1.05 / contrast 0.97**: light gathering inside the lens, slightly milky.

Deliberate ceiling: no displacement refraction (`backdrop-filter: url(#feDisplacementMap)`).
Chromium supports it, but it costs a second backdrop pass per surface and the warp is only
legible on large panes — revisit if glass ever covers a wide area.

### C. Fresnel Ring
A 1px masked ring, not a border — so it follows any radius and paints nothing else:
```css
.glass::before { padding: 1px; mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
                 mask-composite: exclude;
                 background: linear-gradient(130deg, rgba(255,255,255,.58) 0%, rgba(255,255,255,.06) 30%,
                             rgba(255,255,255,.02) 56%, rgba(255,255,255,.14) 82%, rgba(255,255,255,.46) 100%); }
```
Bright where the surface turns away from the light, almost gone across the face — this is what
reads as a thick glass edge instead of a painted rectangle.

### D. Light
```css
box-shadow:
  inset 0 1px 0 rgba(255,255,255,.20),   /* specular top bevel */
  inset 0 -1px 0 rgba(0,0,0,.45),        /* darkened bottom edge */
  inset 0 0 0 .5px rgba(255,255,255,.06),
  0 1px 1px rgba(0,0,0,.25),
  0 10px 24px -6px rgba(0,0,0,.55),
  0 28px 56px -28px rgba(0,0,0,.70);
```
Three shadow stops separate the pane from the content: a contact line, a medium falloff and a
wide ambient pass.

### E. Press illumination
Apple's glass brightens under a finger instead of greying:
`.mobile-player:active { transform: scale(.98); filter: brightness(1.10) }` — the whole pane,
rim included, gathers light.

---

## 4. Solid Fallbacks

Two switches, both on `<html>` (see `src/App.tsx` → `useAppearance()`):

**`html.noglass`** (Settings → Liquid Glass off): every glass surface drops
`backdrop-filter: none` and falls back to the solid `--panel` fill. The dock keeps its
geometry but flushes — the column loses its `14px` inset and `8px` gap, the player becomes a
full-width `#0f0f13` bar with a `1px` top hairline, the nav a `#0b0b0e` bar, both square and
shadowless; the fresnel `::before` rings are `display: none`.

**`html.reduce-blur`** (battery-saver style reduction): `backdrop-filter: none` everywhere too,
but the tint is replaced with the solid `--panel` fill *in place*, so the floating layout and
radii survive.

Both flags are owned by `src/stores/settings.ts` (`reduceDynamicBlur`, `liquidGlass`) and
rendered as switches in `src/views/SettingsView.tsx` — `liquidGlass` is disabled while
`reduceDynamicBlur` is on, because the blur reduction wins either way.

---

## 5. Motion, Physics & Transitions

| Interaction | Duration | Easing Curve | Target |
|---|---|---|---|
| Now Playing Open | 420ms | `cubic-bezier(0.32, 0.72, 0, 1)` | Full-screen translateY(100% -> 0) |
| Sheet Open | 340ms | `var(--apple-spring-fluid)` | `mobile-sheet-up`: translateY(100%) -> 0 |
| Sheet Dismiss | 220ms | `cubic-bezier(0.4, 0, 1, 1)` | `mobile-sheet-down` + `mobile-fade-out` backdrop; `onClose` fires 200ms later |
| Player artwork swap | 260ms | `var(--ease-enter)` | `art-in` (fade + scale .94 -> 1) |
| Player metadata swap | 180ms | `var(--ease-enter)` | `meta-in`, opacity only so text never reflows |
| Player press | 180ms | `var(--apple-spring-fluid)` | `scale(.98)` + `brightness(1.10)` |
| Tab lens slide | 260ms | `var(--apple-spring-fluid)` | `transform`/`width` of `.mobile-tab-indicator` |
| Button Tap (Press-down) | 120ms | `cubic-bezier(0.4, 0, 0.2, 1)` | `transform: scale(0.92)` |
| Artwork Breathe | 4000ms | `ease-in-out` | Ambient radial glow scale & opacity pulse |
| Synced Lyrics Advance | 350ms | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Active line glow and vertical scroll |

A closing sheet must animate *out* before it unmounts: `MobileSheet` keeps it mounted with
`.is-closing` and calls the caller's `onClose` on a 200ms timer (`src/mobile/MobileShell.tsx`).
Both player-bar swaps are keyed on `track.id`, so the outgoing node is replaced rather than
cross-faded — one animation, no stale text.

---

## 6. GPU Performance Engineering

Real-time backdrop filters on mobile can cause GPU fillrate bottlenecks if not composited
correctly. ByTune enforces strict hardware acceleration constraints:

1. **Dedicated GPU Compositing Layers**:
   - `.mobile-player` and `.mobile-nav` enforce `transform: translateZ(0)` and `will-change: transform`.
   - This isolates both floating chrome elements onto dedicated hardware texture layers, preventing
     costly repaint passes during viewport scrolling.

2. **CSS Containment**:
   - `contain: layout style` bounds layout invalidation to the pills themselves, preventing
     parent reflow cascades.

3. **Inertia Scrolling**:
   - `#view-scroll` applies `-webkit-overflow-scrolling: touch` and `will-change: scroll-position`
     for 60-120 FPS momentum scrolling.

4. **Refraction Kernel Tuning**:
   - `blur(22px)` on surfaces, `26px` in the dock, `30px` on sheets — tuned by eye at 412dp.
     Bigger kernels were not visibly different on artwork and cost a wider texture fetch.

5. **Known environment gap — `backdrop-filter` on the emulator.**
   `npx tsc`/CSS cannot catch this: the recipe is correct and computes correctly, but the
   Android emulator's WebView (Chrome 113, GL renderer
   `Android Emulator OpenGL ES Translator (Google SwiftShader)`) does **not** composite
   `backdrop-filter`, so on the emulator the glass renders as tint + rim only and the content
   behind the dock stays sharp and legible through it. Measured, not suspected:
   a `blur(24px)` probe over a hard-edged test block shows uniform ramp on desktop Chromium
   157 (hardware *and* `--disable-gpu`) and untouched 0-255 edges in the emulator WebView,
   while `filter: blur()` in the same WebView blurs fine. Verify any material change on
   hardware; do not chase the emulator for it.

---

## 7. Responsive Breakpoint Rules

- **Mobile Viewport**: `<= 860px` width activates `src/mobile/MobileShell.tsx` and mobile CSS.
- **Compact Standard**: 412 dp width (Pixel 6 / 1080x2400 reference).
- **Minimum Target**: 360 dp width (all components maintain zero horizontal blowout with `min-w-0`).
- Detailed responsiveness specs are documented in `docs/android/RESPONSIVE.md`.

---

## 8. Edge-to-Edge Top Chrome & Floating Navigation

In alignment with Apple Music 7.0:
- **No Heavy Sticky Headers or Logos**: On mobile home, opaque top bars, brand logos, and dark brown tint washes (`.home-tint`) are suppressed. Content rolls cleanly edge-to-edge right under the translucent system status bar.
- **Inline Profile Avatar**: The user account disc ("G") sits directly within the page header greeting line (`src/views/HomeView.tsx`), eliminating artificial header clutter.
- **Floating Glass Back Lenses**: Deep navigation views (Album, Artist, Playlist, Settings) feature a floating circular glass lens (`.mobile-topbar-floating .mobile-floating-back.glass-btn`) with 40px diameter, 50% border radius, and specular rim reflection, providing clean, non-intrusive navigation.

---

## 9. Universal Liquid Glass Surfaces

Beyond the floating mini-player and bottom navigation pills, the same material
(§3, one declaration) covers every pane:
1. **Glass cards (`.glass-card`)**: shared tint + `blur(22px)`, the masked fresnel ring, and a
   `20px` radius fallback for cards that set none. Overlays still set their own radius utility.
2. **Search field (`.mobile-search input`)**: `44px` capsule at `rgb(var(--lg-tint) / .55)`.
   Focus does not flood the field — it brightens the bevel: fill to `.72` and the inner
   specular line from `.22` to `.34`.
3. **Glass buttons (`.glass-btn`)**: `rgba(255,255,255,.10)` + `blur(20px)`, fresnel ring,
   `scale(.94)` → `.92` on press with `brightness(1.12)`. Used for the floating back lens and
   icon actions.
4. **Action sheets (`.mobile-sheet`)**: nearly solid by design (`rgb(16 16 20 / .92)`,
   `blur(30px)`) — a sheet owns the focus, and a translucent one over bright artwork read as
   washed out. Excluded from the shared mask ring: it scrolls, so the ring would scroll away;
   its edge light is a painted top gradient instead.
5. **Sub-view bars (`.mobile-subview-bar`)**: Settings/Downloads header, `54px`, full-bleed
   radius `0`, shared tint + ring + shadow.
6. **Popovers (`.glass-strong`)**: `rgba(17,17,19,.98)` — effectively opaque, because a floating
   menu is read over bright artwork and dense text. `.glass-strong-solid` drops the
   `backdrop-filter` entirely for menus nested inside another `backdrop-filter` ancestor.

Scroll chrome is desktop-only: the `@media (max-width: 860px)` block removes the `14px`
scrollbar gutter and hides the scrollbar, so the phone canvas is the full 412dp wide.

---

## 10. Song & Playlist Offline Download Architecture & UX

Offline listening is designed around seamless 1-tap caching:
1. **Now Playing Download Action**:
   - Circular glass action button located in the primary control deck.
   - State indicator toggles between Download Cloud, Active Progress Spinner, and Checkmark.
2. **Tracklist & Playlist Actions**:
   - Every song row includes a contextual sheet action (`src/lib/trackActions.ts`) with immediate visual feedback.
   - Playlist views feature header-level "Download All" glass pill to queue entire sets with automatic retry and rate-limiting.
3. **High-Performance Audio Pipeline**:
   - Resolves via modern VisionOS client spec with watch session cookies (`src/mobile/innertube.ts`), bypassing botguard barriers.
   - 10-minute in-memory stream resolution caching (`src/mobile/music.ts`) eliminates duplicate network overhead.
   - Audio tracks are persisted locally to device storage (`src/lib/downloads.ts`) with metadata tagging and album art caching for instantaneous zero-latency offline playback.

---

## 11. Host Memory & Hardware Optimization

To prevent laptop emulator memory thrashing and crash loops:
- **AVD RAM Sizing**: Emulator memory is tuned to `2048M` (2GB), fitting comfortably within host RAM boundaries and preventing disk paging stutters.
- **Lock Management**: `Launch_ByTune_Emulator.bat` automatically flushes stale QEMU and multi-instance lockfiles before launch.
- **Compositing Budgets**: CSS filters utilize hardware translateZ layers and bounded blur radii to maintain a steady 60 FPS without GPU overheating.
