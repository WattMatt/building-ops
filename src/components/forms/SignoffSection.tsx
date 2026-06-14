import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PenLine } from 'lucide-react';
import { toast } from 'sonner';
import SignoffRequestDialog from './SignoffRequestDialog';
import SignatureCaptureWidget, { type SignatureState } from './SignatureCaptureWidget';

interface SignoffRequest {
  id: string;
  assigned_to: string;
  status: string;
  active: boolean;
  sequence_order: number;
  due_at: string | null;
  signer?: { full_name: string | null; email: string | null } | null;
}

const CONFIRMATION =
  'I confirm that the information in this submission is correct and this is my signature.';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'secondary',
  signed: 'default',
  declined: 'destructive',
  expired: 'outline',
};

export default function SignoffSection({ submissionId, onChanged }: { submissionId: string; onChanged?: () => void }) {
  const { user, isAdminOrManager } = useAuth();
  const [requests, setRequests] = useState<SignoffRequest[]>([]);
  const [signoffStatus, setSignoffStatus] = useState('none');
  const [loading, setLoading] = useState(true);
  const [assignOpen, setAssignOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: reqs }, { data: sub }] = await Promise.all([
      supabase
        .from('form_signoff_requests')
        .select('id, assigned_to, status, active, sequence_order, due_at')
        .eq('submission_id', submissionId)
        .order('sequence_order'),
      supabase.from('form_submissions').select('signoff_status').eq('id', submissionId).single(),
    ]);
    const ids = [...new Set((reqs || []).map((r) => r.assigned_to))];
    const names = new Map<string, { full_name: string | null; email: string | null }>();
    if (ids.length) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name, email').in('id', ids);
      (profs || []).forEach((p) => names.set(p.id, { full_name: p.full_name, email: p.email }));
    }
    setRequests((reqs || []).map((r) => ({ ...r, signer: names.get(r.assigned_to) ?? null })));
    setSignoffStatus(sub?.signoff_status ?? 'none');
    setLoading(false);
  }, [submissionId]);

  useEffect(() => {
    load();
  }, [load]);

  const myActive = requests.find((r) => r.assigned_to === user?.id && r.active && r.status === 'pending');

  const handleSign = async (s: SignatureState) => {
    if (!myActive || !user) return;
    setSubmitting(true);
    try {
      let signatureUrl: string | null = null;
      if (s.method === 'drawn' && s.drawn) {
        const path = `signatures/${submissionId}/${user.id}/${Date.now()}.png`;
        const blob = await (await fetch(s.drawn)).blob();
        const { error: upErr } = await supabase.storage
          .from('tenant-documents')
          .upload(path, blob, { contentType: 'image/png' });
        if (upErr) throw upErr;
        signatureUrl = path;
      }
      const { error } = await supabase.from('form_signatures').insert({
        request_id: myActive.id,
        submission_id: submissionId,
        signer_id: user.id,
        method: s.method,
        signature_url: signatureUrl,
        typed_name: s.method === 'typed' ? s.typedName.trim() : null,
        confirmation_text: CONFIRMATION,
        user_agent: navigator.userAgent,
      });
      if (error) throw error;

      // The DB trigger advances state; re-read to see if the whole thing completed.
      const { data: sub } = await supabase.from('form_submissions').select('signoff_status').eq('id', submissionId).single();
      if (sub?.signoff_status === 'complete') {
        supabase.functions.invoke('notify-signoff-complete', { body: { submissionId } });
      } else {
        // a sequential chain may have just activated the next signer — notify them
        // (parallel signers were all notified at assign time).
        const { data: nextActive } = await supabase
          .from('form_signoff_requests')
          .select('id, mode')
          .eq('submission_id', submissionId)
          .eq('active', true)
          .eq('status', 'pending');
        (nextActive || [])
          .filter((r) => r.mode === 'sequential')
          .forEach((r) => supabase.functions.invoke('notify-signoff-request', { body: { requestId: r.id } }));
      }
      toast.success('Signed');
      setSignOpen(false);
      await load();
      onChanged?.();
    } catch (e) {
      console.error('sign error:', e);
      toast.error('Failed to record signature');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecline = async () => {
    if (!myActive) return;
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('form_signoff_requests')
        .update({ status: 'declined', active: false, decline_reason: declineReason || null })
        .eq('id', myActive.id);
      if (error) throw error;
      toast.success('Declined');
      setDeclineOpen(false);
      setDeclineReason('');
      await load();
      onChanged?.();
    } catch (e) {
      console.error('decline error:', e);
      toast.error('Failed to decline');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return null;

  return (
    <div className="mb-6 p-4 rounded-lg border">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <PenLine className="h-4 w-4" /> Sign-off
        </h3>
        {isAdminOrManager && (signoffStatus === 'none' || signoffStatus === 'rejected') && (
          <Button size="sm" variant="outline" onClick={() => setAssignOpen(true)}>
            Request sign-off
          </Button>
        )}
      </div>

      {requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sign-off requested.</p>
      ) : (
        <ul className="space-y-1">
          {requests.map((r) => (
            <li key={r.id} className="flex items-center justify-between text-sm">
              <span>
                {r.sequence_order}. {r.signer?.full_name || r.signer?.email || 'Unknown'}
              </span>
              <Badge variant={STATUS_VARIANT[r.status] ?? 'outline'} className="capitalize">
                {r.status}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      {myActive && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => setSignOpen(true)}>
            <PenLine className="h-4 w-4 mr-1" /> Sign
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDeclineOpen(true)}>
            Decline
          </Button>
        </div>
      )}

      <SignoffRequestDialog
        submissionId={submissionId}
        open={assignOpen}
        onOpenChange={setAssignOpen}
        onAssigned={() => {
          load();
          onChanged?.();
        }}
      />

      <Dialog open={signOpen} onOpenChange={setSignOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Sign submission</DialogTitle>
          </DialogHeader>
          <SignatureCaptureWidget confirmationText={CONFIRMATION} onSign={handleSign} submitting={submitting} />
        </DialogContent>
      </Dialog>

      <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Decline sign-off</DialogTitle>
          </DialogHeader>
          <Input value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} placeholder="Reason (optional)" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclineOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDecline} disabled={submitting}>
              Decline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
