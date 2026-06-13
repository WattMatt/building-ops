/** New-Report wizard: type + period → create a draft. Building is locked to the one
 *  passed in (reports are authored per building); falls back to a picker if none given. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus } from 'lucide-react';
import { useBuildings } from '@/hooks/useBuildings';
import { useCreateReport } from '@/hooks/useFortressReports';
import { REPORT_TYPE_LABELS, type ReportType } from '@/integrations/supabase/fortress-db';
import { periodFromMonthInput, formatPeriodLabel } from '@/lib/fortressReports';

const defaultMonth = () => new Date().toISOString().slice(0, 7);

interface NewReportDialogProps {
  /** when set, the report is scoped to this building and the picker is hidden */
  buildingId?: string;
  buildingName?: string;
}

export function NewReportDialog({ buildingId: lockedBuildingId, buildingName: lockedName }: NewReportDialogProps = {}) {
  const navigate = useNavigate();
  const { buildings } = useBuildings();
  const createReport = useCreateReport();

  const [open, setOpen] = useState(false);
  const [pickedBuildingId, setPickedBuildingId] = useState('');
  const [reportType, setReportType] = useState<ReportType>('ops_monthly');
  const [month, setMonth] = useState(defaultMonth());

  const buildingId = lockedBuildingId ?? pickedBuildingId;
  const buildingName = lockedName ?? buildings.find((b) => b.id === buildingId)?.name ?? 'Building';
  const canCreate = buildingId && reportType && month;

  const handleCreate = async () => {
    if (!canCreate) return;
    const period = periodFromMonthInput(month);
    const title = `${REPORT_TYPE_LABELS[reportType]} — ${buildingName} — ${formatPeriodLabel(period)}`;
    const report = await createReport.mutateAsync({
      buildingId,
      reportType,
      reportPeriod: period,
      title,
      inspectionDate: reportType === 'annual_inspection' ? period : null,
    });
    setOpen(false);
    navigate(`/reports/fortress/${report.id}`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="mr-2 h-4 w-4" /> New Report</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Report</DialogTitle>
          <DialogDescription>
            {lockedBuildingId ? `Create a draft report for ${buildingName}.` : 'Create a draft. Fill sections as you go.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!lockedBuildingId && (
            <div className="space-y-2">
              <Label>Building</Label>
              <Select value={pickedBuildingId} onValueChange={setPickedBuildingId}>
                <SelectTrigger><SelectValue placeholder="Select a building" /></SelectTrigger>
                <SelectContent>
                  {buildings.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label>Report type</Label>
            <Select value={reportType} onValueChange={(v) => setReportType(v as ReportType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(REPORT_TYPE_LABELS) as ReportType[]).map((t) => (
                  <SelectItem key={t} value={t}>{REPORT_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="report-month">Period</Label>
            <Input id="report-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!canCreate || createReport.isPending}>
            {createReport.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
