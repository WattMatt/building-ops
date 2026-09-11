import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHotkey } from './useHotkey';

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = window) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

function focusedInput() {
  const input = document.createElement('input');
  document.body.appendChild(input);
  input.focus();
  return input;
}

describe('useHotkey', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('fires on ⌘K (and Ctrl+K) even while focus is in a field', () => {
    const handler = vi.fn();
    renderHook(() => useHotkey('k', { meta: true }, handler));
    const input = focusedInput();

    press('k', { metaKey: true }, input);
    expect(handler).toHaveBeenCalledTimes(1);

    press('K', { ctrlKey: true }, input);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('does not fire on a plain key while focus is in a field, so typing is never eaten', () => {
    const handler = vi.fn();
    renderHook(() => useHotkey('k', {}, handler));
    const input = focusedInput();

    const notPrevented = press('k', {}, input);
    expect(handler).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });

  it('fires on a plain key outside fields', () => {
    const handler = vi.fn();
    renderHook(() => useHotkey('k', {}, handler));

    press('k');
    expect(handler).toHaveBeenCalledTimes(1);

    // The modifier is required only when asked for; a meta hotkey ignores the bare key.
    const metaHandler = vi.fn();
    renderHook(() => useHotkey('k', { meta: true }, metaHandler));
    press('k');
    expect(metaHandler).not.toHaveBeenCalled();
  });

  it('removes its window listener on unmount', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useHotkey('k', { meta: true }, handler));
    unmount();

    press('k', { metaKey: true });
    expect(handler).not.toHaveBeenCalled();
  });
});
