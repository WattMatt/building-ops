import { describe, it, expect } from 'vitest';
import { validateSignature } from './SignatureCaptureWidget';

describe('validateSignature', () => {
  it('requires confirmation regardless of method', () => {
    expect(validateSignature({ method: 'typed', typedName: 'A Smith', drawn: null, confirmed: false }).ok).toBe(false);
    expect(validateSignature({ method: 'drawn', typedName: '', drawn: 'data:image/png;base64,x', confirmed: false }).ok).toBe(false);
  });
  it('typed needs a non-empty name', () => {
    expect(validateSignature({ method: 'typed', typedName: '  ', drawn: null, confirmed: true }).ok).toBe(false);
    expect(validateSignature({ method: 'typed', typedName: 'A Smith', drawn: null, confirmed: true }).ok).toBe(true);
  });
  it('drawn needs a non-empty data URL', () => {
    expect(validateSignature({ method: 'drawn', typedName: '', drawn: null, confirmed: true }).ok).toBe(false);
    expect(validateSignature({ method: 'drawn', typedName: '', drawn: 'data:image/png;base64,x', confirmed: true }).ok).toBe(true);
  });
});
