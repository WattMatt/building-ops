import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Settings as SettingsIcon,
  Building2,
  Bell,
  Palette,
  Shield,
  Upload,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';

export default function Settings() {
  const { user, isAdmin, isAdminOrManager } = useAuth();
  const { organization, loading: orgLoading } = useOrganization();
  const [orgName, setOrgName] = useState('');
  const [orgEmail, setOrgEmail] = useState('');
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [overdueAlerts, setOverdueAlerts] = useState(true);
  const [dailyDigest, setDailyDigest] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [primaryColor, setPrimaryColor] = useState('#2563eb');
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingBranding, setIsSavingBranding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load organization data
  useEffect(() => {
    if (organization) {
      setOrgName(organization.name || '');
      setOrgEmail(organization.email || '');
      setLogoUrl(organization.logo_url);
      setPrimaryColor(organization.primary_color || '#2563eb');
    }
  }, [organization]);

  const handleSaveOrg = async () => {
    if (!organization) {
      toast.error('No organization found');
      return;
    }
    
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('organizations')
        .update({ 
          name: orgName, 
          email: orgEmail,
          updated_at: new Date().toISOString()
        })
        .eq('id', organization.id);

      if (error) throw error;
      toast.success('Organization settings saved');
    } catch (error) {
      if (import.meta.env.DEV) console.error('Save error:', error);
      toast.error('Failed to save organization settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveNotifications = () => {
    toast.success('Notification preferences saved');
  };

  const handleSaveBranding = async () => {
    if (!organization) {
      toast.error('No organization found');
      return;
    }
    
    setIsSavingBranding(true);
    try {
      const { error } = await supabase
        .from('organizations')
        .update({ 
          primary_color: primaryColor,
          updated_at: new Date().toISOString()
        })
        .eq('id', organization.id);

      if (error) throw error;
      toast.success('Branding settings saved');
    } catch (error) {
      if (import.meta.env.DEV) console.error('Save error:', error);
      toast.error('Failed to save branding settings');
    } finally {
      setIsSavingBranding(false);
    }
  };

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      toast.error('Please upload a PNG, SVG, JPEG, or WebP image');
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
      const fileName = `org-logo-${Date.now()}.${fileExt}`;
      const filePath = `logos/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('organization-logos')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('organization-logos')
        .getPublicUrl(filePath);

      // Update organization with new logo URL
      if (organization) {
        const { error: updateError } = await supabase
          .from('organizations')
          .update({ logo_url: publicUrl, updated_at: new Date().toISOString() })
          .eq('id', organization.id);

        if (updateError) throw updateError;
      }

      setLogoUrl(publicUrl);
      toast.success('Logo uploaded and saved successfully');
    } catch (error) {
      if (import.meta.env.DEV) console.error('Upload error:', error);
      toast.error('Failed to upload logo');
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Manage your organization and application preferences
        </p>
      </div>

      <Tabs defaultValue="organization" className="space-y-6">
        <TabsList>
          <TabsTrigger value="organization">
            <Building2 className="h-4 w-4 mr-2" />
            Organization
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell className="h-4 w-4 mr-2" />
            Notifications
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="branding">
              <Palette className="h-4 w-4 mr-2" />
              Branding
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="organization">
          <Card>
            <CardHeader>
              <CardTitle>Organization Details</CardTitle>
              <CardDescription>
                Update your organization's information
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="org-name">Organization Name</Label>
                  <Input
                    id="org-name"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    disabled={!isAdminOrManager}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-email">Contact Email</Label>
                  <Input
                    id="org-email"
                    type="email"
                    value={orgEmail}
                    onChange={(e) => setOrgEmail(e.target.value)}
                    disabled={!isAdminOrManager}
                  />
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <h3 className="font-medium">Default Settings</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Default Timezone</Label>
                    <Input value="Africa/Johannesburg" disabled />
                  </div>
                  <div className="space-y-2">
                    <Label>Default City</Label>
                    <Input value="City of Tshwane" disabled />
                  </div>
                </div>
              </div>

              {isAdminOrManager && (
                <Button onClick={handleSaveOrg} disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>Notification Preferences</CardTitle>
              <CardDescription>
                Configure how and when you receive notifications
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Email Notifications</Label>
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
                    <Label>Overdue Task Alerts</Label>
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
                    <Label>Daily Digest</Label>
                    <p className="text-sm text-muted-foreground">
                      Receive a daily summary of pending tasks
                    </p>
                  </div>
                  <Switch
                    checked={dailyDigest}
                    onCheckedChange={setDailyDigest}
                  />
                </div>
              </div>

              <Button onClick={handleSaveNotifications}>Save Preferences</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="branding">
            <Card>
              <CardHeader>
                <CardTitle>Branding</CardTitle>
                <CardDescription>
                  Customize the appearance of your organization
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Organization Logo</Label>
                    <div className="flex items-center gap-4">
                      <div className="h-20 w-20 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                        {logoUrl ? (
                          <img 
                            src={logoUrl} 
                            alt="Organization logo" 
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Building2 className="h-8 w-8 text-muted-foreground" />
                        )}
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/svg+xml,image/jpeg,image/webp"
                        onChange={handleLogoUpload}
                        className="hidden"
                      />
                      <Button 
                        variant="outline" 
                        onClick={triggerFileUpload}
                        disabled={isUploading}
                      >
                        {isUploading ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4 mr-2" />
                        )}
                        {isUploading ? 'Uploading...' : 'Upload Logo'}
                      </Button>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Recommended: 200x200px, PNG or SVG
                    </p>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label>Primary Color</Label>
                    <div className="flex items-center gap-4">
                      <div
                        className="h-20 w-20 rounded-lg border flex items-center justify-center"
                        style={{ backgroundColor: primaryColor }}
                      />
                      <div className="flex flex-col gap-2">
                        <label className="cursor-pointer">
                          <input
                            type="color"
                            value={primaryColor}
                            onChange={(e) => setPrimaryColor(e.target.value)}
                            className="sr-only"
                          />
                          <Button variant="outline" asChild>
                            <span>
                              <Palette className="h-4 w-4 mr-2" />
                              Choose Color
                            </span>
                          </Button>
                        </label>
                        <span className="text-sm text-muted-foreground">
                          Current: {primaryColor}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Used for buttons and accent elements
                    </p>
                  </div>
                </div>

                <Button onClick={handleSaveBranding} disabled={isSavingBranding}>
                  {isSavingBranding ? 'Saving...' : 'Save Branding'}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
