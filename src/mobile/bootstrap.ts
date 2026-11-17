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

const capacitor = (globalThis as any).Capacitor;

if (capacitor?.isNativePlatform?.()) {
  installMobileBridge();
  setupMobileMediaSession();
}
