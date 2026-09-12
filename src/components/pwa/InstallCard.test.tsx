import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { InstallMode } from '@/hooks/useInstallPrompt';

const state = vi.hoisted(() => ({
  mode: 'ios' as InstallMode,
  mobile: true,
  hintsEnabled: true,
}));
const install = vi.hoisted(() => vi.fn());
const dismiss = vi.hoisted(() => vi.fn());
const track = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useInstallPrompt', () => ({
  useInstallPrompt: () => ({ mode: state.mode, install, dismiss }),
}));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => state.mobile }));
// The real hook reaches for the Supabase client at import time; toggling hints is how we
// prove the copy is a <Hint> and the buttons are not.
vi.mock('@/hooks/useHints', () => ({
  useHints: () => ({ hintsEnabled: state.hintsEnabled, setHintsEnabled: vi.fn() }),
}));
vi.mock('@/lib/analytics', () => ({ track }));

import { InstallCard } from './InstallCard';

const IOS_STEPS = /In Safari, tap Share, then Add to Home Screen\./;
const IOS_PUSH = /Once installed, you can turn on push notifications under My Profile\./;

describe('InstallCard', () => {
  beforeEach(() => {
    state.mode = 'ios';
    state.mobile = true;
    state.hintsEnabled = true;
    install.mockReset().mockResolvedValue('accepted');
    dismiss.mockReset();
    track.mockReset();
  });

  it('on iOS Safari, tells the person how to install and that push follows', () => {
    render(<InstallCard />);
    expect(screen.getByText('Add to home screen')).toBeInTheDocument();
    expect(screen.getByText(IOS_STEPS)).toBeInTheDocument();
    expect(screen.getByText(IOS_PUSH)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Got it' })).toHaveClass('h-11');
    expect(track).toHaveBeenCalledWith('install_prompt_shown', { mode: 'ios' });
  });

  it('with hints off the iOS copy goes and Got it stays', () => {
    state.hintsEnabled = false;
    render(<InstallCard />);
    expect(screen.queryByText(IOS_STEPS)).not.toBeInTheDocument();
    expect(screen.queryByText(IOS_PUSH)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('with a native prompt, offers Add and Not now and does not mention push (the push card is on the same page)', async () => {
    state.mode = 'prompt';
    render(<InstallCard />);
    expect(screen.queryByText(IOS_PUSH)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(install).toHaveBeenCalledTimes(1));
    expect(track).toHaveBeenCalledWith('install_prompt_result', { outcome: 'accepted' });
  });

  it('renders nothing off a phone-sized viewport or when there is nothing to offer', () => {
    state.mobile = false;
    const off = render(<InstallCard />);
    expect(off.container).toBeEmptyDOMElement();
    off.unmount();

    state.mobile = true;
    state.mode = 'none';
    const none = render(<InstallCard />);
    expect(none.container).toBeEmptyDOMElement();
    expect(track).not.toHaveBeenCalled();
  });
});
