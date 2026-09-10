/** Closing an issue needs a note (what was done) — it becomes the last comment, then the status flips. */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PhotoCapture, type PhotoFile } from '@/components/ui/photo-capture';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { uploadIssuePhotos } from '@/lib/issuePhotos';

interface Props { issueId: string; open: boolean; onOpenChange: (o: boolean) => void; onResolved: () => void }

export function ResolveIssueDialog({ issueId, open, onOpenChange, onResolved }: Props) {
  const { user } = useAuth();
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [busy, setBusy] = useState(false);

  const resolve = async () => {
    if (!user || !note.trim()) return;
    setBusy(true);
    try {
      const photoUrls = photos.length ? await uploadIssuePhotos(photos, user.id) : [];
      const { data: me } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
      const authorName = (me as { full_name?: string | null } | null)?.full_name?.trim() || user.email || 'Someone';
      const { error: cErr } = await supabase.from('issue_activity').insert({ issue_id: issueId, activity_type: 'comment', comment: note.trim(), photo_urls: photoUrls, mentions: [], user_id: user.id, author_name: authorName } as never);
      if (cErr) throw cErr;
      // The note is saved even if the status flip fails — it is true either way.
      const { data, error } = await supabase.from('issues').update({ status: 'resolved' }).eq('id', issueId).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Your note was saved, but you do not have permission to resolve this issue.');
      toast.success('Issue resolved');
      setNote(''); setPhotos([]);
      onOpenChange(false);
      onResolved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not resolve the issue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolve this issue</DialogTitle>
          <DialogDescription>Say what was done. This note is recorded on the issue and is required.</DialogDescription>
        </DialogHeader>
        <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Replaced the faulty breaker; tested under load." disabled={busy} />
        <PhotoCapture photos={photos} onPhotosChange={setPhotos} maxPhotos={3} size="sm" disabled={busy} label="Photo of the fix (optional)" />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={resolve} disabled={busy || !note.trim()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Resolve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
