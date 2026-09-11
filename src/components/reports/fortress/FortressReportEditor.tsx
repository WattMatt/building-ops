/** Report editor: section navigator + active section form + lifecycle actions. */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ClipboardCheck, FileDown, Loader2, Send, Share2, Trash2, Undo2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useOrganization } from '@/hooks/useOrganization';
import { generateReportPdf } from '@/lib/fortressReportPdf';
import { listReportArtifactsForSource, saveReportArtifact, type ReportArtifactKind, type ReportArtifactRow } from '@/lib/reportArtifacts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useDiscardDraft, useFortressReport, useReportLifecycle } from '@/hooks/useFortressReports';
import { REPORT_SECTIONS, REPORT_STATUS_VARIANT, formatPeriodLabel, REQUIRED_SECTIONS, REQUIRED_SECTION_TABLE } from '@/lib/fortressReports';
import { useReportSectionCounts } from '@/hooks/useReportSectionCounts';
import { ReportSavedVersions } from '@/components/reports/fortress/ReportSavedVersions';
import { ShareReportDialog } from '@/components/reports/fortress/ShareReportDialog';
import { DiscardDraftDialog } from '@/components/reports/fortress/DiscardDraftDialog';
import { fdb, REPORT_TYPE_LABELS, type ReportStatus, type ReportType } from '@/integrations/supabase/fortress-db';
import { getSectionComponent } from './sections/registry';
import { dirtySections, useDirtyCount } from './dirtySections';
import { Hint } from '@/components/ui/hint';
import { useFeature } from '@/hooks/useOrgSettings';
import { track } from '@/lib/analytics';

// REQUIRED_SECTION_TABLE names section tables as strings, so the count probe uses a narrow structural client
// instead of the typed one (which would demand a literal table name).
interface SectionCountClient {
  from(table: string): {
    select(cols: string, opts: { count: 'exact'; head: true }): { eq(col: string, value: string | undefined): Promise<{ count: number | null }> };
  };
}

