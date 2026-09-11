import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { mockViewport } from '@/test/mobile';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from './responsive-dialog';

const renderDialog = (body: React.ReactNode = <p>Body</p>) =>
  render(
    <ResponsiveDialog open onOpenChange={() => {}}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Title</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Desc</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {body}
      </ResponsiveDialogContent>
    </ResponsiveDialog>,
  );

/** A desktop Dialog has role=dialog without vaul's marker; a sheet carries both. */
const desktopDialog = () => document.querySelector('[role="dialog"]:not([data-vaul-drawer])');

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

  it('decides phone vs desktop once per open: children mount once and a resize does not swap the tree', async () => {
    mockViewport(375);
    const mounted = vi.fn();
    function CountsMounts() {
      useEffect(() => {
        mounted();
      }, []);
      return <p>Body</p>;
    }
    renderDialog(<CountsMounts />);
    expect(await screen.findByText('Body')).toBeInTheDocument();
    expect(document.querySelector('[data-vaul-drawer]')).not.toBeNull();
    expect(mounted).toHaveBeenCalledTimes(1);

    // Grow the viewport while open; a real device fires matchMedia change + resize.
    await act(async () => {
      mockViewport(1024);
      window.dispatchEvent(new Event('resize'));
    });

    expect(document.querySelector('[data-vaul-drawer]')).not.toBeNull();
    expect(desktopDialog()).toBeNull();
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it('gives the sheet a close button and a footer whose buttons are full width and 44px tall', async () => {
    mockViewport(375);
    renderDialog(
      <ResponsiveDialogFooter>
        <button type="button">Cancel</button>
        <button type="submit">Save</button>
      </ResponsiveDialogFooter>,
    );
    expect(await screen.findByRole('button', { name: 'Close' })).toBeInTheDocument();
    const footer = screen.getByRole('button', { name: 'Save' }).parentElement!;
    expect(footer.className).toContain('flex-col-reverse');
    expect(footer.className).toContain('[&>button]:h-11');
  });

  it('keeps the sheet height and single scroll region even when a call site passes desktop overflow classes', async () => {
    mockViewport(375);
    render(
      <ResponsiveDialog open onOpenChange={() => {}}>
        <ResponsiveDialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <ResponsiveDialogTitle>Title</ResponsiveDialogTitle>
          <p>Body</p>
        </ResponsiveDialogContent>
      </ResponsiveDialog>,
    );
    await screen.findByText('Title');
    const sheet = document.querySelector('[data-vaul-drawer]') as HTMLElement;
    expect(sheet.className).toContain('max-h-[92dvh]');
    expect(sheet.className).not.toContain('max-h-[90vh]');
    expect(sheet.className).toContain('overflow-hidden');
    expect(sheet.className).not.toContain('overflow-y-auto');
    expect(sheet.querySelectorAll('.overflow-y-auto')).toHaveLength(1);
  });

  it('drops a call-site max-width so the sheet spans 512–767 px viewports instead of anchoring left', async () => {
    mockViewport(600);
    render(
      <ResponsiveDialog open onOpenChange={() => {}}>
        <ResponsiveDialogContent className="max-w-md">
          <ResponsiveDialogTitle>Title</ResponsiveDialogTitle>
          <p>Body</p>
        </ResponsiveDialogContent>
      </ResponsiveDialog>,
    );
    await screen.findByText('Title');
    const sheet = document.querySelector('[data-vaul-drawer]') as HTMLElement;
    expect(sheet.className).toContain('max-w-none');
    expect(sheet.className).not.toContain('max-w-md');
  });

  it('renders a nested sheet inside an open sheet on phones', async () => {
    mockViewport(375);
    render(
      <ResponsiveDialog open onOpenChange={() => {}}>
        <ResponsiveDialogContent>
          <ResponsiveDialogTitle>Outer</ResponsiveDialogTitle>
          <ResponsiveDialog nested open onOpenChange={() => {}}>
            <ResponsiveDialogContent>
              <ResponsiveDialogTitle>Inner</ResponsiveDialogTitle>
            </ResponsiveDialogContent>
          </ResponsiveDialog>
        </ResponsiveDialogContent>
      </ResponsiveDialog>,
    );
    expect(await screen.findByText('Outer')).toBeInTheDocument();
    expect(await screen.findByText('Inner')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-vaul-drawer]')).toHaveLength(2);
    expect(desktopDialog()).toBeNull();
  });
});
