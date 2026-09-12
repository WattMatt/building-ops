/**
 * "Team" on a building, admin/manager only (the trigger is not mounted for `user`): who is on
 * this building, what each field member does here (one person per role label — tapping a chip
 * moves the rule), Add person (writes user_buildings and, when offered, the 'user' rule), Remove
 * (rules → open tasks → access, reported honestly on partial failure), and the one-off "Apply to
 * existing pending tasks" catch-up that used to live on the Checklists tab.
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, UserCheck, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useBuildingMembers, memberDisplayName, type BuildingMember } from '@/hooks/useBuildingMembers';
import { useBuildingRoleAssignments, buildingRolesKey } from '@/hooks/useBuildingRoleAssignments';
import { useAssignablePeople, addablePeople } from '@/hooks/useAssignablePeople';
import { portfolioCoverageKey } from '@/hooks/usePortfolioCoverage';
import { roleLabel } from '@/components/building/RoleAssignmentsPanel';
import { MemberRow } from './MemberRow';
import { AddPersonDialog } from './AddPersonDialog';
import { RemoveMemberDialog } from './RemoveMemberDialog';
import { addMember, countOpenTasksFor, removeMember, describeRemoveOutcome } from './teamActions';

interface TeamTabProps {
  buildingId: string;
  buildingName?: string;
}

const isManagerRole = (m: BuildingMember) => m.role === 'admin' || m.role === 'manager';

export default function TeamTab({ buildingId, buildingName }: TeamTabProps) {
  const { isAdminOrManager } = useAuth();
  const queryClient = useQueryClient();
  const members = useBuildingMembers(buildingId);
  const { rules, roles, pendingByRole, isLoading: rulesLoading, isError: rulesError, setRule, applyToPending } = useBuildingRoleAssignments(buildingId);
  const people = useAssignablePeople(isAdminOrManager);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<{ member: BuildingMember; openTasks: number | null } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const name = buildingName ?? 'this building';
  const all = useMemo(() => members.data ?? [], [members.data]);
  const managers = useMemo(() => all.filter(isManagerRole), [all]);
  const field = useMemo(() => all.filter((m) => !isManagerRole(m)), [all]);
  const addable = useMemo(() => addablePeople(people.data ?? [], new Set(all.map((m) => m.id))), [people.data, all]);
  const hasUserRule = rules.has('user');
  const applicable = roles.reduce((n, role) => n + (rules.has(role) ? pendingByRole.get(role) ?? 0 : 0), 0);

  if (!isAdminOrManager) return null;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['building-members', buildingId] }),
      queryClient.invalidateQueries({ queryKey: buildingRolesKey(buildingId) }),
      queryClient.invalidateQueries({ queryKey: portfolioCoverageKey }),
    ]);

  const handleToggleRule = async (member: BuildingMember, role: string, held: boolean) => {
    setBusyRole(role);
    try {
      await setRule(role, held ? null : member.id);
      toast.success(held ? `${roleLabel(role)}: nobody` : `${roleLabel(role)}: ${memberDisplayName(member)}`);
      void queryClient.invalidateQueries({ queryKey: portfolioCoverageKey });
    } catch (e) {
      toast.error(`Could not save the rule: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setBusyRole(null);
    }
  };

  const handleAdd = async (personId: string, makeDefault: boolean) => {
    const person = addable.find((p) => p.id === personId);
    const who = person?.full_name?.trim() || 'Unnamed user';
    const out = await addMember(buildingId, personId, makeDefault, setRule);
    if (out.ok) {
      toast.success(makeDefault ? `Added ${who} to ${name} and made them the default for daily tasks` : `Added ${who} to ${name}`);
    } else if (out.step === 'membership') {
      toast.error(`Could not add ${who}: ${out.message}`);
    } else {
      toast.error(`Added ${who} to ${name}, but could not make them the default for daily tasks: ${out.message}`);
    }
    await refresh();
  };

  const openRemove = async (member: BuildingMember) => {
    setRemoving({ member, openTasks: null });
    try {
      const n = await countOpenTasksFor(buildingId, member.id);
      setRemoving((cur) => (cur && cur.member.id === member.id ? { member, openTasks: n } : cur));
    } catch (e) {
      toast.error(`Could not count their open tasks: ${e instanceof Error ? e.message : 'unknown error'}`);
      setRemoving(null);
    }
  };

  const confirmRemove = async () => {
    if (!removing || removing.openTasks === null) return;
    const { member, openTasks } = removing;
    const held = [...rules].filter(([, uid]) => uid === member.id).map(([role]) => role);
    setRemoveBusy(true);
    try {
      const out = await removeMember(buildingId, member.id, held, openTasks);
      const text = describeRemoveOutcome(memberDisplayName(member), out);
      if (out.ok) toast.success(text); else toast.error(text);
    } finally {
      setRemoveBusy(false);
      setRemoving(null);
      await refresh();
    }
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      const n = await applyToPending();
      if (n > 0) toast.success(`Assigned ${n} pending task${n === 1 ? '' : 's'} at ${name}`);
      else toast.info('No unassigned pending tasks match these rules');
    } catch (e) {
      toast.error(`Could not apply the rules: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="team-tab">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" aria-hidden="true" />
                Team at {name}
              </CardTitle>
              <CardDescription>Who works here and what each person does. New tasks are assigned from these roles every night.</CardDescription>
            </div>
            <Button onClick={() => setAddOpen(true)} className="min-h-11 w-full sm:w-auto">
              <UserPlus className="h-4 w-4 mr-2" aria-hidden="true" />
              Add person
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {members.isLoading || rulesLoading ? (
            <div className="space-y-2" role="status" aria-label="Loading team">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : members.isError ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-3">
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0" aria-hidden="true" />
                <p className="text-sm">Could not load the people on this building.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void members.refetch()} className="min-h-11">Try again</Button>
            </div>
          ) : (
            <>
              {rulesError && <p className="text-sm text-destructive">Could not load the role rules for this building; chips may be stale.</p>}
              <section>
                <h3 className="text-sm font-medium mb-1">Managers</h3>
                <p className="text-xs text-muted-foreground mb-2">Admins and managers see every building; nothing to set here.</p>
                <ul aria-label="Managers" className="divide-y">
                  {managers.map((m) => (
                    <li key={m.id} className="py-2 text-sm">{memberDisplayName(m)} <span className="text-muted-foreground">· {m.role}</span></li>
                  ))}
                  {managers.length === 0 && <li className="py-2 text-sm text-muted-foreground">No managers found.</li>}
                </ul>
              </section>
              <section>
                <h3 className="text-sm font-medium mb-2">Field staff</h3>
                {field.length === 0 ? (
                  // Guardrail, not a hint: this is the state every coverage surface is nagging about.
                  <p className="text-sm text-destructive">Nobody is on this building yet. Tasks here reach no one.</p>
                ) : (
                  <ul aria-label="Field staff" className="divide-y">
                    {field.map((m) => (
                      <MemberRow
                        key={m.id}
                        member={m}
                        roles={roles}
                        rules={rules}
                        busyRole={busyRole}
                        onToggleRule={(role, held) => void handleToggleRule(m, role, held)}
                        onRemove={() => void openRemove(m)}
                      />
                    ))}
                  </ul>
                )}
              </section>
              <Button variant="secondary" onClick={handleApply} disabled={applying || applicable === 0} className="min-h-11 w-full sm:w-auto">
                {applying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <UserCheck className="mr-2 h-4 w-4" aria-hidden="true" />}
                Apply to existing pending tasks ({applicable})
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <AddPersonDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        buildingName={name}
        people={addable}
        isLoading={people.isLoading}
        isError={people.isError}
        offerDefault={!hasUserRule}
        onAdd={handleAdd}
      />
      <RemoveMemberDialog
        open={removing !== null}
        onOpenChange={(open) => { if (!open && !removeBusy) setRemoving(null); }}
        name={removing ? memberDisplayName(removing.member) : ''}
        buildingName={name}
        openTasks={removing?.openTasks ?? null}
        busy={removeBusy}
        onConfirm={() => void confirmRemove()}
      />
    </div>
  );
}
