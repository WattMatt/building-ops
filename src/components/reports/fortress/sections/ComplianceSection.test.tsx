import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const state = vi.hoisted(() => ({
  responses: {} as Record<string, { id: string; comment: string | null; response: string | null }>,
  responseMap: {} as Record<string, 'yes' | 'no' | 'na' | undefined>,
  setResponse: vi.fn(async () => {}),
  item: { id: 'i1', template_id: 'tpl1', item_no: '1.1', prompt: 'Fire extinguishers serviced', section_no: '1', section_title: 'Fire', is_scored: true, is_critical: false, group_code: 'A', group_weight: 1, weight: 1, sort_order: 1 },
}));

// SectionCard renders its hint through <Hint> → useHints → useAuth; none of that is under test.
vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: vi.fn() }) }));
vi.mock('@/hooks/useComplianceSection', () => ({
  useComplianceSection: () => ({
    template: null,
    items: [state.item],
    responses: state.responses,
    responseMap: state.responseMap,
    isLoading: false,
    setResponse: state.setResponse,
    liveBuildingPct: null,
    answered: Object.values(state.responseMap).filter(Boolean).length,
    scoredTotal: 1,
  }),
}));

import ComplianceSection from './ComplianceSection';

const renderSection = (readOnly = false) =>
  render(<ComplianceSection reportId="rep1" buildingId="b1" readOnly={readOnly} />);
const commentBox = () => screen.getByPlaceholderText('Comment (optional)') as HTMLInputElement;

beforeEach(() => {
  state.responses = {};
  state.responseMap = {};
  state.setResponse.mockClear();
});

describe('ComplianceSection — comment without an answer', () => {
  it('saves the comment on blur before any answer is picked, and asks for the answer', () => {
    renderSection();
    fireEvent.change(commentBox(), { target: { value: 'Extinguisher tag missing' } });
    expect(screen.getByText('Answer needed')).toBeInTheDocument();
    fireEvent.blur(commentBox());
    expect(state.setResponse).toHaveBeenCalledTimes(1);
    expect(state.setResponse).toHaveBeenCalledWith('i1', null, 'Extinguisher tag missing');
  });

  it('the answer toggle sends the comment as typed, not the last saved one', () => {
    state.responses = { i1: { id: 'r1', comment: 'old note', response: null } };
    renderSection();
    expect(commentBox()).toHaveValue('old note');
    fireEvent.change(commentBox(), { target: { value: 'new note' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));
    expect(state.setResponse).toHaveBeenCalledWith('i1', 'yes', 'new note');
  });

  it('does not rewrite an unchanged comment, and drops the line once the item is answered', () => {
    state.responses = { i1: { id: 'r1', comment: 'kept', response: 'yes' } };
    state.responseMap = { i1: 'yes' };
    renderSection();
    fireEvent.blur(commentBox());
    expect(state.setResponse).not.toHaveBeenCalled();
    expect(screen.queryByText('Answer needed')).toBeNull();
  });

  it('read-only: never writes, but still names the missing answer', () => {
    state.responses = { i1: { id: 'r1', comment: 'noted on site', response: null } };
    renderSection(true);
    expect(commentBox()).toBeDisabled();
    fireEvent.blur(commentBox());
    expect(state.setResponse).not.toHaveBeenCalled();
    expect(screen.getByText('Answer needed')).toBeInTheDocument();
  });
});
