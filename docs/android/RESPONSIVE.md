# RESPONSIVE — layout across every screen size

The goal the owner set: **the same app as the desktop, fully responsive, on any screen**. That
means the phone layout is not a downgrade and the tablet layout is not a stretched phone.

Today the app has **one** breakpoint, `860px`, in two places that must stay in sync:

- `src/index.css` → `@media (max-width: 860px)` (the mobile block)
- `src/lib/useIsMobile.ts` → `export const MOBILE_QUERY = "(max-width: 860px)"`

Everything in this document replaces that. Do not add a third copy of a breakpoint number.

---

## 1. What the platform says

Android's own guidance is the baseline, because the app ships as an Android app:

> Window size classes are opinionated viewport breakpoints: **compact**, **medium**,
> **expanded**, **large**, **extra large**. Width and height are classified separately, and
> width matters more because vertical scrolling is ubiquitous.
> — Android Developers, *Use window size classes* (`developer.android.com/develop/adaptive-apps/guides/use-window-size-classes`)

| Class | Width (dp) | Typical device |
|---|---|---|
| Compact | `< 600` | Phone portrait, small foldable cover screen |
| Medium | `600–839` | Phone landscape, small tablet portrait, unfolded foldable |
| Expanded | `840–1199` | Tablet portrait, small desktop window |
| Large | `1200–1599` | Tablet landscape, desktop window |
| Extra large | `≥ 1600` | Desktop |

Two consequences worth stating plainly:

1. **A landscape phone is medium, not expanded.** At 412×842 rotated, the viewport is ~866 dp
   wide — which is why the current 860 px breakpoint dumped a phone into the three-pane desktop
   shell. This was observed on the emulator: rotating produced `innerWidth 866`, `.mobile-nav`
   gone, three panes squeezed into 364 dp of height.
2. **Edge-to-edge is enforced at targetSdk 35.** System bars become transparent and the app is
   drawn behind them, so every chrome edge needs insets. The build is on targetSdk 34 today;
   system edge-to-edge is implemented in code since 1.1.0 (`enableEdgeToEdge` + transparent
   bars, unverified on device); A-406's device checks still settle it.

---

## 2. What the two reference apps do

### Spotify (phone)

- **Bottom tab bar** for the four top-level destinations; the library lives in its own tab.
- **Mini player floats above the tab bar**, full width, artwork + title + a thin progress line;
  it is a *handle*, not a control surface — tapping it opens Now Playing.
- **Now Playing is a full-screen sheet** that slides up, with artwork at the top, transport
  near the bottom, and an action row (like, shuffle, repeat, share, queue, devices).
- **Swipe up** from Now Playing reveals queue and "about the artist"; swipe down dismisses.
- **Tablet is a different arrangement, not a scaled phone:** a collapsible left sidebar plus a
  persistent right-side media panel, with Now Playing docked as a panel rather than a sheet.
  (Spotify's web player uses breakpoints around 425 / 550 / 600 / 768 / 896 / 1024 px — measured
  from the shipped stylesheet during research; treat as a design reference, not a spec.)

### YouTube Music (phone)

- **Bottom bar** with Home / Explore (or Search) / Library; search is a top-level field.
- **Mini player** above the bar, with the same "tap to expand" contract.
- **Now Playing**: cover art, title/artist, seek bar, transport, then an action row.
- **Up-next is a swipeable sheet with two states** — a brief four-song preview and a full list.
  A 2025 rework moved Lyrics and Related into that swipeable area
  (`androidcentral.com`, *YouTube Music freshens "Now Playing" with a dual-view rework*, Sep 2025).
- **Lyrics is a tab inside Now Playing**, not a separate destination.

**The pattern both share, and what this app should copy:** bottom tabs → floating mini player →
full-screen Now Playing → swipe up for queue/lyrics. The mini player is a handle; the sheet is
where everything happens.

---

## 3. The layout contract for this app

One rule per class. Anything not listed inherits the class below it.

### Compact (`< 600dp`) — phones

| Region | Rule |
|---|---|
| Top bar | 52 dp + `env(safe-area-inset-top)`, back arrow · brand · account disc |
| Content | Single column, full width, `padding: 0 16px`, scrolls under the top bar |
| Navigation | Four-tab bottom bar, 56 dp + `env(safe-area-inset-bottom)` |
| Mini player | Above the nav bar, artwork 40 dp, title/artist two lines, prev/play/next |
| Now Playing | **Full-screen sheet**, drag-down to dismiss, drag-up for queue |
| Queue | Sheet inside Now Playing, half → full height |
| Lyrics | Tab inside Now Playing |
| Right rail | Not rendered |
| Sidebar | Not rendered |

### Medium (`600–839dp`) — landscape phones, small tablets, unfolded foldables

| Region | Rule |
|---|---|
| Navigation | **Navigation rail** on the left (icons + labels, 80 dp) instead of bottom tabs |
| Content | Single column with a wider gutter (24 dp); lists may go two-column |
| Mini player | Full width above the content bottom, or docked at the rail's foot |
| Now Playing | Sheet at 60–80% height, or a docked panel if width ≥ 700 dp |
| Queue | Side panel at ≥ 700 dp, sheet below that |
| Sidebar | Not rendered (the rail carries navigation) |

### Expanded (`≥ 840dp`) — tablets, desktop windows

