import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // relative asset paths so the production build works under file:// in Electron
  base: "./",
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    target: "es2022",
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        // Vendor chunks: stable third-party code splits out of the app
        // chunk so it caches separately and bloat stays visible. Chunk
        // files are relative assets under dist/assets, so the file://
        // Electron base ("./") is unaffected.
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
          "vendor-zustand": ["zustand"],
          "vendor-lucide": ["lucide-react"],
          "vendor-capacitor": ["@capacitor/core"],
        },
      },
    },
  },
});
