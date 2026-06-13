import { ReactNode } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/hooks/useOrganization';
import { useUserProfile } from '@/hooks/useUserProfile';
import { ThemeToggle } from '@/components/ThemeToggle';
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
  FileText,
  Settings,
  Users,
  LogOut,
  ChevronDown,
  MapPin,
  BarChart3,
  FileSpreadsheet,
  User,
} from 'lucide-react';
import { toast } from 'sonner';

interface NavItem {
  title: string;
  href: string;
  icon: ReactNode;
  roles?: ('admin' | 'manager' | 'user' | 'reviewer')[];
}

const mainNavItems: NavItem[] = [
  {
    title: 'Dashboard',
    href: '/',
    icon: <LayoutDashboard className="w-4 h-4" />,
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
  },
  {
    title: 'Map View',
    href: '/map',
    icon: <MapPin className="w-4 h-4" />,
  },
];

const reportsNavItems: NavItem[] = [
  {
    title: 'Operational Reports',
    href: '/reports/fortress',
    icon: <ClipboardCheck className="w-4 h-4" />,
  },
  {
    title: 'Compliance Reports',
    href: '/reports',
    icon: <BarChart3 className="w-4 h-4" />,
  },
  {
    title: 'Audit Archive',
    href: '/audit',
    icon: <FileText className="w-4 h-4" />,
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

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const { user, role, signOut } = useAuth();
  const { organization } = useOrganization();
  const { profile } = useUserProfile();
  const navigate = useNavigate();
  const location = useLocation();

  const appName = organization?.name || 'Building Ops';
  const logoUrl = organization?.logo_url;
  const avatarUrl = profile?.avatar_url;

  const handleSignOut = async () => {
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
                  {mainNavItems.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={location.pathname === item.href}
                      >
                        <Link to={item.href}>
                          {item.icon}
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Reports & Audit</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {reportsNavItems.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={location.pathname === item.href}
                      >
                        <Link to={item.href}>
                          {item.icon}
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Administration</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {adminNavItems.filter(canAccessItem).map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={location.pathname === item.href}
                      >
                        <Link to={item.href}>
                          {item.icon}
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
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
                <DropdownMenuItem onClick={() => navigate('/settings')}>
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </DropdownMenuItem>
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
          <header className="h-12 sm:h-14 border-b bg-card flex items-center justify-between px-3 sm:px-4 shrink-0">
            <SidebarTrigger />
            <ThemeToggle />
          </header>
          <div className="flex-1 p-3 sm:p-4 lg:p-6 overflow-auto">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
