import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createElement } from 'react';

// PUSH_ENABLED is read when @/lib/push is imported, so each case stubs the env and loads a
// fresh module graph (useGeotag.test.ts idiom). The hook is mocked so the component test
// only covers rendering per status and which action each toggle fires.
const hook = vi.hoisted(() => ({
  usePushSubscription: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock('@/hooks/usePushSubscription', () => ({ usePushSubscription: hook.usePushSubscription }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: vi.fn() } }));

async function loadModule(key = 'BTestKey') {
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', key);
  vi.resetModules();
  return import('./PushSwitch');
}

async function loadSwitch(key = 'BTestKey') {
  return (await loadModule(key)).PushSwitch;
}

function status(value: string) {
  hook.usePushSubscription.mockReturnValue({ status: value, enable: hook.enable, disable: hook.disable });
}

describe('PushSwitch', () => {
  beforeEach(() => {
    hook.usePushSubscription.mockReset();
    hook.enable.mockReset().mockResolvedValue(undefined);
    hook.disable.mockReset().mockResolvedValue(undefined);
    toast.error.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders nothing when the build has no VAPID key', async () => {
    status('off');
    const PushSwitch = await loadSwitch('');
    const { container } = render(createElement(PushSwitch, { userId: 'u1' }));
    expect(container).toBeEmptyDOMElement();
    expect(hook.usePushSubscription).not.toHaveBeenCalled();
  });

  it('renders the labelled switch off with coaching when status is off', async () => {
    status('off');
    const PushSwitch = await loadSwitch();
    render(createElement(PushSwitch, { userId: 'u1' }));

    const sw = screen.getByRole('switch', { name: 'Push notifications on this device' });
    expect(sw).toHaveAttribute('id', 'push-device');
    expect(sw).not.toBeChecked();
    expect(sw).toBeEnabled();
    expect(screen.getByText(/Turn this on to get urgent alerts/)).toBeInTheDocument();
  });

  it('shows the on description and is checked when status is on', async () => {
    status('on');
    const PushSwitch = await loadSwitch();
    render(createElement(PushSwitch, { userId: 'u1' }));

    expect(screen.getByRole('switch')).toBeChecked();
    expect(screen.getByText(/You'll get a push for assignments, mentions, sign-off requests and your tasks due today/)).toBeInTheDocument();
  });

  it('is disabled with the blocked guardrail when status is denied', async () => {
    status('denied');
    const PushSwitch = await loadSwitch();
    render(createElement(PushSwitch, { userId: 'u1' }));

    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByText('Notifications are blocked for this site. Allow them in your browser settings, then try again.')).toBeInTheDocument();
  });

  it('is disabled with the home-screen guardrail when status is ios-not-installed', async () => {
    status('ios-not-installed');
    const PushSwitch = await loadSwitch();
    render(createElement(PushSwitch, { userId: 'u1' }));

    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByText('On iPhone, add Building Ops to your home screen first, then turn this on.')).toBeInTheDocument();
  });

  it('is disabled with the unsupported guardrail when status is unsupported', async () => {
    status('unsupported');
    const PushSwitch = await loadSwitch();
    render(createElement(PushSwitch, { userId: 'u1' }));

    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByText("This browser can't receive push notifications.")).toBeInTheDocument();
  });

  it('is disabled and marked busy while a toggle is in flight', async () => {
    status('busy');
    const PushSwitch = await loadSwitch();
    render(createElement(PushSwitch, { userId: 'u1' }));

    const sw = screen.getByRole('switch');
    expect(sw).toBeDisabled();
    expect(sw).toHaveAttribute('aria-busy', 'true');
  });

  it('calls enable() when switched on', async () => {
    status('off');
    const PushSwitch = await loadSwitch();
    render(createElement(PushSwitch, { userId: 'u1' }));

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(hook.enable).toHaveBeenCalledTimes(1));
    expect(hook.disable).not.toHaveBeenCalled();
  });

  it('calls disable() when switched off', async () => {
    status('on');
    const PushSwitch = await loadSwitch();
    render(createElement(PushSwitch, { userId: 'u1' }));

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(hook.disable).toHaveBeenCalledTimes(1));
    expect(hook.enable).not.toHaveBeenCalled();
  });

  it('reports a failed toggle as a toast instead of an unhandled rejection', async () => {
    status('off');
    hook.enable.mockRejectedValue(new Error('RLS says no'));
    const PushSwitch = await loadSwitch();
    render(createElement(PushSwitch, { userId: 'u1' }));

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith("Couldn't turn on push notifications", { description: 'RLS says no' });
  });
});

describe('PushSwitchRow', () => {
  beforeEach(() => {
    hook.enable.mockReset().mockResolvedValue(undefined);
    hook.disable.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('drops the off-state coaching when coaching is false, keeping the label and the switch', async () => {
    const { PushSwitchRow } = await loadModule();
    render(createElement(PushSwitchRow, { status: 'off', enable: hook.enable, disable: hook.disable, coaching: false }));

    expect(screen.getByRole('switch', { name: 'Push notifications on this device' })).toBeEnabled();
    expect(screen.queryByText(/Turn this on to get urgent alerts/)).not.toBeInTheDocument();
  });

  it('still shows the guardrail copy when coaching is false: a requirement is not a tip', async () => {
    const { PushSwitchRow } = await loadModule();
    render(createElement(PushSwitchRow, { status: 'denied', enable: hook.enable, disable: hook.disable, coaching: false }));

    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByText('Notifications are blocked for this site. Allow them in your browser settings, then try again.')).toBeInTheDocument();
  });

  it('drives enable() from the props it was given', async () => {
    const { PushSwitchRow } = await loadModule();
    render(createElement(PushSwitchRow, { status: 'off', enable: hook.enable, disable: hook.disable }));

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(hook.enable).toHaveBeenCalledTimes(1));
  });
});