export default function FortressReportEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, isAdmin, isAdminOrManager } = useAuth();
  const { organization, loading: orgLoading } = useOrganization();
  const { data: report, isLoading } = useFortressReport(id);
  const lifecycle = useReportLifecycle(id!);
  const discard = useDiscardDraft();
  const qc = useQueryClient();
  const shareLinks = useFeature('share_links');

  // Same key ReportSavedVersions reads, so the header button and the versions card never disagree
  // about whether this report has a PDF to share.
  const { data: artifacts } = useQuery({
    queryKey: ['report-artifacts', id],
    enabled: !!id,
    queryFn: async (): Promise<ReportArtifactRow[]> => {
      const { data: rows, error } = await listReportArtifactsForSource(id!);
      if (error) throw new Error(error);
      return rows;
    },
  });

  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [preparedFor, setPreparedFor] = useState('');
  const [reviewOpen, setReviewOpen] = useState<null | ReportStatus>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareArtifactId, setShareArtifactId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Unsaved section edits (D1). Only the active section is mounted, so any dirty grid
  // belongs to the section on screen.
  const dirtyCount = useDirtyCount();
  const anyDirty = dirtyCount > 0;

  // Refresh / tab close with unsaved edits: the browser shows its own confirm.
  useEffect(() => {
    if (!anyDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [anyDirty]);

  // Leaving the editor entirely must not leave stale ids behind for the next report.
  useEffect(() => () => dirtySections.reset(), []);

  /** True when it is safe to leave the current section (clean, or the user chose to discard). */
  const confirmLeave = () => {
    if (!anyDirty) return true;
    const ok = window.confirm('This section has unsaved changes. Discard them?');
    if (ok) dirtySections.reset();
    return ok;
  };

  useEffect(() => { setPreparedFor(report?.prepared_for ?? ''); }, [report?.prepared_for]);

  // Row counts per section, so the navigator can show which tabs actually hold anything.
  const { data: counts } = useReportSectionCounts(id, report?.building_id, report?.report_type);
  const filledCount = counts ? Object.values(counts).filter((n) => (n ?? 0) > 0).length : 0;

  // Hoisted above the early returns: the export confirm (E1) needs the section list and
  // the lifecycle status, and it is defined before them.
  const sections = report ? (REPORT_SECTIONS[report.report_type as ReportType] ?? []) : [];
  const status = (report?.status ?? 'draft') as ReportStatus;
  // Built sections only — an unbuilt one has no form to fill, so naming it as "empty"
  // would ask the user for something they cannot give.
  const builtSectionCount = sections.filter((s) => getSectionComponent(s.key)).length;
  const emptySections = counts
    ? sections.filter((s) => getSectionComponent(s.key) && counts[s.key] === 0).map((s) => s.label)
    : [];

  const savePreparedFor = async () => {
    if (!id || !report) return;
    const next = preparedFor.trim() || null;
    if (next === (report.prepared_for ?? null)) return;
    const { error } = await fdb.from('reports').update({ prepared_for: next }).eq('id', id);
    if (error) {
      if (import.meta.env.DEV) console.error('Update prepared_for failed:', error);
      toast.error('Could not save “Prepared for”.');
      setPreparedFor(report.prepared_for ?? '');
      return;
    }
    qc.invalidateQueries({ queryKey: ['fortress-reports'] });
  };

  const runExport = async () => {
    if (!id || exporting) return;
    setExporting(true);
    try {
      // Report header uses the organisation's configured name + logo (Settings).
      const generated = await generateReportPdf(id, { name: organization?.name ?? '', primaryColor: organization?.primary_color ?? '#2563eb', logoUrl: organization?.logo_url ?? null });
      track('report_exported', { reportType: generated.reportType, reportStatus: generated.reportStatus });
      // Download always succeeds by this point — persistence is best-effort on
      // top (standard D2/D4), and the toast reports both outcomes.
      if (organization?.id && user) {
        const saved = await saveReportArtifact({
          orgId: organization.id,
          kind: `fortress_${generated.reportType}` satisfies ReportArtifactKind,
          blob: generated.blob,
          fileName: generated.fileName,
          generatedBy: user.id,
          sourceId: id,
          buildingId: generated.buildingId,
          reportStatus: generated.reportStatus,
        });
        if (saved.ok) {
          qc.invalidateQueries({ queryKey: ['report-artifacts', id] });
          toast.success('Report PDF downloaded and saved to Saved Reports.');
          // The new version is issued either way, but silently dropping this left an
          // older row still showing as current in Saved Versions.
          if (saved.supersedeWarning) toast.warning(saved.supersedeWarning);
        } else {
          if (import.meta.env.DEV) console.error('Report persist failed:', saved.error);
          toast.warning('Report PDF downloaded, but could not be saved to Saved Reports.');
        }
      } else {
        // Persistence needs the org (for the version chain) and the user (RLS requires
        // generated_by = auth.uid()). Saying only "downloaded" here would let a silent
        // skip read as a complete success, so name what did not happen.
        if (import.meta.env.DEV) console.warn('Artifact not saved:', { orgLoading, hasOrg: !!organization?.id, hasUser: !!user });
        toast.warning(
          orgLoading
            ? 'Report PDF downloaded. It was not saved to Saved Reports because the organisation was still loading — try again in a moment.'
            : 'Report PDF downloaded, but it was not saved to Saved Reports.',
        );
      }
    } catch (e) {
      if (import.meta.env.DEV) console.error('PDF export failed:', e);
      // generateReportPdf fails loudly with a named cause (which table could not be
      // read). A generic toast here muted that — surface it so the user can act.
      const msg = e instanceof Error && e.message ? ` ${e.message}` : '';
      toast.error(`Could not generate the PDF.${msg}`);
    } finally {
      setExporting(false);
    }
  };

  /** Every export becomes the current issued version, so an incomplete or unapproved one is confirmed first (E1). */
  const handleExport = () => {
    // The PDF is generated from saved rows — exporting while dirty would quietly ship a
    // document missing what is on screen.
    if (anyDirty) { toast.error('Save your changes in this section before exporting.'); return; }
    if (emptySections.length || status !== 'approved') { setExportConfirmOpen(true); return; }
    void runExport();
  };

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading report…</div>;
  }
  if (!report) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Report not found, or you don’t have access.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/buildings')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to reports
        </Button>
      </div>
    );
  }

  const current = activeKey ?? sections[0]?.key ?? null;
  const isAuthor = report.author_id === user?.id;
  const editable = (status === 'draft' || status === 'rejected') && (isAuthor || isAdminOrManager);
  const SectionComp = current ? getSectionComponent(current) : undefined;
  const currentMeta = sections.find((s) => s.key === current);

  // One-line workflow hint per status + role, so nobody has to reverse-engineer the
  // lifecycle from which buttons happen to appear. Coaching only — rendered through
  // <Hint>, so experienced users can switch it off from the header lightbulb.
  const statusHint = (() => {
    switch (status) {
      case 'draft':
        return editable
          ? 'Fill in each section, then Submit for review. Each section saves on its own.'
          : 'Draft in progress — waiting on the author to complete and submit it.';
      case 'submitted':
        return isAdminOrManager
          ? 'Look through the sections, then Mark reviewed, Approve, or Reject with a note for the author. Approving also saves the final PDF.'
          : 'Locked while awaiting review. An admin or manager can reopen it as a draft.';
      case 'reviewed':
        return isAdminOrManager
          ? 'Reviewed — Approve to finalise it, or Reject to return it to the author with a note. Approving also saves the final PDF.'
          : 'Reviewed — waiting for a manager to approve.';
      case 'rejected':
        return isAuthor || isAdminOrManager
          ? 'Returned for changes — fix the sections, then Re-submit for review.'
          : 'Returned to the author for changes.';
      case 'approved':
        return 'Approved and locked. An admin or manager can reopen it as a draft if changes are needed.';
      default:
        return null;
    }
  })();

  const transition = (next: ReportStatus, notes?: string) => {
    lifecycle.mutate({ status: next, reviewNotes: notes }, { onSuccess: () => { setReviewOpen(null); setReviewNotes(''); } });
  };

  /** Block draft→submitted until each required section has at least one row. */
  const validateAndSubmit = async () => {
    if (!id || !report) return;
    // Submitting locks the report; typed-but-unsaved rows would be lost with the gate
    // passing on previously saved rows.
    if (anyDirty) { toast.error('Save your changes in this section before submitting.'); return; }
    setSubmitting(true);
    try {
      const metas = REPORT_SECTIONS[report.report_type as keyof typeof REPORT_SECTIONS] ?? [];
      const missing: string[] = [];
      for (const k of REQUIRED_SECTIONS[report.report_type as keyof typeof REQUIRED_SECTIONS] ?? []) {
        const table = REQUIRED_SECTION_TABLE[k];
        if (!table) continue;
        const { count } = await (fdb as unknown as SectionCountClient).from(table).select('id', { count: 'exact', head: true }).eq('report_id', id);
        if (!count) missing.push(metas.find((s) => s.key === k)?.label ?? k);
      }
      if (missing.length) { toast.error(`Add at least one entry to: ${missing.join(', ')}`); return; }
      transition('submitted');
    } finally {
      setSubmitting(false);
    }
  };

  const actions: { label: string; icon: typeof Send; next: ReportStatus; variant?: 'default' | 'outline' | 'destructive'; needsNotes?: boolean }[] = [];
  // draft → submitted (author or admin/manager); rejected → submitted (author re-submits a fixed report).
  if ((status === 'draft' || status === 'rejected') && (isAuthor || isAdminOrManager)) {
    actions.push({ label: status === 'rejected' ? 'Re-submit for review' : 'Submit for review', icon: Send, next: 'submitted' });
  }
  // submitted → reviewed: admin/manager only.
  if (status === 'submitted' && isAdminOrManager) {
    actions.push({ label: 'Mark reviewed', icon: ClipboardCheck, next: 'reviewed', variant: 'outline' });
  }
  // approve/reject reachable from both submitted and reviewed (admin/manager only).
  if ((status === 'submitted' || status === 'reviewed') && isAdminOrManager) {
    actions.push({ label: 'Approve', icon: CheckCircle2, next: 'approved' });
    actions.push({ label: 'Reject', icon: XCircle, next: 'rejected', variant: 'destructive', needsNotes: true });
  }
  // Reopen is offered from every non-draft state. Without 'submitted' here a submitted
  // report is a dead end: `editable` requires draft/rejected, so the only way back to
  // editing was to Approve or Reject it first — which records a review decision nobody
  // made just to fix a typo. This matters in bulk: reports loaded by an import all arrive
  // as 'submitted'.
  if (status !== 'draft' && isAdminOrManager) {
    actions.push({ label: 'Reopen as draft', icon: Undo2, next: 'draft', variant: 'outline' });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-1" onClick={() => { if (confirmLeave()) navigate(`/buildings/${report.building_id}?tab=reports`); }}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to building
          </Button>
          {/* Building names always display uppercase; the name is baked into the composed title. */}
          <h1 className="text-2xl font-semibold">{report.title?.toUpperCase()}</h1>
          <p className="text-sm text-muted-foreground">
            {REPORT_TYPE_LABELS[report.report_type as ReportType]} · {formatPeriodLabel(report.report_period)}
          </p>
          {editable ? (
            <div className="mt-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="prepared-for" className="text-xs text-muted-foreground">Prepared for</Label>
                <Input
                  id="prepared-for"
                  className="h-8 w-56"
                  placeholder="e.g. Capital Propfund"
                  value={preparedFor}
                  onChange={(e) => setPreparedFor(e.target.value)}
                  onBlur={savePreparedFor}
                />
              </div>
              <Hint icon={false} className="mt-1">Printed on the PDF cover under the managers.</Hint>
            </div>
          ) : (
            report.prepared_for && (
              <p className="mt-1 text-sm text-muted-foreground">Prepared for {report.prepared_for}</p>
            )
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={REPORT_STATUS_VARIANT[status] ?? 'outline'} className="capitalize">{status}</Badge>
          {status === 'draft' && isAdmin && (
            <>
              <Button variant="ghost" size="sm" className="min-h-11" disabled={discard.isPending} onClick={() => setDiscardOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4" />
                Discard draft
              </Button>
              <DiscardDraftDialog open={discardOpen} onOpenChange={setDiscardOpen} pending={discard.isPending}
                onConfirm={() => discard.mutate(report.id, { onSuccess: () => navigate(`/buildings/${report.building_id}?tab=reports`) })} />
            </>
          )}
          {/* Share stays enabled with no saved PDF: a `title` on a disabled button is never announced
              and never appears on touch, and the dialog already explains the empty case in plain copy. */}
          {shareLinks && isAdminOrManager && (
            <Button
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={() => { setShareArtifactId(null); setShareOpen(true); }}
            >
              <Share2 className="mr-2 h-4 w-4" />
              Share
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
            Export PDF
          </Button>
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <Button
                key={a.next + a.label}
                variant={a.variant ?? 'default'}
                size="sm"
                disabled={lifecycle.isPending || submitting}
                onClick={() => (a.needsNotes ? setReviewOpen(a.next) : a.next === 'submitted' ? validateAndSubmit() : transition(a.next))}
              >
                {lifecycle.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Icon className="mr-2 h-4 w-4" />}
                {a.label}
              </Button>
            );
          })}
        </div>
      </div>

      {statusHint && <Hint className="-mt-2">{statusHint}</Hint>}

      {/* The approval toast is gone on reload; this is the durable signal that the approval stands but
          its final PDF does not exist. Plain text, never a Hint: it is a state warning, not coaching. */}
      {status === 'approved' && artifacts?.length === 0 && (
        <p className="-mt-2 text-sm">Approved, but no final PDF is saved yet — use Export PDF.</p>
      )}

      {status === 'rejected' && (
        <Card className="border-destructive/40">
          <CardContent className="pt-4 text-sm">
            <span className="font-medium text-destructive">Returned: </span>
            {report.review_notes?.trim() || 'No note was left with this return. Ask the reviewer what needs to change.'}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        <nav className="space-y-1">
          {counts && (
            <p className="px-3 pb-2 text-xs text-muted-foreground">
              {filledCount} of {sections.length} sections have content
            </p>
          )}
          {sections.map((s) => {
            const built = !!getSectionComponent(s.key);
            const n = counts?.[s.key];
            return (
              <button
                key={s.key}
                onClick={() => { if (s.key === current || confirmLeave()) setActiveKey(s.key); }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                  current === s.key ? 'bg-muted font-medium' : 'hover:bg-muted/50',
                  n === 0 && 'text-muted-foreground',
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{s.label}</span>
                  {current === s.key && anyDirty && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-label="Unsaved changes" />
                  )}
                </span>
                {!built ? (
                  <span className="text-[10px] text-muted-foreground">soon</span>
                ) : n === null || n === undefined ? null : n > 0 ? (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                    {n}
                  </span>
                ) : (
                  <span className="shrink-0 text-[10px] text-muted-foreground">empty</span>
                )}
              </button>
            );
          })}
        </nav>

        <div>
          {SectionComp && current ? (
            // A read-only section with no rows would otherwise render as a blank data-entry
            // form — inputs the user cannot fill, and no hint that the data was simply never
            // captured. Say so instead. Only when read-only: an editable empty section is
            // exactly where someone goes to start entering.
            !editable && counts?.[current] === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">{currentMeta?.label}</p>
                  <p className="mt-1">Nothing was captured for this section in this period.</p>
                  {currentMeta?.hint && <Hint className="mt-2 justify-center">{currentMeta.hint}</Hint>}
                  {isAdminOrManager && (
                    <p className="mt-4 text-xs">
                      Reopen this report as a draft to add it.
                    </p>
                  )}
                </CardContent>
              </Card>
            ) : (
              <SectionComp reportId={report.id} buildingId={report.building_id} readOnly={!editable} />
            )
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                <p className="font-medium">{currentMeta?.label}</p>
                <p className="mt-1">This section form is coming soon.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <ReportSavedVersions
        reportId={report.id}
        onShare={shareLinks && isAdminOrManager ? (a) => { setShareArtifactId(a.id); setShareOpen(true); } : undefined}
      />

      <ShareReportDialog
        reportId={report.id}
        artifacts={artifacts ?? []}
        initialArtifactId={shareArtifactId}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />

      {/* Guardrail, not coaching — never routed through <Hint>. */}
      <Dialog open={exportConfirmOpen} onOpenChange={setExportConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export this report as a PDF?</DialogTitle>
            <DialogDescription>
              {status !== 'approved' && <>This report is <b>{status}</b>, not approved — the PDF will carry a DRAFT watermark. </>}
              {emptySections.length > 0 && <>{emptySections.length} of {builtSectionCount} sections are empty: {emptySections.join(', ')}. </>}
              Every export is kept as the next issued version.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportConfirmOpen(false)}>Cancel</Button>
            <Button disabled={exporting} onClick={() => { setExportConfirmOpen(false); void runExport(); }}>Export anyway</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reviewOpen !== null} onOpenChange={(o) => !o && setReviewOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return report to author</DialogTitle>
            <DialogDescription>Add a note explaining what needs to change. The author will see this.</DialogDescription>
          </DialogHeader>
          <Textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} placeholder="What needs fixing…" rows={4} />
          <p className="text-xs text-muted-foreground">A note is required — it is the only thing the author will see.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={lifecycle.isPending || !reviewNotes.trim()}
              onClick={() => reviewOpen && transition(reviewOpen, reviewNotes.trim())}
            >
              Return to author
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
