import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Android target. The renderer is the desktop's own Vite build — same views,
 * same CSS — served to the WebView from `https://localhost`.
 *
 * `allowMixedContent` is on for one reason: the playback proxy is a loopback
 * HTTP server (127.0.0.1), so the media element fetches `http:` from an
 * `https:` page. Nothing else in the app talks cleartext; the network security
 * config in android/app/src/main/res/xml permits it for loopback only.
 */
const config: CapacitorConfig = {
  appId: "com.bytune.music",
  appName: "ByTune",
  webDir: "dist",
  android: {
    allowMixedContent: true,
    backgroundColor: "#000000",
  },
};

export default config;
