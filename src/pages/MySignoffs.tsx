import { useState } from 'react';
import { formatBuildingName } from '@/lib/buildingName';
import { useMySignoffs } from '@/hooks/useMySignoffs';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PenLine, Loader2, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import SignoffSection from '@/components/forms/SignoffSection';

export default function MySignoffs() {
  const { items, loading, reload } = useMySignoffs();
  const [openSubmission, setOpenSubmission] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <PenLine className="h-6 w-6" /> My Sign-offs
        </h1>
        <p className="text-muted-foreground">Form submissions awaiting your signature.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <CheckCircle2 className="h-8 w-8" />
            <p className="font-medium">Nothing to sign</p>
            <p className="text-sm">You have no pending sign-offs.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 divide-y">
            {items.map((it) => {
              const overdue = it.due_at ? new Date(it.due_at) < new Date() : false;
              return (
                <div key={it.id} className="flex items-center justify-between p-4 gap-4">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{it.form_name}</p>
                    <p className="text-sm text-muted-foreground truncate">
                      {formatBuildingName(it.building_name) || 'No building'}
                      {it.due_at && <> · due {format(new Date(it.due_at), 'PP')}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {overdue && <Badge variant="destructive">Overdue</Badge>}
                    <Button size="sm" onClick={() => setOpenSubmission(it.submission_id)}>
                      Review &amp; sign
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!openSubmission} onOpenChange={(o) => !o && setOpenSubmission(null)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Sign-off</DialogTitle>
          </DialogHeader>
          {openSubmission && <SignoffSection submissionId={openSubmission} onChanged={reload} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
