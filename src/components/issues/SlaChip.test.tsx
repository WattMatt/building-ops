import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { formatSlaInstant } from '@/lib/slaState';
import { SlaChip } from './SlaChip';

const NOW = new Date('2026-09-10T10:00:00Z');
const base = { created_at: '2026-09-10T00:00:00Z', status: 'open' };

describe('SlaChip', () => {
  it('renders nothing for an issue without a target', () => {
    const { container } = render(<SlaChip issue={base} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the time left for a healthy clock, with the SAST due time as the title', () => {
    render(<SlaChip issue={{ ...base, sla_target_hours: 72 }} now={NOW} />);
    const chip = screen.getByText('Due in 2d');
    expect(chip).toHaveAttribute('data-sla', 'ok');
    expect(chip).toHaveAttribute('title', `SLA due ${formatSlaInstant(new Date('2026-09-13T00:00:00Z'))}`);
    expect(chip.getAttribute('title')).toMatch(/02:00$/);
  });

  it('turns amber inside the due-soon window', () => {
    render(<SlaChip issue={{ ...base, sla_target_hours: 12 }} now={NOW} />);
    expect(screen.getByText('Due in 2h')).toHaveAttribute('data-sla', 'due_soon');
  });

  it('shows how long ago a breached clock ran out', () => {
    render(<SlaChip issue={{ ...base, sla_target_hours: 4 }} now={NOW} />);
    expect(screen.getByText('Breached 6h ago')).toHaveAttribute('data-sla', 'breached');
  });

  it('follows the clock it is given', () => {
    const { rerender } = render(<SlaChip issue={{ ...base, sla_target_hours: 24 }} now={NOW} />);
    expect(screen.getByText('Due in 14h')).toBeInTheDocument();
    rerender(<SlaChip issue={{ ...base, sla_target_hours: 24 }} now={new Date('2026-09-10T20:00:00Z')} />);
    expect(screen.getByText('Due in 4h')).toHaveAttribute('data-sla', 'due_soon');
  });
});
