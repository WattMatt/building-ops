import { useState, useEffect } from 'react';
import { formatBuildingName } from '@/lib/buildingName';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, ArrowRight, Clock, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';

interface PendingSubmission {
  id: string;
  form_name: string;
  building_id: string | null;
  building_name: string;
  submitted_by: string;
  submitter_name: string;
  created_at: string;
}

export default function PendingSubmissionsWidget() {
  const [submissions, setSubmissions] = useState<PendingSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    fetchPendingSubmissions();
  }, []);

  const fetchPendingSubmissions = async () => {
    try {
      // Get count of all pending submissions
      const { count } = await supabase
        .from('form_submissions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'submitted');

      setTotalCount(count || 0);

      // Fetch recent pending submissions with building info
      const { data, error } = await supabase
        .from('form_submissions')
        .select(`
          id,
          form_name,
          building_id,
          submitted_by,
          created_at,
          buildings (name)
        `)
        .eq('status', 'submitted')
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;

      if (data) {
        // Fetch submitter names
        const submitterIds = [...new Set(data.map(s => s.submitted_by))];
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', submitterIds);

        const profileMap = new Map(profiles?.map(p => [p.id, p.full_name || p.email]) || []);

        setSubmissions(data.map(sub => ({
          id: sub.id,
          form_name: sub.form_name,
          building_id: sub.building_id,
          building_name: (sub.buildings as any)?.name || 'No Building',
          submitted_by: sub.submitted_by,
          submitter_name: profileMap.get(sub.submitted_by) || 'Unknown User',
          created_at: sub.created_at,
        })));
      }
    } catch (error) {
      console.error('Error fetching pending submissions:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Pending Form Submissions
          </CardTitle>
          <CardDescription>Forms awaiting review</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (totalCount === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Pending Form Submissions
            <Badge variant="secondary" className="bg-warning/20 text-warning-foreground">
              {totalCount}
            </Badge>
          </CardTitle>
          <CardDescription>Forms awaiting your review</CardDescription>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/forms">
            View all
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {submissions.map((submission) => (
            <Link
              key={submission.id}
              to={submission.building_id ? `/buildings/${submission.building_id}?tab=forms` : '/forms'}
              className="block"
            >
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-lg bg-warning/10 flex items-center justify-center flex-shrink-0">
                    <FileText className="h-4 w-4 text-warning" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{submission.form_name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {formatBuildingName(submission.building_name)} • {submission.submitter_name}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant="outline" className="text-xs whitespace-nowrap">
                    <Clock className="h-3 w-3 mr-1" />
                    {formatDistanceToNow(new Date(submission.created_at), { addSuffix: true })}
                  </Badge>
                </div>
              </div>
            </Link>
          ))}
        </div>
        {totalCount > 5 && (
          <div className="mt-4 text-center">
            <Button variant="outline" size="sm" asChild>
              <Link to="/forms">
                View all {totalCount} pending submissions
              </Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
