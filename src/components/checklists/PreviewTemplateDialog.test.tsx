import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TemplatePreviewBody, type PreviewItem, type PreviewTemplate } from './PreviewTemplateDialog';

const template: PreviewTemplate = { id: 't1', name: 'Daily Fire Safety', frequency: 'daily' };
const items: PreviewItem[] = [
  { id: 'i2', task_name: 'Check extinguishers', task_description: 'All floors', responsible_party: 'Security', requires_photo: true, requires_signature: false, display_order: 2 },
  { id: 'i1', task_name: 'Test alarm panel', task_description: null, responsible_party: null, requires_photo: false, requires_signature: true, display_order: 1 },
];

describe('TemplatePreviewBody', () => {
  it('renders every task, ordered by display_order', () => {
    render(<TemplatePreviewBody template={template} items={items} />);
    const alarm = screen.getByText(/Test alarm panel/);
    const ext = screen.getByText(/Check extinguishers/);
    expect(alarm).toBeInTheDocument();
    expect(ext).toBeInTheDocument();
    expect(alarm.compareDocumentPosition(ext) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows photo and signature requirement badges', () => {
    render(<TemplatePreviewBody template={template} items={items} />);
    expect(screen.getByText('Photo')).toBeInTheDocument();
    expect(screen.getByText('Signature')).toBeInTheDocument();
  });

  it('is read-only — no action buttons', () => {
    render(<TemplatePreviewBody template={template} items={items} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows an empty state when the template has no tasks', () => {
    render(<TemplatePreviewBody template={template} items={[]} />);
    expect(screen.getByText(/no tasks yet/i)).toBeInTheDocument();
  });
});