| Region | Rule |
|---|---|
| Shell | **The existing three-pane desktop layout, unchanged**: sidebar · content · right rail |
| Sidebar | Collapsible to icons; state persisted |
| Now Playing | Docked panel or the existing overlay, whichever the desktop uses |
| Queue | The right rail |
| Navigation | Sidebar only |

**The desktop build must render identically to today at ≥ 840 dp.** Any change to the
three-pane layout is a desktop regression and needs its own justification.

---

## 4. Implementation plan (A-401)

One source of truth, three consumers.

```
CSS custom properties on <html> (set by the shell, not by media queries alone):
  --bp-compact: 600px
  --bp-medium:  840px      /* medium is [600, 840) */

CSS:      @media (max-width: 599.98px) { … }   /* compact */
          @media (min-width: 600px) and (max-width: 839.98px) { … }  /* medium */
          @media (min-width: 840px) { … }      /* expanded — the current default */

TS:       useWindowClass(): "compact" | "medium" | "expanded"
          one matchMedia listener per boundary, one state value
```

Rules:

- **Exactly one definition** of each boundary in the codebase. `grep -rn "860" src/` must return
  nothing after A-401.
- `useIsMobile` becomes `useWindowClass() === "compact"` (or is deleted and its call sites
  updated). Do not keep both.
- The mobile CSS block is split by class, not by one media query with overrides piled on top.
- Sub-pixel boundaries use `599.98px` / `839.98px` so a 600 dp viewport is unambiguously medium.

---

## 5. Insets and edge-to-edge (A-406)

| Edge | What to do |
|---|---|
| Top | `padding-top: env(safe-area-inset-top)` on the top bar; content scrolls beneath a translucent bar |
| Bottom | `padding-bottom: env(safe-area-inset-bottom)` on the nav bar; the mini player sits above it |
| Left/right | Landscape with a cutout: `env(safe-area-inset-left/right)` on the shell |
| Keyboard | The search field must stay visible when the IME opens — `interactive-widget=resizes-content` in the viewport meta, or rely on Capacitor's resize mode; verify on device |

`index.html` already has `viewport-fit=cover`. That is necessary but not sufficient: every
fixed element needs its own inset. The native side enables edge-to-edge since 1.1.0
(`MainActivity.enableEdgeToEdge()`, transparent status/nav bars in `styles.xml`) — the
inset rules above are what keep content out from under the bars once the system draws
behind them.

---

## 6. Type, touch, and motion

| Concern | Rule |
|---|---|
| Touch targets | Minimum 44×44 dp (48 dp preferred for primary actions) |
| Body text | 14–16 px; never below 12 px for content |
| Font scaling | Layout must survive 2.0× system font (A-407). No fixed-height rows containing text |
| Safe tap zones | Transport controls ≥ 44 dp, with ≥ 8 dp between them |
| Motion | Respect `prefers-reduced-motion`; the sheet animation must have a no-motion path |
| Hover states | Never the only affordance. Every hover-revealed control needs a touch equivalent (this is why the track context menu is A-104) |
| Drag | HTML5 drag-and-drop does not fire on touch. Reorder needs pointer events or explicit up/down actions |

---

## 7. Test matrix (A-410)

Screenshot every row and read it back. Store under `docs/android/screenshots/`.

| # | Size (dp) | Class | Why |
|---|---|---|---|
| 1 | 360 × 640 | compact | Smallest common Android phone |
| 2 | 412 × 842 | compact | The emulator; the primary target |
| 3 | 412 × 842 @ 2.0× font | compact | Font scaling |
| 4 | 600 × 960 | medium | Small tablet portrait / foldable |
| 5 | 866 × 364 | medium | **Landscape phone — the current failure case** |
| 6 | 700 × 900 | medium | Tablet portrait, two-column check |
| 7 | 840 × 1200 | expanded | First three-pane width |
| 8 | 1024 × 768 | expanded | Tablet landscape |
| 9 | 1280 × 800 | expanded | Desktop window; must match the desktop build |
| 10 | RTL, 412 × 842 | compact | Mirroring |

Per size, check: nothing clipped horizontally, nav reachable, mini player not under the nav
bar, Now Playing controls all on screen, no element overlapping the system bars.

---

## 8. Known regressions to guard

| Regression | Guard |
|---|---|
| Landscape phone → three-pane | A-403 lands before the portrait lock is removed (A-409) |
| Tablet gets the phone layout at 700 dp | Medium class must exist; test row 4 and 6 |
| Desktop layout drifts | Test row 9 against the desktop build side by side |
| Two breakpoint definitions diverge | `grep` check in A-401's acceptance criteria |
| Content under the nav bar | Screenshot review at rows 1–2 with gesture nav enabled |
| Text clipped at large font | Row 3 |

---

## 9. Sources

- Android Developers, *Use window size classes* — `developer.android.com/develop/adaptive-apps/guides/use-window-size-classes` (breakpoints, width vs height).
- Android Central, *YouTube Music freshens "Now Playing" with a dual-view rework* — Sep 2025 (swipeable up-next, lyrics/related placement).
- Spotify app behaviour on Android and tablet, plus the Spotify web player's shipped breakpoints (~425/550/600/768/896/1024 px) — observed during research; treat as reference, not specification.
- YouTube Music app behaviour: bottom bar, mini player, Now Playing action row, swipe-up queue — observed during research.

Re-verify any of these before quoting them as current; both apps redesign often.
