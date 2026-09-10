import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { buildCoverage } from '@/lib/reportCoverage';
import { CoverageGrid } from './CoverageGrid';

const buildings = [
  { id: 'b1', name: 'Alpha Mall', report_types: ['ops_monthly', 'cm_monthly'] },
  { id: 'b2', name: 'Beta Plaza', report_types: ['ops_monthly'] },
];
const reports = [
  { id: 'r1', building_id: 'b1', report_type: 'ops_monthly', report_period: '2026-08-01', status: 'approved' },
  { id: 'r2', building_id: 'b2', report_type: 'ops_monthly', report_period: '2026-08-01', status: 'draft' },
];
const period = '2026-08-01';

function renderGrid(over: Partial<React.ComponentProps<typeof CoverageGrid>> = {}) {
  const { rows, summary } = buildCoverage(buildings, reports, period);
  const props = {
    period, rows, summary, canEditTypes: true, canDiscard: true,
    onOpenReport: vi.fn(), onOpenBuilding: vi.fn(), onDiscardDraft: vi.fn(), onSetReportTypes: vi.fn(),
    ...over,
  };
  render(<CoverageGrid {...props} />);
  return props;
}

// Radix dropdown (report types) is left untested: jsdom does not open it.
describe('CoverageGrid', () => {
  it('shows per-type header counts', () => {
    renderGrid();
    expect(screen.getByTestId('summary-ops_monthly')).toHaveTextContent('1 approved · 1 draft');
    expect(screen.getByTestId('summary-cm_monthly')).toHaveTextContent('1 missing');
    expect(screen.getByTestId('summary-annual_inspection')).toHaveTextContent('nothing due');
  });
  it('a missing chip opens the building, a filed chip opens the report', () => {
    const p = renderGrid();
    fireEvent.click(screen.getByRole('button', { name: 'CM missing for Alpha Mall' }));
    expect(p.onOpenBuilding).toHaveBeenCalledWith('b1');
    fireEvent.click(screen.getByRole('button', { name: 'OPS approved for Alpha Mall' }));
    expect(p.onOpenReport).toHaveBeenCalledWith('r1');
  });
  it('offers Discard only on a draft cell, and only to admins', () => {
    const p = renderGrid();
    expect(screen.queryByRole('button', { name: /Discard OPS draft for Alpha Mall/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Discard OPS draft for Beta Plaza' }));
    expect(p.onDiscardDraft).toHaveBeenCalledWith('r2');
  });
  it('hides both controls for a viewer', () => {
    renderGrid({ canEditTypes: false, canDiscard: false });
    expect(screen.queryByRole('button', { name: /Discard/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Report types for/ })).toBeNull();
    expect(screen.queryByText('Report types')).toBeNull();
  });
  it('a manager gets the report-types menu but not Discard', () => {
    renderGrid({ canEditTypes: true, canDiscard: false });
    expect(screen.getByRole('button', { name: 'Report types for Alpha Mall' })).toBeInTheDocument();
    expect(screen.getByText('Report types')).toHaveClass('sr-only');
    expect(screen.queryByRole('button', { name: /Discard/ })).toBeNull();
  });
  it('renders a dash for a type the building does not owe', () => {
    renderGrid();
    // Alpha: annual; Beta: CM + annual.
    const dashes = screen.getAllByTitle('Not required for this building');
    expect(dashes).toHaveLength(3);
    for (const d of dashes) {
      expect(d).toHaveTextContent('—');
      expect(d).toHaveTextContent('Not required');
    }
  });
});
