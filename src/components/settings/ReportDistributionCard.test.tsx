import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReportSchedule, RunResponse } from '@/hooks/useReportSchedules';

const state = vi.hoisted(() => ({
  flag: true,
  isAdminOrManager: true,
  schedules: [] as ReportSchedule[],
  isLoading: false,
  isError: false,
  runNow: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/hooks/useOrgSettings', () => ({
  useFeature: () => state.flag,
  useOrgSettings: () => ({ settings: { report_due_day: 7 }, isLoading: false, isError: false }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, isAdminOrManager: state.isAdminOrManager }) }));
vi.mock('@/hooks/useReportSchedules', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useReportSchedules')>()),
  useReportSchedules: () => ({
    schedules: state.schedules,
    isLoading: state.isLoading,
    isError: state.isError,
    create: state.create,
    update: state.update,
    remove: state.remove,
    runNow: state.runNow,
    isSaving: false,
    isRunning: false,
  }),
  useScheduleDistributions: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useBuildingNames', () => ({ useBuildingNames: () => ({ data: [] }) }));
vi.mock('@/hooks/useBuildings', () => ({ useBuildings: () => ({ buildings: [], loading: false, error: null, refetch: vi.fn(), deleteBuilding: vi.fn() }) }));
vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: vi.fn() }) }));
vi.mock('@/lib/myWork', () => ({ todayInOperatingTz: () => '2026-10-01', OPERATING_TZ: 'Africa/Johannesburg' }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { ReportDistributionCard } from './ReportDistributionCard';
import { countsLine, lastRunLabel } from '@/lib/reportSchedule';

const SCHEDULE: ReportSchedule = {
  id: 's1',
  report_type: 'ops_monthly',
  building_ids: null,
  recipients: [{ email: 'a@example.com' }, { user_id: '00000000-0000-0000-0000-000000000001', name: 'Ann' }],
  send_day: 7,
  remind_days_before: 3,
  is_active: true,
  created_by: 'u1',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  last_run_on: '2026-10-07',
  last_result: {
    ranAt: '2026-10-07T05:00:00Z',
    action: 'send',
    period: '2026-09-01',
    buildings: [
      { buildingId: 'b1', buildingName: 'Alpha', reportId: 'r1', status: 'sent', recipients: 2 },
      { buildingId: 'b2', buildingName: 'Beta', reportId: null, status: 'skipped_no_artifact', recipients: 2 },
    ],
  },
};

const DRY: RunResponse = {
  ok: true,
  dryRun: true,
  today: '2026-10-01',
  schedules: [{ scheduleId: 's1', action: 'send', period: '2026-09-01', buildings: [
    { buildingId: 'b1', buildingName: 'Alpha', reportId: 'r1', status: 'would_send', recipients: 2 },
    { buildingId: 'b2', buildingName: 'Beta', reportId: null, status: 'skipped_not_approved', recipients: 2 },
  ] }],
  counts: { sent: 1, skipped_no_artifact: 0, skipped_not_approved: 1, failed: 0, reminded: 0, already_sent: 0 },
};

beforeEach(() => {
  state.flag = true;
  state.isAdminOrManager = true;
  state.schedules = [SCHEDULE];
  state.isLoading = false;
  state.isError = false;
  state.runNow = vi.fn().mockResolvedValue(DRY);
  state.update = vi.fn().mockResolvedValue(undefined);
  state.remove = vi.fn().mockResolvedValue(undefined);
  toast.success.mockClear();
  toast.error.mockClear();
});

describe('ReportDistributionCard', () => {
  it('renders nothing while the report_schedules flag is off', () => {
    state.flag = false;
    const { container } = render(<ReportDistributionCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a non-admin/manager even with the flag on', () => {
    state.isAdminOrManager = false;
    const { container } = render(<ReportDistributionCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists a schedule with its type, scope, recipients, timing, next send and last run', () => {
    render(<ReportDistributionCard />);
    expect(screen.getByText('Monthly OPS Report')).toBeInTheDocument();
    expect(screen.getByText('All buildings · 2 recipients')).toBeInTheDocument();
    expect(screen.getByText('Sends on the 7th of the following month · reminder 3 days before')).toBeInTheDocument();
    expect(screen.getByText('Next send 7 Oct for September 2026')).toBeInTheDocument();
    expect(screen.getByText('Ran 7 Oct: 1 sent · 1 skipped')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Active: Monthly OPS Report' })).toBeChecked();
  });

  it('shows the empty state and the New schedule button when there are no schedules', () => {
    state.schedules = [];
    render(<ReportDistributionCard />);
    expect(screen.getByText(/No schedules yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New schedule' })).toBeInTheDocument();
  });

  it('says so when the schedules could not be loaded', () => {
    state.isError = true;
    state.schedules = [];
    render(<ReportDistributionCard />);
    expect(screen.getByText('Schedules could not be loaded')).toBeInTheDocument();
  });

  it('Preview run calls runNow with dryRun: true and shows the per-building outcome', async () => {
    render(<ReportDistributionCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview run' }));
    await waitFor(() => expect(state.runNow).toHaveBeenCalledWith({ scheduleId: 's1', dryRun: true }));
    expect(await screen.findByText('Preview · Monthly OPS Report · September 2026')).toBeInTheDocument();
    expect(screen.getByText('1 would send · 1 skipped: not approved')).toBeInTheDocument();
    expect(screen.getByText('Nothing was sent.')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Would send')).toBeInTheDocument();
    expect(screen.getByText('Skipped: not approved')).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('Send now asks first, names the period and recipient count, then runs for real', async () => {
    state.runNow = vi.fn().mockResolvedValue({ ...DRY, dryRun: false, counts: { sent: 1 } });
    render(<ReportDistributionCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    expect(state.runNow).not.toHaveBeenCalled();
    expect(await screen.findByText(/This emails the share links for September 2026 to 2 recipients now/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    await waitFor(() => expect(state.runNow).toHaveBeenCalledWith({ scheduleId: 's1', dryRun: false }));
    expect(await screen.findByText('Sent · Monthly OPS Report · September 2026')).toBeInTheDocument();
    expect(screen.getByText('1 sent')).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Distribution run finished.');
  });

  it('the Active switch updates is_active only', async () => {
    render(<ReportDistributionCard />);
    fireEvent.click(screen.getByRole('switch', { name: 'Active: Monthly OPS Report' }));
    await waitFor(() => expect(state.update).toHaveBeenCalledWith('s1', { is_active: false }));
  });

  it('a failed run surfaces the message as a toast', async () => {
    state.runNow = vi.fn().mockRejectedValue(new Error('forbidden'));
    render(<ReportDistributionCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview run' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('forbidden'));
  });

  it('Delete asks first, then removes', async () => {
    render(<ReportDistributionCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(state.remove).not.toHaveBeenCalled();
    expect(await screen.findByText('Delete this schedule?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(state.remove).toHaveBeenCalledWith('s1'));
  });
});

describe('countsLine', () => {
  it('drops zero counts and words a dry run as would-send', () => {
    expect(countsLine({ sent: 3, skipped_no_artifact: 0, failed: 1 }, true)).toBe('3 would send · 1 failed');
    expect(countsLine({ sent: 3, already_sent: 2 }, false)).toBe('3 sent · 2 already sent');
    expect(countsLine({ sent: 0 }, true)).toBe('Nothing to do');
  });
});

describe('lastRunLabel', () => {
  it('summarises a send, a reminder, and a run without a result', () => {
    expect(lastRunLabel(SCHEDULE)).toBe('Ran 7 Oct: 1 sent · 1 skipped');
    expect(lastRunLabel({ last_run_on: '2026-10-04', last_result: { ranAt: '', action: 'remind', period: '2026-09-01', buildings: [{ buildingId: 'b', buildingName: 'B', reportId: null, status: 'reminded', recipients: 0 }] } })).toBe('Reminded 4 Oct: 1 building');
    expect(lastRunLabel({ last_run_on: '2026-10-07', last_result: null })).toBe('Ran 7 Oct');
    expect(lastRunLabel({ last_run_on: null, last_result: null })).toBeNull();
  });
});
