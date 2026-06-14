import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface Props {
  submissionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned: () => void;
}

export default function SignoffRequestDialog({ submissionId, open, onOpenChange, onAssigned }: Props) {
  const { user } = useAuth();
  const [people, setPeople] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<string[]>([]); // ordered signer ids
  const [mode, setMode] = useState<'sequential' | 'parallel'>('sequential');
  const [dueAt, setDueAt] = useState('');
  const [instructions, setInstructions] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('deactivated', false)
        .order('full_name');
      setPeople(data || []);
    })();
  }, [open]);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = async () => {
    if (selected.length === 0) {
      toast.error('Select at least one signer');
      return;
    }
    setSaving(true);
    try {
      const rows = selected.map((sid, i) => ({
        submission_id: submissionId,
        assigned_to: sid,
        assigned_by: user?.id ?? null,
        sequence_order: i + 1,
        mode,
        status: 'pending',
        active: mode === 'parallel' ? true : i === 0,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        instructions: instructions || null,
      }));
      const { data: inserted, error } = await supabase
        .from('form_signoff_requests')
        .insert(rows)
        .select('id, active');
      if (error) throw error;

      await supabase.from('form_submissions').update({ signoff_status: 'pending' }).eq('id', submissionId);

      (inserted || [])
        .filter((r) => r.active)
        .forEach((r) => {
          supabase.functions.invoke('notify-signoff-request', { body: { requestId: r.id } });
        });

      toast.success('Sign-off requested');
      setSelected([]);
      setInstructions('');
      setDueAt('');
      onAssigned();
      onOpenChange(false);
    } catch (e) {
      console.error('assign signoff error:', e);
      toast.error('Failed to request sign-off');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Request sign-off</DialogTitle>
          <DialogDescription>Assign one or more people to sign this submission.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>
              Signers{' '}
              {selected.length > 0 && (
                <span className="text-muted-foreground font-normal">({selected.length} selected, in order)</span>
              )}
            </Label>
            <div className="max-h-48 overflow-auto rounded-md border divide-y">
              {people.map((p) => {
                const idx = selected.indexOf(p.id);
                return (
                  <label key={p.id} className="flex items-center gap-2 p-2 text-sm cursor-pointer">
                    <Checkbox checked={idx >= 0} onCheckedChange={() => toggle(p.id)} />
                    {idx >= 0 && <span className="text-xs font-medium text-primary w-5">{idx + 1}.</span>}
                    <span>{p.full_name || p.email || 'Unknown'}</span>
                  </label>
                );
              })}
              {people.length === 0 && <p className="p-2 text-sm text-muted-foreground">No users found.</p>}
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="button" size="sm" variant={mode === 'sequential' ? 'default' : 'outline'} onClick={() => setMode('sequential')}>
              Sequential
            </Button>
            <Button type="button" size="sm" variant={mode === 'parallel' ? 'default' : 'outline'} onClick={() => setMode('parallel')}>
              Parallel
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="signoff-due">Due date (optional)</Label>
            <Input id="signoff-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="signoff-instr">Instructions (optional)</Label>
            <Input
              id="signoff-instr"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. confirm the fire panel test"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || selected.length === 0}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Request sign-off
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
