import { useEffect, useState, useCallback } from 'react';
import { formatBuildingName } from '@/lib/buildingName';
import { supabase } from '@/integrations/supabase/client';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Hint } from '@/components/ui/hint';
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
import { isTenantIssue, reporterSummary, type IssueReporter, type IssueSource } from '@/lib/issueSource';
import { useBuildingMembers, memberDisplayName } from '@/hooks/useBuildingMembers';
import { AssigneePicker } from '@/components/people/AssigneePicker';
import { ContractorPicker } from '@/components/contractors/ContractorPicker';
import { IssueCommentComposer } from '@/components/issues/IssueCommentComposer';
import { ResolveIssueDialog } from '@/components/issues/ResolveIssueDialog';
import { SlaChip } from '@/components/issues/SlaChip';
import { EvidencePackMenu } from '@/components/evidence/EvidencePackMenu';
import { formatSlaInstant, slaState } from '@/lib/slaState';
import { useNow } from '@/hooks/useNow';
import { notify } from '@/lib/notify';
import { parseCost } from '@/lib/money';
import { throwIfRefused } from '@/lib/pgErrors';
import { useAuth } from '@/contexts/AuthContext';
import type { TablesUpdate } from '@/integrations/supabase/types';

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
  // Optional: `useIssues` always supplies the R4c intake columns, but MyDay and older fixtures pass
  // their own shape — an issue without them simply is not a tenant report.
  source?: IssueSource;
  reporter?: IssueReporter | null;
  reference?: string | null;
  // Optional: older fixtures and callers predate the SLA columns; no target means no clock.
  sla_target_hours?: number | null;
  sla_breached_at?: string | null;
  first_response_at?: string | null;
  resolved_at?: string | null;
}

