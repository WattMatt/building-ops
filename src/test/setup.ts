import 'fake-indexeddb/auto';
import "@testing-library/jest-dom";
import { vi } from "vitest";

// `src/integrations/supabase/client.ts` throws at import time when these are unset, and CI
// checks out the repo with no .env. Tests never talk to a real Supabase project (they mock
// the client), so any placeholder works; only fill in what the local .env has not already.
if (!import.meta.env.VITE_SUPABASE_URL) {
  vi.stubEnv("VITE_SUPABASE_URL", "http://localhost:54321");
}
if (!import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "test-anon-key");
}

// This jsdom setup exposes no Web Storage (and Node's own `localStorage` global is
// undefined without --localstorage-file). Give tests a real in-memory one so code
// that persists preferences can be exercised.
if (!window.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    writable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size; },
    },
  });
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
