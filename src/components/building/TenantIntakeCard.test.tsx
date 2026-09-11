import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const state = vi.hoisted(() => ({
  feature: true,
  isAdminOrManager: true,
  tokens: {
    token: null as null | Record<string, unknown>,
    url: null as string | null,
    isLoading: false,
    isError: false,
    isMutating: false,
    create: vi.fn(async () => {}),
    rotate: vi.fn(async () => {}),
    disable: vi.fn(async () => {}),
  },
  printed: [] as string[],
  printOk: true,
}));

vi.mock('@/hooks/useOrgSettings', () => ({ useFeature: () => state.feature }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdminOrManager: state.isAdminOrManager, user: { id: 'u1' } }) }));
vi.mock('@/hooks/useIntakeTokens', () => ({ useIntakeTokens: () => state.tokens }));
vi.mock('@/hooks/useOrganization', () => ({ useOrganization: () => ({ organization: { name: 'Watson Mattheus' }, loading: false }) }));
vi.mock('qrcode', () => ({ toDataURL: vi.fn(async () => 'data:image/png;base64,QQ==') }));
vi.mock('@/lib/intakeSheet', async () => {
  const actual = await vi.importActual<typeof import('@/lib/intakeSheet')>('@/lib/intakeSheet');
  return {
    ...actual,
    openPrintWindow: (html: string) => { state.printed.push(html); return state.printOk; },
  };
});
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'maybeSingle']) chain[m] = () => chain;
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: { name: 'North Tower' }, error: null }).then(resolve);
      return chain;
    },
  },
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { TenantIntakeCard } from './TenantIntakeCard';

const row = {
  id: 'tok1',
  building_id: 'b1',
  token: 'a'.repeat(43),
  label: 'Tenant intake',
  is_active: true,
  created_by: 'u1',
  created_at: '2026-09-01T08:00:00.000Z',
  last_used_at: '2026-09-05T10:00:00.000Z',
  submissions_count: 3,
};

const renderCard = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return render(<TenantIntakeCard buildingId="b1" />, { wrapper });
};

describe('TenantIntakeCard', () => {
  const originalConfirm = window.confirm;

  beforeEach(() => {
    state.feature = true;
    state.isAdminOrManager = true;
    state.tokens = { ...state.tokens, token: null, url: null, isLoading: false, isError: false, isMutating: false };
    state.tokens.create.mockClear();
    state.tokens.rotate.mockClear();
    state.tokens.disable.mockClear();
    state.printed.length = 0;
    state.printOk = true;
    toast.success.mockClear();
    toast.error.mockClear();
  });
  afterEach(() => { window.confirm = originalConfirm; });

  it('renders nothing while the org feature flag is off', () => {
    state.feature = false;
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a user who is not an admin or manager', () => {
    state.isAdminOrManager = false;
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it('offers to create the first link when the building has none', async () => {
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /create link/i }));
    await waitFor(() => expect(state.tokens.create).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith('Intake link created');
  });

  it('surfaces a load failure as plain copy rather than an empty card', async () => {
    state.tokens = { ...state.tokens, isError: true };
    renderCard();
    expect(await screen.findByText('Could not load the intake link.')).toBeInTheDocument();
  });

  it('shows the live link, its use count and the QR image', async () => {
    state.tokens = { ...state.tokens, token: row, url: `https://app.example.com/intake/${row.token}` };
    renderCard();
    expect(await screen.findByLabelText('Intake link')).toHaveTextContent(`/intake/${row.token}`);
    expect(screen.getByText('3 reports')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByAltText('QR code for the tenant report form')).toHaveAttribute('src', 'data:image/png;base64,QQ=='));
    // The privacy guardrail is plain visible text, not coaching behind a hint toggle.
    expect(screen.getByText(/Anyone with this link can report a problem/)).toBeInTheDocument();
  });

  it('copies the link to the clipboard', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    state.tokens = { ...state.tokens, token: row, url: 'https://app.example.com/intake/x' };
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /copy link/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://app.example.com/intake/x'));
  });

  it('prints an A5 sheet carrying the building name', async () => {
    state.tokens = { ...state.tokens, token: row, url: 'https://app.example.com/intake/x' };
    renderCard();
    const print = await screen.findByRole('button', { name: /print qr sheet/i });
    await waitFor(() => expect(print).not.toBeDisabled());
    fireEvent.click(print);
    await waitFor(() => expect(state.printed).toHaveLength(1));
    // The sheet carries the house-formatted building name, as every other printed surface does.
    expect(state.printed[0]).toContain('NORTH TOWER');
    expect(state.printed[0]).toContain('https://app.example.com/intake/x');
  });

  it('says so when the browser blocks the print window', async () => {
    state.printOk = false;
    state.tokens = { ...state.tokens, token: row, url: 'https://app.example.com/intake/x' };
    renderCard();
    const print = await screen.findByRole('button', { name: /print qr sheet/i });
    await waitFor(() => expect(print).not.toBeDisabled());
    fireEvent.click(print);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('blocked the print window')));
  });

  it('rotates only after the printed-codes warning is accepted', async () => {
    state.tokens = { ...state.tokens, token: row, url: 'https://app.example.com/intake/x' };
    renderCard();
    const rotate = await screen.findByRole('button', { name: /rotate/i });

    window.confirm = vi.fn(() => false);
    fireEvent.click(rotate);
    expect(state.tokens.rotate).not.toHaveBeenCalled();

    window.confirm = vi.fn(() => true);
    fireEvent.click(rotate);
    await waitFor(() => expect(state.tokens.rotate).toHaveBeenCalled());
    expect((window.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('printed QR codes stop working');
  });

  it('disables the link after confirmation', async () => {
    state.tokens = { ...state.tokens, token: row, url: 'https://app.example.com/intake/x' };
    window.confirm = vi.fn(() => true);
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /disable/i }));
    await waitFor(() => expect(state.tokens.disable).toHaveBeenCalled());
  });
});
