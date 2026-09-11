import { describe, it, expect, vi } from 'vitest';
import {
  EMPTY_INTAKE, INTAKE_LIMITS, REFERENCE_RE, buildIntakeFormData, fetchIntakeInfo, intakeUrl,
  serverFieldError, submitIntake, validateIntake, type IntakeValues,
} from './intakeForm';

const filled: IntakeValues = {
  title: 'Light out in the passage',
  description: 'The passage between shop 10 and 14 has been dark since Monday.',
  name: 'Thandi Tenant',
  shopNumber: '12',
  phone: '0821234567',
  email: 'thandi@example.co.za',
  category: 'Electrical',
};

/** A Response stand-in: only `status` and `json()` are read. */
const res = (status: number, body: unknown = {}) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;

describe('validateIntake', () => {
  it('asks for the three required fields when the form is empty', () => {
    expect(validateIntake(EMPTY_INTAKE)).toEqual({
      title: 'Tell us what the problem is',
      description: 'Describe the problem and where it is',
      name: 'Your name lets the team follow up',
    });
  });

  it('treats whitespace as empty', () => {
    const errors = validateIntake({ ...filled, title: '   ' });
    expect(errors.title).toBe('Tell us what the problem is');
  });

  it('caps the long fields', () => {
    expect(validateIntake({ ...filled, title: 'x'.repeat(INTAKE_LIMITS.title + 1) }).title)
      .toBe(`Keep the summary under ${INTAKE_LIMITS.title} characters`);
    expect(validateIntake({ ...filled, phone: '0'.repeat(INTAKE_LIMITS.phone + 1) }).phone)
      .toBe(`Keep the phone number under ${INTAKE_LIMITS.phone} characters`);
  });

  it('rejects a malformed email but accepts a missing one', () => {
    expect(validateIntake({ ...filled, email: 'thandi@' }).email).toBe('That email address does not look right');
    expect(validateIntake({ ...filled, email: '' }).email).toBeUndefined();
  });

  it('passes a filled form', () => {
    expect(validateIntake(filled)).toEqual({});
  });
});

describe('buildIntakeFormData', () => {
  const file = (name: string) => new File(['x'], name, { type: 'image/jpeg' });

  it('sends the token first and the trimmed required fields', () => {
    const fd = buildIntakeFormData('tok', { ...filled, title: '  Light out  ' }, []);
    expect([...fd.keys()][0]).toBe('t');
    expect(fd.get('t')).toBe('tok');
    expect(fd.get('title')).toBe('Light out');
    expect(fd.get('description')).toBe(filled.description);
    expect(fd.get('name')).toBe('Thandi Tenant');
  });

  it('omits the optional fields when they are blank but always sends the honeypot', () => {
    const fd = buildIntakeFormData('tok', { ...EMPTY_INTAKE, title: 'a', description: 'b', name: 'c' }, []);
    expect(fd.has('shop_number')).toBe(false);
    expect(fd.has('phone')).toBe(false);
    expect(fd.has('email')).toBe(false);
    expect(fd.has('category')).toBe(false);
    expect(fd.get('website')).toBe('');
  });

  it('carries the optional fields and the honeypot value when they are given', () => {
    const fd = buildIntakeFormData('tok', filled, [], 'spam');
    expect(fd.get('shop_number')).toBe('12');
    expect(fd.get('phone')).toBe('0821234567');
    expect(fd.get('email')).toBe('thandi@example.co.za');
    expect(fd.get('category')).toBe('Electrical');
    expect(fd.get('website')).toBe('spam');
  });

  it('caps the photos at the documented limit', () => {
    const fd = buildIntakeFormData('tok', filled, [file('a.jpg'), file('b.jpg'), file('c.jpg'), file('d.jpg')]);
    expect(fd.getAll('photos')).toHaveLength(INTAKE_LIMITS.photos);
  });
});

describe('intakeUrl', () => {
  it('builds the public route the QR code carries', () => {
    expect(intakeUrl('abc', 'https://x.app')).toBe('https://x.app/intake/abc');
  });
});

