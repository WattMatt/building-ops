import { vi } from 'vitest';

/**
 * Make useIsMobile() (and CSS-driven code that reads matchMedia) see the given viewport width.
 * Call inside a test before rendering; call with 1024 (or restore) afterwards.
 */
export function mockViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => {
      const m = /\(max-width:\s*(\d+)px\)/.exec(query);
      const matches = m ? width <= Number(m[1]) : false;
      return {
        matches,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      };
    }),
  });
  window.dispatchEvent(new Event('resize'));
}
