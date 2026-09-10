import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { HintsProvider, useHints } from './useHints';
import { Hint } from '@/components/ui/hint';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

const selectState: { data: unknown; error: unknown } = { data: null, error: null };
const updatePatches: Array<{ patch: unknown; id: unknown }> = [];

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: selectState.data, error: selectState.error })),
        })),
      })),
      update: vi.fn((patch: unknown) => ({
        eq: vi.fn((_col: string, id: unknown) => {
          updatePatches.push({ patch, id });
          return Promise.resolve({ error: null });
        }),
      })),
    })),
  },
}));

function Toggle() {
  const { hintsEnabled, setHintsEnabled } = useHints();
  return <button onClick={() => setHintsEnabled(!hintsEnabled)}>{hintsEnabled ? 'on' : 'off'}</button>;
}

describe('hints preference', () => {
  beforeEach(() => {
    window.localStorage.clear();
    selectState.data = null;
    selectState.error = null;
    updatePatches.length = 0;
  });

  it('shows hints by default and hides them when switched off', async () => {
    render(
      <HintsProvider>
        <Hint>Fill in each section</Hint>
        <Toggle />
      </HintsProvider>,
    );
    await waitFor(() => expect(screen.getByRole('button')).toBeInTheDocument());
    expect(screen.getByText('Fill in each section')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('Fill in each section')).toBeNull();
    expect(window.localStorage.getItem('fortress.hints.user-1')).toBe('off');
  });

  it('honours a stored "off" and switches back on for a refresher', async () => {
    window.localStorage.setItem('fortress.hints.user-1', 'off');
    render(
      <HintsProvider>
        <Hint>Answers save automatically</Hint>
        <Toggle />
      </HintsProvider>,
    );
    await waitFor(() => expect(screen.queryByText('Answers save automatically')).toBeNull());
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Answers save automatically')).toBeInTheDocument();
    expect(window.localStorage.getItem('fortress.hints.user-1')).toBe('on');
  });

  it('keeps the preference per user, not global', async () => {
    window.localStorage.setItem('fortress.hints.someone-else', 'off');
    render(
      <HintsProvider>
        <Hint>Visible for this user</Hint>
      </HintsProvider>,
    );
    await waitFor(() => expect(screen.getByText('Visible for this user')).toBeInTheDocument());
  });

  it('reads the preference from the profile', async () => {
    selectState.data = { show_hints: false };
    selectState.error = null;
    window.localStorage.setItem('fortress.hints.user-1', 'on');

    function Reader() {
      const { hintsEnabled } = useHints();
      return <span>{hintsEnabled ? 'on' : 'off'}</span>;
    }

    render(
      <HintsProvider>
        <Reader />
      </HintsProvider>,
    );

    await waitFor(() => expect(screen.getByText('off')).toBeInTheDocument());
  });

  it('writes changes back to the profile', async () => {
    selectState.data = { show_hints: false };
    selectState.error = null;

    function Setter() {
      const { hintsEnabled, setHintsEnabled } = useHints();
      return <button onClick={() => setHintsEnabled(true)}>{hintsEnabled ? 'on' : 'off'}</button>;
    }

    render(
      <HintsProvider>
        <Setter />
      </HintsProvider>,
    );

    await waitFor(() => expect(screen.getByText('off')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });

    await waitFor(() => expect(updatePatches.length).toBeGreaterThan(0));
    expect(updatePatches[0].patch).toEqual({ show_hints: true });
    expect(updatePatches[0].id).toBe('user-1');
  });

  it('falls back to localStorage when the profile read fails', async () => {
    selectState.data = null;
    selectState.error = { message: 'x' };
    window.localStorage.setItem('fortress.hints.user-1', 'off');

    function Reader() {
      const { hintsEnabled } = useHints();
      return <span>{hintsEnabled ? 'on' : 'off'}</span>;
    }

    render(
      <HintsProvider>
        <Reader />
      </HintsProvider>,
    );

    await waitFor(() => expect(screen.getByText('off')).toBeInTheDocument());
  });
});
