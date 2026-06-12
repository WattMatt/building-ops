import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SignedImage } from '@/components/ui/signed-image';
import { Building2, Calendar, Clock, Loader2, UserCircle2, ArrowRight, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import type { IssuePriority, IssueStatus } from '@/lib/constants';

interface Issue {
  id: string;
  title: string;
  description: string;
  priority: IssuePriority;
  status: IssueStatus;
  deadline: string | null;
  created_at: string;
  building_id: string;
  building_name?: string;
  reported_by: string;
  assigned_to: string | null;
  corrective_action: string | null;
  photo_urls: string[] | null;
  task_instance_id: string | null;
}

interface Activity {
  id: string;
  activity_type: string;
  old_value: string | null;
  new_value: string | null;
  comment: string | null;
  author_name: string | null;
  created_at: string;
}

const statusColors: Record<IssueStatus, string> = {
  open: 'bg-warning text-warning-foreground',
  in_progress: 'bg-info text-info-foreground',
  escalated: 'bg-destructive text-destructive-foreground',
  resolved: 'bg-success text-success-foreground',
};
const statusLabels: Record<IssueStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  escalated: 'Escalated',
  resolved: 'Resolved',
};
const STATUS_ORDER: IssueStatus[] = ['open', 'in_progress', 'escalated', 'resolved'];

interface Props {
  issue: Issue;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  onUpdated: () => void;
}

export default function IssueDetailDialog({ issue, open, onOpenChange, canManage, onUpdated }: Props) {
  const [activity, setActivity] = useState<Activity[]>([]);
  const [people, setPeople] = useState<Record<string, string>>({});
  const [assignable, setAssignable] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingAssignee, setSavingAssignee] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: acts }, { data: profs }] = await Promise.all([
        supabase
          .from('issue_activity')
          .select('id, activity_type, old_value, new_value, comment, author_name, created_at')
          .eq('issue_id', issue.id)
          .order('created_at', { ascending: true }),
        // Assignable people = anyone with access to this building (admin/manager
        // see all; the picker is only shown to managers anyway).
        supabase.from('profiles').select('id, full_name, email'),
      ]);
      setActivity((acts as Activity[]) ?? []);
      const map: Record<string, string> = {};
      const list: { id: string; name: string }[] = [];
      for (const p of profs ?? []) {
        const name = (p.full_name as string) || (p.email as string) || 'Unknown';
        map[p.id as string] = name;
        list.push({ id: p.id as string, name });
      }
      setPeople(map);
      setAssignable(list.sort((a, b) => a.name.localeCompare(b.name)));
    } finally {
      setLoading(false);
    }
  }, [issue.id]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // The issues trigger logs the change to issue_activity automatically.
  const changeStatus = async (status: IssueStatus) => {
    if (status === issue.status) return;
    setSavingStatus(true);
    try {
      const { error } = await supabase.from('issues').update({ status }).eq('id', issue.id);
      if (error) throw error;
      toast.success(`Status changed to ${statusLabels[status]}`);
      onUpdated();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to change status');
    } finally {
      setSavingStatus(false);
    }
  };

  const changeAssignee = async (value: string) => {
    const assigned_to = value === '__unassigned__' ? null : value;
    if (assigned_to === issue.assigned_to) return;
    setSavingAssignee(true);
    try {
      const { error } = await supabase.from('issues').update({ assigned_to }).eq('id', issue.id);
      if (error) throw error;
      toast.success(assigned_to ? `Assigned to ${people[assigned_to] ?? 'user'}` : 'Unassigned');
      onUpdated();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to assign');
    } finally {
      setSavingAssignee(false);
    }
  };

  const activityText = (a: Activity): string => {
    switch (a.activity_type) {
      case 'created':
        return 'created this issue';
      case 'status_change':
        return `changed status ${statusLabels[a.old_value as IssueStatus] ?? a.old_value} → ${statusLabels[a.new_value as IssueStatus] ?? a.new_value}`;
      case 'assignment':
        return a.new_value
          ? `assigned to ${people[a.new_value] ?? 'a user'}`
          : 'removed the assignee';
      case 'contractor_assignment':
        return `assigned contractor ${a.new_value ?? ''}`.trim();
      case 'comment':
        return a.comment ?? 'commented';
      default:
        return a.activity_type;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">{issue.title}</DialogTitle>
          <DialogDescription className="flex items-center gap-2 flex-wrap pt-1">
            <Badge variant="secondary" className={statusColors[issue.status]}>{statusLabels[issue.status]}</Badge>
            <span className="flex items-center gap-1 text-xs"><Building2 className="h-3 w-3" />{issue.building_name}</span>
            <span className="flex items-center gap-1 text-xs"><Calendar className="h-3 w-3" />{format(new Date(issue.created_at), 'MMM d, yyyy')}</span>
            {issue.deadline && (
              <span className="flex items-center gap-1 text-xs"><Clock className="h-3 w-3" />Due {format(new Date(issue.deadline), 'MMM d')}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm whitespace-pre-wrap">{issue.description}</p>

          {issue.corrective_action && (
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <span className="font-medium">Corrective action: </span>{issue.corrective_action}
            </div>
          )}

          {issue.photo_urls && issue.photo_urls.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {issue.photo_urls.map((url, i) => (
                <SignedImage key={i} src={url} alt={`Evidence ${i + 1}`} className="h-20 w-20 rounded-md object-cover border" />
              ))}
            </div>
          )}

          {/* Management controls (admin/manager) */}
          {canManage && (
            <div className="grid grid-cols-2 gap-3 border-t pt-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select value={issue.status} onValueChange={(v) => changeStatus(v as IssueStatus)} disabled={savingStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_ORDER.map((s) => (
                      <SelectItem key={s} value={s}>{statusLabels[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Assignee</Label>
                <Select value={issue.assigned_to ?? '__unassigned__'} onValueChange={changeAssignee} disabled={savingAssignee}>
                  <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned__">Unassigned</SelectItem>
                    {assignable.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* History */}
          <div className="border-t pt-4">
            <Label className="text-xs text-muted-foreground">History</Label>
            {loading ? (
              <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : activity.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No history yet.</p>
            ) : (
              <ol className="mt-2 space-y-3">
                {activity.map((a) => (
                  <li key={a.id} className="flex gap-2 text-sm">
                    <span className="mt-0.5 text-muted-foreground">
                      {a.activity_type === 'status_change' ? <ArrowRight className="h-4 w-4" />
                        : a.activity_type === 'assignment' ? <UserCircle2 className="h-4 w-4" />
                        : <Plus className="h-4 w-4" />}
                    </span>
                    <div className="flex-1">
                      <p>
                        <span className="font-medium">{a.author_name ?? 'Someone'}</span> {activityText(a)}
                      </p>
                      <p className="text-xs text-muted-foreground">{format(new Date(a.created_at), 'MMM d, yyyy • h:mm a')}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
