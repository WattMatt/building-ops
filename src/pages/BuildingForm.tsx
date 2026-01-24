import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Building2, User, Phone, Mail, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

const buildingSchema = z.object({
  name: z.string().trim().min(1, 'Building name is required').max(100, 'Name must be less than 100 characters'),
  address: z.string().trim().min(1, 'Address is required').max(255, 'Address must be less than 255 characters'),
  assetManager: z.object({
    name: z.string().trim().max(100).optional(),
    phone: z.string().trim().max(20).optional(),
    email: z.string().trim().email('Invalid email').max(255).optional().or(z.literal('')),
  }),
  centreManagement: z.object({
    name: z.string().trim().max(100).optional(),
    phone: z.string().trim().max(20).optional(),
    email: z.string().trim().email('Invalid email').max(255).optional().or(z.literal('')),
  }),
  securityContact: z.object({
    name: z.string().trim().max(100).optional(),
    phone: z.string().trim().max(20).optional(),
    email: z.string().trim().email('Invalid email').max(255).optional().or(z.literal('')),
  }),
});

interface ContactInfo {
  name: string;
  phone: string;
  email: string;
}

export default function BuildingForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { isAdminOrManager } = useAuth();
  const { organization } = useOrganization();
  const isEditing = Boolean(id);

  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(isEditing);

  // Form state
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [assetManager, setAssetManager] = useState<ContactInfo>({ name: '', phone: '', email: '' });
  const [centreManagement, setCentreManagement] = useState<ContactInfo>({ name: '', phone: '', email: '' });
  const [securityContact, setSecurityContact] = useState<ContactInfo>({ name: '', phone: '', email: '' });

  useEffect(() => {
    if (isEditing && id) {
      fetchBuilding(id);
    }
  }, [id, isEditing]);

  const fetchBuilding = async (buildingId: string) => {
    try {
      const { data, error } = await supabase
        .from('buildings')
        .select('*')
        .eq('id', buildingId)
        .single();

      if (error) throw error;

      setName(data.name);
      setAddress(data.address);

      // Parse emergency_contacts for our contact fields
      const contacts = data.emergency_contacts as Record<string, any> | null;
      if (contacts) {
        if (contacts.assetManager) {
          setAssetManager({
            name: contacts.assetManager.name || '',
            phone: contacts.assetManager.phone || '',
            email: contacts.assetManager.email || '',
          });
        }
        if (contacts.centreManagement) {
          setCentreManagement({
            name: contacts.centreManagement.name || '',
            phone: contacts.centreManagement.phone || '',
            email: contacts.centreManagement.email || '',
          });
        }
        if (contacts.securityContact) {
          setSecurityContact({
            name: contacts.securityContact.name || '',
            phone: contacts.securityContact.phone || '',
            email: contacts.securityContact.email || '',
          });
        }
      }
    } catch (error) {
      console.error('Error fetching building:', error);
      toast.error('Failed to load building');
      navigate('/buildings');
    } finally {
      setInitialLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate
    const validation = buildingSchema.safeParse({
      name,
      address,
      assetManager,
      centreManagement,
      securityContact,
    });

    if (!validation.success) {
      const firstError = validation.error.errors[0];
      toast.error(firstError.message);
      return;
    }

    if (!organization?.id) {
      toast.error('Organization not found');
      return;
    }

    setLoading(true);

    try {
      const hasAssetManager = assetManager.name || assetManager.phone || assetManager.email;
      const hasCentreManagement = centreManagement.name || centreManagement.phone || centreManagement.email;
      const hasSecurityContact = securityContact.name || securityContact.phone || securityContact.email;

      const emergencyContacts: Record<string, any> = {};
      if (hasAssetManager) emergencyContacts.assetManager = assetManager;
      if (hasCentreManagement) emergencyContacts.centreManagement = centreManagement;
      if (hasSecurityContact) emergencyContacts.securityContact = securityContact;

      const buildingData = {
        name: name.trim(),
        address: address.trim(),
        organization_id: organization.id,
        emergency_contacts: Object.keys(emergencyContacts).length > 0 ? emergencyContacts : null,
      };

      if (isEditing && id) {
        const { error } = await supabase
          .from('buildings')
          .update(buildingData)
          .eq('id', id);

        if (error) throw error;
        toast.success('Building updated successfully');
      } else {
        const { error } = await supabase
          .from('buildings')
          .insert(buildingData);

        if (error) throw error;
        toast.success('Building created successfully');
      }

      navigate('/buildings');
    } catch (error: any) {
      console.error('Error saving building:', error);
      toast.error(error.message || 'Failed to save building');
    } finally {
      setLoading(false);
    }
  };

  if (!isAdminOrManager) {
    navigate('/buildings');
    return null;
  }

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/buildings')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">
            {isEditing ? 'Edit Building' : 'Add Building'}
          </h1>
          <p className="text-muted-foreground">
            {isEditing ? 'Update building details' : 'Add a new building to your portfolio'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Building Details
            </CardTitle>
            <CardDescription>
              Basic information about the building
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Building Name *</Label>
              <Input
                id="name"
                placeholder="Enter building name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Building Address *</Label>
              <Input
                id="address"
                placeholder="Enter full address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                required
              />
            </div>
          </CardContent>
        </Card>

        {/* Asset Manager */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Asset Manager
            </CardTitle>
            <CardDescription>
              Contact details for the asset manager
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="am-name">Name</Label>
              <Input
                id="am-name"
                placeholder="Asset manager name"
                value={assetManager.name}
                onChange={(e) => setAssetManager({ ...assetManager, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="am-phone">Phone</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="am-phone"
                    type="tel"
                    placeholder="+27 XX XXX XXXX"
                    value={assetManager.phone}
                    onChange={(e) => setAssetManager({ ...assetManager, phone: e.target.value })}
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="am-email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="am-email"
                    type="email"
                    placeholder="email@example.com"
                    value={assetManager.email}
                    onChange={(e) => setAssetManager({ ...assetManager, email: e.target.value })}
                    className="pl-9"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Centre Management */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Centre Management
            </CardTitle>
            <CardDescription>
              Contact details for centre management
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cm-name">Name</Label>
              <Input
                id="cm-name"
                placeholder="Centre manager name"
                value={centreManagement.name}
                onChange={(e) => setCentreManagement({ ...centreManagement, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cm-phone">Phone</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="cm-phone"
                    type="tel"
                    placeholder="+27 XX XXX XXXX"
                    value={centreManagement.phone}
                    onChange={(e) => setCentreManagement({ ...centreManagement, phone: e.target.value })}
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cm-email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="cm-email"
                    type="email"
                    placeholder="email@example.com"
                    value={centreManagement.email}
                    onChange={(e) => setCentreManagement({ ...centreManagement, email: e.target.value })}
                    className="pl-9"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Security Contact */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Security Contact
            </CardTitle>
            <CardDescription>
              Contact details for security
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sc-name">Name</Label>
              <Input
                id="sc-name"
                placeholder="Security contact name"
                value={securityContact.name}
                onChange={(e) => setSecurityContact({ ...securityContact, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sc-phone">Phone</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="sc-phone"
                    type="tel"
                    placeholder="+27 XX XXX XXXX"
                    value={securityContact.phone}
                    onChange={(e) => setSecurityContact({ ...securityContact, phone: e.target.value })}
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sc-email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="sc-email"
                    type="email"
                    placeholder="email@example.com"
                    value={securityContact.email}
                    onChange={(e) => setSecurityContact({ ...securityContact, email: e.target.value })}
                    className="pl-9"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate('/buildings')}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? 'Saving...' : isEditing ? 'Update Building' : 'Create Building'}
          </Button>
        </div>
      </form>
    </div>
  );
}
