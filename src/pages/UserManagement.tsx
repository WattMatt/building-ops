import { useState, useEffect } from 'react';
import { useAuth, type InviteUserPayload } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useBuildings } from '@/hooks/useBuildings';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Users,
  Plus,
  Search,
  Shield,
  MoreVertical,
  Loader2,
  UserX,
  UserCheck,
  Copy,
  Check,
  Mail,
  KeyRound,
  Building2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AvatarPicker } from '@/components/avatar/AvatarPicker';
import EditAssignmentsDialog from '@/components/users/EditAssignmentsDialog';

type UserStatus = 'active' | 'invited' | 'deactivated';

interface UserWithRole {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
  created_at: string;
  // Invited (pending) = the user still has the first-login gate set.
  must_set_password?: boolean;
  // Durable deactivation flag maintained by the set-user-status edge function
  // on profiles.deactivated. Read on load; updated optimistically in-session.
  deactivated?: boolean;
  // Real auth state from the invite-user fn's "status" action (admin-only):
  // distinguishes "never signed in" from "signed in but still gated".
  email_confirmed?: boolean;
  last_sign_in_at?: string | null;
}

type InviteMode = 'invite' | 'temp_password';

const roleColors: Record<string, string> = {
  admin: 'bg-destructive text-destructive-foreground',
  manager: 'bg-primary text-primary-foreground',
  user: 'bg-success text-success-foreground',
  reviewer: 'bg-muted text-muted-foreground',
};

const roleLabels: Record<string, string> = {
  admin: 'Admin',
  manager: 'Manager',
  user: 'Field Staff',
  reviewer: 'Reviewer',
};

