/**
 * Portfolio coverage for one period: rows = buildings, columns = report types, cell = status chip.
 * Admins can mark which types a building owes (so "missing" is honest) and discard an empty draft.
 */
import { MoreHorizontal, Trash2 } from 'lucide-react';
import type { ReportType } from '@/integrations/supabase/fortress-db';
import { REPORT_STATUS_VARIANT, formatPeriodLabel } from '@/lib/fortressReports';
import { formatBuildingName } from '@/lib/buildingName';
import { COVERAGE_TYPES, COVERAGE_TYPE_LABELS, summaryLine, type CoverageRow, type CoverageSummary } from '@/lib/reportCoverage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export interface CoverageGridProps {
  period: string;
  rows: CoverageRow[];
  summary: CoverageSummary;
  isAdmin: boolean;
  onOpenReport: (reportId: string) => void;
  onOpenBuilding: (buildingId: string) => void;
  onDiscardDraft: (reportId: string) => void;
  onSetReportTypes: (buildingId: string, types: ReportType[]) => void;
  discarding?: boolean;
}

export function CoverageGrid({ period, rows, summary, isAdmin, onOpenReport, onOpenBuilding, onDiscardDraft, onSetReportTypes, discarding }: CoverageGridProps) {
  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">Coverage — {formatPeriodLabel(period)}</CardTitle>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          {COVERAGE_TYPES.map((t) => (
            <span key={t} data-testid={`summary-${t}`}><span className="font-medium text-foreground">{COVERAGE_TYPE_LABELS[t]}:</span> {summaryLine(summary[t])}</span>
          ))}
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Building</TableHead>
              {COVERAGE_TYPES.map((t) => <TableHead key={t}>{COVERAGE_TYPE_LABELS[t]}</TableHead>)}
              {isAdmin && <TableHead className="w-12"><span className="sr-only">Report types</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const owed = COVERAGE_TYPES.filter((t) => row.cells[t].status !== 'na');
              return (
                <TableRow key={row.buildingId}>
                  <TableCell className="font-medium">{formatBuildingName(row.name)}</TableCell>
                  {COVERAGE_TYPES.map((t) => {
                    const cell = row.cells[t];
                    if (cell.status === 'na') {
                      return <TableCell key={t}><span className="text-muted-foreground" title="Not required for this building">—</span></TableCell>;
                    }
                    const reportId = cell.reportId;
                    return (
                      <TableCell key={t}>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="inline-flex min-h-11 items-center rounded-md px-1 text-left"
                            aria-label={`${COVERAGE_TYPE_LABELS[t]} ${cell.status} for ${row.name}`}
                            onClick={() => (reportId ? onOpenReport(reportId) : onOpenBuilding(row.buildingId))}
                          >
                            <Badge variant={cell.status === 'missing' ? 'outline' : REPORT_STATUS_VARIANT[cell.status] ?? 'outline'}
                              className={cell.status === 'missing' ? 'border-dashed text-muted-foreground capitalize' : 'capitalize'}>
                              {cell.status}
                            </Badge>
                          </button>
                          {isAdmin && cell.status === 'draft' && reportId && (
                            <Button variant="ghost" size="icon" className="h-11 w-11" title="Discard this empty draft"
                              aria-label={`Discard ${COVERAGE_TYPE_LABELS[t]} draft for ${row.name}`} disabled={discarding}
                              onClick={() => onDiscardDraft(reportId)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    );
                  })}
                  {isAdmin && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`Report types for ${row.name}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>This building owes</DropdownMenuLabel>
                          {COVERAGE_TYPES.map((t) => (
                            <DropdownMenuCheckboxItem key={t} className="min-h-11" checked={owed.includes(t)}
                              onCheckedChange={(on) => onSetReportTypes(row.buildingId, on ? [...owed, t] : owed.filter((x) => x !== t))}>
                              {COVERAGE_TYPE_LABELS[t]}
                            </DropdownMenuCheckboxItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
