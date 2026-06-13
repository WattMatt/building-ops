/** New-Report wizard step 1: pick building + type + period → create a draft. */
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

export function NewReportDialog() {
  const navigate = useNavigate();
  const { buildings } = useBuildings();
  const createReport = useCreateReport();

  const [open, setOpen] = useState(false);
  const [buildingId, setBuildingId] = useState('');
  const [reportType, setReportType] = useState<ReportType>('ops_monthly');
  const [month, setMonth] = useState(defaultMonth());

  const canCreate = buildingId && reportType && month;

  const handleCreate = async () => {
    if (!canCreate) return;
    const building = buildings.find((b) => b.id === buildingId);
    const period = periodFromMonthInput(month);
    const title = `${REPORT_TYPE_LABELS[reportType]} — ${building?.name ?? 'Building'} — ${formatPeriodLabel(period)}`;
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
          <DialogDescription>Create a draft. You can start from a blank report and fill sections as you go.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Building</Label>
            <Select value={buildingId} onValueChange={setBuildingId}>
              <SelectTrigger><SelectValue placeholder="Select a building" /></SelectTrigger>
              <SelectContent>
                {buildings.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
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
