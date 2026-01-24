import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Phone, Mail } from 'lucide-react';
import { ReactNode } from 'react';

export interface ContactInfo {
  name: string;
  phone: string;
  email: string;
}

interface ContactSectionProps {
  title: string;
  description: string;
  icon: ReactNode;
  contact: ContactInfo;
  onChange: (contact: ContactInfo) => void;
  idPrefix: string;
  namePlaceholder?: string;
}

export default function ContactSection({
  title,
  description,
  icon,
  contact,
  onChange,
  idPrefix,
  namePlaceholder = 'Contact name',
}: ContactSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-name`}>Name</Label>
          <Input
            id={`${idPrefix}-name`}
            placeholder={namePlaceholder}
            value={contact.name}
            onChange={(e) => onChange({ ...contact, name: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-phone`}>Phone</Label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id={`${idPrefix}-phone`}
                type="tel"
                placeholder="+27 XX XXX XXXX"
                value={contact.phone}
                onChange={(e) => onChange({ ...contact, phone: e.target.value })}
                className="pl-9"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-email`}>Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id={`${idPrefix}-email`}
                type="email"
                placeholder="email@example.com"
                value={contact.email}
                onChange={(e) => onChange({ ...contact, email: e.target.value })}
                className="pl-9"
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
