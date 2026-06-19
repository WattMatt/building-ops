import { useEffect, useState } from 'react';
import { formatBuildingName } from '@/lib/buildingName';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  userId: string;
  userLabel: string;
  buildings: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

/**
 * Admin control to view and change which buildings a user is assigned to
 * (user_buildings). Closes the F-35 gap: assignments could only be set at
 * invite, and were wiped — not restored — by deactivate/reactivate.
 */
export default function EditAssignmentsDialog({ userId, userLabel, buildings, open, onOpenChange, onSaved }: Props) {
  const [original, setOriginal] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    supabase
      .from('user_buildings')
      .select('building_id')
      .eq('user_id', userId)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) toast.error('Failed to load current assignments');
        const ids = new Set((data ?? []).map((r) => r.building_id as string));
        setOriginal(ids);
        setSelected(new Set(ids));
        setLoading(false);
      });
    return () => { active = false; };
  }, [open, userId]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const save = async () => {
    const toAdd = [...selected].filter((id) => !original.has(id));
    const toRemove = [...original].filter((id) => !selected.has(id));
    if (toAdd.length === 0 && toRemove.length === 0) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      if (toRemove.length > 0) {
        const { error } = await supabase
          .from('user_buildings')
          .delete()
          .eq('user_id', userId)
          .in('building_id', toRemove);
        if (error) throw error;
      }
      if (toAdd.length > 0) {
        const { error } = await supabase
          .from('user_buildings')
          .insert(toAdd.map((building_id) => ({ user_id: userId, building_id })));
        if (error) throw error;
      }
      toast.success('Building access updated');
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update access');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Building access</DialogTitle>
          <DialogDescription>
            Choose which buildings <span className="font-medium">{userLabel}</span> can access.
            Admins and managers see all buildings regardless of assignment.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : buildings.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No buildings available.</p>
        ) : (
          <div className="max-h-72 overflow-y-auto space-y-2 py-1">
            {buildings.map((b) => (
              <label key={b.id} htmlFor={`assign-${b.id}`} className="flex items-center gap-3 rounded-md p-2 hover:bg-muted/50 cursor-pointer">
                <Checkbox id={`assign-${b.id}`} checked={selected.has(b.id)} onCheckedChange={() => toggle(b.id)} />
                <Label htmlFor={`assign-${b.id}`} className="cursor-pointer font-normal">{formatBuildingName(b.name)}</Label>
              </label>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