describe('fetchIntakeInfo', () => {
  it('returns null on the function\'s identical 404', async () => {
    await expect(fetchIntakeInfo('tok', vi.fn(async () => res(404, { error: 'not_found' })))).resolves.toBeNull();
  });

  it('throws on a server error so the page can offer a retry', async () => {
    await expect(fetchIntakeInfo('tok', vi.fn(async () => res(500)))).rejects.toThrow('HTTP 500');
  });

  it('parses the payload and asks for no cached copy', async () => {
    const info = { building: { name: 'North Tower' }, org: { name: 'WM', logoUrl: null, primaryColor: '#123456' }, shops: [], categories: [] };
    const impl = vi.fn(async () => res(200, info));
    await expect(fetchIntakeInfo('a b', impl)).resolves.toEqual(info);
    const [url, init] = impl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('?t=a%20b');
    expect(init.cache).toBe('no-store');
  });
});

describe('submitIntake', () => {
  const fd = new FormData();

  it('accepts a 201 carrying a well-formed reference', async () => {
    const r = await submitIntake(fd, vi.fn(async () => res(201, { reference: 'FO-ABC234' })));
    expect(r).toEqual({ ok: true, reference: 'FO-ABC234' });
    expect(REFERENCE_RE.test('FO-ABC234')).toBe(true);
  });

  it('refuses a 201 whose reference is malformed rather than showing the tenant nonsense', async () => {
    // '1' and '0' are not in the base32 alphabet the function draws from.
    await expect(submitIntake(fd, vi.fn(async () => res(201, { reference: 'FO-ABC10' }))))
      .resolves.toEqual({ ok: false, kind: 'failed', fields: [] });
  });

  it('maps the documented status codes', async () => {
    await expect(submitIntake(fd, vi.fn(async () => res(400, { error: 'invalid', fields: ['title', 'photos'] }))))
      .resolves.toEqual({ ok: false, kind: 'invalid', fields: ['title', 'photos'] });
    await expect(submitIntake(fd, vi.fn(async () => res(400, { error: 'invalid' }))))
      .resolves.toEqual({ ok: false, kind: 'invalid', fields: [] });
    await expect(submitIntake(fd, vi.fn(async () => res(404)))).resolves.toMatchObject({ kind: 'not_found' });
    await expect(submitIntake(fd, vi.fn(async () => res(413)))).resolves.toMatchObject({ kind: 'too_large' });
    await expect(submitIntake(fd, vi.fn(async () => res(429)))).resolves.toMatchObject({ kind: 'rate_limited' });
    await expect(submitIntake(fd, vi.fn(async () => res(500)))).resolves.toMatchObject({ kind: 'failed' });
  });

  it('treats a dropped connection as a failure the tenant can retry', async () => {
    await expect(submitIntake(fd, vi.fn(async () => { throw new Error('offline'); })))
      .resolves.toEqual({ ok: false, kind: 'failed', fields: [] });
  });

  it('puts the token on the query as well as in the body, so the function never parses an unknown body', async () => {
    const withToken = buildIntakeFormData('a b', { ...EMPTY_INTAKE, title: 'a', description: 'b', name: 'c' }, []);
    const spy = vi.fn(async () => res(201, { reference: 'FO-ABC234' }));
    await submitIntake(withToken, spy);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/functions/v1/tenant-intake?t=a%20b');
    expect(init.method).toBe('POST');
    expect((init.body as FormData).get('t')).toBe('a b');
  });
});

describe('serverFieldError', () => {
  it('maps the function\'s field names onto the page\'s fields', () => {
    expect(serverFieldError('shop_number')).toEqual({ field: 'shopNumber', message: 'Pick your shop from the list' });
    expect(serverFieldError('title')?.field).toBe('title');
    expect(serverFieldError('photos')?.field).toBe('photos');
    expect(serverFieldError('nonsense')).toBeNull();
  });
});
