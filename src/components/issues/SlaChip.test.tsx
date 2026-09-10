import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SlaChip } from './SlaChip';

const NOW = new Date('2026-09-10T10:00:00Z');
const base = { created_at: '2026-09-10T00:00:00Z', status: 'open' };

describe('SlaChip', () => {
  it('renders nothing for an issue without a target', () => {
    const { container } = render(<SlaChip issue={base} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the time left for a healthy clock', () => {
    render(<SlaChip issue={{ ...base, sla_target_hours: 72 }} now={NOW} />);
    const chip = screen.getByText('Due in 2d');
    expect(chip).toHaveAttribute('data-sla', 'ok');
    expect(chip).toHaveAttribute('title', expect.stringContaining('SLA due'));
  });

  it('shows how long ago a breached clock ran out', () => {
    render(<SlaChip issue={{ ...base, sla_target_hours: 4 }} now={NOW} />);
    expect(screen.getByText('Breached 6h ago')).toHaveAttribute('data-sla', 'breached');
  });
});
