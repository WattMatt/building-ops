import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // The default 'threads' pool hangs in this environment (worker_threads +
    // jsdom). 'forks' runs the suite reliably. See docs/plans/2026-06-14-phase1.
    pool: "forks",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
