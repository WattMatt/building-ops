import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// The hook keeps a module-level fix cache, so every case gets a fresh module
// via vi.resetModules() + dynamic import.
async function loadHook() {
  vi.resetModules();
  const mod = await import('./useGeotag');
  return mod.useGeotag;
}

type GetCurrentPosition = (
  success: (pos: { coords: { latitude: number; longitude: number } }) => void,
  error: (err: unknown) => void
) => void;

function stubGeolocation(impl: GetCurrentPosition) {
  const getCurrentPosition = vi.fn(impl);
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  });
  return getCurrentPosition;
}

const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation');

describe('useGeotag', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalGeolocation) {
      Object.defineProperty(navigator, 'geolocation', originalGeolocation);
    } else {
      delete (navigator as unknown as { geolocation?: unknown }).geolocation;
    }
  });

  it('does not ask for a position when disabled', async () => {
    const getCurrentPosition = stubGeolocation((success) =>
      success({ coords: { latitude: 1, longitude: 2 } })
    );
    const useGeotag = await loadHook();

    const { result } = renderHook(() => useGeotag(false));

    expect(result.current.position).toBeNull();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('shares one fix across concurrent hooks', async () => {
    const getCurrentPosition = stubGeolocation((success) =>
      success({ coords: { latitude: -33.9, longitude: 18.4 } })
    );
    const useGeotag = await loadHook();

    const a = renderHook(() => useGeotag(true));
    const b = renderHook(() => useGeotag(true));

    await waitFor(() => {
      expect(a.result.current.position).toEqual({ lat: -33.9, lng: 18.4 });
      expect(b.result.current.position).toEqual({ lat: -33.9, lng: 18.4 });
    });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('caches a denial so a remount within the TTL does not re-prompt', async () => {
    const getCurrentPosition = stubGeolocation((_success, error) =>
      error({ code: 1, message: 'User denied Geolocation' })
    );
    const useGeotag = await loadHook();

    const first = renderHook(() => useGeotag(true));
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(1));
    expect(first.result.current.position).toBeNull();
    first.unmount();

    const second = renderHook(() => useGeotag(true));
    // Give any stray request a tick to surface before asserting.
    await new Promise((r) => setTimeout(r, 0));
    expect(second.result.current.position).toBeNull();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });
});
