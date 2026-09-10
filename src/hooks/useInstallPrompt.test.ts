import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useInstallPrompt, isIosSafari } from './useInstallPrompt';

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function fakePromptEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  return Object.assign(new Event('beforeinstallprompt'), {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome }),
  });
}

describe('useInstallPrompt', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts as "none" when nothing has been offered (jsdom is not iOS)', () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.mode).toBe('none');
  });

  it('captures beforeinstallprompt, then installs and returns the outcome', async () => {
    const { result } = renderHook(() => useInstallPrompt());
    const evt = fakePromptEvent('accepted');

    act(() => {
      window.dispatchEvent(evt);
    });
    expect(result.current.mode).toBe('prompt');

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.install();
    });
    expect(evt.prompt).toHaveBeenCalledTimes(1);
    expect(outcome).toBe('accepted');
    // The deferred event is single-use: after prompting there is nothing left to offer.
    expect(result.current.mode).toBe('none');
  });

  it('returns "unavailable" from install() when no prompt has been captured', async () => {
    const { result } = renderHook(() => useInstallPrompt());
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.install();
    });
    expect(outcome).toBe('unavailable');
  });

  it('dismiss() persists across sessions via localStorage', () => {
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(fakePromptEvent());
    });
    expect(result.current.mode).toBe('prompt');

    act(() => {
      result.current.dismiss();
    });
    expect(result.current.mode).toBe('dismissed');
    expect(localStorage.getItem('fortress.install.dismissed')).toBe('1');

    // A fresh mount reads the flag back.
    const again = renderHook(() => useInstallPrompt());
    expect(again.result.current.mode).toBe('dismissed');
  });

  it('flips to "installed" on appinstalled, which outranks a pending prompt', () => {
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(fakePromptEvent());
    });
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(result.current.mode).toBe('installed');
  });

  describe('on iOS Safari', () => {
    const original = navigator.userAgent;
    beforeEach(() => {
      Object.defineProperty(navigator, 'userAgent', { value: IOS_UA, configurable: true });
    });
    afterEach(() => {
      Object.defineProperty(navigator, 'userAgent', { value: original, configurable: true });
    });

    it('detects Safari but not Chrome/Firefox on iOS', () => {
      expect(isIosSafari()).toBe(true);
      Object.defineProperty(navigator, 'userAgent', { value: IOS_UA + ' CriOS/120', configurable: true });
      expect(isIosSafari()).toBe(false);
    });

    it('reports "ios" so the caller can show the Share-sheet instructions', () => {
      const { result } = renderHook(() => useInstallPrompt());
      expect(result.current.mode).toBe('ios');
    });
  });
});
