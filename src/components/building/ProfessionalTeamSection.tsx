import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Phone, Mail, HardHat, Ruler, Zap, Droplets, Building } from 'lucide-react';
import { ReactNode } from 'react';

export interface ProfessionalContact {
  name: string;
  company: string;
  phone: string;
  email: string;
}

// Keys are persisted verbatim into buildings.professional_team and decoded by the
// iOS reader with no key-mapping strategy — camelCase is pinned by SCHEMA_CONTRACT §2.1.
export interface ProfessionalTeam {
  architect: ProfessionalContact;
  civilEngineer: ProfessionalContact;
  structuralEngineer: ProfessionalContact;
  electricalEngineer: ProfessionalContact;
  wetServicesEngineer: ProfessionalContact;
}

interface ProfessionalFieldProps {
  title: string;
  icon: ReactNode;
  contact: ProfessionalContact;
  onChange: (contact: ProfessionalContact) => void;
  idPrefix: string;
}

function ProfessionalField({ title, icon, contact, onChange, idPrefix }: ProfessionalFieldProps) {
  return (
    <div className="p-4 rounded-lg bg-muted/30 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-name`} className="text-xs">Contact Name</Label>
          <Input
            id={`${idPrefix}-name`}
            placeholder="Contact person"
            value={contact.name}
            onChange={(e) => onChange({ ...contact, name: e.target.value })}
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-company`} className="text-xs">Company</Label>
          <Input
            id={`${idPrefix}-company`}
            placeholder="Company name"
            value={contact.company}
            onChange={(e) => onChange({ ...contact, company: e.target.value })}
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-phone`} className="text-xs">Phone</Label>
          <div className="relative">
            <Phone className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              id={`${idPrefix}-phone`}
              type="tel"
              placeholder="+27 XX XXX XXXX"
              value={contact.phone}
              onChange={(e) => onChange({ ...contact, phone: e.target.value })}
              className="pl-7 h-9"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-email`} className="text-xs">Email</Label>
          <div className="relative">
            <Mail className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              id={`${idPrefix}-email`}
              type="email"
              placeholder="email@example.com"
              value={contact.email}
              onChange={(e) => onChange({ ...contact, email: e.target.value })}
              className="pl-7 h-9"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

interface ProfessionalTeamSectionProps {
  team: ProfessionalTeam;
  onChange: (team: ProfessionalTeam) => void;
}

export default function ProfessionalTeamSection({ team, onChange }: ProfessionalTeamSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardHat className="h-5 w-5" />
          Professional Team
        </CardTitle>
        <CardDescription>
          Contact details for architects and engineers
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ProfessionalField
          title="Architect"
          icon={<Building className="h-4 w-4 text-primary" />}
          contact={team.architect}
          onChange={(c) => onChange({ ...team, architect: c })}
          idPrefix="arch"
        />
        <ProfessionalField
          title="Civil Engineer"
          icon={<Ruler className="h-4 w-4 text-accent-foreground" />}
          contact={team.civilEngineer}
          onChange={(c) => onChange({ ...team, civilEngineer: c })}
          idPrefix="civil"
        />
        <ProfessionalField
          title="Structural Engineer"
          icon={<HardHat className="h-4 w-4 text-warning" />}
          contact={team.structuralEngineer}
          onChange={(c) => onChange({ ...team, structuralEngineer: c })}
          idPrefix="struct"
        />
        <ProfessionalField
          title="Electrical Engineer"
          icon={<Zap className="h-4 w-4 text-warning" />}
          contact={team.electricalEngineer}
          onChange={(c) => onChange({ ...team, electricalEngineer: c })}
          idPrefix="elec-eng"
        />
        <ProfessionalField
          title="Wet Services Engineer"
          icon={<Droplets className="h-4 w-4 text-info" />}
          contact={team.wetServicesEngineer}
          onChange={(c) => onChange({ ...team, wetServicesEngineer: c })}
          idPrefix="wet"
        />
      </CardContent>
    </Card>
  );
}
