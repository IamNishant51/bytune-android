/**
 * Haptics — one typed helper for the five tactile moments (tab press,
 * play/pause, like, long-press, sheet snap).
 *
 * Transport is the typed bridge method first (`ByTuneApi.haptic`, backed by
 * the Android shell plugin's performHapticFeedback): it respects the
 * system haptic settings and costs no permission. Any failure — no bridge,
 * no plugin method, or the desktop main process rejecting (no handler) —
 * falls back to `navigator.vibrate`. Never both, never a throw.
 *
 * Gating: there is no haptics setting in the settings store yet, so the
 * helper carries its own enabled flag (default on). Track B owns adding
 * the setting and wiring `setHapticsEnabled` to it. Calls are rate-limited
 * (one per 40ms) so a gesture storm never buzzes continuously, and never
 * throw — a missing vibrate API is a silent no-op.
 */
import { hasBridge, requireBridge } from "./bridge";

export type HapticKind = "selection" | "light" | "medium" | "success";

const PATTERNS: Record<HapticKind, number | number[]> = {
  selection: 8,
  light: 12,
  medium: 25,
  success: [12, 35, 12],
};

let enabled = true;
let lastAt = 0;

/** Lets a future settings toggle switch all haptics off at once. */
export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

export function haptic(kind: HapticKind): void {
  if (!enabled) return;
  const now = Date.now();
  if (now - lastAt < 40) return;
  lastAt = now;
  // Prefer the native shell haptic (typed bridge method). It no-ops when
  // the plugin is absent and rejects on desktop (no handler) — either way
  // the vibrate fallback below runs instead. Never both, never a throw.
  if (hasBridge()) {
    try {
      void Promise.resolve(requireBridge().haptic(kind)).catch(() => vibrate(kind));
      return;
    } catch {
      /* fall through to vibrate */
    }
  }
  vibrate(kind);
}

function vibrate(kind: HapticKind): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    /* Vibrator unavailable — haptics are decoration, never load-bearing. */
  }
}
