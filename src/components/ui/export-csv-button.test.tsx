/**
 * The one export button: the disabled rule, the filename shape and the two toasts now live in
 * exactly one place, so they are asserted in exactly one place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const exportCsv = vi.hoisted(() => vi.fn());
vi.mock('@/lib/exportCsv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/exportCsv')>()),
  exportCsv,
}));

import { ExportCsvButton, csvFileName } from './export-csv-button';
import type { CsvColumn } from '@/lib/exportCsv';

interface Row { name: string }
const columns: CsvColumn<Row>[] = [{ key: 'name', header: 'Name' }];
const rows: Row[] = [{ name: 'Lift' }, { name: 'Pump' }];

beforeEach(() => {
  exportCsv.mockClear();
  toast.error.mockClear();
  toast.success.mockClear();
});

describe('csvFileName', () => {
  it('appends the date and the extension to a base name', () => {
    expect(csvFileName('assets', '2026-09-11')).toBe('assets_2026-09-11.csv');
  });

  it('makes anything the caller interpolates filename-safe', () => {
    expect(csvFileName('service-history-Main HVAC Unit #2', '2026-09-11')).toBe('service-history-main-hvac-unit-2_2026-09-11.csv');
    expect(csvFileName('', '2026-09-11')).toBe('export_2026-09-11.csv');
  });
});

describe('ExportCsvButton', () => {
  it('exports the rows it was given and says how many', () => {
    render(<ExportCsvButton rows={rows} columns={columns} filename="assets" />);
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));

    expect(exportCsv).toHaveBeenCalledTimes(1);
    const [gotRows, gotColumns, filename] = exportCsv.mock.calls[0];
    expect(gotRows).toBe(rows);
    expect(gotColumns).toBe(columns);
    expect(filename).toMatch(/^assets_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(toast.success).toHaveBeenCalledWith('Exported 2 rows');
  });

  it('says "1 row" for a single row', () => {
    render(<ExportCsvButton rows={[rows[0]]} columns={columns} filename="assets" />);
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    expect(toast.success).toHaveBeenCalledWith('Exported 1 row');
  });

  it('is disabled with nothing to export, and with an explicit disabled', () => {
    const { unmount } = render(<ExportCsvButton rows={[]} columns={columns} filename="assets" />);
    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeDisabled();
    unmount();

    render(<ExportCsvButton rows={rows} columns={columns} filename="assets" disabled />);
    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeDisabled();
  });

  it('a blocked export stays ENABLED and explains itself instead of exporting', () => {
    render(<ExportCsvButton rows={[]} columns={columns} filename="grid" blockedReason="Save first — Save is at the bottom of this card." />);
    const button = screen.getByRole('button', { name: /Export CSV/ });
    expect(button).not.toBeDisabled();

    fireEvent.click(button);
    expect(exportCsv).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Save first — Save is at the bottom of this card.');
  });

  it('takes a custom label', () => {
    render(<ExportCsvButton rows={rows} columns={columns} filename="ppm-grid" label="Export grid CSV" />);
    expect(screen.getByRole('button', { name: /Export grid CSV/ })).toBeInTheDocument();
  });
});
