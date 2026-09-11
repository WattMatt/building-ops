/**
 * Comment on an issue: text, optional photos, @mentions from the building's members.
 * The write goes through the offline queue: one issue_activity row (activity_type 'comment')
 * with a client-generated id, plus the comment/mention notifications, all done by the queue
 * handler so the path is identical now (online) or on replay (offline).
 */
import { useRef, useState, type KeyboardEvent } from 'react';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PhotoCapture, type PhotoFile } from '@/components/ui/photo-capture';
import { useAuth } from '@/contexts/AuthContext';
import { useBuildingMembers, memberDisplayName } from '@/hooks/useBuildingMembers';
import { enqueueAndRun } from '@/lib/offline/enqueueAndRun';
import { toastForOutcome } from '@/lib/offline/outcomeToast';
import { mentionQueryAt, insertMention, mentionPresent, type MentionRange } from '@/lib/mentions';
import { track } from '@/lib/analytics';

/** Keys the mention picker itself handles in onKeyDown; onKeyUp must not re-derive the range from them. */
const PICKER_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape']);

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
  const { data: members, byId } = useBuildingMembers(buildingId);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [mentions, setMentions] = useState<string[]>([]);
  const [range, setRange] = useState<MentionRange | null>(null);
  const [active, setActive] = useState(0);
  const [posting, setPosting] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  const candidates = range
    ? (members ?? []).filter((m) => memberDisplayName(m).toLowerCase().includes(range.query.toLowerCase())).slice(0, 6)
    : [];
  const isOpen = range !== null && candidates.length > 0;

  const setRangeAndResetActive = (next: MentionRange | null) => {
    setRange(next);
    setActive(0);
  };

  const onChange = (value: string, caret: number) => {
    setText(value);
    setRangeAndResetActive(mentionQueryAt(value, caret));
  };

  const pick = (id: string, name: string) => {
    if (!range) return;
    const next = insertMention(text, range, name);
    setText(next.text);
    setMentions((m) => (m.includes(id) ? m : [...m, id]));
    setRangeAndResetActive(null);
    requestAnimationFrame(() => boxRef.current?.setSelectionRange(next.caret, next.caret));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % candidates.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + candidates.length) % candidates.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const m = candidates[active];
      if (m) pick(m.id, memberDisplayName(m));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setRangeAndResetActive(null);
    }
  };

  const post = async () => {
    const comment = text.trim();
    if (!comment || !user) return;
    setPosting(true);
    try {
      // Keep only mentions whose @Name still appears in the text (exact, boundary-aware match).
      const kept = mentions.filter((id) => { const m = byId.get(id); return m && mentionPresent(comment, memberDisplayName(m)); });
      // The handler drops the author and anyone mentioned from notifyOthers before notifying.
      const notifyOthers = Array.from(new Set([assigneeId, reporterId].filter((id): id is string => !!id)));
      const outcome = await enqueueAndRun(user.id, {
        kind: 'issue_comment', activityId: crypto.randomUUID(), issueId, issueTitle, buildingId, comment,
        mentions: kept, notifyOthers, userEmail: user.email ?? null,
      }, photos.map((p) => ({ file: p.file })));
      // No success toast: the comment appearing in the timeline is the confirmation, as before.
      toastForOutcome(outcome, { queued: "Comment saved on this device — it will post when you're back online" });
      if (outcome.status === 'failed') return;
      track('issue_commented', { issueId, mentions: kept.length, photos: photos.length });
      photos.forEach((p) => { if (p.preview) URL.revokeObjectURL(p.preview); });
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
          onKeyUp={(e) => {
            if (PICKER_KEYS.has(e.key)) return; // onKeyDown already handled these keys (or closed the picker); never re-derive the range from them
            setRangeAndResetActive(mentionQueryAt(text, (e.target as HTMLTextAreaElement).selectionStart ?? text.length));
          }}
          onKeyDown={onKeyDown}
          aria-autocomplete="list"
          aria-expanded={isOpen}
          disabled={posting}
        />
        {isOpen && (
          <ul role="listbox" aria-label="Mention someone" className="absolute left-0 top-full z-10 mt-1 w-64 rounded-md border bg-popover p-1 shadow-md">
            {candidates.map((m, i) => (
              <li
                key={m.id}
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
                className={`w-full cursor-pointer rounded px-2 py-1.5 text-left text-sm ${i === active ? 'bg-muted' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(m.id, memberDisplayName(m))}
              >
                <span>{memberDisplayName(m)}</span> <span className="text-muted-foreground">· {m.role}</span>
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
