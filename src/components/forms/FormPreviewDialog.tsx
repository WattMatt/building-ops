import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Download, Printer, FileText, Maximize2, Minimize2 } from 'lucide-react';

interface FormField {
  label: string;
  type: 'text' | 'date' | 'time' | 'signature' | 'checkbox' | 'textarea' | 'select';
  required?: boolean;
  options?: string[];
  width?: 'full' | 'half';
}

interface FormTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: React.ReactNode;
  fields?: FormField[];
}

interface FormPreviewDialogProps {
  form: FormTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const defaultFormFields: Record<string, FormField[]> = {
  '1': [ // Key Access Log
    { label: 'Date', type: 'date', required: true, width: 'half' },
    { label: 'Time', type: 'time', required: true, width: 'half' },
    { label: 'Key ID / Number', type: 'text', required: true, width: 'half' },
    { label: 'Key Description', type: 'text', required: true, width: 'half' },
    { label: 'Issued To (Name)', type: 'text', required: true },
    { label: 'Company / Department', type: 'text', width: 'half' },
    { label: 'Contact Number', type: 'text', width: 'half' },
    { label: 'Purpose of Issue', type: 'textarea', required: true },
    { label: 'Issue Time', type: 'time', required: true, width: 'half' },
    { label: 'Return Time', type: 'time', width: 'half' },
    { label: 'Recipient Signature', type: 'signature', required: true },
    { label: 'Issuing Officer Signature', type: 'signature', required: true },
    { label: 'Notes / Remarks', type: 'textarea' },
  ],
  '2': [ // Roof Access Journal
    { label: 'Date', type: 'date', required: true, width: 'half' },
    { label: 'Permit Number', type: 'text', width: 'half' },
    { label: 'Personnel Name', type: 'text', required: true },
    { label: 'Company', type: 'text', required: true, width: 'half' },
    { label: 'ID Number', type: 'text', width: 'half' },
    { label: 'Time In', type: 'time', required: true, width: 'half' },
    { label: 'Time Out', type: 'time', width: 'half' },
    { label: 'Reason for Access', type: 'textarea', required: true },
    { label: 'Equipment Carried', type: 'textarea' },
    { label: 'Safety Briefing Completed', type: 'checkbox', required: true },
    { label: 'PPE Worn', type: 'checkbox', required: true },
    { label: 'Authorised By', type: 'text', required: true },
    { label: 'Authoriser Signature', type: 'signature', required: true },
    { label: 'Personnel Signature', type: 'signature', required: true },
  ],
  '3': [ // Daily Site Handover Log
    { label: 'Date', type: 'date', required: true, width: 'half' },
    { label: 'Shift', type: 'select', options: ['Day Shift', 'Night Shift'], required: true, width: 'half' },
    { label: 'Outgoing Officer Name', type: 'text', required: true, width: 'half' },
    { label: 'Incoming Officer Name', type: 'text', required: true, width: 'half' },
    { label: 'Handover Time', type: 'time', required: true },
    { label: 'Outstanding Tasks', type: 'textarea', required: true },
    { label: 'Incidents During Shift', type: 'textarea' },
    { label: 'Equipment Status', type: 'textarea' },
    { label: 'Key Items Handed Over', type: 'textarea' },
    { label: 'Special Instructions', type: 'textarea' },
    { label: 'Outgoing Officer Signature', type: 'signature', required: true },
    { label: 'Incoming Officer Signature', type: 'signature', required: true },
  ],
  '4': [ // Asset Inspection Report
    { label: 'Date', type: 'date', required: true, width: 'half' },
    { label: 'Asset ID', type: 'text', required: true, width: 'half' },
    { label: 'Asset Type', type: 'select', options: ['HVAC', 'Lift', 'Escalator', 'Generator', 'Fire System', 'Other'], required: true },
    { label: 'Location', type: 'text', required: true },
    { label: 'Inspector Name', type: 'text', required: true },
    { label: 'Visual Condition', type: 'select', options: ['Good', 'Fair', 'Poor', 'Critical'], required: true, width: 'half' },
    { label: 'Operational Status', type: 'select', options: ['Operational', 'Degraded', 'Non-Operational'], required: true, width: 'half' },
    { label: 'Last Service Date', type: 'date', width: 'half' },
    { label: 'Next Service Due', type: 'date', width: 'half' },
    { label: 'Findings / Observations', type: 'textarea', required: true },
    { label: 'Recommended Actions', type: 'textarea' },
    { label: 'Photos Attached', type: 'checkbox' },
    { label: 'Inspector Signature', type: 'signature', required: true },
  ],
  '5': [ // Cleaning & Hygiene Log
    { label: 'Date', type: 'date', required: true, width: 'half' },
    { label: 'Time', type: 'time', required: true, width: 'half' },
    { label: 'Area / Location', type: 'text', required: true },
    { label: 'Cleaning Type', type: 'select', options: ['Routine', 'Deep Clean', 'Spot Clean', 'Sanitisation'], required: true },
    { label: 'Cleaner Name', type: 'text', required: true },
    { label: 'Floors Mopped', type: 'checkbox' },
    { label: 'Surfaces Wiped', type: 'checkbox' },
    { label: 'Bins Emptied', type: 'checkbox' },
    { label: 'Consumables Restocked', type: 'checkbox' },
    { label: 'Consumables Notes', type: 'textarea' },
    { label: 'Issues Found', type: 'textarea' },
    { label: 'Supervisor Check', type: 'checkbox' },
    { label: 'Cleaner Signature', type: 'signature', required: true },
    { label: 'Supervisor Signature', type: 'signature' },
  ],
  '6': [ // Access Control / Visitor Log
    { label: 'Date', type: 'date', required: true, width: 'half' },
    { label: 'Time In', type: 'time', required: true, width: 'half' },
    { label: 'Visitor Name', type: 'text', required: true },
    { label: 'Company / Organisation', type: 'text', required: true },
    { label: 'ID Type', type: 'select', options: ['ID Card', 'Passport', 'Driver\'s License', 'Other'], required: true, width: 'half' },
    { label: 'ID Number', type: 'text', required: true, width: 'half' },
    { label: 'Host Name', type: 'text', required: true },
    { label: 'Host Department', type: 'text', width: 'half' },
    { label: 'Host Contact', type: 'text', width: 'half' },
    { label: 'Purpose of Visit', type: 'textarea', required: true },
    { label: 'Badge Number Issued', type: 'text', required: true },
    { label: 'Time Out', type: 'time' },
    { label: 'Badge Returned', type: 'checkbox' },
    { label: 'Visitor Signature', type: 'signature', required: true },
    { label: 'Security Officer', type: 'text', required: true },
  ],
  '7': [ // Work Order / Job Card
    { label: 'Work Order Number', type: 'text', required: true, width: 'half' },
    { label: 'Date Raised', type: 'date', required: true, width: 'half' },
    { label: 'Requested By', type: 'text', required: true },
    { label: 'Priority', type: 'select', options: ['Low', 'Medium', 'High', 'Emergency'], required: true },
    { label: 'Location', type: 'text', required: true },
    { label: 'Description of Work', type: 'textarea', required: true },
    { label: 'Assigned Vendor / Technician', type: 'text' },
    { label: 'Estimated Cost', type: 'text', width: 'half' },
    { label: 'Actual Cost', type: 'text', width: 'half' },
    { label: 'Start Date', type: 'date', width: 'half' },
    { label: 'Completion Date', type: 'date', width: 'half' },
    { label: 'Work Performed', type: 'textarea' },
    { label: 'Materials Used', type: 'textarea' },
    { label: 'Completion Evidence Attached', type: 'checkbox' },
    { label: 'Technician Signature', type: 'signature' },
    { label: 'Approved By Signature', type: 'signature' },
  ],
  '8': [ // Incident / Near-miss Report
    { label: 'Date of Incident', type: 'date', required: true, width: 'half' },
    { label: 'Time of Incident', type: 'time', required: true, width: 'half' },
    { label: 'Location', type: 'text', required: true },
    { label: 'Incident Type', type: 'select', options: ['Injury', 'Near Miss', 'Property Damage', 'Environmental', 'Security'], required: true },
    { label: 'Severity', type: 'select', options: ['Minor', 'Moderate', 'Serious', 'Critical'], required: true },
    { label: 'Persons Involved', type: 'textarea', required: true },
    { label: 'Witnesses', type: 'textarea' },
    { label: 'Description of Incident', type: 'textarea', required: true },
    { label: 'Immediate Actions Taken', type: 'textarea', required: true },
    { label: 'Root Cause Analysis', type: 'textarea' },
    { label: 'Corrective Actions Required', type: 'textarea', required: true },
    { label: 'Photos Attached', type: 'checkbox' },
    { label: 'First Aid Administered', type: 'checkbox' },
    { label: 'Emergency Services Called', type: 'checkbox' },
    { label: 'Reporter Name', type: 'text', required: true },
    { label: 'Reporter Signature', type: 'signature', required: true },
    { label: 'Manager Review Signature', type: 'signature' },
  ],
  '9': [ // Evacuation Drill Record
    { label: 'Drill Date', type: 'date', required: true, width: 'half' },
    { label: 'Drill Time', type: 'time', required: true, width: 'half' },
    { label: 'Drill Type', type: 'select', options: ['Fire', 'Earthquake', 'Bomb Threat', 'General Emergency'], required: true },
    { label: 'Building / Zone', type: 'text', required: true },
    { label: 'Total Occupants', type: 'text', required: true, width: 'half' },
    { label: 'Evacuation Time (minutes)', type: 'text', required: true, width: 'half' },
    { label: 'Assembly Point Used', type: 'text', required: true },
    { label: 'All Areas Cleared', type: 'checkbox', required: true },
    { label: 'Roll Call Completed', type: 'checkbox', required: true },
    { label: 'Fire Wardens Present', type: 'textarea' },
    { label: 'Issues Identified', type: 'textarea' },
    { label: 'Lessons Learned', type: 'textarea' },
    { label: 'Recommendations', type: 'textarea' },
    { label: 'Drill Coordinator', type: 'text', required: true },
    { label: 'Coordinator Signature', type: 'signature', required: true },
  ],
  '10': [ // Permit to Work / Hot Work Permit
    { label: 'Permit Number', type: 'text', required: true, width: 'half' },
    { label: 'Date', type: 'date', required: true, width: 'half' },
    { label: 'Work Type', type: 'select', options: ['Hot Work', 'Confined Space', 'Working at Height', 'Electrical', 'Excavation'], required: true },
    { label: 'Location', type: 'text', required: true },
    { label: 'Contractor Name', type: 'text', required: true },
    { label: 'Company', type: 'text', required: true },
    { label: 'Description of Work', type: 'textarea', required: true },
    { label: 'Start Time', type: 'time', required: true, width: 'half' },
    { label: 'End Time', type: 'time', required: true, width: 'half' },
    { label: 'Hazards Identified', type: 'textarea', required: true },
    { label: 'Control Measures', type: 'textarea', required: true },
    { label: 'Fire Extinguisher Available', type: 'checkbox', required: true },
    { label: 'Fire Watch Required', type: 'checkbox' },
    { label: 'Area Isolated', type: 'checkbox' },
    { label: 'PPE Requirements', type: 'textarea', required: true },
    { label: 'Contractor Signature', type: 'signature', required: true },
    { label: 'Authorising Officer', type: 'text', required: true },
    { label: 'Authoriser Signature', type: 'signature', required: true },
    { label: 'Permit Closed', type: 'checkbox' },
    { label: 'Close-out Time', type: 'time' },
    { label: 'Close-out Signature', type: 'signature' },
  ],
  '11': [ // Certificate Register
    { label: 'Certificate Type', type: 'text', required: true },
    { label: 'Certificate Number', type: 'text', required: true },
    { label: 'Asset / Equipment', type: 'text', required: true },
    { label: 'Location', type: 'text', required: true },
    { label: 'Issuing Authority', type: 'text', required: true },
    { label: 'Issue Date', type: 'date', required: true, width: 'half' },
    { label: 'Expiry Date', type: 'date', required: true, width: 'half' },
    { label: 'Renewal Lead Time (days)', type: 'text', width: 'half' },
    { label: 'Responsible Person', type: 'text', required: true },
    { label: 'Renewal Status', type: 'select', options: ['Current', 'Due Soon', 'Expired', 'Renewed'], required: true },
    { label: 'Notes / Actions', type: 'textarea' },
    { label: 'Document Attached', type: 'checkbox' },
  ],
  '12': [ // Pest Control & Waste Log
    { label: 'Date', type: 'date', required: true, width: 'half' },
    { label: 'Type', type: 'select', options: ['Pest Control', 'Waste Disposal', 'Hazardous Waste'], required: true, width: 'half' },
    { label: 'Location / Area', type: 'text', required: true },
    { label: 'Contractor / Company', type: 'text', required: true },
    { label: 'Technician Name', type: 'text', required: true },
    { label: 'Treatment / Service Type', type: 'textarea', required: true },
    { label: 'Chemicals / Materials Used', type: 'textarea' },
    { label: 'Quantity Disposed (if waste)', type: 'text' },
    { label: 'Disposal Method', type: 'text' },
    { label: 'Findings / Observations', type: 'textarea' },
    { label: 'Follow-up Required', type: 'checkbox' },
    { label: 'Next Service Date', type: 'date' },
    { label: 'Technician Signature', type: 'signature', required: true },
    { label: 'FM Officer Signature', type: 'signature' },
  ],
  '13': [ // Parking & Vehicle Incident Log
    { label: 'Date', type: 'date', required: true, width: 'half' },
    { label: 'Time', type: 'time', required: true, width: 'half' },
    { label: 'Incident Type', type: 'select', options: ['Accident', 'Oil Spill', 'Unauthorised Parking', 'Tow Required', 'Vandalism', 'Other'], required: true },
    { label: 'Location / Bay Number', type: 'text', required: true },
    { label: 'Vehicle Registration', type: 'text', required: true },
    { label: 'Vehicle Make / Model', type: 'text' },
    { label: 'Owner / Driver Name', type: 'text' },
    { label: 'Contact Number', type: 'text' },
    { label: 'Description of Incident', type: 'textarea', required: true },
    { label: 'Actions Taken', type: 'textarea', required: true },
    { label: 'Tow Company Called', type: 'checkbox' },
    { label: 'Tow Company Name', type: 'text' },
    { label: 'Photos Attached', type: 'checkbox' },
    { label: 'Police Report Number', type: 'text' },
    { label: 'Reporting Officer', type: 'text', required: true },
    { label: 'Officer Signature', type: 'signature', required: true },
  ],
  '14': [ // Training & PPE Issuance Record
    { label: 'Date', type: 'date', required: true, width: 'half' },
    { label: 'Type', type: 'select', options: ['Training', 'PPE Issuance', 'Both'], required: true, width: 'half' },
    { label: 'Employee Name', type: 'text', required: true },
    { label: 'Employee ID', type: 'text', required: true, width: 'half' },
    { label: 'Department', type: 'text', width: 'half' },
    { label: 'Training Topic', type: 'text' },
    { label: 'Training Duration (hours)', type: 'text' },
    { label: 'Trainer Name', type: 'text' },
    { label: 'PPE Items Issued', type: 'textarea' },
    { label: 'PPE Size / Specifications', type: 'textarea' },
    { label: 'Competency Assessment Passed', type: 'checkbox' },
    { label: 'Refresher Due Date', type: 'date' },
    { label: 'Employee Acknowledgement', type: 'checkbox', required: true },
    { label: 'Employee Signature', type: 'signature', required: true },
    { label: 'Issuing Officer', type: 'text', required: true },
    { label: 'Officer Signature', type: 'signature', required: true },
  ],
};

export function FormPreviewDialog({ form, open, onOpenChange }: FormPreviewDialogProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  if (!form) return null;

  const fields = defaultFormFields[form.id] || [];

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    // Create a simple HTML version for download
    const formHtml = generateFormHtml(form, fields);
    const blob = new Blob([formHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${form.name.replace(/\s+/g, '_')}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const generateFormHtml = (form: FormTemplate, fields: FormField[]) => {
    return `
<!DOCTYPE html>
<html>
<head>
  <title>${form.name}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; }
    .description { text-align: center; color: #666; margin-bottom: 30px; }
    .category { text-align: center; background: #f0f0f0; padding: 4px 12px; display: inline-block; border-radius: 4px; margin-bottom: 20px; }
    .field-group { display: flex; flex-wrap: wrap; gap: 16px; }
    .field { margin-bottom: 16px; }
    .field.full { width: 100%; }
    .field.half { width: calc(50% - 8px); }
    .field label { display: block; font-weight: bold; margin-bottom: 4px; }
    .field label .required { color: red; }
    .field input, .field textarea, .field select { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
    .field textarea { min-height: 80px; }
    .field.signature { border: 1px dashed #ccc; height: 80px; display: flex; align-items: center; justify-content: center; color: #999; }
    .field.checkbox { display: flex; align-items: center; gap: 8px; }
    .field.checkbox input { width: auto; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>${form.name}</h1>
  <p class="description">${form.description}</p>
  <div style="text-align: center;"><span class="category">${form.category}</span></div>
  <div class="field-group">
    ${fields.map(field => {
      const widthClass = field.width === 'half' ? 'half' : 'full';
      const requiredMark = field.required ? '<span class="required">*</span>' : '';
      
      if (field.type === 'signature') {
        return `<div class="field ${widthClass}"><label>${field.label} ${requiredMark}</label><div class="field signature">Sign here</div></div>`;
      }
      if (field.type === 'checkbox') {
        return `<div class="field ${widthClass} checkbox"><input type="checkbox" /><label>${field.label} ${requiredMark}</label></div>`;
      }
      if (field.type === 'textarea') {
        return `<div class="field ${widthClass}"><label>${field.label} ${requiredMark}</label><textarea></textarea></div>`;
      }
      if (field.type === 'select') {
        return `<div class="field ${widthClass}"><label>${field.label} ${requiredMark}</label><select><option value="">Select...</option>${(field.options || []).map(opt => `<option value="${opt}">${opt}</option>`).join('')}</select></div>`;
      }
      return `<div class="field ${widthClass}"><label>${field.label} ${requiredMark}</label><input type="${field.type}" /></div>`;
    }).join('')}
  </div>
</body>
</html>`;
  };

  const renderField = (field: FormField, index: number) => {
    const baseClasses = "space-y-1";
    const widthClass = field.width === 'half' ? 'w-full md:w-[calc(50%-0.5rem)]' : 'w-full';

    return (
      <div key={index} className={`${baseClasses} ${widthClass}`}>
        <label className="text-sm font-medium flex items-center gap-1">
          {field.label}
          {field.required && <span className="text-destructive">*</span>}
        </label>
        {field.type === 'signature' ? (
          <div className="h-20 border-2 border-dashed border-muted-foreground/30 rounded-md flex items-center justify-center text-muted-foreground text-sm">
            Sign here
          </div>
        ) : field.type === 'checkbox' ? (
          <div className="flex items-center gap-2 h-10">
            <div className="h-5 w-5 border-2 border-muted-foreground/50 rounded" />
          </div>
        ) : field.type === 'textarea' ? (
          <div className="h-20 border border-input rounded-md bg-background" />
        ) : field.type === 'select' ? (
          <div className="h-10 border border-input rounded-md bg-background px-3 flex items-center text-muted-foreground text-sm">
            Select {field.label.toLowerCase()}...
          </div>
        ) : (
          <div className="h-10 border border-input rounded-md bg-background" />
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${isFullscreen ? 'max-w-[95vw] h-[95vh]' : 'max-w-4xl max-h-[90vh]'} flex flex-col`}>
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                {form.icon}
              </div>
              <div>
                <DialogTitle className="text-xl">{form.name}</DialogTitle>
                <p className="text-sm text-muted-foreground">{form.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setIsFullscreen(!isFullscreen)}>
                {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </Button>
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
              <Button size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
            </div>
          </div>
        </DialogHeader>
        
        <Separator className="my-4" />
        
        <div className="flex-1 overflow-auto">
          {/* Form Preview */}
          <div className="bg-white dark:bg-card border rounded-lg p-6 shadow-sm print:shadow-none print:border-none">
            {/* Form Header */}
            <div className="text-center mb-6 print:mb-4">
              <h2 className="text-2xl font-bold text-foreground mb-2">{form.name}</h2>
              <p className="text-muted-foreground mb-3">{form.description}</p>
              <Badge variant="secondary">{form.category}</Badge>
            </div>
            
            <Separator className="my-6" />
            
            {/* Form Fields */}
            <div className="flex flex-wrap gap-4">
              {fields.map((field, index) => renderField(field, index))}
            </div>
            
            {fields.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Form template fields will be displayed here</p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
