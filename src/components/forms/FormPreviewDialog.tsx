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
import { Download, Printer, FileText, Maximize2, Minimize2, FileDown, Loader2, Camera } from 'lucide-react';
import { defaultFormFields, FormField } from '@/lib/formFields';
import { generateFormPdf } from '@/lib/pdfGenerator';
import { useOrganization } from '@/hooks/useOrganization';
import { toast } from 'sonner';

interface FormTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: React.ReactNode;
}

interface FormPreviewDialogProps {
  form: FormTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FormPreviewDialog({ form, open, onOpenChange }: FormPreviewDialogProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const { organization } = useOrganization();

  if (!form) return null;

  const fields = defaultFormFields[form.id] || [];

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPdf = async () => {
    setIsGeneratingPdf(true);
    try {
      await generateFormPdf(
        { id: form.id, name: form.name, description: form.description, category: form.category },
        fields,
        {
          name: organization?.name || 'Building Ops',
          logoUrl: organization?.logo_url,
          primaryColor: organization?.primary_color || '#2563eb',
          address: organization?.address,
          phone: organization?.phone,
          email: organization?.email,
        }
      );
      toast.success('PDF downloaded successfully');
    } catch (error) {
      console.error('PDF generation error:', error);
      toast.error('Failed to generate PDF');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleDownloadHtml = () => {
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
    const primaryColor = organization?.primary_color || '#2563eb';
    const orgName = organization?.name || 'Building Ops';
    
    return `
<!DOCTYPE html>
<html>
<head>
  <title>${form.name}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    .header { border-bottom: 3px solid ${primaryColor}; padding-bottom: 15px; margin-bottom: 20px; }
    .org-name { color: ${primaryColor}; font-size: 14px; font-weight: bold; }
    h1 { text-align: center; color: ${primaryColor}; margin: 20px 0 10px; }
    .description { text-align: center; color: #666; margin-bottom: 30px; }
    .category { text-align: center; background: ${primaryColor}; color: white; padding: 4px 12px; display: inline-block; border-radius: 4px; margin-bottom: 20px; }
    .field-group { display: flex; flex-wrap: wrap; gap: 16px; }
    .field { margin-bottom: 16px; }
    .field.full { width: 100%; }
    .field.half { width: calc(50% - 8px); }
    .field label { display: block; font-weight: bold; margin-bottom: 4px; font-size: 12px; color: #374151; }
    .field label .required { color: red; }
    .field input, .field textarea, .field select { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
    .field textarea { min-height: 80px; }
    .field.signature { border: 1px dashed #ccc; height: 80px; display: flex; align-items: center; justify-content: center; color: #999; }
    .field.checkbox { display: flex; align-items: center; gap: 8px; }
    .field.checkbox input { width: auto; }
    .footer { margin-top: 40px; padding-top: 15px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #9ca3af; display: flex; justify-content: space-between; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <div class="header">
    <span class="org-name">${orgName}</span>
  </div>
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
      if (field.type === 'photo') {
        return `<div class="field ${widthClass}"><label>${field.label} ${requiredMark}</label><div class="field signature" style="height: 100px;">Photo upload (max ${field.maxPhotos || 5})</div></div>`;
      }
      return `<div class="field ${widthClass}"><label>${field.label} ${requiredMark}</label><input type="${field.type}" /></div>`;
    }).join('')}
  </div>
  <div class="footer">
    <span>${orgName} - ${form.name}</span>
    <span>${new Date().toLocaleDateString()}</span>
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
        ) : field.type === 'photo' ? (
          <div className="h-24 border-2 border-dashed border-muted-foreground/30 rounded-md flex flex-col items-center justify-center text-muted-foreground text-sm gap-2">
            <Camera className="h-6 w-6 opacity-50" />
            <span>Photo upload (max {field.maxPhotos || 5})</span>
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
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                {form.icon}
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-xl truncate">{form.name}</DialogTitle>
                <p className="text-sm text-muted-foreground truncate">{form.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button variant="outline" size="sm" onClick={() => setIsFullscreen(!isFullscreen)}>
                {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </Button>
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownloadHtml}>
                <FileDown className="h-4 w-4 mr-2" />
                HTML
              </Button>
              <Button size="sm" onClick={handleDownloadPdf} disabled={isGeneratingPdf}>
                {isGeneratingPdf ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                PDF
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
