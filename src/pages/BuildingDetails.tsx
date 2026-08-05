import { useState, useEffect } from 'react';
import { formatBuildingName } from '@/lib/buildingName';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, MapPin, Edit, Users, Phone, Mail, User, Shield, Camera } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import TenantsTab from '@/components/building/TenantsTab';
import AssetsTab from '@/components/building/AssetsTab';
import DocumentsTab from '@/components/building/DocumentsTab';
import MaintenanceCalendarTab from '@/components/building/MaintenanceCalendarTab';
import NotesTab from '@/components/building/NotesTab';
import OverviewWidgets from '@/components/building/OverviewWidgets';
import ChecklistsTab from '@/components/building/ChecklistsTab';
import FormsTab from '@/components/building/FormsTab';
import ReportsTab from '@/components/building/ReportsTab';
import InsightLinkerTab from '@/components/building/InsightLinkerTab';
import { BuildingAvatar } from '@/components/building/BuildingAvatar';
import { BuildingAvatarDialog } from '@/components/building/BuildingAvatarDialog';
import { BuildingScoreChips } from '@/components/building/BuildingScoreChips';
import { useBuildingScore } from '@/hooks/useBuildingScore';

interface Building {
  id: string;
  name: string;
  address: string;
  city: string;
  logo_url: string | null;
  logo_position: string | null;
  avatar_color: string | null;
  emergency_contacts: any;
  created_at: string;
}

