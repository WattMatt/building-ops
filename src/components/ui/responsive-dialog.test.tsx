import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { mockViewport } from '@/test/mobile';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from './responsive-dialog';

const renderDialog = () =>
  render(
    <ResponsiveDialog open onOpenChange={() => {}}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Title</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Desc</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <p>Body</p>
      </ResponsiveDialogContent>
    </ResponsiveDialog>,
  );

describe('ResponsiveDialog', () => {
  afterEach(() => mockViewport(1024));

  it('renders a vaul bottom sheet on phones', async () => {
    mockViewport(375);
    renderDialog();
    expect(await screen.findByText('Title')).toBeInTheDocument();
    expect(document.querySelector('[data-vaul-drawer]')).not.toBeNull();
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('renders a centred dialog on desktop', async () => {
    mockViewport(1024);
    renderDialog();
    expect(await screen.findByText('Title')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.querySelector('[data-vaul-drawer]')).toBeNull();
  });
});
