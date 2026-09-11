import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CommandPalette } from './CommandPalette';

const navigateMock = vi.fn();
const trackMock = vi.fn();

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => trackMock(...a) }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, isAdminOrManager: false }),
}));
vi.mock('@/hooks/useSearchEntities', () => ({
  // Mirrors the real hook: nothing below two characters.
  useSearchEntities: (q: string) => ({
    data: q.trim().length >= 2
      ? [
          { kind: 'building', id: 'b1', building_id: 'b1', title: 'Alpha Tower', subtitle: '1 Road' },
          { kind: 'issue', id: 'i1', building_id: 'b1', title: 'Leak', subtitle: null },
        ]
      : undefined,
    isFetching: false,
  }),
}));

beforeAll(() => {
  // cmdk scrolls the active item into view and measures with ResizeObserver; jsdom has neither.
  Element.prototype.scrollIntoView = vi.fn();
  if (!('ResizeObserver' in globalThis)) {
    class RO { observe() {} unobserve() {} disconnect() {} }
    (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  }
});

function renderOpen() {
  const onOpenChange = vi.fn();
  render(
    <MemoryRouter>
      <CommandPalette open onOpenChange={onOpenChange} />
    </MemoryRouter>,
  );
  return { onOpenChange };
}

describe('CommandPalette', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    trackMock.mockReset();
    window.localStorage.clear();
  });

  it('shows grouped server results and navigates on select, remembering the hit', () => {
    const { onOpenChange } = renderOpen();
    const input = screen.getByPlaceholderText(/search buildings/i);
    fireEvent.change(input, { target: { value: 'fi' } });

    expect(screen.getByText('Buildings')).toBeInTheDocument();
    expect(screen.getByText('Issues')).toBeInTheDocument();
    expect(screen.getByText('Alpha Tower')).toBeInTheDocument();
    expect(screen.getByText('1 Road')).toBeInTheDocument();
    expect(screen.getByText('Leak')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Alpha Tower'));

    expect(navigateMock).toHaveBeenCalledWith('/buildings/b1');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(trackMock).toHaveBeenCalledWith('palette_navigate', { kind: 'building' });
    const stored = JSON.parse(window.localStorage.getItem('fortress.palette.recent.u1') ?? '[]');
    expect(stored).toEqual([
      { kind: 'building', id: 'b1', building_id: 'b1', title: 'Alpha Tower', subtitle: '1 Road' },
    ]);
  });

  it('routes each kind to its destination', () => {
    renderOpen();
    fireEvent.change(screen.getByPlaceholderText(/search buildings/i), { target: { value: 'le' } });
    fireEvent.click(screen.getByText('Leak'));
    expect(navigateMock).toHaveBeenCalledWith('/issues?open=i1');
  });

  it('shows recents when the query is short, and filters pages client-side', () => {
    window.localStorage.setItem(
      'fortress.palette.recent.u1',
      JSON.stringify([{ kind: 'tenant', id: 't1', building_id: 'b9', title: 'Acme Ltd', subtitle: null }]),
    );
    renderOpen();
    expect(screen.getByText('Recent')).toBeInTheDocument();
    expect(screen.getByText('My Day')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Acme Ltd'));
    expect(navigateMock).toHaveBeenCalledWith('/buildings/b9?tab=tenants');

    fireEvent.change(screen.getByPlaceholderText(/search buildings/i), { target: { value: 'inb' } });
    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.queryByText('My Day')).not.toBeInTheDocument();
    expect(screen.queryByText('Recent')).not.toBeInTheDocument();
  });

  it('asks for two characters when a one-character query matches no page', () => {
    renderOpen();
    fireEvent.change(screen.getByPlaceholderText(/search buildings/i), { target: { value: 'z' } });
    expect(screen.getByText('Type at least two characters.')).toBeInTheDocument();
  });
});