export default function BuildingDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdminOrManager } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [building, setBuilding] = useState<Building | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') ?? 'overview');
  const { ohsPct, taskPct } = useBuildingScore(id);
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);

  // keep the active tab in the URL so report links / the editor back-button can deep-link here
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setSearchParams((prev) => { prev.set('tab', tab); return prev; }, { replace: true });
  };

  useEffect(() => {
    if (id) fetchBuilding(id);
  }, [id]);

  const fetchBuilding = async (buildingId: string) => {
    try {
      const { data, error } = await supabase
        .from('buildings')
        .select('*')
        .eq('id', buildingId)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        toast.error('Building not found');
        navigate('/buildings');
        return;
      }
      setBuilding(data);
    } catch (error) {
      console.error('Error fetching building:', error);
      toast.error('Failed to load building');
      navigate('/buildings');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!building) return null;

  const contacts = building.emergency_contacts || {};
  const hasCustomLogo = building.logo_url && !building.logo_url.includes('dicebear');
  const logoPosition = building.logo_position || 'top-left';

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:gap-4">
        <div className="relative flex items-start sm:items-center gap-2 sm:gap-4">
          {/* Positioned Logo Overlay (single source of the building logo) */}
          {hasCustomLogo && (
            <div
              className={cn(
                'absolute z-10 group',
                logoPosition === 'top-left' && 'top-0 left-10 sm:left-12',
                logoPosition === 'top-center' && 'top-0 left-1/2 -translate-x-1/2',
                logoPosition === 'top-right' && 'top-0 right-0'
              )}
            >
              <img
                src={building.logo_url!}
                alt="Building logo"
                className="w-8 h-8 sm:w-10 sm:h-10 object-contain rounded-md bg-background/95 backdrop-blur-sm border shadow-sm"
              />
              {isAdminOrManager && (
                <button
                  onClick={() => setAvatarDialogOpen(true)}
                  className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-md cursor-pointer"
                  title="Change logo"
                >
                  <Camera className="h-4 w-4 text-white" />
                </button>
              )}
            </div>
          )}
          
          <Button variant="ghost" size="icon" onClick={() => navigate('/buildings')} className="shrink-0 h-8 w-8 sm:h-10 sm:w-10">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            {/* Fallback avatar shown only when there is no custom logo (the
                positioned overlay handles the custom-logo case). Keeps the
                logo-upload entry point available for logo-less buildings. */}
            {!hasCustomLogo && (
              <div className="relative group shrink-0">
                <BuildingAvatar
                  name={building.name}
                  logoUrl={building.logo_url}
                  avatarColor={building.avatar_color}
                  size="lg"
                  className="w-10 h-10 sm:w-12 sm:h-12"
                />
                {isAdminOrManager && (
                  <button
                    onClick={() => setAvatarDialogOpen(true)}
                    className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg cursor-pointer"
                    title="Change avatar"
                  >
                    <Camera className="h-4 w-4 text-white" />
                  </button>
                )}
              </div>
            )}
            <div className={cn("min-w-0 flex-1", hasCustomLogo && logoPosition === 'top-center' && "pt-10 sm:pt-12")}>
              <h1 className="text-lg sm:text-2xl font-bold truncate">{formatBuildingName(building.name)}</h1>
              <p className="text-xs sm:text-sm text-muted-foreground flex items-center gap-1 truncate">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{building.address}, {building.city}</span>
              </p>
              <div className="mt-2">
                <BuildingScoreChips ohsPct={ohsPct} taskPct={taskPct} />
              </div>
            </div>
          </div>
        </div>
        {isAdminOrManager && (
          <Button asChild size="sm" className="self-start ml-10 sm:ml-14">
            <Link to={`/buildings/${building.id}/edit`}>
              <Edit className="w-4 h-4 mr-1.5" />
              Edit
            </Link>
          </Button>
        )}
      </div>

      {/* Tabs - Mobile optimized with icons */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="w-full">
          <TabsTrigger value="overview" className="flex-1 sm:flex-none">
            <span className="hidden sm:inline">Overview</span>
            <span className="sm:hidden">Info</span>
          </TabsTrigger>
          <TabsTrigger value="checklists" className="flex-1 sm:flex-none">
            <span className="hidden sm:inline">Checklists</span>
            <span className="sm:hidden">Tasks</span>
          </TabsTrigger>
          <TabsTrigger value="forms" className="flex-1 sm:flex-none">Forms</TabsTrigger>
          <TabsTrigger value="reports" className="flex-1 sm:flex-none">Reports</TabsTrigger>
          <TabsTrigger value="tenants" className="flex-1 sm:flex-none">Tenants</TabsTrigger>
          <TabsTrigger value="assets" className="flex-1 sm:flex-none">Assets</TabsTrigger>
          <TabsTrigger value="maintenance" className="flex-1 sm:flex-none">
            <span className="hidden sm:inline">Maintenance</span>
            <span className="sm:hidden">Maint.</span>
          </TabsTrigger>
          <TabsTrigger value="electrical" className="flex-1 sm:flex-none">
            <span className="hidden sm:inline">Electrical &amp; Compliance</span>
            <span className="sm:hidden">Elec.</span>
          </TabsTrigger>
          <TabsTrigger value="documents" className="flex-1 sm:flex-none">
            <span className="hidden sm:inline">Documents</span>
            <span className="sm:hidden">Docs</span>
          </TabsTrigger>
          <TabsTrigger value="notes" className="flex-1 sm:flex-none">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-6">
          {/* Alert Widgets */}
          <OverviewWidgets buildingId={building.id} onTabChange={setActiveTab} />

          {/* Contacts Grid */}
          <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {/* Asset Manager */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Asset Manager
                </CardTitle>
              </CardHeader>
              <CardContent>
                {contacts.assetManager?.name ? (
                  <div className="space-y-2">
                    <p className="font-medium">{contacts.assetManager.name}</p>
                    {contacts.assetManager.phone && (
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {contacts.assetManager.phone}
                      </p>
                    )}
                    {contacts.assetManager.email && (
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {contacts.assetManager.email}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Not configured</p>
                )}
              </CardContent>
            </Card>

            {/* Centre Management */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Centre Management
                </CardTitle>
              </CardHeader>
              <CardContent>
                {contacts.centreManagement?.name ? (
                  <div className="space-y-2">
                    <p className="font-medium">{contacts.centreManagement.name}</p>
                    {contacts.centreManagement.phone && (
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {contacts.centreManagement.phone}
                      </p>
                    )}
                    {contacts.centreManagement.email && (
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {contacts.centreManagement.email}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Not configured</p>
                )}
              </CardContent>
            </Card>

            {/* Security Contact */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Security Contact
                </CardTitle>
              </CardHeader>
              <CardContent>
                {contacts.securityContact?.name ? (
                  <div className="space-y-2">
                    <p className="font-medium">{contacts.securityContact.name}</p>
                    {contacts.securityContact.phone && (
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {contacts.securityContact.phone}
                      </p>
                    )}
                    {contacts.securityContact.email && (
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {contacts.securityContact.email}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Not configured</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="checklists" className="mt-6">
          <ChecklistsTab buildingId={building.id} buildingName={building.name} />
        </TabsContent>

        <TabsContent value="forms" className="mt-6">
          <FormsTab buildingId={building.id} buildingName={building.name} />
        </TabsContent>

        <TabsContent value="reports" className="mt-6">
          <ReportsTab buildingId={building.id} buildingName={building.name} />
        </TabsContent>

        <TabsContent value="tenants" className="mt-6">
          <TenantsTab buildingId={building.id} />
        </TabsContent>

        <TabsContent value="electrical" className="mt-6">
          <InsightLinkerTab buildingId={building.id} active={activeTab === 'electrical'} />
        </TabsContent>

        <TabsContent value="assets" className="mt-6">
          <AssetsTab buildingId={building.id} />
        </TabsContent>

        <TabsContent value="maintenance" className="mt-6">
          <MaintenanceCalendarTab buildingId={building.id} />
        </TabsContent>

        <TabsContent value="documents" className="mt-6">
          <DocumentsTab buildingId={building.id} />
        </TabsContent>

        <TabsContent value="notes" className="mt-6">
          <NotesTab buildingId={building.id} />
        </TabsContent>
      </Tabs>

      {/* Avatar Change Dialog */}
      {isAdminOrManager && (
        <BuildingAvatarDialog
          open={avatarDialogOpen}
          onOpenChange={setAvatarDialogOpen}
          buildingId={building.id}
          buildingName={building.name}
          currentLogoUrl={building.logo_url}
          currentAvatarColor={building.avatar_color}
          onSuccess={() => id && fetchBuilding(id)}
        />
      )}
    </div>
  );
}
