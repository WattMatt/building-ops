import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { csvCell, toCsv, exportCsv, type CsvColumn } from './exportCsv';

interface Row { name: string; amount: number | null; note: string | null }

const columns: CsvColumn<Row>[] = [
  { key: 'name', header: 'Name' },
  { key: 'amount', header: 'Amount (R)', format: (v) => (v === null ? '' : `R ${v}`) },
  { key: 'note', header: 'Note' },
];

describe('csvCell', () => {
  it('leaves plain text alone and blanks null/undefined', () => {
    expect(csvCell('hello')).toBe('hello');
    expect(csvCell(12)).toBe('12');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes commas, quotes and line breaks and doubles embedded quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });
});

describe('toCsv', () => {
  it('starts with a UTF-8 BOM, uses CRLF endings and a trailing newline', () => {
    const csv = toCsv([{ name: 'Lift', amount: 10, note: null }], columns);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toBe('\uFEFFName,Amount (R),Note\r\nLift,R 10,\r\n');
  });

  it('applies the column format and quotes cells that need it', () => {
    const csv = toCsv(
      [
        { name: 'Pump, main', amount: null, note: 'He said "done"' },
        { name: 'Boiler', amount: 1234.5, note: 'two\nlines' },
      ],
      columns,
    );
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('Name,Amount (R),Note');
    expect(lines[1]).toBe('"Pump, main",,"He said ""done"""');
    // The embedded newline is inside quotes, so it must not split the row.
    expect(csv).toContain('Boiler,R 1234.5,"two\nlines"\r\n');
  });

  it('passes the whole row to format for derived columns', () => {
    const derived: CsvColumn<Row>[] = [{ key: 'name', header: 'Label', format: (_v, row) => `${row.name}:${row.amount ?? 0}` }];
    expect(toCsv([{ name: 'x', amount: 3, note: null }], derived)).toBe('\uFEFFLabel\r\nx:3\r\n');
  });

  it('writes only the header for an empty row set', () => {
    expect(toCsv([], columns)).toBe('\uFEFFName,Amount (R),Note\r\n');
  });
});

// jsdom's Blob lacks arrayBuffer()/text(); FileReader is the portable way to read it back.
// Bytes, not text: readAsText would strip the very BOM the test is checking for.
const readBlob = (blob: Blob) =>
  new Promise<Uint8Array>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });

describe('exportCsv', () => {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:fake');
  const revokeObjectURL = vi.fn();
  let click: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // jsdom has no object URLs; stub them so the download path can be observed.
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL });
    click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  afterEach(() => {
    click.mockRestore();
  });

  it('builds a text/csv blob, clicks a download anchor and revokes the URL', async () => {
    exportCsv([{ name: 'Lift', amount: 10, note: null }], columns, 'assets_export');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe('text/csv;charset=utf-8');
    const bytes = await readBlob(blob);
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe('Name,Amount (R),Note\r\nLift,R 10,\r\n');

    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('assets_export.csv');
    expect(anchor.href).toBe('blob:fake');
    // The anchor is removed again so repeated exports don't litter the DOM.
    expect(document.body.querySelector('a[download]')).toBeNull();

    // Revocation is deferred a tick so the browser can start the download first.
    await new Promise((r) => setTimeout(r, 10));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('keeps an explicit .csv extension', () => {
    exportCsv([], columns, 'Tenants.CSV');
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('Tenants.CSV');
  });
});
