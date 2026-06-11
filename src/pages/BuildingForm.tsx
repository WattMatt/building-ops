import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import type { Json } from '@/integrations/supabase/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Building2, User, Shield, Zap, Landmark, Gauge, ImagePlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import ContactSection, { ContactInfo } from '@/components/building/ContactSection';
import ProfessionalTeamSection, { ProfessionalTeam, ProfessionalContact } from '@/components/building/ProfessionalTeamSection';
import TariffSection, { UtilityTariffs, UtilityTariff } from '@/components/building/TariffSection';
import { SinglePhotoCapture } from '@/components/ui/photo-capture';
import { BuildingCardPreview } from '@/components/building/BuildingCardPreview';
import { BuildingAvatarPicker } from '@/components/avatar/BuildingAvatarPicker';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const contactSchema = z.object({
  name: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email('Invalid email').max(255).optional().or(z.literal('')),
});

const buildingSchema = z.object({
  name: z.string().trim().min(1, 'Building name is required').max(100, 'Name must be less than 100 characters'),
  address: z.string().trim().min(1, 'Address is required').max(255, 'Address must be less than 255 characters'),
  assetManager: contactSchema,
  centreManagement: contactSchema,
  securityContact: contactSchema,
  electricalAuthority: contactSchema.extend({ account_number: z.string().trim().max(50).optional() }),
  council: contactSchema.extend({ ward_number: z.string().trim().max(50).optional() }),
  meterReading: contactSchema.extend({ contract_number: z.string().trim().max(50).optional() }),
});

