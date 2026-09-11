import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// The capture pipeline (heic2any, canvas) has its own tests and cannot run in jsdom.
vi.mock('@/components/ui/photo-capture', () => ({ PhotoCapture: () => null }));

import IntakePage from './IntakePage';

const info = {
  building: { name: 'North Tower' },
  org: { name: 'Watson Mattheus', logoUrl: null, primaryColor: '#2563eb' },
  shops: [{ shopNumber: '12', shopName: 'Kool Kids' }, { shopNumber: '14', shopName: 'Bean There' }],
  categories: ['Electrical', 'Plumbing'],
};

const res = (status: number, body: unknown = {}) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;

const fetchMock = vi.fn();
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/intake/tok']}>
      <Routes><Route path="/intake/:token" element={<IntakePage />} /></Routes>
    </MemoryRouter>,
  );

/** Fill the three required fields the way a tenant would. */
const fillRequired = () => {
  fireEvent.change(screen.getByLabelText(/what is the problem/i), { target: { value: 'Light out' } });
  fireEvent.change(screen.getByLabelText(/where is it/i), { target: { value: 'Passage by shop 12' } });
  fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Thandi' } });
};

describe('IntakePage', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    window.scrollTo = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the identical "not active" message for any refused token', async () => {
    fetchMock.mockResolvedValue(res(404, { error: 'not_found' }));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'This link is not active' })).toBeInTheDocument();
    expect(screen.getByText('Ask the building team for the current QR code.')).toBeInTheDocument();
  });

  it('offers a retry when the function itself is down', async () => {
    fetchMock.mockResolvedValue(res(500));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Could not load the form' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('renders the form with the building\'s shops and categories', async () => {
    fetchMock.mockResolvedValue(res(200, info));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Report a problem' })).toBeInTheDocument();
    expect(screen.getByText('12 — Kool Kids')).toBeInTheDocument();
    expect(screen.getByText('Electrical')).toBeInTheDocument();
    expect(screen.getByText('Plumbing')).toBeInTheDocument();
    // Privacy wording is plain visible text, not coaching behind the hints toggle.
    expect(screen.getByText('Your name and contact details go to the building team only.')).toBeInTheDocument();
  });

  it('keeps every control at a 44 px touch target', async () => {
    fetchMock.mockResolvedValue(res(200, info));
    renderPage();
    await screen.findByRole('heading', { name: 'Report a problem' });
    for (const id of ['intake-title', 'intake-name', 'intake-phone', 'intake-email', 'intake-category', 'intake-shop']) {
      expect(document.getElementById(id)?.className).toContain('h-11');
    }
    expect(screen.getByRole('button', { name: /send report/i }).className).toContain('h-12');
  });

  it('refuses to POST an empty form and says what is missing', async () => {
    fetchMock.mockResolvedValue(res(200, info));
    renderPage();
    await screen.findByRole('heading', { name: 'Report a problem' });
    fetchMock.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /send report/i }));

    expect(await screen.findByText('Tell us what the problem is')).toBeInTheDocument();
    expect(screen.getByText('Describe the problem and where it is')).toBeInTheDocument();
    expect(screen.getByText('Your name lets the team follow up')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the multipart form and shows the reference the tenant must keep', async () => {
    fetchMock.mockResolvedValueOnce(res(200, info));
    renderPage();
    await screen.findByRole('heading', { name: 'Report a problem' });
    fillRequired();

    fetchMock.mockResolvedValueOnce(res(201, { reference: 'FO-ABC234' }));
    fireEvent.click(screen.getByRole('button', { name: /send report/i }));

    expect(await screen.findByTestId('reference')).toHaveTextContent('FO-ABC234');
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain('/functions/v1/tenant-intake');
    expect(init.method).toBe('POST');
    const fd = init.body as FormData;
    expect(fd.get('t')).toBe('tok');
    expect(fd.get('title')).toBe('Light out');
    expect(fd.get('website')).toBe('');
  });

  it('shows the rate-limit copy when the hour\'s quota is spent', async () => {
    fetchMock.mockResolvedValueOnce(res(200, info));
    renderPage();
    await screen.findByRole('heading', { name: 'Report a problem' });
    fillRequired();

    fetchMock.mockResolvedValueOnce(res(429, { error: 'rate_limited' }));
    fireEvent.click(screen.getByRole('button', { name: /send report/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Too many reports from this phone or this link/);
  });

  it('maps the function\'s field rejections back onto the fields', async () => {
    fetchMock.mockResolvedValueOnce(res(200, info));
    renderPage();
    await screen.findByRole('heading', { name: 'Report a problem' });
    fillRequired();

    fetchMock.mockResolvedValueOnce(res(400, { error: 'invalid', fields: ['shop_number'] }));
    fireEvent.click(screen.getByRole('button', { name: /send report/i }));

    expect(await screen.findByText('Pick your shop from the list')).toBeInTheDocument();
  });

  it('falls back to the "not active" screen when the token dies mid-submission', async () => {
    fetchMock.mockResolvedValueOnce(res(200, info));
    renderPage();
    await screen.findByRole('heading', { name: 'Report a problem' });
    fillRequired();

    fetchMock.mockResolvedValueOnce(res(404, { error: 'not_found' }));
    fireEvent.click(screen.getByRole('button', { name: /send report/i }));

    expect(await screen.findByRole('heading', { name: 'This link is not active' })).toBeInTheDocument();
  });
});
