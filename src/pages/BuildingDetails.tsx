import { useState, useEffect, useRef } from 'react';
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
import PpmTab from '@/components/building/PpmTab';
import DocumentsTab from '@/components/building/DocumentsTab';
import BuildingCalendarTab from '@/components/building/BuildingCalendarTab';
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
import { useBuildingTrend } from '@/hooks/useBuildingTrend';

interface Building {
  id: string;
  name: string;
  // Nullable in the regenerated row type; the header renders whatever is there.
  address: string | null;
  city: string | null;
  logo_url: string | null;
  logo_position: string | null;
  avatar_color: string | null;
  emergency_contacts: any;
  created_at: string | null;
}

export default function BuildingDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdminOrManager } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [building, setBuilding] = useState<Building | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') ?? 'overview');
  const { ohsPct, taskPct, asOf } = useBuildingScore(id);
  const trend = useBuildingTrend(id, 90);
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);

  // keep the active tab in the URL so report links / the editor back-button can deep-link here
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setSearchParams((prev) => { prev.set('tab', tab); return prev; }, { replace: true });
  };

  // `activeTab` is seeded from ?tab= once above; in-app navigations to the same
  // building with a different ?tab= (quick-create "New note", palette hits) must
  // switch too. Only write when the param is present and differs, so the
  // handleTabChange -> setSearchParams -> effect round-trip cannot loop.
  const tabParam = searchParams.get('tab');
  useEffect(() => {
    if (tabParam !== null && tabParam !== activeTab) setActiveTab(tabParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync from the URL only when the param changes
  }, [tabParam]);

  // On phones the tab strip scrolls horizontally; keep the active tab in view
  // (deep links like ?tab=documents land on a tab that starts off-screen).
  // `loading` is a dep because the strip only mounts once the building has loaded.
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tabsRef.current?.querySelector<HTMLElement>('[data-state="active"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [activeTab, loading]);

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
                <BuildingScoreChips ohsPct={ohsPct} taskPct={taskPct} ohsTrend={trend.series.compliance} taskTrend={trend.series.tasks} asOf={asOf} />
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
        <TabsList ref={tabsRef} className="w-full flex-nowrap justify-start overflow-x-auto overflow-y-hidden whitespace-nowrap snap-x scroll-px-3 sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
          <TabsTrigger value="overview" className="snap-start shrink-0 min-h-11 sm:min-h-0 sm:flex-none">
            <span className="hidden sm:inline">Overview</span>
            <span className="sm:hidden">Info</span>
          </TabsTrigger>
          <TabsTrigger value="checklists" className="snap-start shrink-0 min-h-11 sm:min-h-0 sm:flex-none">
            <span className="hidden sm:inline">Checklists</span>
            <span className="sm:hidden">Tasks</span>
          </TabsTrigger>
          <TabsTrigger value="forms" className="snap-start shrink-0 min-h-11 sm:min-h-0 sm:flex-none">Forms</TabsTrigger>
          <TabsTrigger value="reports" className="snap-start shrink-0 min-h-11 sm:min-h-0 sm:flex-none">Reports</TabsTrigger>
          <TabsTrigger value="tenants" className="snap-start shrink-0 min-h-11 sm:min-h-0 sm:flex-none">Tenants</TabsTrigger>
          <TabsTrigger value="assets" className="snap-start shrink-0 min-h-11 sm:min-h-0 sm:flex-none">Assets</TabsTrigger>
          <TabsTrigger value="ppm" className="snap-start shrink-0 min-h-11 sm:min-h-0 sm:flex-none">PPM</TabsTrigger>
          {/* Value stays `maintenance` so existing ?tab=maintenance deep links keep working. */}
          <TabsTrigger value="maintenance" className="snap-start shrink-0 min-h-11 sm:min-h-0 sm:flex-none">
            <span className="hidden sm:inline">Calendar</span>
            <span className="sm:hidden">Cal.</span>
          </TabsTrigger>
          <TabsTrigger value="electrical" className="snap-start shrink-0 min-h-11 sm:min-h-0 sm:flex-none">
            <span className="hidden sm:inline">Electrical &amp; Compliance</span>
            <span className="sm:hidden">Elec.</span>
          </TabsTrigger>
          <TabsTrigger value="documents" className="snap-start shrink-0 min-h-11 sm:min-h-0 sm:flex-none">
            <span className="hidden sm:inline">Documents</span>
            <span className="sm:hidden">Docs</span>
          </TabsTrigger>
          <TabsTrigger value="notes" className="snap-start shrink-0 min-h-11 sm:min-h-0 sm:flex-none">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          {/* Phone-first order (spec §5.3): score chips live in the header;
              OverviewWidgets leads with today's tasks and open issues, then the
              alert widgets; contacts follow. That is plain DOM order — nothing is
              reordered per breakpoint. */}
          <div className="flex flex-col gap-6">
            {/* Overview Widgets */}
            <div>
              <OverviewWidgets buildingId={building.id} onTabChange={handleTabChange} />
            </div>

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
                        <a href={`tel:${contacts.assetManager.phone.replace(/\s+/g, '')}`} className="hover:underline">{contacts.assetManager.phone}</a>
                      </p>
                    )}
                    {contacts.assetManager.email && (
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        <a href={`mailto:${contacts.assetManager.email}`} className="hover:underline">{contacts.assetManager.email}</a>
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
                        <a href={`tel:${contacts.centreManagement.phone.replace(/\s+/g, '')}`} className="hover:underline">{contacts.centreManagement.phone}</a>
                      </p>
                    )}
                    {contacts.centreManagement.email && (
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        <a href={`mailto:${contacts.centreManagement.email}`} className="hover:underline">{contacts.centreManagement.email}</a>
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
                        <a href={`tel:${contacts.securityContact.phone.replace(/\s+/g, '')}`} className="hover:underline">{contacts.securityContact.phone}</a>
                      </p>
                    )}
                    {contacts.securityContact.email && (
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        <a href={`mailto:${contacts.securityContact.email}`} className="hover:underline">{contacts.securityContact.email}</a>
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Not configured</p>
                )}
              </CardContent>
            </Card>
          </div>
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

        <TabsContent value="ppm" className="mt-6">
          <PpmTab buildingId={building.id} />
        </TabsContent>

        <TabsContent value="maintenance" className="mt-6">
          <BuildingCalendarTab buildingId={building.id} buildingName={building.name} />
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
