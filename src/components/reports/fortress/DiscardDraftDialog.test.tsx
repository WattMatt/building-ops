import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DiscardDraftDialog } from './DiscardDraftDialog';

describe('DiscardDraftDialog', () => {
  it('renders nothing while closed', () => {
    render(<DiscardDraftDialog open={false} onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  it('states the rule and confirms with a destructive action', async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(<DiscardDraftDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} />);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Discard this draft?');
    expect(dialog).toHaveTextContent('Only a draft with no saved content can be discarded.');
    const action = screen.getByRole('button', { name: 'Discard draft' });
    expect(action.className).toContain('bg-destructive');
    expect(action.className).toContain('min-h-11');
    expect(screen.getByRole('button', { name: 'Cancel' }).className).toContain('min-h-11');
    fireEvent.click(action);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
  it('Cancel closes without confirming', async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(<DiscardDraftDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} />);
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onConfirm).not.toHaveBeenCalled();
  });
  it('disables the action while a discard is in flight', async () => {
    render(<DiscardDraftDialog open pending onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    await screen.findByRole('alertdialog');
    expect(screen.getByRole('button', { name: 'Discard draft' })).toBeDisabled();
  });
});
