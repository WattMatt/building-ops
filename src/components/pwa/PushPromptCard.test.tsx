import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createElement } from 'react';

// PUSH_ENABLED is read when @/lib/push is imported (the card reaches it through PushSwitch), so
// each case stubs the env and loads a fresh module graph — the PushSwitch.test idiom. The
// subscription hook is mocked: this test covers when the card shows, that its copy is a <Hint>,
// dismissal, and that the switch drives the hook; enable/disable themselves are covered by
// usePushSubscription.test.
const hook = vi.hoisted(() => ({ usePushSubscription: vi.fn(), enable: vi.fn(), disable: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
const hints = vi.hoisted(() => ({ enabled: true }));

vi.mock('@/hooks/usePushSubscription', () => ({ usePushSubscription: hook.usePushSubscription }));
vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: hints.enabled, setHintsEnabled: vi.fn() }) }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: vi.fn() } }));

const KEY = 'fortress.pushPrompt.dismissed.u1';
const COPY = /Get a push when a task is assigned to you and each morning for what's due today\./;

async function loadModule(key = 'BTestKey') {
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', key);
  vi.resetModules();
  return import('./PushPromptCard');
}

function status(value: string) {
  hook.usePushSubscription.mockReturnValue({ status: value, enable: hook.enable, disable: hook.disable });
}

describe('PushPromptCard', () => {
  beforeEach(() => {
    hook.usePushSubscription.mockReset();
    hook.enable.mockReset().mockResolvedValue(undefined);
    hook.disable.mockReset().mockResolvedValue(undefined);
    toast.error.mockReset();
    hints.enabled = true;
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders nothing when the build has no VAPID key', async () => {
    status('off');
    const { PushPromptCard } = await loadModule('');
    const { container } = render(createElement(PushPromptCard, { userId: 'u1' }));
    expect(container).toBeEmptyDOMElement();
    expect(hook.usePushSubscription).not.toHaveBeenCalled();
  });

  it('renders nothing without a signed-in user', async () => {
    status('off');
    const { PushPromptCard } = await loadModule();
    const { container } = render(createElement(PushPromptCard, { userId: undefined }));
    expect(container).toBeEmptyDOMElement();
    expect(hook.usePushSubscription).not.toHaveBeenCalled();
  });

  it.each(['on', 'busy', 'denied', 'unsupported', 'ios-not-installed'])('renders nothing when status is %s', async (value) => {
    status(value);
    const { PushPromptCard } = await loadModule();
    const { container } = render(createElement(PushPromptCard, { userId: 'u1' }));
    expect(container).toBeEmptyDOMElement();
  });

  it('offers the switch, the coaching copy and Dismiss when push is off', async () => {
    status('off');
    const { PushPromptCard } = await loadModule();
    render(createElement(PushPromptCard, { userId: 'u1' }));

    expect(screen.getByText('Turn on push notifications')).toBeInTheDocument();
    expect(screen.getByText(COPY)).toBeInTheDocument();
    const sw = screen.getByRole('switch', { name: 'Push notifications on this device' });
    expect(sw).not.toBeChecked();
    expect(sw).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveClass('h-11');
    // The row's own off-state coaching would double up with the card's hint.
    expect(screen.queryByText(/Turn this on to get urgent alerts/)).not.toBeInTheDocument();
  });

  it('keeps the switch and Dismiss with hints off; only the coaching copy goes', async () => {
    hints.enabled = false;
    status('off');
    const { PushPromptCard } = await loadModule();
    render(createElement(PushPromptCard, { userId: 'u1' }));

    expect(screen.queryByText(COPY)).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Push notifications on this device' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('switching on calls enable() and keeps the card while the toggle is in flight', async () => {
    status('off');
    const { PushPromptCard } = await loadModule();
    const { rerender } = render(createElement(PushPromptCard, { userId: 'u1' }));

    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(hook.enable).toHaveBeenCalledTimes(1));

    // The hook reports busy while subscribing; the card the user just touched must not vanish under them.
    status('busy');
    rerender(createElement(PushPromptCard, { userId: 'u1' }));
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByText('Turn on push notifications')).toBeInTheDocument();

    // If the browser prompt ends in a block, the card stays so the row's guardrail explains it.
    status('denied');
    rerender(createElement(PushPromptCard, { userId: 'u1' }));
    expect(screen.getByText('Turn on push notifications')).toBeInTheDocument();
    expect(screen.getByText('Notifications are blocked for this site. Allow them in your browser settings, then try again.')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeDisabled();

    // …and goes once the device is on.
    status('on');
    rerender(createElement(PushPromptCard, { userId: 'u1' }));
    expect(screen.queryByText('Turn on push notifications')).not.toBeInTheDocument();
  });

  it('Dismiss hides the card and records the choice for this user on this device', async () => {
    status('off');
    const { PushPromptCard } = await loadModule();
    const { container } = render(createElement(PushPromptCard, { userId: 'u1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(container).toBeEmptyDOMElement();
    expect(window.localStorage.getItem(KEY)).toBe('1');
  });

  it('stays hidden on the next visit after a dismissal, but not for another user', async () => {
    window.localStorage.setItem(KEY, '1');
    status('off');
    const { PushPromptCard } = await loadModule();

    const first = render(createElement(PushPromptCard, { userId: 'u1' }));
    expect(first.container).toBeEmptyDOMElement();
    first.unmount();

    render(createElement(PushPromptCard, { userId: 'u2' }));
    expect(screen.getByText('Turn on push notifications')).toBeInTheDocument();
  });

  it('treats unavailable storage as not dismissed and never throws on write', async () => {
    const { readDismissed, writeDismissed } = await loadModule();
    const broken = {
      getItem: () => { throw new Error('private mode'); },
      setItem: () => { throw new Error('private mode'); },
    };
    expect(readDismissed('u1', broken)).toBe(false);
    expect(() => writeDismissed('u1', broken)).not.toThrow();
    expect(readDismissed('u1', null)).toBe(false);
    expect(() => writeDismissed('u1', null)).not.toThrow();
  });
});
