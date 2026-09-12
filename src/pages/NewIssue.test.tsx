import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { mockViewport } from '@/test/mobile';

const enqueueAndRun = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/offline/enqueueAndRun', () => ({ enqueueAndRun }));
vi.mock('sonner', () => ({ toast }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
const auth = vi.hoisted(() => ({ value: { user: { id: 'u1' }, isAdminOrManager: false } as { user: { id: string }; isAdminOrManager: boolean } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.value }));
const bld = vi.hoisted(() => ({
  value: [{ id: 'b1', name: 'North Tower' }] as { id: string; name: string }[],
  loading: false,
}));
vi.mock('@/hooks/useBuildings', () => ({
  useBuildings: () => ({ buildings: bld.value, loading: bld.loading }),
}));
vi.mock('@/components/ui/photo-capture', () => ({
  PhotoCapture: ({ photos }: { photos: unknown[] }) => <div data-testid="photo-capture">{photos.length}</div>,
}));
const draft = vi.hoisted(() => ({
  restored: null as null | { title: string; description: string; buildingId: string; priority: 'low' | 'medium' | 'high' | 'critical'; photos: File[]; savedAt: number },
  ready: true,
  save: vi.fn(),
  clear: vi.fn(),
}));
vi.mock('@/hooks/useIssueDraft', () => ({ useIssueDraft: () => draft }));
const hints = vi.hoisted(() => ({ enabled: true }));
vi.mock('@/hooks/useHints', () => ({
  useHints: () => ({ hintsEnabled: hints.enabled, setHintsEnabled: vi.fn() }),
}));
// jsdom has no object URLs; restoring a draft recreates previews through them.
const createObjectURL = vi.hoisted(() => vi.fn((_file: Blob) => 'blob:fake'));
const revokeObjectURL = vi.hoisted(() => vi.fn());
Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL });
Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL });

import NewIssue from './NewIssue';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const renderAt = (path = '/issues/new') =>
  render(<MemoryRouter initialEntries={[path]}><NewIssue /></MemoryRouter>);

const two = [{ id: 'b1', name: 'North Tower' }, { id: 'b2', name: 'South Wing' }];

const submit = async () => {
  fireEvent.change(screen.getByLabelText(/issue title/i), { target: { value: ' Lift out of service ' } });
  fireEvent.change(screen.getByLabelText(/^description/i), { target: { value: 'Lift 2 stuck on ground floor.' } });
  fireEvent.click(screen.getByRole('button', { name: /report issue/i }));
  await waitFor(() => expect(enqueueAndRun).toHaveBeenCalledTimes(1));
};

