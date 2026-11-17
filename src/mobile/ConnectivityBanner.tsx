/**
 * Connectivity banner — the global offline state (A-502/C-13).
 *
 * Shows only while offline, parked at the top of the screen clear of the
 * floating dock chrome. The online/offline signal comes from Track B's
 * `useConnectivity()` hook in src/lib/connectivity.ts; this component owns
 * only the presentation.
 */
import { useConnectivity } from "../lib/connectivity";

export function ConnectivityBanner() {
  const { online } = useConnectivity();
  if (online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[60] pointer-events-none"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="mx-4 mt-2 rounded-full bg-amber-500/95 px-4 py-2 text-center text-[13px] font-semibold text-black shadow-lg">
        Waiting for connection — downloads and playback will resume
      </div>
    </div>
  );
}
