import { describe, it, expect, vi, afterEach } from 'vitest';
import { intakeSheetHtml, openPrintWindow } from './intakeSheet';

const input = {
  buildingName: 'North <Tower> & Co',
  orgName: 'Watson "Mattheus"',
  url: 'https://app.example.com/intake/abc',
  qrDataUrl: 'data:image/png;base64,QQ==',
};

describe('intakeSheetHtml', () => {
  const html = intakeSheetHtml(input);

  it('escapes the building and org names rather than letting them inject markup', () => {
    expect(html).toContain('North &lt;Tower&gt; &amp; Co');
    expect(html).not.toContain('<Tower>');
    expect(html).toContain('Watson &quot;Mattheus&quot;');
  });

  it('embeds the QR image and the link the tenant would type', () => {
    expect(html).toContain(`src="${input.qrDataUrl}"`);
    expect(html).toContain(input.url);
  });

  it('escapes the QR data URL too, so it can never break out of the src attribute', () => {
    const evil = intakeSheetHtml({ ...input, qrDataUrl: 'data:image/png;base64,QQ=="><script>alert(1)</script>' });
    expect(evil).not.toContain('<script>alert(1)</script>');
    expect(evil).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('is an A5 sheet that prints itself once it has loaded', () => {
    expect(html).toContain('size: A5 portrait');
    expect(html).toContain('window.print()');
  });
});

describe('openPrintWindow', () => {
  const original = window.open;
  afterEach(() => { window.open = original; });

  it('reports a blocked pop-up instead of silently doing nothing', () => {
    window.open = vi.fn(() => null);
    expect(openPrintWindow('<p>x</p>')).toBe(false);
  });

  it('writes the sheet into the new window', () => {
    const doc = { open: vi.fn(), write: vi.fn(), close: vi.fn() };
    window.open = vi.fn(() => ({ document: doc }) as unknown as Window);
    expect(openPrintWindow('<p>x</p>')).toBe(true);
    expect(doc.write).toHaveBeenCalledWith('<p>x</p>');
    expect(doc.close).toHaveBeenCalled();
  });
});
