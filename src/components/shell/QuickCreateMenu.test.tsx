import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QuickCreateMenu } from './QuickCreateMenu';

const navigateMock = vi.fn();
const trackMock = vi.fn();
const auth = vi.hoisted(() => ({ isAdminOrManager: false }));

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => trackMock(...a) }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, isAdminOrManager: auth.isAdminOrManager }),
}));

beforeAll(() => {
  // Radix DropdownMenu uses pointer capture APIs jsdom does not implement.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = vi.fn();
});

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <QuickCreateMenu />
    </MemoryRouter>,
  );
}

function openMenu() {
  // jsdom has no PointerEvent, so Radix's pointerdown path never sees `button === 0`;
  // its trigger also toggles on Enter, which is what a keyboard user does anyway.
  fireEvent.keyDown(screen.getByRole('button', { name: 'Create' }), { key: 'Enter' });
}

describe('QuickCreateMenu', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    trackMock.mockReset();
    auth.isAdminOrManager = false;
  });

  it('on a building page as a non-manager offers issue and note, not generate tasks', async () => {
    renderAt('/buildings/b1');
    openMenu();
    expect(await screen.findByText('New issue')).toBeInTheDocument();
    expect(screen.getByText('New note')).toBeInTheDocument();
    expect(screen.queryByText('Generate tasks')).not.toBeInTheDocument();
  });

  it('on a building page as a manager also offers generate tasks', async () => {
    auth.isAdminOrManager = true;
    renderAt('/buildings/b1');
    openMenu();
    expect(await screen.findByText('Generate tasks')).toBeInTheDocument();
  });

  it('away from a building only offers a new issue', async () => {
    renderAt('/issues');
    openMenu();
    expect(await screen.findByText('New issue')).toBeInTheDocument();
    expect(screen.queryByText('New note')).not.toBeInTheDocument();
    expect(screen.queryByText('Generate tasks')).not.toBeInTheDocument();
  });

  it('on the create-building form treats /buildings/new as no building', async () => {
    renderAt('/buildings/new');
    openMenu();
    expect(await screen.findByText('New issue')).toBeInTheDocument();
    expect(screen.queryByText('New note')).not.toBeInTheDocument();
    expect(screen.queryByText('Generate tasks')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('New issue'));
    expect(navigateMock).toHaveBeenCalledWith('/issues/new');
  });

  it('pre-scopes the new issue to the current building', async () => {
    renderAt('/buildings/b1');
    openMenu();
    fireEvent.click(await screen.findByText('New issue'));
    expect(navigateMock).toHaveBeenCalledWith('/issues/new?building=b1');
    expect(trackMock).toHaveBeenCalledWith('quick_create', { kind: 'issue' });
  });
});
