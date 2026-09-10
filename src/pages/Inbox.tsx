/**
 * The full inbox: every notification row the signed-in user has (newest 50), with an
 * "Unread only" filter. Each row marks itself read and deep-links to the thing it is about,
 * so the inbox is a queue you empty rather than a log you read.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Inbox as InboxIcon, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useNotifications } from '@/hooks/useNotifications';
import { track } from '@/lib/analytics';

export default function Inbox() {
  const { items, unread, markRead, markAllRead, isLoading, isError, refetch } = useNotifications();
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);

  const visible = unreadOnly ? items.filter((n) => !n.read_at) : items;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <InboxIcon className="h-6 w-6" /> Inbox
          </h1>
          <p className="text-muted-foreground">
            {unread > 0 ? `${unread} unread notification${unread === 1 ? '' : 's'}.` : 'Everything that needs you, in one place.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch id="unread-only" checked={unreadOnly} onCheckedChange={setUnreadOnly} />
            <Label htmlFor="unread-only" className="text-sm">Unread only</Label>
          </div>
          {unread > 0 && (
            <Button variant="outline" size="sm" onClick={() => void markAllRead()}>
              Mark all read
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <Card className="border-destructive/50">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Failed to load your inbox</h3>
            <p className="text-muted-foreground text-center mb-4 max-w-md">
              An unexpected error occurred while fetching your notifications.
            </p>
            <Button onClick={() => void refetch()} variant="outline">
              Try Again
            </Button>
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <CheckCircle2 className="h-8 w-8" />
            <p className="font-medium">{unreadOnly ? 'Nothing unread' : 'Nothing here yet'}</p>
            <p className="text-sm">
              {unreadOnly ? 'You are all caught up.' : 'Assignments, comments and sign-off requests will show up here.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 divide-y">
            {visible.map((n) => (
              <button
                key={n.id}
                type="button"
                className={`block w-full p-4 text-left hover:bg-muted ${n.read_at ? '' : 'bg-primary/5'}`}
                onClick={() => { void markRead(n.id); track('notification_opened', { kind: n.kind }); navigate(n.url); }}
              >
                {!n.read_at && <span className="sr-only">Unread</span>}
                <p className="font-medium truncate">{n.title}</p>
                {n.body && <p className="text-sm text-muted-foreground truncate">{n.body}</p>}
                <p className="text-xs text-muted-foreground">
                  {n.actor_name ? `${n.actor_name} · ` : ''}
                  {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                </p>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
