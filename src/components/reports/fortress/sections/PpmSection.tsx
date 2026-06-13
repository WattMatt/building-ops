/** PPM — read-only roll-up from the ppm_monthly_status view (reuses task_instances).
 *  No new data is authored here; the manager reviews planned-maintenance status. */
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SectionCard } from '../SectionCard';
import { fdb, type PpmMonthlyStatus } from '@/integrations/supabase/fortress-db';
import { formatPeriodLabel } from '@/lib/fortressReports';
import type { SectionProps } from './types';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  done: 'default', due: 'secondary', missed: 'destructive', issue_logged: 'outline',
};

export default function PpmSection({ buildingId }: SectionProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['fortress-ppm', buildingId],
    enabled: !!buildingId,
    queryFn: async (): Promise<PpmMonthlyStatus[]> => {
      const { data, error } = await fdb
        .from('ppm_monthly_status')
        .select('*')
        .eq('building_id', buildingId)
        .order('period_month', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <SectionCard title="PPM" hint="Planned maintenance status, rolled up from scheduled tasks. Read-only.">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.length ? (
        <p className="text-sm text-muted-foreground">No planned maintenance tasks for this building.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((r, i) => (
                <TableRow key={`${r.service_name}-${r.period_month}-${i}`}>
                  <TableCell>{r.service_name}</TableCell>
                  <TableCell>{formatPeriodLabel(r.period_month)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status ?? 'due'] ?? 'outline'} className="capitalize">
                      {(r.status ?? '').replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </SectionCard>
  );
}
