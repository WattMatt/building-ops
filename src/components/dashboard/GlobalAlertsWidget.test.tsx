import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ExpiringItem } from '@/lib/expiry';

const state = vi.hoisted(() => ({
  query: { data: undefined as ExpiringItem[] | undefined, isLoading: false, isError: false, error: null as Error | null, refetch: vi.fn() },
}));

vi.mock('@/hooks/useExpiringItems', () => ({ useExpiringItems: () => state.query }));

import GlobalAlertsWidget from './GlobalAlertsWidget';

const B = '11111111-1111-4111-8111-111111111111';
const CONTRACTOR = '22222222-2222-4222-8222-222222222222';

const items: ExpiringItem[] = [
  { kind: 'building_document', entity_type: 'document', entity_id: 'd1', parent_id: null, building_id: B, building_name: 'Alpha Court', name: 'Fire certificate', detail: 'Certificate', expiry_date: '2026-09-15', days_left: 5 },
  { kind: 'tenant_document', entity_type: 'document', entity_id: 'd2', parent_id: 't1', building_id: B, building_name: 'Alpha Court', name: 'Lease — Shop 1', detail: 'Shop 1', expiry_date: '2026-10-05', days_left: 25 },
  { kind: 'contractor_document', entity_type: 'document', entity_id: 'd3', parent_id: CONTRACTOR, building_id: null, building_name: null, name: 'COIDA letter', detail: 'Acme Electrical', expiry_date: '2026-11-01', days_left: 52 },
  { kind: 'asset_warranty', entity_type: 'asset', entity_id: 'a1', parent_id: null, building_id: B, building_name: 'Alpha Court', name: 'Chiller', detail: 'HVAC', expiry_date: '2026-12-01', days_left: 82 },
  { kind: 'asset_service', entity_type: 'asset', entity_id: 'a2', parent_id: null, building_id: B, building_name: 'Alpha Court', name: 'Generator', detail: 'Power', expiry_date: '2026-09-01', days_left: -9 },
];

function mount() {
  return render(<MemoryRouter><GlobalAlertsWidget /></MemoryRouter>);
}

describe('GlobalAlertsWidget', () => {
  beforeEach(() => {
    state.query.data = items;
    state.query.isLoading = false;
    state.query.isError = false;
    state.query.error = null;
    state.query.refetch.mockReset();
  });

  it('counts every item in the header and splits documents from service dates', () => {
    mount();
    expect(screen.getByText('5 items expiring within 90 days or already past')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Documents \(4\)/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Maintenance \(1\)/ })).toBeInTheDocument();
    // Bucket pills carry the counts across both tabs.
    expect(screen.getByRole('button', { name: 'All (5)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Expired (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '≤ 30 days (2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '31–60 days (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '61–90 days (1)' })).toBeInTheDocument();
  });

  it('filters the Documents list with the ≤ 30 days pill', () => {
    mount();
    expect(screen.getAllByRole('link', { name: /^Open / })).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: '≤ 30 days (2)' }));
    const links = screen.getAllByRole('link', { name: /^Open / });
    expect(links.map((l) => l.getAttribute('aria-label'))).toEqual(['Open Fire certificate', 'Open Lease — Shop 1']);
    expect(screen.getByRole('button', { name: '≤ 30 days (2)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('tab', { name: /Documents \(2\)/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Maintenance \(0\)/ })).toBeInTheDocument();
  });

  it('links a contractor document to the contractor register', () => {
    mount();
    expect(screen.getByRole('link', { name: 'Open COIDA letter' })).toHaveAttribute('href', `/contractors?open=${CONTRACTOR}`);
    expect(screen.getByRole('link', { name: 'Open Fire certificate' })).toHaveAttribute('href', `/buildings/${B}?tab=documents`);
    expect(screen.getByRole('link', { name: 'Open Lease — Shop 1' })).toHaveAttribute('href', `/buildings/${B}?tab=tenants`);
    expect(screen.getByRole('link', { name: 'Open Chiller' })).toHaveAttribute('href', `/buildings/${B}?tab=assets`);
    expect(screen.getByText('Contractor document · Acme Electrical')).toBeInTheDocument();
  });

  it('lists an overdue service date under Maintenance', () => {
    mount();
    // Radix tabs activate on mousedown; the inactive panel is not in the DOM until then.
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Maintenance \(1\)/ }));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByRole('link', { name: 'Open Generator' })).toHaveAttribute('href', `/buildings/${B}?tab=assets`);
    expect(within(panel).getByText('service overdue by 9 days')).toBeInTheDocument();
    expect(within(panel).getByText('9d overdue')).toBeInTheDocument();
  });

  it('renders nothing when there is nothing expiring', () => {
    state.query.data = [];
    const { container } = mount();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the failure card with a retry when the read fails', () => {
    state.query.data = undefined;
    state.query.isError = true;
    state.query.error = new Error('permission denied');
    mount();
    expect(screen.getByText('Failed to load global alerts')).toBeInTheDocument();
    expect(screen.getByText(/permission denied/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(state.query.refetch).toHaveBeenCalledTimes(1);
  });

  it('shows a spinner while loading', () => {
    state.query.data = undefined;
    state.query.isLoading = true;
    mount();
    expect(screen.getByRole('status', { name: 'Loading alerts' })).toBeInTheDocument();
    expect(screen.queryByText('Global Alerts')).toBeNull();
  });
});