describe('NewIssue', () => {
  beforeEach(() => {
    enqueueAndRun.mockReset().mockResolvedValue({ status: 'synced', result: {} });
    navigate.mockClear();
    auth.value = { user: { id: 'u1' }, isAdminOrManager: false };
    bld.value = [{ id: 'b1', name: 'North Tower' }];
    bld.loading = false;
    window.localStorage.clear();
    draft.restored = null;
    draft.ready = true;
    draft.save.mockClear();
    draft.clear.mockClear();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    toast.mockClear(); toast.success.mockClear(); toast.error.mockClear();
  });

  afterEach(() => { mockViewport(1024); hints.enabled = true; });

  it('queues an issue_create op with a client-generated issue id and goes to the list', async () => {
    render(<MemoryRouter><NewIssue /></MemoryRouter>);
    await submit();
    const [uid, payload, photos] = enqueueAndRun.mock.calls[0];
    expect(uid).toBe('u1');
    expect(payload).toMatchObject({
      kind: 'issue_create',
      row: {
        title: 'Lift out of service', description: 'Lift 2 stuck on ground floor.', priority: 'medium', status: 'open',
        building_id: 'b1', deadline: null, corrective_action: null, reported_by: 'u1', assigned_to: null, task_instance_id: null,
      },
      markTaskIssueLogged: null,
    });
    expect(payload.issueId).toMatch(UUID);
    expect(photos).toEqual([]);
    expect(toast.success).toHaveBeenCalledWith('Issue reported successfully');
    expect(navigate).toHaveBeenCalledWith('/issues');
  });

  describe('estimated cost', () => {
    it('is not offered to a plain user and is omitted from the row', async () => {
      render(<MemoryRouter><NewIssue /></MemoryRouter>);
      expect(screen.queryByLabelText(/estimated cost/i)).toBeNull();
      await submit();
      const [, payload] = enqueueAndRun.mock.calls[0];
      expect('estimated_cost' in payload.row).toBe(false);
    });

    it('is written as estimated_cost for a manager, and null when left blank', async () => {
      auth.value = { user: { id: 'u1' }, isAdminOrManager: true };
      const { unmount } = render(<MemoryRouter><NewIssue /></MemoryRouter>);
      fireEvent.change(screen.getByLabelText(/estimated cost/i), { target: { value: '1500.50' } });
      await submit();
      expect(enqueueAndRun.mock.calls[0][1].row.estimated_cost).toBe(1500.5);
      unmount();

      enqueueAndRun.mockReset().mockResolvedValue({ status: 'synced', result: {} });
      render(<MemoryRouter><NewIssue /></MemoryRouter>);
      await submit();
      expect(enqueueAndRun.mock.calls[0][1].row).toHaveProperty('estimated_cost', null);
    });

    it('rejects a negative estimate before anything is queued', async () => {
      auth.value = { user: { id: 'u1' }, isAdminOrManager: true };
      render(<MemoryRouter><NewIssue /></MemoryRouter>);
      fireEvent.change(screen.getByLabelText(/issue title/i), { target: { value: 'Broken door' } });
      fireEvent.change(screen.getByLabelText(/^description/i), { target: { value: 'Hinge snapped.' } });
      const cost = screen.getByLabelText(/estimated cost/i) as HTMLInputElement;
      fireEvent.change(cost, { target: { value: '-5' } });
      fireEvent.click(screen.getByRole('button', { name: /report issue/i }));
      // min={0} makes the browser refuse the submit (jsdom runs the same constraint validation);
      // parseCost in handleSubmit is the backstop for anything that slips past it.
      expect(cost.validity.rangeUnderflow).toBe(true);
      await new Promise((r) => setTimeout(r, 0));
      expect(enqueueAndRun).not.toHaveBeenCalled();
    });
  });

  it('still goes to the list when the issue is queued, and stays put when it is rejected', async () => {
    enqueueAndRun.mockResolvedValueOnce({ status: 'queued' });
    const { unmount } = render(<MemoryRouter><NewIssue /></MemoryRouter>);
    await submit();
    expect(toast).toHaveBeenCalledWith("Issue saved on this device — it will be reported when you're back online");
    expect(navigate).toHaveBeenCalledWith('/issues');
    unmount();

    enqueueAndRun.mockReset().mockResolvedValueOnce({ status: 'failed', error: 'new row violates row-level security policy' });
    navigate.mockClear();
    render(<MemoryRouter><NewIssue /></MemoryRouter>);
    await submit();
    expect(toast.error).toHaveBeenCalledWith('new row violates row-level security policy');
    expect(navigate).not.toHaveBeenCalled();
  });

  describe('building precedence (spec §8)', () => {
    it('?building= wins over the last-used building', async () => {
      bld.value = two;
      window.localStorage.setItem('fortress.lastBuilding.u1', 'b1');
      renderAt('/issues/new?building=b2');
      await submit();
      expect(enqueueAndRun.mock.calls[0][1].row.building_id).toBe('b2');
    });

    it('a single building is pre-selected', async () => {
      window.localStorage.setItem('fortress.lastBuilding.u1', 'b9');
      renderAt();
      await submit();
      expect(enqueueAndRun.mock.calls[0][1].row.building_id).toBe('b1');
    });

    it('falls back to the last-used building when there are several', async () => {
      bld.value = two;
      window.localStorage.setItem('fortress.lastBuilding.u1', 'b2');
      renderAt();
      await submit();
      expect(enqueueAndRun.mock.calls[0][1].row.building_id).toBe('b2');
    });

    it('ignores a last-used building the user can no longer access', async () => {
      bld.value = two;
      window.localStorage.setItem('fortress.lastBuilding.u1', 'b9');
      renderAt();
      fireEvent.change(screen.getByLabelText(/issue title/i), { target: { value: 'Broken door' } });
      fireEvent.change(screen.getByLabelText(/^description/i), { target: { value: 'Hinge snapped.' } });
      fireEvent.click(screen.getByRole('button', { name: /report issue/i }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Please select a building'));
      expect(enqueueAndRun).not.toHaveBeenCalled();
    });

    it('stays empty when nothing decides', async () => {
      bld.value = two;
      renderAt();
      fireEvent.change(screen.getByLabelText(/issue title/i), { target: { value: 'Broken door' } });
      fireEvent.change(screen.getByLabelText(/^description/i), { target: { value: 'Hinge snapped.' } });
      fireEvent.click(screen.getByRole('button', { name: /report issue/i }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Please select a building'));
      expect(enqueueAndRun).not.toHaveBeenCalled();
    });

    it('remembers the building after a synced submit and after a queued one', async () => {
      const { unmount } = renderAt();
      await submit();
      expect(window.localStorage.getItem('fortress.lastBuilding.u1')).toBe('b1');
      unmount();

      window.localStorage.clear();
      enqueueAndRun.mockReset().mockResolvedValueOnce({ status: 'queued' });
      renderAt();
      await submit();
      expect(window.localStorage.getItem('fortress.lastBuilding.u1')).toBe('b1');
    });

    it('does not remember the building when the submit is rejected', async () => {
      enqueueAndRun.mockReset().mockResolvedValueOnce({ status: 'failed', error: 'permission denied' });
      renderAt();
      await submit();
      expect(window.localStorage.getItem('fortress.lastBuilding.u1')).toBeNull();
    });
  });

  describe('draft (spec §8)', () => {
    const photo = new File(['x'], 'fault.jpg', { type: 'image/jpeg' });
    const stored = { title: 'Lift', description: 'Stuck on 3', buildingId: 'b2', priority: 'high' as const, photos: [photo], savedAt: 1 };

    it('restores the fields and photos and shows the guardrail bar', async () => {
      bld.value = two;
      draft.restored = stored;
      renderAt();
      expect(screen.getByLabelText(/issue title/i)).toHaveValue('Lift');
      expect(screen.getByLabelText(/^description/i)).toHaveValue('Stuck on 3');
      expect(screen.getByTestId('photo-capture')).toHaveTextContent('1');
      expect(createObjectURL).toHaveBeenCalledWith(photo);
      expect(screen.getByRole('status')).toHaveTextContent('Draft restored');
      fireEvent.click(screen.getByRole('button', { name: /report issue/i }));
      await waitFor(() => expect(enqueueAndRun).toHaveBeenCalledTimes(1));
      const [, payload, photos] = enqueueAndRun.mock.calls[0];
      expect(payload.row).toMatchObject({ title: 'Lift', description: 'Stuck on 3', building_id: 'b2', priority: 'high' });
      expect(photos).toEqual([{ file: photo }]);
    });

    it('a draft without a building leaves the precedence choice alone', async () => {
      draft.restored = { ...stored, buildingId: '' };
      renderAt();
      fireEvent.click(screen.getByRole('button', { name: /report issue/i }));
      await waitFor(() => expect(enqueueAndRun).toHaveBeenCalledTimes(1));
      expect(enqueueAndRun.mock.calls[0][1].row.building_id).toBe('b1');
    });

    it('does not restore or show the bar while the store is still being read', () => {
      draft.restored = stored;
      draft.ready = false;
      renderAt();
      expect(screen.getByLabelText(/issue title/i)).toHaveValue('');
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('saves on every change once ready', async () => {
      renderAt();
      fireEvent.change(screen.getByLabelText(/issue title/i), { target: { value: 'Broken door' } });
      await waitFor(() => expect(draft.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ title: 'Broken door', description: '', buildingId: 'b1', priority: 'medium', photos: [] }),
      ));
      expect(draft.clear).not.toHaveBeenCalled();
    });

    it('an empty form is never saved as a draft', async () => {
      renderAt();
      await new Promise((r) => setTimeout(r, 0));
      expect(draft.save).not.toHaveBeenCalled();
    });

    it('Discard empties the form, revokes the previews and clears the store', async () => {
      bld.value = two;
      draft.restored = stored;
      renderAt();
      // The restore itself is content, so the page has already saved it once; Discard must
      // not save again.
      const savesBefore = draft.save.mock.calls.length;
      fireEvent.click(screen.getByRole('button', { name: /discard/i }));
      expect(screen.getByLabelText(/issue title/i)).toHaveValue('');
      expect(screen.getByLabelText(/^description/i)).toHaveValue('');
      expect(screen.getByTestId('photo-capture')).toHaveTextContent('0');
      expect(screen.queryByRole('status')).toBeNull();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
      expect(draft.clear).toHaveBeenCalledTimes(1);
      await new Promise((r) => setTimeout(r, 0));
      expect(draft.save).toHaveBeenCalledTimes(savesBefore);
    });

    it('a successful or queued submit clears the draft; a rejected one keeps it', async () => {
      const first = renderAt();
      await submit();
      expect(draft.clear).toHaveBeenCalledTimes(1);
      expect(draft.clear.mock.invocationCallOrder[0]).toBeGreaterThan(enqueueAndRun.mock.invocationCallOrder[0]);
      first.unmount();

      draft.clear.mockClear();
      enqueueAndRun.mockReset().mockResolvedValueOnce({ status: 'queued' });
      const second = renderAt();
      await submit();
      expect(draft.clear).toHaveBeenCalledTimes(1);
      second.unmount();

      draft.clear.mockClear();
      enqueueAndRun.mockReset().mockResolvedValueOnce({ status: 'failed', error: 'permission denied' });
      renderAt();
      await submit();
      expect(draft.clear).not.toHaveBeenCalled();
    });
  });

  describe('phone layout (spec §8)', () => {
    // jsdom has no layout engine: every scrollWidth/clientWidth is 0 and Tailwind's CSS is not
    // compiled into the test DOM, so "scrollWidth <= 375" would pass vacuously. What the test
    // CAN observe is the decision the page makes from the viewport — the class list — so that
    // is what it asserts. The real no-horizontal-scroll check is the browser step in Task 6.
    it('pins the action bar to the bottom on a phone and leaves it inline on a desktop', () => {
      mockViewport(375);
      const { unmount } = renderAt();
      const bar = screen.getByTestId('issue-actions');
      expect(bar.className).toMatch(/\bfixed\b/);
      expect(bar.className).toMatch(/safe-area-inset-bottom/);
      expect(bar.className).toMatch(/\bbottom-0\b/);
      unmount();

      mockViewport(1024);
      renderAt();
      expect(screen.getByTestId('issue-actions').className).not.toMatch(/\bfixed\b/);
    });

    it('puts the photo control directly under the building select, before the title', () => {
      renderAt();
      const building = screen.getByLabelText(/building/i);
      const photos = screen.getByTestId('photo-capture');
      const title = screen.getByLabelText(/issue title/i);
      expect(building.compareDocumentPosition(photos) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(photos.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('gives every control a 44 px minimum below sm', () => {
      auth.value = { user: { id: 'u1' }, isAdminOrManager: true };
      renderAt();
      for (const el of [
        screen.getByLabelText(/building/i),
        screen.getByLabelText(/issue title/i),
        screen.getByLabelText(/priority/i),
        screen.getByLabelText(/resolution deadline/i),
        screen.getByLabelText(/estimated cost/i),
        screen.getByRole('button', { name: /report issue/i }),
        screen.getByRole('button', { name: /cancel/i }),
      ]) {
        expect(el.className).toMatch(/\bmin-h-11\b/);
      }
    });

    it('routes the photo coaching line through the hints toggle', () => {
      const line = 'One clear photo of the fault is worth more than a paragraph.';
      const { unmount } = renderAt();
      expect(screen.getByText(line)).toBeInTheDocument();
      unmount();
      hints.enabled = false;
      renderAt();
      expect(screen.queryByText(line)).toBeNull();
    });
  });
});
