import { vi } from 'vitest';

type ChangeListener = (e: { matches: boolean; media: string }) => void;
const listeners = new Map<string, Set<ChangeListener>>();
let currentWidth = 1024;

const matchesQuery = (query: string, width: number) => {
  const m = /\(max-width:\s*(\d+)px\)/.exec(query);
  return m ? width <= Number(m[1]) : false;
};

/**
 * Make useIsMobile() (and CSS-driven code that reads matchMedia) see the given viewport width.
 *
 * Call BEFORE render: the initial value is read synchronously from `window.innerWidth` and
 * `matchMedia` at mount. Calling it again while something is mounted behaves like a real
 * viewport change: `window.innerWidth` is updated and every `change` listener registered on a
 * matched media query is notified with its new `matches`. Call with 1024 afterwards to restore.
 */
export function mockViewport(width: number) {
  const previous = currentWidth;
  currentWidth = width;
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => {
      const set = listeners.get(query) ?? new Set<ChangeListener>();
      listeners.set(query, set);
      return {
        get matches() {
          return matchesQuery(query, currentWidth);
        },
        media: query,
        onchange: null,
        addListener: (fn: ChangeListener) => set.add(fn),
        removeListener: (fn: ChangeListener) => set.delete(fn),
        addEventListener: (_type: string, fn: ChangeListener) => set.add(fn),
        removeEventListener: (_type: string, fn: ChangeListener) => set.delete(fn),
        dispatchEvent: () => false,
      };
    }),
  });
  for (const [query, set] of listeners) {
    if (matchesQuery(query, previous) !== matchesQuery(query, width)) {
      for (const fn of set) fn({ matches: matchesQuery(query, width), media: query });
    }
  }
}
