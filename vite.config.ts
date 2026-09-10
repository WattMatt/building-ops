import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

// Brand blue: hsl(217 91% 50%) = --primary in src/index.css. Keep in sync with
// <meta name="theme-color"> in index.html.
const THEME_COLOR = "#0b64f4";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    // 8080 stays the default; PORT lets a tool or CI pick a free one when 8080
    // is already taken (Docker Desktop binds it on some machines).
    port: Number(process.env.PORT) || 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: null, // registered from UpdateToast via virtual:pwa-register/react so the update prompt is ours
      includeAssets: ["favicon.ico", "favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Building Ops",
        short_name: "Ops",
        description: "Property and facilities management",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: THEME_COLOR,
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // App shell only. Supabase REST/storage responses carry the user's bearer token and
        // per-user RLS results; a shared SW cache would leak across users on one device.
        // Offline data lives in the per-user query persister (src/lib/persist.ts, Task 4).
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/rest\//, /^\/storage\//, /^\/auth\//],
        runtimeCaching: [],
        // Routes are code-split (src/App.tsx), so the entry is ~0.8 MB and the largest
        // chunk is pdfmake's embedded fonts (vfs_fonts, ~1.8 MB). Everything must be
        // precached or that route is unusable offline, so the limit sits at the smallest
        // power of two that covers the largest chunk. If a build's biggest chunk grows
        // past this, Workbox skips it silently: check `precache N entries` in the build log.
        maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