export default function UserManagement() {
  const { isAdmin, inviteUser, setUserStatus } = useAuth();
  const { buildings, loading: buildingsLoading } = useBuildings();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Invite dialog state
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('user');
  const [inviteBuildingIds, setInviteBuildingIds] = useState<string[]>([]);
  const [inviteMode, setInviteMode] = useState<InviteMode>('invite');
  const [isInviting, setIsInviting] = useState(false);

  // One-time temp-password modal state
  const [tempPasswordResult, setTempPasswordResult] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Deactivate/reactivate in-flight tracking
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  // Building-access editor (F-35)
  const [assigningUser, setAssigningUser] = useState<UserWithRole | null>(null);

  const [avatarDialogUser, setAvatarDialogUser] = useState<UserWithRole | null>(null);
  const [selectedAvatarUrl, setSelectedAvatarUrl] = useState<string | null>(null);
  const [savingAvatar, setSavingAvatar] = useState(false);

  useEffect(() => {
    if (isAdmin) {
      fetchUsers();
    }
  }, [isAdmin]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      // Fetch profiles with their roles. select('*') so must_set_password and
      // deactivated are included even if the generated types lag the migration.
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('*');

      if (profilesError) throw profilesError;

      // Fetch roles
      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role');

      if (rolesError) throw rolesError;

      // Combine profiles with roles
      const usersWithRoles: UserWithRole[] = (profiles || []).map((profile) => {
        const p = profile as typeof profile & { must_set_password?: boolean; deactivated?: boolean };
        const userRole = roles?.find((r) => r.user_id === p.id);
        return {
          id: p.id,
          email: p.email ?? '',
          full_name: p.full_name,
          avatar_url: p.avatar_url,
          created_at: p.created_at ?? new Date().toISOString(),
          role: userRole?.role || 'user',
          must_set_password: Boolean(p.must_set_password),
          deactivated: Boolean(p.deactivated),
        };
      });

      // Best-effort merge of real auth state (confirmed / last sign-in) so
      // the status column shows the truth, not just the gate-flag proxy.
      try {
        const { data: statusData } = await supabase.functions.invoke('invite-user', {
          body: { action: 'status' },
        });
        const authStates = new Map(
          ((statusData?.users ?? []) as { id: string; email_confirmed: boolean; last_sign_in_at: string | null }[])
            .map((u) => [u.id, u])
        );
        for (const u of usersWithRoles) {
          const s = authStates.get(u.id);
          if (s) {
            u.email_confirmed = s.email_confirmed;
            u.last_sign_in_at = s.last_sign_in_at;
          }
        }
      } catch {
        // Status enrichment is non-critical; the list still renders without it.
      }

      setUsers(usersWithRoles);
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error fetching users:', error);
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const getStatus = (user: UserWithRole): UserStatus => {
    if (user.deactivated) return 'deactivated';
    if (user.must_set_password) return 'invited';
    return 'active';
  };

  // Recovery actions (Onboarding Hardening): fresh sign-in link for a pending
  // user — emailed via Resend, or copied so onboarding never depends on email.
  const handleResend = async (user: UserWithRole, delivery: 'email' | 'link') => {
    setResendingId(user.id);
    try {
      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: { action: 'resend', email: user.email, delivery },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (delivery === 'link') {
        if (!data?.actionLink) throw new Error('No link returned');
        await navigator.clipboard.writeText(data.actionLink);
        toast.success('Sign-in link copied — valid for 24 hours. Send it however you like.');
      } else {
        toast.success(`Fresh invite emailed to ${user.email} (link valid 24 hours)`);
      }
      fetchUsers();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to resend invite';
      toast.error(message);
    } finally {
      setResendingId(null);
    }
  };

  const filteredUsers = users.filter(
    (user) =>
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (user.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
  );

  const resetInviteForm = () => {
    setInviteEmail('');
    setInviteFullName('');
    setInviteRole('user');
    setInviteBuildingIds([]);
    setInviteMode('invite');
  };

  const toggleInviteBuilding = (buildingId: string) => {
    setInviteBuildingIds((prev) =>
      prev.includes(buildingId)
        ? prev.filter((id) => id !== buildingId)
        : [...prev, buildingId]
    );
  };

  const handleInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      toast.error('Please enter a valid email address');
      return;
    }

    const payload: InviteUserPayload = {
      email,
      fullName: inviteFullName.trim() || undefined,
      role: inviteRole as InviteUserPayload['role'],
      buildingIds: inviteBuildingIds.length > 0 ? inviteBuildingIds : undefined,
      mode: inviteMode,
    };

    setIsInviting(true);
    try {
      const result = await inviteUser(payload);
      setIsInviteOpen(false);

      if (result.status === 'temp_password' && result.tempPassword) {
        // Show the generated password exactly once.
        setTempPasswordResult({ email, password: result.tempPassword });
        setCopied(false);
      } else {
        toast.success(`Invite sent to ${email}`);
      }

      resetInviteForm();
      fetchUsers();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to invite user';
      toast.error(message);
    } finally {
      setIsInviting(false);
    }
  };

  const handleCopyTempPassword = async () => {
    if (!tempPasswordResult) return;
    try {
      await navigator.clipboard.writeText(tempPasswordResult.password);
      setCopied(true);
      toast.success('Password copied to clipboard');
    } catch {
      toast.error('Could not copy — select and copy it manually');
    }
  };

  const handleSetStatus = async (user: UserWithRole, action: 'deactivate' | 'reactivate') => {
    if (action === 'deactivate' && !confirm(`Deactivate ${user.full_name || user.email}? They will lose access until reactivated.`)) {
      return;
    }
    setStatusUpdatingId(user.id);
    try {
      await setUserStatus(user.id, action);
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, deactivated: action === 'deactivate' } : u))
      );
      toast.success(action === 'deactivate' ? 'User deactivated' : 'User reactivated');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update user status';
      toast.error(message);
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      const { error } = await supabase
        .from('user_roles')
        .update({ role: newRole as any })
        .eq('user_id', userId);

      if (error) throw error;

      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
      );
      toast.success('User role updated');
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error updating role:', error);
      toast.error('Failed to update user role');
    }
  };

  const handleOpenAvatarDialog = (user: UserWithRole) => {
    setAvatarDialogUser(user);
    setSelectedAvatarUrl(user.avatar_url);
  };

  const handleSaveAvatar = async () => {
    if (!avatarDialogUser) return;

    setSavingAvatar(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: selectedAvatarUrl })
        .eq('id', avatarDialogUser.id);

      if (error) throw error;

      setUsers((prev) =>
        prev.map((u) =>
          u.id === avatarDialogUser.id ? { ...u, avatar_url: selectedAvatarUrl } : u
        )
      );
      toast.success('User avatar updated');
      setAvatarDialogUser(null);
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error updating avatar:', error);
      toast.error('Failed to update user avatar');
    } finally {
      setSavingAvatar(false);
    }
  };

  const getUserInitials = (user: UserWithRole) => {
    if (user.full_name) {
      return user.full_name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    return user.email.charAt(0).toUpperCase();
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-semibold">Access Restricted</h2>
          <p className="text-muted-foreground">
            Only administrators can manage users.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">User Management</h1>
          <p className="text-muted-foreground">
            Manage team members and their access levels
          </p>
        </div>
        <Dialog
          open={isInviteOpen}
          onOpenChange={(open) => {
            setIsInviteOpen(open);
            if (!open) resetInviteForm();
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Invite User
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Invite Team Member</DialogTitle>
              <DialogDescription>
                Create an account and assign access. Send an invite email, or generate a
                temporary password to hand over directly.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email Address</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="user@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-name">Full Name (optional)</Label>
                <Input
                  id="invite-name"
                  type="text"
                  placeholder="Jane Smith"
                  value={inviteFullName}
                  onChange={(e) => setInviteFullName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-role">Role</Label>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger id="invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">Field Staff</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="reviewer">Reviewer</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Building Access (optional)</Label>
                {buildingsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading buildings…
                  </div>
                ) : buildings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No buildings available.</p>
                ) : (
                  <ScrollArea className="h-36 rounded-md border p-2">
                    <div className="space-y-2">
                      {buildings.map((b) => (
                        <label
                          key={b.id}
                          className="flex items-center gap-2 text-sm cursor-pointer"
                        >
                          <Checkbox
                            checked={inviteBuildingIds.includes(b.id)}
                            onCheckedChange={() => toggleInviteBuilding(b.id)}
                          />
                          <span>{b.name}</span>
                        </label>
                      ))}
                    </div>
                  </ScrollArea>
                )}
                <p className="text-xs text-muted-foreground">
                  Leave empty for organization-wide access (subject to role).
                </p>
              </div>

              <div className="space-y-2">
                <Label>Onboarding method</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={inviteMode === 'invite' ? 'default' : 'outline'}
                    className="justify-start"
                    onClick={() => setInviteMode('invite')}
                  >
                    <Mail className="h-4 w-4 mr-2" />
                    Send invite email
                  </Button>
                  <Button
                    type="button"
                    variant={inviteMode === 'temp_password' ? 'default' : 'outline'}
                    className="justify-start"
                    onClick={() => setInviteMode('temp_password')}
                  >
                    <KeyRound className="h-4 w-4 mr-2" />
                    Temp password
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {inviteMode === 'invite'
                    ? 'The user receives an email to set their own password.'
                    : 'A one-time password is generated for you to hand over. The user must change it on first login.'}
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsInviteOpen(false)} disabled={isInviting}>
                Cancel
              </Button>
              <Button onClick={handleInvite} disabled={isInviting}>
                {isInviting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {inviteMode === 'invite' ? 'Send Invite' : 'Create & Generate Password'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search users..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        {Object.entries(roleLabels).map(([role, label]) => (
          <Card key={role}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="text-2xl font-bold">
                    {users.filter((u) => u.role === role).length}
                  </p>
                </div>
                <Badge variant="secondary" className={roleColors[role]}>
                  {label}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>Team Members</CardTitle>
          <CardDescription>
            All users with access to your organization
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Users className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No users found</h3>
              <p className="text-muted-foreground text-center">
                {searchQuery ? 'Try adjusting your search query' : 'No users have been added yet'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => handleOpenAvatarDialog(user)}
                          className="relative group"
                          title="Click to change avatar"
                        >
                          <Avatar className="h-10 w-10 transition-opacity group-hover:opacity-75">
                            <AvatarImage src={user.avatar_url || undefined} alt={user.full_name || user.email} />
                            <AvatarFallback className="bg-primary/10 text-primary">
                              {getUserInitials(user)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="bg-background/80 rounded-full p-1">
                              <svg className="h-4 w-4 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </div>
                          </div>
                        </button>
                        <div>
                          <p className="font-medium">
                            {user.full_name || 'No name'}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {user.email}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={user.role}
                        onValueChange={(v) => handleRoleChange(user.id, v)}
                      >
                        <SelectTrigger className="w-[130px]">
                          <Badge
                            variant="secondary"
                            className={roleColors[user.role]}
                          >
                            {roleLabels[user.role] || user.role}
                          </Badge>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">Field Staff</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                          <SelectItem value="reviewer">Reviewer</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const status = getStatus(user);
                        if (status === 'deactivated') {
                          return (
                            <Badge variant="secondary" className="bg-muted text-muted-foreground">
                              Deactivated
                            </Badge>
                          );
                        }
                        if (status === 'invited') {
                          return (
                            <Badge variant="secondary" className="bg-warning text-warning-foreground">
                              {user.last_sign_in_at ? 'Password setup pending' : 'Invited — never signed in'}
                            </Badge>
                          );
                        }
                        return (
                          <Badge variant="secondary" className="bg-success text-success-foreground">
                            Active
                          </Badge>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(user.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" disabled={statusUpdatingId === user.id || resendingId === user.id}>
                            {statusUpdatingId === user.id || resendingId === user.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <MoreVertical className="h-4 w-4" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {getStatus(user) === 'invited' && (
                            <>
                              <DropdownMenuItem onClick={() => handleResend(user, 'email')}>
                                <Mail className="h-4 w-4 mr-2" />
                                Resend invite email
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleResend(user, 'link')}>
                                <Copy className="h-4 w-4 mr-2" />
                                Copy sign-in link
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuItem onClick={() => setAssigningUser(user)}>
                            <Building2 className="h-4 w-4 mr-2" />
                            Edit building access
                          </DropdownMenuItem>
                          {user.deactivated ? (
                            <DropdownMenuItem onClick={() => handleSetStatus(user, 'reactivate')}>
                              <UserCheck className="h-4 w-4 mr-2" />
                              Reactivate User
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => handleSetStatus(user, 'deactivate')}
                              className="text-destructive focus:text-destructive"
                            >
                              <UserX className="h-4 w-4 mr-2" />
                              Deactivate User
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Avatar Selection Dialog */}
      <Dialog open={!!avatarDialogUser} onOpenChange={(open) => !open && setAvatarDialogUser(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Change User Avatar</DialogTitle>
            <DialogDescription>
              Select an avatar for {avatarDialogUser?.full_name || avatarDialogUser?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <AvatarPicker
              selectedUrl={selectedAvatarUrl}
              onSelect={setSelectedAvatarUrl}
              userInitials={avatarDialogUser ? getUserInitials(avatarDialogUser) : 'U'}
              showCustomization={true}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAvatarDialogUser(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveAvatar} disabled={savingAvatar}>
              {savingAvatar && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Avatar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* One-time temporary password modal */}
      <Dialog
        open={!!tempPasswordResult}
        onOpenChange={(open) => {
          if (!open) {
            setTempPasswordResult(null);
            setCopied(false);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Temporary password created</DialogTitle>
            <DialogDescription>
              Copy this password and hand it to {tempPasswordResult?.email} securely. It is
              shown only once and cannot be retrieved again.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={tempPasswordResult?.password ?? ''}
                className="font-mono"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button type="button" variant="outline" size="icon" onClick={handleCopyTempPassword}>
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
              The user must change this password on first login.
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setTempPasswordResult(null);
                setCopied(false);
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {assigningUser && (
        <EditAssignmentsDialog
          userId={assigningUser.id}
          userLabel={assigningUser.full_name || assigningUser.email}
          buildings={buildings}
          open={!!assigningUser}
          onOpenChange={(o) => { if (!o) setAssigningUser(null); }}
          onSaved={fetchUsers}
        />
      )}
    </div>
  );
}