const emptyContact: ContactInfo = { name: '', phone: '', email: '' };
const emptyExtendedContact = { name: '', phone: '', email: '', account_number: '' };
const emptyCouncilContact = { name: '', phone: '', email: '', ward_number: '' };
const emptyMeterContact = { name: '', phone: '', email: '', contract_number: '' };
const emptyProfessional: ProfessionalContact = { name: '', company: '', phone: '', email: '' };
const emptyProfessionalTeam: ProfessionalTeam = {
  architect: { ...emptyProfessional },
  civil_engineer: { ...emptyProfessional },
  structural_engineer: { ...emptyProfessional },
  electrical_engineer: { ...emptyProfessional },
  wet_services_engineer: { ...emptyProfessional },
};
const emptyTariff: UtilityTariff = { rate: '', unit: '', notes: '' };
const emptyTariffs: UtilityTariffs = {
  electricity: { ...emptyTariff },
  water: { ...emptyTariff },
};

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
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPosition, setLogoPosition] = useState<string>('top-left');
  const [avatarColor, setAvatarColor] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [assetManager, setAssetManager] = useState<ContactInfo>({ ...emptyContact });
  const [centreManagement, setCentreManagement] = useState<ContactInfo>({ ...emptyContact });
  const [securityContact, setSecurityContact] = useState<ContactInfo>({ ...emptyContact });
  
  // New fields
  const [electricalAuthority, setElectricalAuthority] = useState({ ...emptyExtendedContact });
  const [council, setCouncil] = useState({ ...emptyCouncilContact });
  const [meterReading, setMeterReading] = useState({ ...emptyMeterContact });
  const [professionalTeam, setProfessionalTeam] = useState<ProfessionalTeam>({ ...emptyProfessionalTeam });
  const [utilityTariffs, setUtilityTariffs] = useState<UtilityTariffs>({ ...emptyTariffs });

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
      setLogoUrl(data.logo_url);
      setLogoPosition(data.logo_position || 'top-left');
      setAvatarColor(data.avatar_color || null);

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

      // Parse new fields
      const elecAuth = data.electrical_authority as Record<string, any> | null;
      if (elecAuth) {
        setElectricalAuthority({
          name: elecAuth.name || '',
          phone: elecAuth.phone || '',
          email: elecAuth.email || '',
          account_number: elecAuth.account_number || '',
        });
      }

      const councilData = data.council_details as Record<string, any> | null;
      if (councilData) {
        setCouncil({
          name: councilData.name || '',
          phone: councilData.phone || '',
          email: councilData.email || '',
          ward_number: councilData.ward_number || '',
        });
      }

      const meterData = data.meter_reading_company as Record<string, any> | null;
      if (meterData) {
        setMeterReading({
          name: meterData.name || '',
          phone: meterData.phone || '',
          email: meterData.email || '',
          contract_number: meterData.contract_number || '',
        });
      }

      const teamData = data.professional_team as Record<string, any> | null;
      if (teamData) {
        setProfessionalTeam({
          architect: teamData.architect || { ...emptyProfessional },
          civil_engineer: teamData.civil_engineer || { ...emptyProfessional },
          structural_engineer: teamData.structural_engineer || { ...emptyProfessional },
          electrical_engineer: teamData.electrical_engineer || { ...emptyProfessional },
          wet_services_engineer: teamData.wet_services_engineer || { ...emptyProfessional },
        });
      }

      const tariffsData = data.utility_tariffs as Record<string, any> | null;
      if (tariffsData) {
        setUtilityTariffs({
          electricity: tariffsData.electricity || { ...emptyTariff },
          water: tariffsData.water || { ...emptyTariff },
        });
      }
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error fetching building:', error);
      toast.error('Failed to load building');
      navigate('/buildings');
    } finally {
      setInitialLoading(false);
    }
  };

  const hasContent = (obj: Record<string, any>): boolean => {
    return Object.values(obj).some(v => 
      typeof v === 'string' ? v.trim() !== '' : (typeof v === 'object' ? hasContent(v) : Boolean(v))
    );
  };

  const uploadLogo = async (buildingId: string): Promise<string | null> => {
    if (!logoFile) return logoUrl;

    const fileExt = logoFile.name.split('.').pop()?.toLowerCase() || 'jpg';
    const filePath = `${buildingId}/logo.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('building-logos')
      .upload(filePath, logoFile, { upsert: true });

    if (uploadError) {
      if (import.meta.env.DEV) console.error('Logo upload error:', uploadError);
      toast.error('Failed to upload logo');
      return logoUrl;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('building-logos')
      .getPublicUrl(filePath);

    return publicUrl;
  };

  const handleLogoSelect = (file: File) => {
    setLogoFile(file);
    // Create a preview URL
    const previewUrl = URL.createObjectURL(file);
    setLogoUrl(previewUrl);
  };

  const handleRemoveLogo = () => {
    setLogoFile(null);
    setLogoUrl(null);
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
      electricalAuthority,
      council,
      meterReading,
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
      const hasAssetManager = hasContent(assetManager);
      const hasCentreManagement = hasContent(centreManagement);
      const hasSecurityContact = hasContent(securityContact);

      const emergencyContacts: Record<string, any> = {};
      if (hasAssetManager) emergencyContacts.assetManager = assetManager;
      if (hasCentreManagement) emergencyContacts.centreManagement = centreManagement;
      if (hasSecurityContact) emergencyContacts.securityContact = securityContact;

      // Build initial data without logo_url
      const buildingData: Record<string, any> = {
        name: name.trim(),
        address: address.trim(),
        organization_id: organization.id,
        logo_position: logoPosition,
        avatar_color: avatarColor,
        emergency_contacts: Object.keys(emergencyContacts).length > 0 ? (emergencyContacts as Json) : null,
        electrical_authority: hasContent(electricalAuthority) ? (electricalAuthority as Json) : null,
        council_details: hasContent(council) ? (council as Json) : null,
        meter_reading_company: hasContent(meterReading) ? (meterReading as Json) : null,
        professional_team: hasContent(professionalTeam) ? (professionalTeam as unknown as Json) : null,
        utility_tariffs: hasContent(utilityTariffs) ? (utilityTariffs as unknown as Json) : null,
      };

      if (isEditing && id) {
        // Upload logo if changed
        const finalLogoUrl = await uploadLogo(id);
        buildingData.logo_url = finalLogoUrl;

        const { error } = await supabase
          .from('buildings')
          .update(buildingData)
          .eq('id', id);

        if (error) throw error;
        toast.success('Building updated successfully');
      } else {
        // For new buildings, first insert to get the ID, then upload logo
        const insertData = {
          name: name.trim(),
          address: address.trim(),
          organization_id: organization.id,
          logo_position: logoPosition,
          avatar_color: avatarColor,
          emergency_contacts: Object.keys(emergencyContacts).length > 0 ? (emergencyContacts as Json) : null,
          electrical_authority: hasContent(electricalAuthority) ? (electricalAuthority as Json) : null,
          council_details: hasContent(council) ? (council as Json) : null,
          meter_reading_company: hasContent(meterReading) ? (meterReading as Json) : null,
          professional_team: hasContent(professionalTeam) ? (professionalTeam as unknown as Json) : null,
          utility_tariffs: hasContent(utilityTariffs) ? (utilityTariffs as unknown as Json) : null,
        };
        
        const { data: newBuilding, error } = await supabase
          .from('buildings')
          .insert([insertData])
          .select('id')
          .single();

        if (error) throw error;

        // Now upload logo with the new building ID
        if (logoFile && newBuilding?.id) {
          const finalLogoUrl = await uploadLogo(newBuilding.id);
          await supabase
            .from('buildings')
            .update({ logo_url: finalLogoUrl })
            .eq('id', newBuilding.id);
        }

        toast.success('Building created successfully');
      }

      navigate('/buildings');
    } catch (error: any) {
      if (import.meta.env.DEV) console.error('Error saving building:', error);
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
    <div className="max-w-3xl mx-auto space-y-6">
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
            {/* Building Logo / Avatar */}
            <div className="space-y-3">
              <Label>Building Identity</Label>
              <Tabs defaultValue="upload" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="upload">Upload Logo</TabsTrigger>
                  <TabsTrigger value="pattern">Use Pattern</TabsTrigger>
                </TabsList>
                
                <TabsContent value="upload" className="mt-4">
                  <div className="flex items-start gap-4">
                    {logoUrl && !logoUrl.includes('dicebear') ? (
                      <div className="relative">
                        <img
                          src={logoUrl}
                          alt="Building logo"
                          className="w-24 h-24 sm:w-32 sm:h-32 object-contain rounded-lg border bg-muted"
                        />
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute -top-2 -right-2 h-6 w-6"
                          onClick={handleRemoveLogo}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <SinglePhotoCapture
                        onPhotoSelect={handleLogoSelect}
                        placeholder={
                          <div className="flex flex-col items-center gap-1 text-muted-foreground">
                            <ImagePlus className="h-6 w-6" />
                            <span className="text-xs">Upload Logo</span>
                          </div>
                        }
                        shape="rounded"
                        size="lg"
                        acceptedTypes={['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']}
                        maxSizeMB={5}
                        maxDimension={512}
                        className="w-24 h-24 sm:w-32 sm:h-32"
                      />
                    )}
                    <div className="text-xs text-muted-foreground">
                      <p>Recommended: Square image, at least 256x256px</p>
                      <p>Formats: JPG, PNG, WebP</p>
                      <p>Max size: 5MB</p>
                    </div>
                  </div>
                </TabsContent>
                
                <TabsContent value="pattern" className="mt-4">
                  <BuildingAvatarPicker
                    selectedUrl={logoUrl?.includes('dicebear') ? logoUrl : null}
                    selectedColor={avatarColor}
                    onSelect={(url) => {
                      setLogoUrl(url);
                      setLogoFile(null);
                    }}
                    onColorChange={setAvatarColor}
                    buildingName={name}
                    disabled={uploadingLogo}
                  />
                </TabsContent>
              </Tabs>
              
              {/* Logo Position Selector with Live Preview */}
              {logoUrl && (
                <div className="flex flex-col sm:flex-row gap-6">
                  <div className="space-y-2">
                    <Label className="text-sm">Logo Position in Card</Label>
                    <div className="grid grid-cols-3 gap-2 max-w-xs">
                      {[
                        { value: 'top-left', label: 'Top Left' },
                        { value: 'top-center', label: 'Top Center' },
                        { value: 'top-right', label: 'Top Right' },
                      ].map((pos) => (
                        <Button
                          key={pos.value}
                          type="button"
                          variant={logoPosition === pos.value ? 'default' : 'outline'}
                          size="sm"
                          className="text-xs h-8"
                          onClick={() => setLogoPosition(pos.value)}
                        >
                          {pos.label}
                        </Button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Choose where the logo appears on building cards
                    </p>
                  </div>
                  
                  {/* Live Card Preview */}
                  <BuildingCardPreview
                    name={name}
                    address={address}
                    logoUrl={logoUrl}
                    logoPosition={logoPosition}
                    avatarColor={avatarColor}
                  />
                </div>
              )}
            </div>
            
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

        <Separator />
        <h2 className="text-lg font-semibold text-muted-foreground">Management Contacts</h2>

        {/* Asset Manager */}
        <ContactSection
          title="Asset Manager"
          description="Contact details for the asset manager"
          icon={<User className="h-5 w-5" />}
          contact={assetManager}
          onChange={setAssetManager}
          idPrefix="am"
          namePlaceholder="Asset manager name"
        />

        {/* Centre Management */}
        <ContactSection
          title="Centre Management"
          description="Contact details for centre management"
          icon={<User className="h-5 w-5" />}
          contact={centreManagement}
          onChange={setCentreManagement}
          idPrefix="cm"
          namePlaceholder="Centre manager name"
        />

        {/* Security Contact */}
        <ContactSection
          title="Security Contact"
          description="Contact details for security"
          icon={<Shield className="h-5 w-5" />}
          contact={securityContact}
          onChange={setSecurityContact}
          idPrefix="sc"
          namePlaceholder="Security contact name"
        />

        <Separator />
        <h2 className="text-lg font-semibold text-muted-foreground">Utilities & Authorities</h2>

        {/* Electrical Supply Authority */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Electrical Supply Authority
            </CardTitle>
            <CardDescription>
              Contact details for your electrical utility provider
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="elec-name">Authority Name</Label>
                <Input
                  id="elec-name"
                  placeholder="e.g., Eskom, City Power"
                  value={electricalAuthority.name}
                  onChange={(e) => setElectricalAuthority({ ...electricalAuthority, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="elec-account">Account Number</Label>
                <Input
                  id="elec-account"
                  placeholder="Account number"
                  value={electricalAuthority.account_number}
                  onChange={(e) => setElectricalAuthority({ ...electricalAuthority, account_number: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="elec-phone">Phone</Label>
                <Input
                  id="elec-phone"
                  type="tel"
                  placeholder="+27 XX XXX XXXX"
                  value={electricalAuthority.phone}
                  onChange={(e) => setElectricalAuthority({ ...electricalAuthority, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="elec-email">Email</Label>
                <Input
                  id="elec-email"
                  type="email"
                  placeholder="email@example.com"
                  value={electricalAuthority.email}
                  onChange={(e) => setElectricalAuthority({ ...electricalAuthority, email: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Council Details */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Landmark className="h-5 w-5" />
              Council
            </CardTitle>
            <CardDescription>
              Local council contact details
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="council-name">Council Name</Label>
                <Input
                  id="council-name"
                  placeholder="e.g., City of Tshwane"
                  value={council.name}
                  onChange={(e) => setCouncil({ ...council, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="council-ward">Ward Number</Label>
                <Input
                  id="council-ward"
                  placeholder="Ward number"
                  value={council.ward_number}
                  onChange={(e) => setCouncil({ ...council, ward_number: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="council-phone">Phone</Label>
                <Input
                  id="council-phone"
                  type="tel"
                  placeholder="+27 XX XXX XXXX"
                  value={council.phone}
                  onChange={(e) => setCouncil({ ...council, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="council-email">Email</Label>
                <Input
                  id="council-email"
                  type="email"
                  placeholder="email@example.com"
                  value={council.email}
                  onChange={(e) => setCouncil({ ...council, email: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Meter Reading Company */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-5 w-5" />
              Meter Reading Company
            </CardTitle>
            <CardDescription>
              Contact details for your meter reading service provider
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="meter-name">Company Name</Label>
                <Input
                  id="meter-name"
                  placeholder="Company name"
                  value={meterReading.name}
                  onChange={(e) => setMeterReading({ ...meterReading, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="meter-contract">Contract Number</Label>
                <Input
                  id="meter-contract"
                  placeholder="Contract number"
                  value={meterReading.contract_number}
                  onChange={(e) => setMeterReading({ ...meterReading, contract_number: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="meter-phone">Phone</Label>
                <Input
                  id="meter-phone"
                  type="tel"
                  placeholder="+27 XX XXX XXXX"
                  value={meterReading.phone}
                  onChange={(e) => setMeterReading({ ...meterReading, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="meter-email">Email</Label>
                <Input
                  id="meter-email"
                  type="email"
                  placeholder="email@example.com"
                  value={meterReading.email}
                  onChange={(e) => setMeterReading({ ...meterReading, email: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Separator />
        <h2 className="text-lg font-semibold text-muted-foreground">Professional Team</h2>

        {/* Professional Team */}
        <ProfessionalTeamSection
          team={professionalTeam}
          onChange={setProfessionalTeam}
        />

        <Separator />
        <h2 className="text-lg font-semibold text-muted-foreground">Utility Tariffs</h2>

        {/* Utility Tariffs */}
        <TariffSection
          tariffs={utilityTariffs}
          onChange={setUtilityTariffs}
        />

        {/* Actions */}
        <div className="flex justify-end gap-4 pt-4">
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
