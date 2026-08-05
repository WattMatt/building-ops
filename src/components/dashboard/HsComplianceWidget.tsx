import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { ShieldCheck, FileWarning, Loader2, AlertTriangle } from 'lucide-react';
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
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchScores();
  }, []);

  const fetchScores = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const today = new Date();
      const windowStart = format(subDays(today, 30), 'yyyy-MM-dd');
      const todayStr = format(today, 'yyyy-MM-dd');

      // RLS scopes all three queries to the user's buildings automatically
      const { data: buildings, error: buildingsError } = await supabase
        .from('buildings')
        .select('id, name')
        .order('name');

      if (buildingsError) throw buildingsError;

      const { data: tasks, error: tasksError } = await supabase
        .from('task_instances')
        .select('building_id, status, due_date, category')
        .not('category', 'is', null)
        .gte('due_date', windowStart)
        .lte('due_date', todayStr);

      if (tasksError) throw tasksError;

      const { data: documents, error: documentsError } = await supabase
        .from('building_documents')
        .select('building_id, expiry_date');

      if (documentsError) throw documentsError;

      setScores(computeHsScores(buildings || [], tasks || [], documents || [], today));
    } catch (error) {
      console.error('Error fetching H&S scores:', error);
      // A failed read must not render as a compliance score of record.
      setLoadError(error instanceof Error ? error.message : 'An unexpected error occurred.');
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
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive mb-2" />
            <p className="text-sm font-medium mb-1">Failed to load H&amp;S compliance</p>
            <p className="text-xs text-muted-foreground max-w-sm mb-4">
              {loadError} No score shown here can be treated as current.
            </p>
            <Button onClick={() => fetchScores()} variant="outline" size="sm">
              Try Again
            </Button>
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
