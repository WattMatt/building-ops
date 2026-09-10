/** Header bell: unread count, the 10 newest rows, mark all read, link to the full inbox. */
import { Bell } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useNotifications } from '@/hooks/useNotifications';

export function NotificationBell() {
  const { items, unread, markRead, markAllRead } = useNotifications();
  const navigate = useNavigate();
  const recent = items.slice(0, 10);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={unread ? `${unread} unread notifications` : 'Notifications'} className="relative">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {unread > 0 && <button type="button" className="text-xs underline" onClick={() => void markAllRead()}>Mark all read</button>}
        </div>
        {recent.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing new.</p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto">
            {recent.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={`w-full px-3 py-2 text-left hover:bg-muted ${n.read_at ? '' : 'bg-primary/5'}`}
                  onClick={() => { void markRead(n.id); navigate(n.url); }}
                >
                  <p className="truncate text-sm">{n.title}</p>
                  <p className="text-xs text-muted-foreground">{n.actor_name ? `${n.actor_name} · ` : ''}{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t px-3 py-2 text-right">
          <Link to="/inbox" className="text-xs underline">Open inbox</Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
