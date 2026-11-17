/**
 * Android bootstrap. Imported first from `main.tsx`: when the page is running
 * inside the Capacitor shell it installs the `window.bytune` bridge before any
 * module reads it (`src/lib/platform.ts` does, at import time).
 *
 * A plain browser (desktop dev server, the Electron renderer) has no
 * `window.Capacitor`, so this file is inert there.
 */
import { installMobileBridge } from "./bridge";
import { setupMobileMediaSession } from "./mediaSession";
import { clearDurationCache, invalidateStreamCache } from "./music";
import { releaseStandbyAudio } from "../lib/audio";

declare global {
  interface Window {
    /** Native memory-pressure hook, called by the shell via bridge.eval. */
    __bytuneMemoryPressure?: (reason: string) => void;
  }
}

/** Shape of the native `memoryInfo` plugin result (Track D contract). */
interface MemoryInfoResult {
  lowMemory: boolean;
  availMemMB?: number;
  thresholdMB?: number;
}

interface ShellPlugin {
  memoryInfo?: () => Promise<unknown>;
}

function shellPlugin(): ShellPlugin | null {
  const cap = (
    globalThis as unknown as { Capacitor?: { Plugins?: { ByTuneShell?: ShellPlugin } } }
  ).Capacitor;
  return cap?.Plugins?.ByTuneShell ?? null;
}

function parseMemoryInfo(value: unknown): MemoryInfoResult | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.lowMemory !== "boolean") return null;
  return {
    lowMemory: record.lowMemory,
    availMemMB: typeof record.availMemMB === "number" ? record.availMemMB : undefined,
    thresholdMB: typeof record.thresholdMB === "number" ? record.thresholdMB : undefined,
  };
}

/**
 * Memory-pressure response: drop the perishable in-memory caches (streams,
 * durations, artwork palettes), release the standby deck, and fall back to
 * solid fills until the user restarts.
 */
function handleMemoryPressure(reason: string): void {
  invalidateStreamCache();
  clearDurationCache();
  releaseStandbyAudio();
  // Palette caches live in the artwork modules; dynamic imports keep this
  // early-boot module free of cycles. Best-effort: a failed import only
  // means the small palette caches survive this pressure event.
  void import("../lib/ambient")
    .then((m) => m.clearAmbientCache())
    .catch(() => undefined);
  void import("../lib/palette")
    .then((m) => m.clearPaletteCaches())
    .catch(() => undefined);
  document.documentElement.classList.add("reduce-blur");
  console.warn(
    `[bytune] memory pressure (${reason}): dropped stream/duration/palette caches, released standby audio, reduced blur`
  );
}

/**
 * Poll the native `memoryInfo` plugin every 60s while foregrounded.
 * Foreground trim callbacks are not delivered on API 34+, so polling is the
 * mechanism. If the plugin method does not exist yet (Track D), no polling
 * starts at all — the hook above still answers direct native calls.
 */
function startMemoryInfoPolling(): void {
  const memoryInfo = shellPlugin()?.memoryInfo;
  if (typeof memoryInfo !== "function") return;
  window.setInterval(() => {
    if (document.hidden) return;
    void memoryInfo()
      .then((res) => {
        if (parseMemoryInfo(res)?.lowMemory) handleMemoryPressure("native-low-memory");
      })
      .catch(() => undefined);
  }, 60000);
}

const capacitor = (globalThis as any).Capacitor;

if (capacitor?.isNativePlatform?.()) {
  installMobileBridge();
  setupMobileMediaSession();
  window.__bytuneMemoryPressure = handleMemoryPressure;
  startMemoryInfoPolling();
}
