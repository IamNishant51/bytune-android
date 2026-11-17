/**
 * Connectivity state — one store, wired once at import.
 *
 * `useConnectivity()` returns `{ online: boolean }` for UI (the offline
 * banner), and non-React code subscribes via `useConnectivity.subscribe`
 * (the audio engine's network recovery). The listeners are installed when
 * this module is first imported, so state is live before any component
 * mounts; `navigator.onLine` is the initial value, not a guess.
 */
import { create } from "zustand";

interface ConnectivityState {
  online: boolean;
}

function initialOnline(): boolean {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

export const useConnectivity = create<ConnectivityState>(() => ({
  online: initialOnline(),
}));

let wired = false;

function wireConnectivity(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;
  const update = (): void => {
    useConnectivity.setState({ online: navigator.onLine });
  };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
}

wireConnectivity();
