/** Report editor: section navigator + active section form + lifecycle actions. */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ClipboardCheck, FileDown, Loader2, Send, Undo2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useOrganization } from '@/hooks/useOrganization';
import { generateReportPdf } from '@/lib/fortressReportPdf';
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
import { useFortressReport, useReportLifecycle } from '@/hooks/useFortressReports';
import { REPORT_SECTIONS, REPORT_STATUS_VARIANT, formatPeriodLabel, REQUIRED_SECTIONS, REQUIRED_SECTION_TABLE } from '@/lib/fortressReports';
import { fdb, REPORT_TYPE_LABELS, type ReportStatus } from '@/integrations/supabase/fortress-db';
import { getSectionComponent } from './sections/registry';

export default function FortressReportEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, role, isAdminOrManager } = useAuth();
  const isReviewer = role === 'reviewer';
  const { organization } = useOrganization();
  const { data: report, isLoading } = useFortressReport(id);
  const lifecycle = useReportLifecycle(id!);
  const qc = useQueryClient();

  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [preparedFor, setPreparedFor] = useState('');
  const [reviewOpen, setReviewOpen] = useState<null | ReportStatus>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [exporting, setExporting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { setPreparedFor(report?.prepared_for ?? ''); }, [report?.prepared_for]);

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

  const handleExport = async () => {
    if (!id) return;
    setExporting(true);
    try {
      await generateReportPdf(id, { name: organization?.name ?? 'GMI Operations', primaryColor: organization?.primary_color ?? '#2563eb', logoUrl: organization?.logo_url ?? null });
    } catch (e) {
      if (import.meta.env.DEV) console.error('PDF export failed:', e);
      toast.error('Could not generate the PDF.');
    } finally {
      setExporting(false);
    }
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

  const sections = REPORT_SECTIONS[report.report_type] ?? [];
  const current = activeKey ?? sections[0]?.key ?? null;
  const status = report.status as ReportStatus;
  const isAuthor = report.author_id === user?.id;
  const editable = (status === 'draft' || status === 'rejected') && (isAuthor || isAdminOrManager);
  const SectionComp = current ? getSectionComponent(current) : undefined;
  const currentMeta = sections.find((s) => s.key === current);

  const transition = (next: ReportStatus, notes?: string) => {
    lifecycle.mutate({ status: next, reviewNotes: notes }, { onSuccess: () => { setReviewOpen(null); setReviewNotes(''); } });
  };

  /** Block draft→submitted until each required section has at least one row. */
  const validateAndSubmit = async () => {
    if (!id || !report) return;
    setSubmitting(true);
    try {
      const metas = REPORT_SECTIONS[report.report_type as keyof typeof REPORT_SECTIONS] ?? [];
      const missing: string[] = [];
      for (const k of REQUIRED_SECTIONS[report.report_type as keyof typeof REQUIRED_SECTIONS] ?? []) {
        const table = REQUIRED_SECTION_TABLE[k];
        if (!table) continue;
        const { count } = await (fdb as any).from(table).select('id', { count: 'exact', head: true }).eq('report_id', id);
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
  // submitted → reviewed: reviewer role or admin/manager.
  if (status === 'submitted' && (isReviewer || isAdminOrManager)) {
    actions.push({ label: 'Mark reviewed', icon: ClipboardCheck, next: 'reviewed', variant: 'outline' });
  }
  // approve/reject reachable from both submitted and reviewed (admin/manager only).
  if ((status === 'submitted' || status === 'reviewed') && isAdminOrManager) {
    actions.push({ label: 'Approve', icon: CheckCircle2, next: 'approved' });
    actions.push({ label: 'Reject', icon: XCircle, next: 'rejected', variant: 'destructive', needsNotes: true });
  }
  if ((status === 'rejected' || status === 'approved') && isAdminOrManager) {
    actions.push({ label: 'Reopen as draft', icon: Undo2, next: 'draft', variant: 'outline' });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-1" onClick={() => navigate(`/buildings/${report.building_id}?tab=reports`)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to building
          </Button>
          <h1 className="text-2xl font-semibold">{report.title}</h1>
          <p className="text-sm text-muted-foreground">
            {REPORT_TYPE_LABELS[report.report_type]} · {formatPeriodLabel(report.report_period)}
          </p>
          {editable ? (
            <div className="mt-2 flex items-center gap-2">
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
          ) : (
            report.prepared_for && (
              <p className="mt-1 text-sm text-muted-foreground">Prepared for {report.prepared_for}</p>
            )
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={REPORT_STATUS_VARIANT[status] ?? 'outline'} className="capitalize">{status}</Badge>
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

      {report.review_notes && status === 'rejected' && (
        <Card className="border-destructive/40">
          <CardContent className="pt-4 text-sm">
            <span className="font-medium text-destructive">Returned: </span>{report.review_notes}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-[220px_1fr]">
        <nav className="space-y-1">
          {sections.map((s) => {
            const built = !!getSectionComponent(s.key);
            return (
              <button
                key={s.key}
                onClick={() => setActiveKey(s.key)}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors',
                  current === s.key ? 'bg-muted font-medium' : 'hover:bg-muted/50',
                )}
              >
                <span>{s.label}</span>
                {!built && <span className="text-[10px] text-muted-foreground">soon</span>}
              </button>
            );
          })}
        </nav>

        <div>
          {SectionComp && current ? (
            <SectionComp reportId={report.id} buildingId={report.building_id} readOnly={!editable} />
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

      <Dialog open={reviewOpen !== null} onOpenChange={(o) => !o && setReviewOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return report to author</DialogTitle>
            <DialogDescription>Add a note explaining what needs to change. The author will see this.</DialogDescription>
          </DialogHeader>
          <Textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} placeholder="What needs fixing…" rows={4} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(null)}>Cancel</Button>
            <Button variant="destructive" disabled={lifecycle.isPending} onClick={() => reviewOpen && transition(reviewOpen, reviewNotes)}>
              Return to author
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
