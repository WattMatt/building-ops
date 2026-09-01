import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HintsProvider, useHints } from './useHints';
import { Hint } from '@/components/ui/hint';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

function Toggle() {
  const { hintsEnabled, setHintsEnabled } = useHints();
  return <button onClick={() => setHintsEnabled(!hintsEnabled)}>{hintsEnabled ? 'on' : 'off'}</button>;
}

describe('hints preference', () => {
  beforeEach(() => window.localStorage.clear());

  it('shows hints by default and hides them when switched off', () => {
    render(
      <HintsProvider>
        <Hint>Fill in each section</Hint>
        <Toggle />
      </HintsProvider>,
    );
    expect(screen.getByText('Fill in each section')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('Fill in each section')).toBeNull();
    expect(window.localStorage.getItem('fortress.hints.user-1')).toBe('off');
  });

  it('honours a stored "off" and switches back on for a refresher', () => {
    window.localStorage.setItem('fortress.hints.user-1', 'off');
    render(
      <HintsProvider>
        <Hint>Answers save automatically</Hint>
        <Toggle />
      </HintsProvider>,
    );
    expect(screen.queryByText('Answers save automatically')).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Answers save automatically')).toBeInTheDocument();
    expect(window.localStorage.getItem('fortress.hints.user-1')).toBe('on');
  });

  it('keeps the preference per user, not global', () => {
    window.localStorage.setItem('fortress.hints.someone-else', 'off');
    render(
      <HintsProvider>
        <Hint>Visible for this user</Hint>
      </HintsProvider>,
    );
    expect(screen.getByText('Visible for this user')).toBeInTheDocument();
  });
});
