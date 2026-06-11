import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ShieldCheck, FileWarning, Loader2 } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { computeHsScores, scoreBand, type HsBuildingScore } from '@/lib/hsScore';

const BAND_STYLES: Record<string, string> = {
  good: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  warning: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  none: 'bg-muted text-muted-foreground',
};

export default function HsComplianceWidget() {
  const [loading, setLoading] = useState(true);
  const [scores, setScores] = useState<HsBuildingScore[]>([]);

  useEffect(() => {
    fetchScores();
  }, []);

  const fetchScores = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const windowStart = format(subDays(today, 30), 'yyyy-MM-dd');
      const todayStr = format(today, 'yyyy-MM-dd');

      // RLS scopes all three queries to the user's buildings automatically
      const { data: buildings } = await supabase
        .from('buildings')
        .select('id, name')
        .order('name');

      const { data: tasks } = await supabase
        .from('task_instances')
        .select('building_id, status, due_date, category')
        .not('category', 'is', null)
        .gte('due_date', windowStart)
        .lte('due_date', todayStr);

      const { data: documents } = await supabase
        .from('building_documents')
        .select('building_id, expiry_date');

      setScores(computeHsScores(buildings || [], tasks || [], documents || [], today));
    } catch (error) {
      console.error('Error fetching H&S scores:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldCheck className="h-5 w-5" />
          H&S Compliance
        </CardTitle>
        <CardDescription>Completion of health & safety checks, last 30 days</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : scores.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No buildings visible</p>
        ) : (
          <div className="space-y-3">
            {scores.map((row) => {
              const band = scoreBand(row.score);
              return (
                <div key={row.building_id} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{row.name}</p>
                      {row.hasExpiredCert && (
                        <span title="Expired certificate on file">
                          <FileWarning className="h-4 w-4 text-destructive shrink-0" />
                        </span>
                      )}
                    </div>
                    {row.score !== null && (
                      <Progress value={row.score} className="h-1.5 mt-1" />
                    )}
                  </div>
                  <Badge className={`shrink-0 ${BAND_STYLES[band]}`}>
                    {row.score !== null ? `${row.score}%` : 'No checks'}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