interface Activity {
  id: string;
  activity_type: string;
  old_value: string | null;
  new_value: string | null;
  comment: string | null;
  author_name: string | null;
  created_at: string;
  user_id: string | null;
  photo_urls: string[] | null;
  mentions: string[] | null;
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

type CostField = 'estimated_cost' | 'actual_cost';
const COST_LABELS: Record<CostField, string> = { estimated_cost: 'Estimated cost', actual_cost: 'Actual cost' };

const costText = (v: number | null | undefined) => (v == null ? '' : String(v));

interface Props {
  issue: Issue;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  onUpdated: () => void;
}

export default function IssueDetailDialog({ issue, open, onOpenChange, canManage, onUpdated }: Props) {
  const { user } = useAuth();
  const { byId: members } = useBuildingMembers(issue.building_id);
  // One ticking clock for the chip and the due line, so neither freezes at open time.
  const now = useNow();
  const sla = slaState(issue, now);
  const nameOf = (id: string | null | undefined) => (id && members.get(id) ? memberDisplayName(members.get(id)!) : null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingAssignee, setSavingAssignee] = useState(false);
  // Contractor (spec §8, admin/manager): the list queries do not select it, so it is loaded with
  // the cost columns below; the resolve dialog needs it to offer a rating. The picker stays
  // disabled until that fetch resolves (`costs` lands in the same call) so a pick made before
  // the row arrives cannot be overwritten by it.
  const [contractorId, setContractorId] = useState<string | null>(null);
  const [savingContractor, setSavingContractor] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  // Costs (spec §8, admin/manager): the list queries don't select these columns, so the
  // dialog reads them itself; `costs` is the saved state, `costDraft` what's being typed.
  const [costs, setCosts] = useState<Record<CostField, number | null> | null>(null);
  const [costDraft, setCostDraft] = useState<Record<CostField, string>>({ estimated_cost: '', actual_cost: '' });
  const [savingCost, setSavingCost] = useState<CostField | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: acts, error } = await supabase
        .from('issue_activity')
        .select('id, activity_type, old_value, new_value, comment, author_name, created_at, user_id, photo_urls, mentions')
        .eq('issue_id', issue.id)
        .order('created_at', { ascending: true });
      if (error) {
        if (import.meta.env.DEV) console.error('Load issue history failed:', error);
        setActivityError(error.message || 'Could not load the history.');
        return;
      }
      setActivityError(null);
      // photo_urls is jsonb (typed Json); the app only ever writes string[] there.
      setActivity((acts ?? []) as Activity[]);
    } finally {
      setLoading(false);
    }
  }, [issue.id]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    if (!open || !canManage) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from('issues').select('estimated_cost, actual_cost, contractor_id').eq('id', issue.id);
      if (cancelled || error) return;
      const row = data?.[0];
      const next = { estimated_cost: row?.estimated_cost ?? null, actual_cost: row?.actual_cost ?? null };
      setCosts(next);
      setCostDraft({ estimated_cost: costText(next.estimated_cost), actual_cost: costText(next.actual_cost) });
      setContractorId(row?.contractor_id ?? null);
    })();
    return () => { cancelled = true; };
  }, [open, canManage, issue.id]);

  /**
   * The one write path for every management control. Selecting the id back is what makes RLS
   * visible: a refused update is not an error, it is zero rows, and zero rows must read as a
   * permission failure — never as a success.
   */
  const updateIssue = async (patch: TablesUpdate<'issues'>, deniedMessage: string) => {
    const { data, error } = await supabase.from('issues').update(patch).eq('id', issue.id).select('id');
    throwIfRefused(error, data, deniedMessage);
  };

  // Saved on blur.
  const saveCost = async (field: CostField) => {
    const parsed = parseCost(costDraft[field]);
    if (parsed === undefined) {
      toast.error(`${COST_LABELS[field]} must be an amount of R 0 or more`);
      setCostDraft((d) => ({ ...d, [field]: costText(costs?.[field]) }));
      return;
    }
    if (parsed === (costs?.[field] ?? null)) return;
    setSavingCost(field);
    try {
      await updateIssue({ [field]: parsed }, "You do not have permission to change this issue's costs.");
      setCosts((c) => ({ estimated_cost: c?.estimated_cost ?? null, actual_cost: c?.actual_cost ?? null, [field]: parsed }));
      toast.success(`${COST_LABELS[field]} saved`);
      onUpdated();
    } catch (e) {
      setCostDraft((d) => ({ ...d, [field]: costText(costs?.[field]) }));
      toast.error(e instanceof Error ? e.message : `Failed to save ${COST_LABELS[field].toLowerCase()}`);
    } finally {
      setSavingCost(null);
    }
  };

  // The issues trigger logs the change to issue_activity automatically.
  const changeStatus = async (status: IssueStatus) => {
    if (status === issue.status) return;
    if (status === 'resolved') {
      setResolveOpen(true);
      return;
    }
    setSavingStatus(true);
    try {
      await updateIssue({ status }, 'You do not have permission to change this issue.');
      toast.success(`Status changed to ${statusLabels[status]}`);
      onUpdated();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to change status');
    } finally {
      setSavingStatus(false);
    }
  };

  const changeAssignee = async (assigned_to: string | null) => {
    if (assigned_to === issue.assigned_to) return;
    setSavingAssignee(true);
    try {
      await updateIssue({ assigned_to }, 'You do not have permission to assign this issue.');
      toast.success(assigned_to ? `Assigned to ${nameOf(assigned_to) ?? 'user'}` : 'Unassigned');
      if (assigned_to && assigned_to !== user?.id) {
        void notify({ kind: 'issue_assigned', entityType: 'issue', entityId: issue.id, buildingId: issue.building_id, recipients: [assigned_to], title: `Issue assigned to you: ${issue.title}`, url: `/issues?open=${issue.id}` });
      }
      onUpdated();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to assign');
    } finally {
      setSavingAssignee(false);
    }
  };

  const changeContractor = async (contractor_id: string | null) => {
    if (contractor_id === contractorId) return;
    const previous = contractorId;
    setSavingContractor(true);
    setContractorId(contractor_id);
    try {
      await updateIssue({ contractor_id }, "You do not have permission to change this issue's contractor.");
      toast.success(contractor_id ? 'Contractor assigned' : 'Contractor removed');
      onUpdated();
      await load();
    } catch (e) {
      setContractorId(previous);
      toast.error(e instanceof Error ? e.message : 'Failed to change the contractor');
    } finally {
      setSavingContractor(false);
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
          ? `assigned to ${nameOf(a.new_value) ?? 'a user'}`
          : 'removed the assignee';
      case 'contractor_assignment':
        return `assigned contractor ${a.new_value ?? ''}`.trim();
      case 'comment':
        return '';
      default:
        return a.activity_type;
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2 pr-6">{issue.title}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="flex items-center gap-2 flex-wrap pt-1">
            <Badge variant="secondary" className={statusColors[issue.status]}>{statusLabels[issue.status]}</Badge>
            <span className="flex items-center gap-1 text-xs"><Building2 className="h-3 w-3" />{formatBuildingName(issue.building_name)}</span>
            <span className="flex items-center gap-1 text-xs"><Calendar className="h-3 w-3" />{format(new Date(issue.created_at), 'MMM d, yyyy')}</span>
            {issue.deadline && (
              <span className="flex items-center gap-1 text-xs"><Clock className="h-3 w-3" />Due {format(new Date(issue.deadline), 'MMM d')}</span>
            )}
            <SlaChip issue={issue} now={now} />
          </ResponsiveDialogDescription>
          {/* Anyone who can open this issue may hand it over as evidence: RLS already decides
              what they can read, and the pack holds nothing they are not looking at. */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <EvidencePackMenu kind="issue" id={issue.id} buildingName={formatBuildingName(issue.building_name)} />
          </div>
        </ResponsiveDialogHeader>

        <div className="space-y-4">
          <p className="text-sm whitespace-pre-wrap">{issue.description}</p>
          {isTenantIssue(issue) && (
            <div className="rounded-lg border p-3 text-sm space-y-1" data-testid="tenant-report">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-info text-info">Tenant report</Badge>
                {issue.reference && <span className="font-mono text-xs">{issue.reference}</span>}
              </div>
              <p>{reporterSummary(issue.reporter)}</p>
              <p className="flex flex-wrap gap-3 text-xs">
                {issue.reporter?.phone && <a className="underline" href={`tel:${issue.reporter.phone}`}>{issue.reporter.phone}</a>}
                {issue.reporter?.email && <a className="underline" href={`mailto:${issue.reporter.email}`}>{issue.reporter.email}</a>}
              </p>
            </div>
          )}
          {issue.sla_target_hours != null && (
            <p className="text-xs text-muted-foreground">
              SLA target {issue.sla_target_hours} h
              {issue.first_response_at ? ` · first response ${formatSlaInstant(new Date(issue.first_response_at))}` : ' · no response yet'}
              {sla.due ? ` · due ${formatSlaInstant(sla.due)}` : ''}
            </p>
          )}

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
                <AssigneePicker buildingId={issue.building_id} value={issue.assigned_to} onChange={changeAssignee} disabled={savingAssignee} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="issue-contractor" className="text-xs">Contractor</Label>
                <ContractorPicker
                  id="issue-contractor"
                  value={contractorId}
                  onChange={(id) => void changeContractor(id)}
                  disabled={costs === null || savingContractor}
                  aria-label="Contractor"
                />
                <Hint>Assign the contractor doing the work — you can rate them when the issue is resolved</Hint>
              </div>
            </div>
          )}

          {/* Costs (admin/manager) */}
          {canManage && (
            <div className="space-y-2 border-t pt-4">
              <Label className="text-xs text-muted-foreground">Costs</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="issue-estimated-cost" className="text-xs">Estimated cost (R)</Label>
                  <Input
                    id="issue-estimated-cost"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    placeholder="0"
                    className="h-11"
                    value={costDraft.estimated_cost}
                    onChange={(e) => setCostDraft((d) => ({ ...d, estimated_cost: e.target.value }))}
                    onBlur={() => void saveCost('estimated_cost')}
                    disabled={costs === null || savingCost === 'estimated_cost'}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="issue-actual-cost" className="text-xs">Actual cost (R)</Label>
                  <Input
                    id="issue-actual-cost"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    placeholder="0"
                    className="h-11"
                    value={costDraft.actual_cost}
                    onChange={(e) => setCostDraft((d) => ({ ...d, actual_cost: e.target.value }))}
                    onBlur={() => void saveCost('actual_cost')}
                    disabled={costs === null || savingCost === 'actual_cost'}
                  />
                </div>
              </div>
              <Hint>Fill in the actual cost when the work is done — it feeds the building's monthly costs</Hint>
            </div>
          )}

          {/* History */}
          <div className="border-t pt-4">
            <Label className="text-xs text-muted-foreground">History</Label>
            {loading ? (
              <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : activityError ? (
              <div className="space-y-2 py-2">
                <p className="text-xs text-destructive">Could not load the history.</p>
                <Button size="sm" variant="outline" onClick={() => void load()}>Try again</Button>
              </div>
            ) : activity.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No history yet.</p>
            ) : (
              <ol className="mt-2 space-y-3">
                {activity.map((a) => {
                  const mentionedNames = (a.mentions ?? []).map((id) => nameOf(id)).filter((n): n is string => !!n);
                  return (
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
                      {a.activity_type === 'comment' && a.comment && (
                        <p className="whitespace-pre-wrap">{a.comment}</p>
                      )}
                      {a.photo_urls && a.photo_urls.length > 0 && (
                        <div className="mt-1 flex gap-2 flex-wrap">
                          {a.photo_urls.map((url, i) => (
                            <SignedImage key={i} src={url} alt={`Comment photo ${i + 1}`} className="h-16 w-16 rounded-md object-cover border" />
                          ))}
                        </div>
                      )}
                      {mentionedNames.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Mentioned: {mentionedNames.join(', ')}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">{format(new Date(a.created_at), 'MMM d, yyyy • h:mm a')}</p>
                    </div>
                  </li>
                  );
                })}
              </ol>
            )}

            <IssueCommentComposer
              issueId={issue.id}
              buildingId={issue.building_id}
              issueTitle={issue.title}
              reporterId={issue.reported_by}
              assigneeId={issue.assigned_to}
              onPosted={() => { void load(); onUpdated(); }}
            />
          </div>
        </div>

        <ResolveIssueDialog
          nested
          issueId={issue.id}
          contractorId={contractorId}
          open={resolveOpen}
          onOpenChange={setResolveOpen}
          onResolved={() => { onUpdated(); void load(); }}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
