import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  FileSpreadsheet,
  Download,
  Printer,
  Key,
  HardHat,
  ClipboardList,
  Shield,
  Wrench,
  Truck,
  Users,
  AlertTriangle,
  Flame,
  Eye,
} from 'lucide-react';
import { FormPreviewDialog } from '@/components/forms/FormPreviewDialog';

interface FormTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: React.ReactNode;
}

const formTemplates: FormTemplate[] = [
  {
    id: '1',
    name: 'Key Access / Key Issuance Log',
    description: 'Track keys issued/returned, key ID, purpose',
    category: 'Security',
    icon: <Key className="h-5 w-5" />,
  },
  {
    id: '2',
    name: 'Roof Access Journal',
    description: 'Record personnel, time in/out, work reason, permit',
    category: 'Maintenance',
    icon: <HardHat className="h-5 w-5" />,
  },
  {
    id: '3',
    name: 'Daily Site Handover Log',
    description: 'Shift notes, outstanding tasks, incidents',
    category: 'Operations',
    icon: <ClipboardList className="h-5 w-5" />,
  },
  {
    id: '4',
    name: 'Asset Inspection Report',
    description: 'Condition checks for HVAC, lifts, escalators',
    category: 'Maintenance',
    icon: <Wrench className="h-5 w-5" />,
  },
  {
    id: '5',
    name: 'Cleaning & Hygiene Log',
    description: 'Restroom checks, consumables restocked, deep-clean notes',
    category: 'Cleaning',
    icon: <ClipboardList className="h-5 w-5" />,
  },
  {
    id: '6',
    name: 'Access Control / Visitor Log',
    description: 'Visitor name, company, host, ID, badge issued',
    category: 'Security',
    icon: <Users className="h-5 w-5" />,
  },
  {
    id: '7',
    name: 'Work Order / Job Card',
    description: 'Request, scope, cost, vendor, completion evidence',
    category: 'Operations',
    icon: <FileSpreadsheet className="h-5 w-5" />,
  },
  {
    id: '8',
    name: 'Incident / Near-miss Report',
    description: 'Safety incidents, photos, corrective actions',
    category: 'Safety',
    icon: <AlertTriangle className="h-5 w-5" />,
  },
  {
    id: '9',
    name: 'Evacuation Drill Record',
    description: 'Drill date, attendance, timing, lessons learned',
    category: 'Safety',
    icon: <Shield className="h-5 w-5" />,
  },
  {
    id: '10',
    name: 'Permit to Work / Hot Work Permit',
    description: 'Authorisation for hazardous tasks, controls',
    category: 'Safety',
    icon: <Flame className="h-5 w-5" />,
  },
  {
    id: '11',
    name: 'Certificate Register',
    description: 'Statutory certificates, issuer, expiry, renewal actions',
    category: 'Compliance',
    icon: <FileSpreadsheet className="h-5 w-5" />,
  },
  {
    id: '12',
    name: 'Pest Control & Waste Log',
    description: 'Treatments, locations, hazardous waste disposals',
    category: 'Operations',
    icon: <ClipboardList className="h-5 w-5" />,
  },
  {
    id: '13',
    name: 'Parking & Vehicle Incident Log',
    description: 'Accidents, oil spills, tow actions',
    category: 'Security',
    icon: <Truck className="h-5 w-5" />,
  },
  {
    id: '14',
    name: 'Training & PPE Issuance Record',
    description: 'Attendance, issued PPE, refresher dates',
    category: 'HR/Safety',
    icon: <HardHat className="h-5 w-5" />,
  },
];

const categoryColors: Record<string, string> = {
  Security: 'bg-primary text-primary-foreground',
  Maintenance: 'bg-accent text-accent-foreground',
  Operations: 'bg-info text-info-foreground',
  Cleaning: 'bg-success text-success-foreground',
  Safety: 'bg-warning text-warning-foreground',
  Compliance: 'bg-destructive/80 text-destructive-foreground',
  'HR/Safety': 'bg-muted text-muted-foreground',
};

export default function FormsLibrary() {
  const [selectedForm, setSelectedForm] = useState<FormTemplate | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const handlePreview = (form: FormTemplate) => {
    setSelectedForm(form);
    setPreviewOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Forms Library</h1>
          <p className="text-muted-foreground">
            Standard FM forms for printing and digital completion
          </p>
        </div>
      </div>

      {/* Forms Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {formTemplates.map((form) => (
          <Card key={form.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    {form.icon}
                  </div>
                  <div>
                    <CardTitle className="text-base leading-tight">
                      {form.name}
                    </CardTitle>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                {form.description}
              </p>
              <div className="flex items-center justify-between">
                <Badge variant="secondary" className={categoryColors[form.category]}>
                  {form.category}
                </Badge>
                <div className="flex items-center gap-1">
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => handlePreview(form)}
                    title="Preview form"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" title="Print form">
                    <Printer className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" title="Download form">
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Form Preview Dialog */}
      <FormPreviewDialog
        form={selectedForm}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
    </div>
  );
}
