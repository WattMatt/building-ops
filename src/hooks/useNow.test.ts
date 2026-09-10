import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNow } from './useNow';

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('starts at the mount instant and ticks once per interval', () => {
    const { result } = renderHook(() => useNow());
    expect(result.current.toISOString()).toBe('2026-09-10T10:00:00.000Z');
    act(() => { vi.advanceTimersByTime(59_999); });
    expect(result.current.toISOString()).toBe('2026-09-10T10:00:00.000Z');
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.toISOString()).toBe('2026-09-10T10:01:00.000Z');
    act(() => { vi.advanceTimersByTime(120_000); });
    expect(result.current.toISOString()).toBe('2026-09-10T10:03:00.000Z');
  });

  it('honours a custom interval', () => {
    const { result } = renderHook(() => useNow(1_000));
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(result.current.toISOString()).toBe('2026-09-10T10:00:03.000Z');
  });

  it('sets one interval and clears it on unmount', () => {
    const setSpy = vi.spyOn(globalThis, 'setInterval');
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = renderHook(() => useNow());
    expect(setSpy).toHaveBeenCalledTimes(1);
    unmount();
    expect(clearSpy).toHaveBeenCalledWith(setSpy.mock.results[0].value);
    expect(vi.getTimerCount()).toBe(0);
  });
});
