import { ReactNode, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/hooks/useOrganization';
import { useUserProfile } from '@/hooks/useUserProfile';
import { recordAuthEvent } from '@/lib/auth-audit';
import { ThemeToggle } from '@/components/ThemeToggle';
import { HintsToggle } from '@/components/HintsToggle';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { OfflineBanner } from '@/components/pwa/OfflineBanner';
import { UpdateToast } from '@/components/pwa/UpdateToast';
import { OfflineQueueRunner } from '@/components/offline/OfflineQueueRunner';
import { SyncStatusPill } from '@/components/offline/SyncStatusPill';
import { CommandPalette } from '@/components/shell/CommandPalette';
import { QuickCreateMenu } from '@/components/shell/QuickCreateMenu';
import { useHotkey } from '@/components/shell/useHotkey';
import { track } from '@/lib/analytics';
import { useNotifications, useNotificationsRealtime } from '@/hooks/useNotifications';
import type { NotificationKind } from '@/lib/notify';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  LayoutDashboard,
  Building2,
  ClipboardCheck,
  AlertTriangle,
  Settings,
  Users,
  LogOut,
  ChevronDown,
  MapPin,
  BarChart3,
  FileText,
  FileSpreadsheet,
  PenLine,
  Sun,
  User,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';

interface NavItem {
  title: string;
  href: string;
  icon: ReactNode;
  roles?: ('admin' | 'manager' | 'user')[];
  /** Unread notifications of these kinds show as a count beside the item. */
  badgeKinds?: NotificationKind[];
}

const mainNavItems: NavItem[] = [
  {
    // First, because for site roles it is the only page they need most days.
    title: 'My Day',
    href: '/my-day',
    icon: <Sun className="w-4 h-4" />,
  },
  {
    // `/` renders the portfolio dashboard for admins and managers and redirects everyone
    // else to /my-day, so for a site role this entry is a second door to the page above it.
    // Hiding it keeps one destination per control.
    title: 'Dashboard',
    href: '/',
    icon: <LayoutDashboard className="w-4 h-4" />,
    roles: ['admin', 'manager'],
  },
  {
    title: 'Buildings',
    href: '/buildings',
    icon: <Building2 className="w-4 h-4" />,
  },
  {
    title: 'Checklists',
    href: '/checklists',
    icon: <ClipboardCheck className="w-4 h-4" />,
  },
  {
    title: 'Issues',
    href: '/issues',
    icon: <AlertTriangle className="w-4 h-4" />,
    badgeKinds: ['issue_assigned', 'issue_comment', 'issue_mention'],
  },
  {
    title: 'Map View',
    href: '/map',
    icon: <MapPin className="w-4 h-4" />,
  },
  {
    title: 'My Sign-offs',
    href: '/my-signoffs',
    icon: <PenLine className="w-4 h-4" />,
    badgeKinds: ['signoff_requested', 'signoff_overdue'],
  },
];

const reportsNavItems: NavItem[] = [
  {
    // The monthly OPS/CM and annual reports themselves. Previously reachable only by
    // opening a building and finding its Reports tab, which meant no way to see a month
    // across the portfolio at all.
    title: 'Building Reports',
    href: '/reports/fortress',
    icon: <FileText className="w-4 h-4" />,
    badgeKinds: ['report_submitted', 'report_returned', 'report_approved'],
  },
  {
    // Note: a different thing — H&S scoring and PDF evidence packs, not the reports above.
    title: 'Compliance Reports',
    href: '/reports',
    icon: <BarChart3 className="w-4 h-4" />,
    roles: ['admin', 'manager'],
  },
  {
    title: 'Forms Library',
    href: '/forms',
    icon: <FileSpreadsheet className="w-4 h-4" />,
  },
];

const adminNavItems: NavItem[] = [
  {
    title: 'User Management',
    href: '/users',
    icon: <Users className="w-4 h-4" />,
    roles: ['admin'],
  },
  {
    title: 'Settings',
    href: '/settings',
    icon: <Settings className="w-4 h-4" />,
    roles: ['admin', 'manager'],
  },
];

interface DashboardLayoutProps {
  children: ReactNode;
}

/** The unread pill beside a nav item. */
function NavBadge({ count }: { count: number }) {
  return (
    <span className="ml-auto rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground">
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">{count} unread</span>
    </span>
  );
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const { user, role, signOut, isAdminOrManager } = useAuth();
  const { organization } = useOrganization();
  const { profile } = useUserProfile();
  // Signed-out renders are possible (the layout mounts before the session resolves);
  // the hook is enabled only when there is a user, so this is a no-op count of 0.
  const { unreadByKind } = useNotifications();
  // The one owner of the notifications realtime channel. It belongs here because the layout
  // persists across routes; opening a second channel on the same topic from the bell or the
  // inbox page breaks live updates for everyone (see useNotificationsRealtime).
  useNotificationsRealtime();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  useHotkey('k', { meta: true }, () => { track('palette_open', { via: 'hotkey' }); setPaletteOpen(true); });
  const location = useLocation();

  const appName = organization?.name || 'Building Ops';
  const logoUrl = organization?.logo_url;
  const avatarUrl = profile?.avatar_url;

  const handleSignOut = async () => {
    // C7: write the logout audit row BEFORE the session is revoked — after
    // signOut the RLS self-attribution check (user_id = auth.uid()) would
    // reject it. recordAuthEvent never throws and never blocks on failure.
    await recordAuthEvent('auth.logout');
    await signOut();
    toast.success('Signed out successfully');
    navigate('/auth');
  };

  const displayName = profile?.full_name || user?.email?.split('@')[0] || 'User';
  const userInitials = displayName
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const canAccessItem = (item: NavItem) => {
    if (!item.roles) return true;
    return role && item.roles.includes(role);
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <Sidebar>
          <SidebarHeader className="border-b border-sidebar-border p-4">
            <Link to="/" className="flex flex-col items-center gap-2">
              {logoUrl ? (
                <img src={logoUrl} alt={appName} className="w-16 h-16 rounded-lg object-contain" />
              ) : (
                <div className="w-16 h-16 bg-sidebar-primary rounded-lg flex items-center justify-center">
                  <ClipboardCheck className="w-8 h-8 text-sidebar-primary-foreground" />
                </div>
              )}
              <span className="font-bold text-sm text-center">{appName}</span>
            </Link>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Main</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {mainNavItems.filter(canAccessItem).map((item) => {
                    const n = item.badgeKinds ? unreadByKind(item.badgeKinds) : 0;
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={location.pathname === item.href}
                        >
                          <Link to={item.href}>
                            {item.icon}
                            <span>{item.title}</span>
                            {n > 0 && <NavBadge count={n} />}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Reports & Audit</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {reportsNavItems.filter(canAccessItem).map((item) => {
                    const n = item.badgeKinds ? unreadByKind(item.badgeKinds) : 0;
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={location.pathname === item.href}
                        >
                          <Link to={item.href}>
                            {item.icon}
                            <span>{item.title}</span>
                            {n > 0 && <NavBadge count={n} />}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Administration</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {adminNavItems.filter(canAccessItem).map((item) => {
                    const n = item.badgeKinds ? unreadByKind(item.badgeKinds) : 0;
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={location.pathname === item.href}
                        >
                          <Link to={item.href}>
                            {item.icon}
                            <span>{item.title}</span>
                            {n > 0 && <NavBadge count={n} />}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="border-t border-sidebar-border p-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-3 px-2"
                >
                  <Avatar className="h-8 w-8">
                    {avatarUrl && (
                      <AvatarImage src={avatarUrl} alt={displayName} />
                    )}
                    <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col items-start text-left flex-1 min-w-0">
                    <span className="text-sm font-medium truncate w-full">
                      {displayName}
                    </span>
                    <span className="text-xs text-sidebar-foreground/60 capitalize">
                      {role ?? 'User'}
                    </span>
                  </div>
                  <ChevronDown className="w-4 h-4 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>My Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/profile')}>
                  <User className="w-4 h-4 mr-2" />
                  My Profile
                </DropdownMenuItem>
                {isAdminOrManager && (
                  <DropdownMenuItem onClick={() => navigate('/settings')}>
                    <Settings className="w-4 h-4 mr-2" />
                    Settings
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>

        <main className="flex-1 flex flex-col min-w-0">
          <OfflineBanner />
          {'serviceWorker' in navigator && <UpdateToast />}
          <OfflineQueueRunner />
          <header className="h-12 sm:h-14 border-b bg-card flex items-center justify-between px-3 sm:px-4 shrink-0">
            <SidebarTrigger />
            <div className="flex items-center gap-1">
              <SyncStatusPill />
              <QuickCreateMenu />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Search (⌘K)"
                className="h-11 w-11 sm:h-9 sm:w-9"
                onClick={() => { track('palette_open', { via: 'button' }); setPaletteOpen(true); }}
              >
                <Search className="h-5 w-5" />
              </Button>
              <NotificationBell />
              <HintsToggle />
              <ThemeToggle />
            </div>
          </header>
          <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
          <div className="flex-1 p-3 sm:p-4 lg:p-6 overflow-auto">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
