import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { IssueDraft } from '@/lib/offline/drafts';

const store = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), clear: vi.fn() }));
vi.mock('@/lib/offline/drafts', () => ({
  readIssueDraft: store.read,
  saveIssueDraft: store.save,
  clearIssueDraft: store.clear,
}));

import { useIssueDraft, DRAFT_DEBOUNCE_MS } from './useIssueDraft';

const saved: IssueDraft = { title: 'Lift', description: 'Stuck', buildingId: 'b1', priority: 'high', photos: [], savedAt: 1 };
const input = { title: 'Lift', description: 'Stuck', buildingId: 'b1', priority: 'high' as const, photos: [] as File[] };

describe('useIssueDraft', () => {
  beforeEach(() => {
    store.read.mockReset().mockResolvedValue(null);
    store.save.mockReset().mockResolvedValue(undefined);
    store.clear.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it('is not ready until the store has been read, then hands back what it holds', async () => {
    store.read.mockResolvedValue(saved);
    const { result } = renderHook(() => useIssueDraft('u1'));
    expect(result.current.ready).toBe(false);
    expect(result.current.restored).toBeNull();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.restored).toEqual(saved);
    expect(store.read).toHaveBeenCalledWith('u1');
  });

  it('is ready with nothing to restore when there is no user', async () => {
    const { result } = renderHook(() => useIssueDraft(undefined));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.restored).toBeNull();
    act(() => { result.current.save(input); result.current.clear(); });
    expect(store.read).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(store.clear).not.toHaveBeenCalled();
  });

  it('debounces saves by 400 ms and writes only the last value, stamped', async () => {
    const { result } = renderHook(() => useIssueDraft('u1'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    vi.useFakeTimers();
    act(() => { result.current.save(input); });
    act(() => { vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS - 1); });
    act(() => { result.current.save({ ...input, title: 'Lift 2' }); });
    act(() => { vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS - 1); });
    expect(store.save).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledWith('u1', expect.objectContaining({ ...input, title: 'Lift 2', savedAt: expect.any(Number) }));
  });

  it('clear() cancels a pending save and deletes the draft', async () => {
    const { result } = renderHook(() => useIssueDraft('u1'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    vi.useFakeTimers();
    act(() => { result.current.save(input); });
    act(() => { result.current.clear(); });
    act(() => { vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS * 2); });
    expect(store.save).not.toHaveBeenCalled();
    expect(store.clear).toHaveBeenCalledWith('u1');
  });

  it('flushes a pending save on unmount so leaving the page keeps the last keystrokes', async () => {
    const { result, unmount } = renderHook(() => useIssueDraft('u1'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    vi.useFakeTimers();
    act(() => { result.current.save(input); });
    unmount();
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledWith('u1', expect.objectContaining(input));
    act(() => { vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS * 2); });
    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it('save → clear → unmount writes nothing: clear() empties the slot the unmount flush reads', async () => {
    const { result, unmount } = renderHook(() => useIssueDraft('u1'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    vi.useFakeTimers();
    act(() => { result.current.save(input); });
    act(() => { result.current.clear(); });
    unmount();
    act(() => { vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS * 2); });
    expect(store.save).not.toHaveBeenCalled();
    expect(store.clear).toHaveBeenCalledTimes(1);
  });

  it('a save that fails (quota, private mode) is swallowed', async () => {
    store.save.mockRejectedValue(new Error('QuotaExceededError'));
    const { result } = renderHook(() => useIssueDraft('u1'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    vi.useFakeTimers();
    act(() => { result.current.save(input); });
    await act(async () => { vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS); await Promise.resolve(); });
    expect(store.save).toHaveBeenCalledTimes(1);
  });
});
