import { useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Eraser } from 'lucide-react';

export interface SignatureState {
  method: 'drawn' | 'typed';
  typedName: string;
  drawn: string | null; // PNG data URL
  confirmed: boolean;
}

export function validateSignature(s: SignatureState): { ok: boolean; reason?: string } {
  if (!s.confirmed) return { ok: false, reason: 'You must confirm to sign.' };
  if (s.method === 'typed') {
    if (!s.typedName.trim()) return { ok: false, reason: 'Enter your full name.' };
    return { ok: true };
  }
  if (!s.drawn) return { ok: false, reason: 'Draw your signature.' };
  return { ok: true };
}

interface Props {
  confirmationText: string;
  onSign: (s: SignatureState) => Promise<void> | void;
  submitting: boolean;
}

export default function SignatureCaptureWidget({ confirmationText, onSign, submitting }: Props) {
  const [method, setMethod] = useState<'drawn' | 'typed'>('drawn');
  const [typedName, setTypedName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const padRef = useRef<SignatureCanvas | null>(null);

  // Approximate validity for the button; exact data URL is read on submit.
  const candidate: SignatureState = {
    method,
    typedName,
    drawn: method === 'drawn' ? (hasDrawn ? 'pending' : null) : null,
    confirmed,
  };
  const canSubmit = validateSignature(candidate).ok && !submitting;

  const clearPad = () => {
    padRef.current?.clear();
    setHasDrawn(false);
  };

  const handleSign = async () => {
    const drawn =
      method === 'drawn' && padRef.current && !padRef.current.isEmpty()
        ? padRef.current.toDataURL('image/png')
        : null;
    const state: SignatureState = { method, typedName, drawn, confirmed };
    if (!validateSignature(state).ok) return;
    await onSign(state);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button type="button" variant={method === 'drawn' ? 'default' : 'outline'} size="sm" onClick={() => setMethod('drawn')}>
          Draw
        </Button>
        <Button type="button" variant={method === 'typed' ? 'default' : 'outline'} size="sm" onClick={() => setMethod('typed')}>
          Type
        </Button>
      </div>

      {method === 'drawn' ? (
        <div className="space-y-2">
          <div className="rounded-md border bg-background">
            <SignatureCanvas
              ref={padRef}
              penColor="#111827"
              onEnd={() => setHasDrawn(true)}
              canvasProps={{ className: 'w-full h-40 rounded-md' }}
            />
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={clearPad}>
            <Eraser className="h-4 w-4 mr-2" />
            Clear
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="sig-name">Full name</Label>
          <Input id="sig-name" value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder="Type your full name" />
        </div>
      )}

      <label className="flex items-start gap-2 text-sm text-muted-foreground">
        <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} className="mt-0.5" />
        <span>{confirmationText}</span>
      </label>

      <Button onClick={handleSign} disabled={!canSubmit}>
        {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Sign
      </Button>
    </div>
  );
}
