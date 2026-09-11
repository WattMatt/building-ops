import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SubscribeCard } from './SubscribeCard';

const hook = vi.hoisted(() => ({
  url: null as string | null,
  isLoading: false,
  isError: false,
  isMutating: false,
  create: vi.fn(async () => {}),
  rotate: vi.fn(async () => {}),
  revoke: vi.fn(async () => {}),
  /** Arguments the card passed to useCalendarToken on its last render. */
  args: [] as unknown[],
}));

vi.mock('@/lib/calendarTokens', async (orig) => ({
  ...(await orig<typeof import('@/lib/calendarTokens')>()),
  useCalendarToken: (...a: unknown[]) => { hook.args = a; return hook; },
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});

const URL = 'https://x.supabase.co/functions/v1/ics-feed?t=abc';

describe('SubscribeCard', () => {
  beforeEach(() => {
    hook.url = null;
    hook.isLoading = false;
    hook.isError = false;
    hook.isMutating = false;
    hook.create.mockClear();
    hook.rotate.mockClear();
    hook.revoke.mockClear();
    toast.success.mockClear();
    toast.error.mockClear();
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  });

  it('offers to create a link when there is none, and creates on tap', async () => {
    render(<SubscribeCard buildingId={null} />);
    expect(hook.args).toEqual([null, 'My calendar']);
    expect(screen.getByText(/Nothing is shared until you create one/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Subscription link')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Create subscription link' }));
    await waitFor(() => expect(hook.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Subscription link created'));
  });

  it('labels a building token with the building name', () => {
    render(<SubscribeCard buildingId="b1" buildingName="Alpha House" />);
    expect(hook.args).toEqual(['b1', 'Building · Alpha House']);
    expect(screen.getByText(/every dated item for Alpha House/)).toBeInTheDocument();
  });

  it('shows the loading and error states', () => {
    hook.isLoading = true;
    const { unmount } = render(<SubscribeCard buildingId={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking for a subscription link');
    unmount();

    hook.isLoading = false;
    hook.isError = true;
    render(<SubscribeCard buildingId={null} />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load your subscription link");
  });

  it('with a token, shows the URL read-only with the disclosure and the coaching hint', () => {
    hook.url = URL;
    render(<SubscribeCard buildingId={null} />);
    const input = screen.getByLabelText('Subscription link') as HTMLInputElement;
    expect(input.value).toBe(URL);
    expect(input).toHaveAttribute('readonly');
    expect(screen.getByText('Anyone with this link can read your calendar titles. Rotate it if it leaks.')).toBeInTheDocument();
    expect(screen.getByText(/Paste it into Outlook or Google Calendar as a subscription/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create subscription link' })).toBeNull();
  });

  it('Copy writes the https URL; the webcal variant swaps the scheme', async () => {
    hook.url = URL;
    render(<SubscribeCard buildingId={null} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Link copied'));

    fireEvent.click(screen.getByRole('button', { name: 'Copy as webcal://' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('webcal://x.supabase.co/functions/v1/ics-feed?t=abc'));
  });

  it('tells the user when the clipboard is unavailable', async () => {
    hook.url = URL;
    writeText.mockRejectedValueOnce(new Error('denied'));
    render(<SubscribeCard buildingId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't copy. Select the link and copy it yourself."));
  });

  it('Rotate asks first, and only the confirm calls rotate', async () => {
    hook.url = URL;
    render(<SubscribeCard buildingId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Rotate this link?');
    expect(hook.rotate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(hook.rotate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rotate link' }));
    await waitFor(() => expect(hook.rotate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('New link ready'));
  });

  it('Turn off asks first, then calls revoke', async () => {
    hook.url = URL;
    render(<SubscribeCard buildingId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Turn off this subscription?');
    expect(hook.revoke).not.toHaveBeenCalled();

    // The confirm button shares its label with the trigger; pick the one inside the dialog.
    const confirm = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Turn off')!;
    fireEvent.click(confirm);
    await waitFor(() => expect(hook.revoke).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Subscription turned off'));
  });

  it('surfaces a failed write as an error toast with the reason', async () => {
    hook.url = URL;
    hook.rotate.mockRejectedValueOnce(new Error("You don't have permission to manage this calendar link."));
    render(<SubscribeCard buildingId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rotate link' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You don't have permission to manage this calendar link."));
  });

  it('disables the action buttons while a write is in flight', () => {
    hook.url = URL;
    hook.isMutating = true;
    render(<SubscribeCard buildingId={null} />);
    expect(screen.getByRole('button', { name: 'Rotate' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeDisabled();
  });
});
