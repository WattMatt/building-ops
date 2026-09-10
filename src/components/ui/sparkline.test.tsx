import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sparkline } from './sparkline';

describe('Sparkline', () => {
  it('renders an accessible image and skips null gaps', () => {
    const { container } = render(<Sparkline values={[10, null, 30]} label="OHS compliance trend" />);
    expect(screen.getByRole('img', { name: 'OHS compliance trend' })).toBeInTheDocument();
    // Two points joined; the null in the middle is not a point.
    const points = container.querySelector('polyline')?.getAttribute('points') ?? '';
    expect(points.split(' ')).toHaveLength(2);
  });

  it('renders nothing for fewer than two numeric points', () => {
    const one = render(<Sparkline values={[5]} label="one" />);
    expect(one.container.innerHTML).toBe('');
    const none = render(<Sparkline values={[null, null]} label="none" />);
    expect(none.container.innerHTML).toBe('');
  });

  it('honours a fixed 0–100 scale: a value of 100 sits at the top (y = 1.0)', () => {
    const { container } = render(<Sparkline values={[0, 100]} min={0} max={100} width={72} height={20} label="scaled" />);
    const points = container.querySelector('polyline')?.getAttribute('points') ?? '';
    const last = points.split(' ').pop() ?? '';
    expect(last.split(',')[1]).toBe('1.0');
    const dot = container.querySelector('circle');
    expect(dot?.getAttribute('cy')).toBe('1');
  });
});
