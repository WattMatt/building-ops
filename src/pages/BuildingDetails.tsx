import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Building2, MapPin, Edit, Users, Phone, Mail, User, Shield } from 'lucide-react';
import { toast } from 'sonner';
import TenantsTab from '@/components/building/TenantsTab';
import AssetsTab from '@/components/building/AssetsTab';
import DocumentsTab from '@/components/building/DocumentsTab';
import MaintenanceCalendarTab from '@/components/building/MaintenanceCalendarTab';
import NotesTab from '@/components/building/NotesTab';

interface Building {
  id: string;
  name: string;
  address: string;
  city: string;
  emergency_contacts: any;
  created_at: string;
}

export default function BuildingDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdminOrManager } = useAuth();
  const [building, setBuilding] = useState<Building | null>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/buildings')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
              <Building2 className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{building.name}</h1>
              <p className="text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {building.address}, {building.city}
              </p>
            </div>
          </div>
        </div>
        {isAdminOrManager && (
          <Button asChild>
            <Link to={`/buildings/${building.id}/edit`}>
              <Edit className="w-4 h-4 mr-2" />
              Edit Building
            </Link>
          </Button>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tenants">Tenants</TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-6">
          {/* Contacts Grid */}
          <div className="grid gap-4 md:grid-cols-3">
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

        <TabsContent value="tenants" className="mt-6">
          <TenantsTab buildingId={building.id} />
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
    </div>
  );
}
