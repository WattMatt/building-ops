/**
 * Comment on an issue: text, optional photos, @mentions from the building's members.
 * Writes one issue_activity row (activity_type 'comment'); the author name is denormalised
 * from the caller's own profile because other users cannot read it back later.
 */
import { useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PhotoCapture, type PhotoFile } from '@/components/ui/photo-capture';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useBuildingMembers, memberDisplayName } from '@/hooks/useBuildingMembers';
import { uploadIssuePhotos } from '@/lib/issuePhotos';
import { mentionQueryAt, insertMention, type MentionRange } from '@/lib/mentions';
import { notify } from '@/lib/notify';

interface Props {
  issueId: string;
  buildingId: string;
  issueTitle: string;
  reporterId: string | null;
  assigneeId: string | null;
  onPosted: () => void;
}

export function IssueCommentComposer({ issueId, buildingId, issueTitle, reporterId, assigneeId, onPosted }: Props) {
  const { user } = useAuth();
  const { data: members } = useBuildingMembers(buildingId);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [mentions, setMentions] = useState<string[]>([]);
  const [range, setRange] = useState<MentionRange | null>(null);
  const [posting, setPosting] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  const candidates = range
    ? (members ?? []).filter((m) => memberDisplayName(m).toLowerCase().includes(range.query.toLowerCase())).slice(0, 6)
    : [];

  const onChange = (value: string, caret: number) => {
    setText(value);
    setRange(mentionQueryAt(value, caret));
  };

  const pick = (id: string, name: string) => {
    if (!range) return;
    const next = insertMention(text, range, name);
    setText(next.text);
    setMentions((m) => (m.includes(id) ? m : [...m, id]));
    setRange(null);
    requestAnimationFrame(() => boxRef.current?.setSelectionRange(next.caret, next.caret));
  };

  const post = async () => {
    const comment = text.trim();
    if (!comment || !user) return;
    setPosting(true);
    try {
      const photoUrls = photos.length ? await uploadIssuePhotos(photos, user.id) : [];
      const { data: me } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
      const authorName = (me as { full_name?: string | null } | null)?.full_name?.trim() || user.email || 'Someone';
      // Keep only mentions whose @Name still appears in the text.
      const kept = mentions.filter((id) => { const m = members?.find((x) => x.id === id); return m && comment.includes(`@${memberDisplayName(m)}`); });
      const { data, error } = await supabase.from('issue_activity').insert({
        issue_id: issueId, activity_type: 'comment', comment, photo_urls: photoUrls, mentions: kept, user_id: user.id, author_name: authorName,
      } as never).select('id').single();
      if (error) throw error;
      if (!data) throw new Error('The comment was not saved.');
      const others = Array.from(new Set([assigneeId, reporterId].filter((id): id is string => !!id && id !== user.id && !kept.includes(id))));
      if (others.length) void notify({ kind: 'issue_comment', entityType: 'issue', entityId: issueId, buildingId, recipients: others, title: `${authorName} commented on: ${issueTitle}`, body: comment.slice(0, 200), url: `/issues?open=${issueId}` });
      const mentioned = kept.filter((id) => id !== user.id);
      if (mentioned.length) void notify({ kind: 'issue_mention', entityType: 'issue', entityId: issueId, buildingId, recipients: mentioned, title: `${authorName} mentioned you on: ${issueTitle}`, body: comment.slice(0, 200), url: `/issues?open=${issueId}` });
      setText(''); setPhotos([]); setMentions([]);
      onPosted();
    } catch (e) {
      if (import.meta.env.DEV) console.error('Post comment failed:', e);
      toast.error(e instanceof Error ? e.message : 'Could not post the comment.');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="relative">
        <Textarea
          ref={boxRef}
          rows={3}
          placeholder="Add a comment… type @ to mention someone"
          value={text}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onKeyUp={(e) => setRange(mentionQueryAt(text, (e.target as HTMLTextAreaElement).selectionStart ?? text.length))}
          disabled={posting}
        />
        {range && candidates.length > 0 && (
          <ul role="listbox" className="absolute left-0 top-full z-10 mt-1 w-64 rounded-md border bg-popover p-1 shadow-md">
            {candidates.map((m) => (
              <li key={m.id}>
                <button type="button" role="option" aria-selected={false} className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m.id, memberDisplayName(m))}>
                  {memberDisplayName(m)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <PhotoCapture photos={photos} onPhotosChange={setPhotos} maxPhotos={3} size="sm" disabled={posting} label="Photos" />
      <div className="flex justify-end">
        <Button size="sm" onClick={post} disabled={posting || !text.trim()}>
          {posting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          Post
        </Button>
      </div>
    </div>
  );
}
