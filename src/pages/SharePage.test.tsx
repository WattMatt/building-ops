import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The page is public: the only Supabase call is the anon branding view, and it is made by
// useOrganization (the hook the theme provider above this route already uses) — never twice.
const brandingSelect = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: (...args: unknown[]) => {
        brandingSelect(...args);
        return {
          limit: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: { id: 'o1', name: 'Fortress', logo_url: null, primary_color: '#123456' }, error: null }),
          }),
        };
      },
    }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
  },
}));

import SharePage, { fetchShareMeta, openShare, type ShareMeta } from './SharePage';

const TOKEN = 'A'.repeat(43);

const meta = (over: Partial<ShareMeta> = {}): ShareMeta => ({
  building: 'Alpha Centre',
  title: 'Monthly OPS Report — Alpha Centre — September 2026',
  type: 'ops_monthly',
  period: '2026-09-01',
  reportStatus: 'approved',
  issuedAt: '2026-09-10T08:00:00.000Z',
  expiresAt: '2026-10-10T08:00:00.000Z',
  needsPasscode: false,
  ...over,
});

const jsonResponse = (status: number, body: unknown) =>
  ({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) }) as unknown as Response;

const fetchMock = vi.fn();

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/share/${TOKEN}`]}>
        <Routes><Route path="/share/:token" element={<SharePage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  brandingSelect.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('fetchShareMeta', () => {
  it('never calls the function for a malformed token', async () => {
    expect(await fetchShareMeta('too-short')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps 404 to null and 200 to the metadata', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, null));
    expect(await fetchShareMeta(TOKEN)).toBeNull();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, meta()));
    expect(await fetchShareMeta(TOKEN)).toMatchObject({ building: 'Alpha Centre', needsPasscode: false });
  });
});

describe('openShare', () => {
  it('maps 200 to the signed URL', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { url: 'https://signed.example/report.pdf' }));
    expect(await openShare(TOKEN)).toEqual({ ok: true, url: 'https://signed.example/report.pdf' });
  });

  it('maps 404 to not_found and 429 to locked with the retry window', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, null));
    expect(await openShare(TOKEN, 'wrong')).toEqual({ ok: false, reason: 'not_found' });
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: 'locked', retryAfterSeconds: 600 }));
    expect(await openShare(TOKEN)).toEqual({ ok: false, reason: 'locked', retryAfterSeconds: 600 });
  });

  it('maps anything else to error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'unavailable' }));
    expect(await openShare(TOKEN)).toEqual({ ok: false, reason: 'error' });
  });
});

describe('SharePage', () => {
  it('renders the unavailable card for an unknown link', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, null));
    renderPage();
    expect(await screen.findByText(/This link is not available/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open PDF/ })).toBeNull();
  });

  it('renders the report metadata and no passcode field when none is set', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, meta()));
    renderPage();
    expect(await screen.findByText(/ALPHA CENTRE/)).toBeInTheDocument();
    expect(screen.getByText(/Monthly OPS Report · Alpha Centre/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Passcode/)).toBeNull();
    expect(screen.queryByText(/DRAFT watermark/)).toBeNull();
    expect(screen.getByRole('button', { name: /Open PDF/ })).toBeEnabled();
  });

  it('names the watermark for a PDF issued before approval and gates on the passcode', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, meta({ reportStatus: 'submitted', needsPasscode: true })));
    renderPage();
    expect(await screen.findByText(/carries a DRAFT watermark/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Passcode/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open PDF/ })).toBeDisabled();
  });

  it('reads the branding once, through the shared hook', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, meta()));
    renderPage();
    expect(await screen.findByText('Fortress')).toBeInTheDocument();
    await waitFor(() => expect(brandingSelect).toHaveBeenCalledTimes(1));
  });

  it('hands the PDF tab no opener back to this page', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, meta()));
    fetchMock.mockResolvedValue(jsonResponse(200, { url: 'https://signed.example/report.pdf' }));
    const tab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
    vi.stubGlobal('open', vi.fn(() => tab));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Open PDF/ }));
    await waitFor(() => expect(tab.location.href).toBe('https://signed.example/report.pdf'));
    expect(tab.opener).toBeNull();
  });
});
