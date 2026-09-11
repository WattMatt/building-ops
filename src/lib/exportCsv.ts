/**
 * One CSV exporter for the app (spec §8 "Costs"): assets, tenants, PPM plan, cost rollups.
 *
 * - RFC 4180: a cell is wrapped in double quotes when it contains a quote, a comma, or a
 *   line break; embedded quotes are doubled. Every cell is otherwise written verbatim.
 * - UTF-8 BOM so Excel opens accented text correctly; CRLF row endings (RFC 4180 §2.1).
 * - Download goes through a Blob + object URL + anchor click — the same path the XLSX
 *   writers used, which works inside the PWA sandbox where `navigator.msSaveBlob` and
 *   `data:` links do not.
 */

import { formatSlaInstant } from './slaState';

/** A column that reads one property; `format` may still rewrite what that property produces. */
export interface CsvKeyedColumn<Row> {
  /** Property read from each row when `format` is not given. */
  key: keyof Row & string;
  /** Header cell text. */
  header: string;
  /** Turns the raw value into the cell text; receives the whole row for derived columns. */
  format?: (value: Row[keyof Row & string], row: Row) => string;
}

/**
 * A column with no property behind it \u2014 its text is derived from the whole row (an SLA due
 * date, a month in a PPM grid). `key` is deliberately absent: several of these used to repeat
 * one arbitrary key, which read as a lie and only worked because `format` ignores the value.
 */
export interface CsvComputedColumn<Row> {
  key?: never;
  header: string;
  format: (value: undefined, row: Row) => string;
}

export type CsvColumn<Row> = CsvKeyedColumn<Row> | CsvComputedColumn<Row>;

const BOM = '\uFEFF';
const CRLF = '\r\n';

/** Cell text for a value that may be null/empty \u2014 the default for optional string columns. */
export const csvText = (value: unknown): string => (value == null || value === '' ? '' : String(value));

/**
 * Cell text for an INSTANT (a timestamptz), through the one wall-clock formatter the app uses.
 * A raw ISO string lands in Excel as text, not a date, so no instant column may skip this.
 */
export const csvInstant = (value: unknown): string => {
  if (typeof value !== 'string' || !value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : formatSlaInstant(d);
};

/** Quotes a single cell per RFC 4180; `null`/`undefined` become an empty cell. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Builds the CSV text (with BOM and CRLF endings) without downloading it. */
export function toCsv<Row>(rows: readonly Row[], columns: readonly CsvColumn<Row>[]): string {
  const header = columns.map((c) => csvCell(c.header)).join(',');
  const body = rows.map((row) =>
    columns
      .map((c) => {
        const raw = c.key === undefined ? undefined : row[c.key];
        const format = c.format as ((value: unknown, row: Row) => string) | undefined;
        return csvCell(format ? format(raw, row) : raw);
      })
      .join(','),
  );
  return BOM + [header, ...body].join(CRLF) + CRLF;
}

/**
 * Blob → file on disk: object URL + anchor click, the one download path the app uses. It is
 * here rather than in each exporter because `navigator.msSaveBlob` and `data:` links do not
 * work inside the PWA sandbox, so every writer (CSV, PDF, evidence-pack zip) needs this one.
 */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Downloads `rows` as `filename` (".csv" is appended when missing). */
export function exportCsv<Row>(rows: readonly Row[], columns: readonly CsvColumn<Row>[], filename: string): void {
  const csv = toCsv(rows, columns);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`);
}
