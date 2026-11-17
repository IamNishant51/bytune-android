/**
 * Device capability helpers — the single place that answers "is this a
 * low-memory phone?" so every low-RAM gate in the renderer agrees.
 *
 * `navigator.deviceMemory` is a Chromium-only coarse bucket (0.25 / 0.5 / 1 /
 * 2 / 4 / 8 GB); it is absent on other engines, where the CPU count is the
 * fallback signal. Both are hints, not measurements: an unknown device is
 * treated as capable (false) so a desktop or an unrecognised browser never
 * loses the full experience by default.
 *
 * Contract: Tracks B and C import `isLowMemoryDevice` from here. Do not
 * duplicate the thresholds elsewhere.
 */

interface NavigatorWithMemory extends Navigator {
  readonly deviceMemory?: number;
}

/** True on phones reporting 4 GB or less of device memory. */
export function isLowMemoryDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as NavigatorWithMemory;
  if (typeof nav.deviceMemory === "number" && Number.isFinite(nav.deviceMemory)) {
    return nav.deviceMemory <= 4;
  }
  if (typeof nav.hardwareConcurrency === "number" && Number.isFinite(nav.hardwareConcurrency)) {
    return nav.hardwareConcurrency <= 4;
  }
  return false;
}

/**
 * Artwork target for a full-bleed phone hero: the displayed width in
 * physical pixels, floored at 1080 (a 720px hero upscales ~1.5x at the
 * reference 2.625 density and reads soft) and capped at 1200 (Google's
 * image service tops out there, and more pixels only cost decode memory).
 */
export function mobileHeroArtworkTarget(): number {
  if (typeof window === "undefined") return 1080;
  const dpr = window.devicePixelRatio || 1;
  const physical = Math.ceil(window.innerWidth * dpr);
  return Math.min(1200, Math.max(1080, physical));
}
