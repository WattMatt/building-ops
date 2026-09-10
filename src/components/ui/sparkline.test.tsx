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

  it('draws an all-equal series as a level line through the middle, never NaN', () => {
    const { container } = render(<Sparkline values={[50, 50, 50]} height={20} label="flat" />);
    const points = container.querySelector('polyline')?.getAttribute('points') ?? '';
    expect(points).not.toContain('NaN');
    const ys = points.split(' ').map((p) => p.split(',')[1]);
    expect(ys).toEqual(['10.0', '10.0', '10.0']);
  });

  it('an all-equal series on a fixed scale keeps its true height', () => {
    const { container } = render(<Sparkline values={[100, 100]} min={0} max={100} height={20} label="full" />);
    const points = container.querySelector('polyline')?.getAttribute('points') ?? '';
    expect(points.split(' ').map((p) => p.split(',')[1])).toEqual(['1.0', '1.0']);
  });
});
