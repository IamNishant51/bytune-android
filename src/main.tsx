import "./mobile/bootstrap";
import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./lib/platform";
import "./index.css";

// The PiP miniplayer loads only in the PiP window — the main app never pays
// for its chunk.
const PipApp = lazy(() => import("./pip/PipApp").then((m) => ({ default: m.PipApp })));

/**
 * One bundle, two windows: the main app shell, and — when this renderer was
 * loaded with ?window=pip — the compact native miniplayer. The PiP window
 * renders no app shell and boots no audio engine; it is a pure view onto the
 * main window's playback state (see src/pip/).
 */
const isPipWindow = new URLSearchParams(window.location.search).get("window") === "pip";

ReactDOM.createRoot(document.getElementById("root")!).render(
  isPipWindow ? (
    <ErrorBoundary>
      <Suspense fallback={null}>
        <PipApp />
      </Suspense>
    </ErrorBoundary>
  ) : (
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  )
);
