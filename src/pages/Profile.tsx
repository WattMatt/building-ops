import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DEFAULT_AVATARS, CARTOON_AVATARS, AVATAR_CATEGORIES, generateRandomAvatar } from '@/lib/avatars';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { User, Loader2, Mail, Phone, Camera, Bell, AlertTriangle, Calendar, CheckSquare, Upload, Shuffle, Check, Lock, Eye, EyeOff, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface ProfileData {
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  email: string;
  email_notifications: boolean | null;
  overdue_alerts: boolean | null;
  daily_digest: boolean | null;
  issue_updates: boolean | null;
  task_reminders: boolean | null;
}

export default function Profile() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [overdueAlerts, setOverdueAlerts] = useState(true);
  const [dailyDigest, setDailyDigest] = useState(false);
  const [issueUpdates, setIssueUpdates] = useState(true);
  const [taskReminders, setTaskReminders] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingNotifications, setIsSavingNotifications] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) {
      fetchProfile();
    }
  }, [user]);

  const fetchProfile = async () => {
    if (!user) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, avatar_url, phone, email, email_notifications, overdue_alerts, daily_digest, issue_updates, task_reminders')
        .eq('id', user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setProfile(data);
        setFullName(data.full_name || '');
        setPhone(data.phone || '');
        setAvatarUrl(data.avatar_url);
        setEmailNotifications(data.email_notifications ?? true);
        setOverdueAlerts(data.overdue_alerts ?? true);
        setDailyDigest(data.daily_digest ?? false);
        setIssueUpdates(data.issue_updates ?? true);
        setTaskReminders(data.task_reminders ?? true);
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
      toast.error('Failed to load profile');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!user) return;

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim() || null,
          phone: phone.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (error) throw error;
      toast.success('Profile updated successfully');
    } catch (error) {
      console.error('Error saving profile:', error);
      toast.error('Failed to save profile');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveNotifications = async () => {
    if (!user) return;

    setIsSavingNotifications(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          email_notifications: emailNotifications,
          overdue_alerts: overdueAlerts,
          daily_digest: dailyDigest,
          issue_updates: issueUpdates,
          task_reminders: taskReminders,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (error) throw error;
      toast.success('Notification preferences saved');
    } catch (error) {
      console.error('Error saving notifications:', error);
      toast.error('Failed to save notification preferences');
    } finally {
      setIsSavingNotifications(false);
    }
  };

  const handleChangePassword = async () => {
    if (!newPassword || !confirmPassword) {
      toast.error('Please fill in all password fields');
      return;
    }

    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setIsChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      toast.success('Password updated successfully');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      console.error('Error changing password:', error);
      toast.error(error.message || 'Failed to update password');
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') {
      toast.error('Please type DELETE to confirm');
      return;
    }

    setIsDeletingAccount(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        toast.error('You must be logged in to delete your account');
        return;
      }

      const response = await supabase.functions.invoke('delete-account', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to delete account');
      }

      toast.success('Your account has been deleted');
      await signOut();
      navigate('/auth');
    } catch (error: any) {
      console.error('Error deleting account:', error);
      toast.error(error.message || 'Failed to delete account');
    } finally {
      setIsDeletingAccount(false);
      setDeleteConfirmText('');
    }
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    // Validate file type
    const validTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      toast.error('Please upload a PNG, JPEG, WebP, or GIF image');
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error('File size must be less than 2MB');
      return;
    }

    setIsUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `avatar-${Date.now()}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      // Update profile with new avatar URL
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ 
          avatar_url: publicUrl, 
          updated_at: new Date().toISOString() 
        })
        .eq('id', user.id);

      if (updateError) throw updateError;

      setAvatarUrl(publicUrl);
      toast.success('Avatar uploaded successfully');
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Failed to upload avatar');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSelectDefaultAvatar = async (url: string | null) => {
    if (!user) return;

    setIsUploading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ 
          avatar_url: url, 
          updated_at: new Date().toISOString() 
        })
        .eq('id', user.id);

      if (error) throw error;

      setAvatarUrl(url);
      toast.success(url ? 'Avatar updated' : 'Avatar removed');
    } catch (error) {
      console.error('Error updating avatar:', error);
      toast.error('Failed to update avatar');
    } finally {
      setIsUploading(false);
    }
  };

  const handleGenerateRandom = async () => {
    if (!user) return;
    // Randomly select a style from available cartoon styles
    const styles: Array<'adventurer' | 'lorelei' | 'notionists' | 'fun-emoji'> = ['adventurer', 'lorelei', 'notionists', 'fun-emoji'];
    const randomStyle = styles[Math.floor(Math.random() * styles.length)];
    const randomUrl = generateRandomAvatar(user.id + Date.now(), randomStyle);
    await handleSelectDefaultAvatar(randomUrl);
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  const userInitials = fullName
    ? fullName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : user?.email?.split('@')[0].slice(0, 2).toUpperCase() ?? 'U';

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">My Profile</h1>
        <p className="text-muted-foreground">
          Manage your personal information and preferences
        </p>
      </div>

      {/* Profile Card */}
      <Card>
        <CardHeader>
          <CardTitle>Personal Information</CardTitle>
          <CardDescription>
            Update your profile details and avatar
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Avatar Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-6">
              <div className="relative">
                <Avatar className="h-24 w-24">
                  <AvatarImage src={avatarUrl || undefined} alt="Profile avatar" />
                  <AvatarFallback className="bg-primary text-primary-foreground text-xl">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
                <button
                  onClick={triggerFileUpload}
                  disabled={isUploading}
                  className="absolute bottom-0 right-0 h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {isUploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Camera className="h-4 w-4" />
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Profile Photo</p>
                <p className="text-sm text-muted-foreground">
                  Upload your own photo or choose from avatars below
                </p>
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={triggerFileUpload}
                    disabled={isUploading}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Upload
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleGenerateRandom}
                    disabled={isUploading}
                  >
                    <Shuffle className="h-4 w-4 mr-2" />
                    Random
                  </Button>
                </div>
              </div>
            </div>

            {/* Avatar Library */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Choose an Avatar</Label>
              <Tabs defaultValue="adventurer" className="w-full">
                <TabsList className="grid w-full grid-cols-4 h-auto">
                  {(Object.keys(AVATAR_CATEGORIES) as Array<keyof typeof AVATAR_CATEGORIES>).map((category) => (
                    <TabsTrigger
                      key={category}
                      value={category}
                      className="text-xs py-2 px-1"
                    >
                      {AVATAR_CATEGORIES[category].label}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {(Object.keys(AVATAR_CATEGORIES) as Array<keyof typeof AVATAR_CATEGORIES>).map((category) => (
                  <TabsContent key={category} value={category} className="mt-3">
                    <p className="text-xs text-muted-foreground mb-3">
                      {AVATAR_CATEGORIES[category].description}
                    </p>
                    <div className="grid grid-cols-6 gap-2">
                      {CARTOON_AVATARS.filter(a => a.category === category).map((avatar) => {
                        const isSelected = avatar.url === avatarUrl;
                        return (
                          <button
                            key={avatar.id}
                            onClick={() => handleSelectDefaultAvatar(avatar.url)}
                            disabled={isUploading}
                            className={`relative rounded-lg p-1 transition-all hover:scale-105 ${
                              isSelected 
                                ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' 
                                : 'hover:ring-2 hover:ring-muted-foreground/30'
                            }`}
                            title={avatar.name}
                          >
                            <Avatar className="h-12 w-12">
                              <AvatarImage src={avatar.url || undefined} alt={avatar.name} />
                              <AvatarFallback className="bg-muted text-muted-foreground text-sm">
                                {avatar.name.slice(0, 2)}
                              </AvatarFallback>
                            </Avatar>
                            {isSelected && (
                              <div className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                                <Check className="h-3 w-3 text-primary-foreground" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
              
              {/* Use Initials Option */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => handleSelectDefaultAvatar(null)}
                  disabled={isUploading}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                    !avatarUrl 
                      ? 'border-primary bg-primary/10 text-primary' 
                      : 'border-muted hover:border-muted-foreground/50'
                  }`}
                >
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-muted text-muted-foreground text-sm">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm">Use my initials</span>
                  {!avatarUrl && <Check className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          <Separator />

          {/* Form Fields */}
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="full-name" className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Full Name
              </Label>
              <Input
                id="full-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your full name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Email Address
              </Label>
              <Input
                id="email"
                type="email"
                value={profile?.email || user?.email || ''}
                disabled
                className="bg-muted"
              />
              <p className="text-xs text-muted-foreground">
                Email cannot be changed. Contact an administrator if needed.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                Phone Number
              </Label>
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Enter your phone number"
              />
            </div>
          </div>

          <Separator />

          <div className="flex justify-end">
            <Button onClick={handleSaveProfile} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Notification Preferences Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notification Preferences
          </CardTitle>
          <CardDescription>
            Choose how and when you want to be notified
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Email Notifications
                </Label>
                <p className="text-sm text-muted-foreground">
                  Receive notifications via email
                </p>
              </div>
              <Switch
                checked={emailNotifications}
                onCheckedChange={setEmailNotifications}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Overdue Task Alerts
                </Label>
                <p className="text-sm text-muted-foreground">
                  Get alerted when tasks become overdue
                </p>
              </div>
              <Switch
                checked={overdueAlerts}
                onCheckedChange={setOverdueAlerts}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Daily Digest
                </Label>
                <p className="text-sm text-muted-foreground">
                  Receive a daily summary of pending tasks
                </p>
              </div>
              <Switch
                checked={dailyDigest}
                onCheckedChange={setDailyDigest}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Issue Updates
                </Label>
                <p className="text-sm text-muted-foreground">
                  Get notified when issues you reported or are assigned to are updated
                </p>
              </div>
              <Switch
                checked={issueUpdates}
                onCheckedChange={setIssueUpdates}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="flex items-center gap-2">
                  <CheckSquare className="h-4 w-4" />
                  Task Reminders
                </Label>
                <p className="text-sm text-muted-foreground">
                  Receive reminders for upcoming task deadlines
                </p>
              </div>
              <Switch
                checked={taskReminders}
                onCheckedChange={setTaskReminders}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSaveNotifications} disabled={isSavingNotifications}>
              {isSavingNotifications ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Preferences'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Security Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Security
          </CardTitle>
          <CardDescription>
            Update your password to keep your account secure
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Password must be at least 6 characters long
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button 
              onClick={handleChangePassword} 
              disabled={isChangingPassword || !newPassword || !confirmPassword}
            >
              {isChangingPassword ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                'Update Password'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Account Info Card */}
      <Card>
        <CardHeader>
          <CardTitle>Account Information</CardTitle>
          <CardDescription>
            Your account details
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm font-medium">Account ID</p>
              <p className="text-sm text-muted-foreground font-mono">
                {user?.id?.slice(0, 8)}...
              </p>
            </div>
            <div>
              <p className="text-sm font-medium">Member Since</p>
              <p className="text-sm text-muted-foreground">
                {user?.created_at 
                  ? new Date(user.created_at).toLocaleDateString('en-ZA', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })
                  : 'N/A'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Danger Zone Card */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Danger Zone
          </CardTitle>
          <CardDescription>
            Irreversible actions that affect your account
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg border border-destructive/30 bg-destructive/5">
            <div className="space-y-1">
              <p className="font-medium">Delete Account</p>
              <p className="text-sm text-muted-foreground">
                Permanently delete your account and all associated data. This action cannot be undone.
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">
                  Delete Account
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                    Delete Your Account?
                  </AlertDialogTitle>
                  <AlertDialogDescription className="space-y-3">
                    <p>
                      This action is <strong>permanent and irreversible</strong>. Deleting your account will:
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      <li>Remove all your personal data</li>
                      <li>Delete your profile and preferences</li>
                      <li>Remove you from all building assignments</li>
                      <li>Log you out immediately</li>
                    </ul>
                    <div className="pt-2">
                      <Label htmlFor="delete-confirm" className="text-sm font-medium text-foreground">
                        Type <strong>DELETE</strong> to confirm:
                      </Label>
                      <Input
                        id="delete-confirm"
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        placeholder="DELETE"
                        className="mt-2"
                      />
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => setDeleteConfirmText('')}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeleteAccount}
                    disabled={deleteConfirmText !== 'DELETE' || isDeletingAccount}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {isDeletingAccount ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      'Delete My Account'
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
