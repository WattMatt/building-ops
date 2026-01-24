import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/hooks/useOrganization';
import { toast } from 'sonner';
import { Loader2, Send, Building2, ClipboardCheck } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

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

interface FillableFormDialogProps {
  form: FormTemplate | null;
  fields: FormField[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitSuccess?: () => void;
}

export function FillableFormDialog({
  form,
  fields,
  open,
  onOpenChange,
  onSubmitSuccess,
}: FillableFormDialogProps) {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [selectedBuilding, setSelectedBuilding] = useState<string>('');
  const [signatureConfirmed, setSignatureConfirmed] = useState<Record<string, boolean>>({});

  // Fetch buildings for selection
  const { data: buildings } = useQuery({
    queryKey: ['buildings-for-forms'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('buildings')
        .select('id, name')
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setFormData({});
      setSelectedBuilding('');
      setSignatureConfirmed({});
    }
  }, [open]);

  if (!form) return null;

  const handleFieldChange = (fieldLabel: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [fieldLabel]: value,
    }));
  };

  const handleSignatureConfirm = (fieldLabel: string, confirmed: boolean) => {
    setSignatureConfirmed((prev) => ({
      ...prev,
      [fieldLabel]: confirmed,
    }));
    if (confirmed) {
      handleFieldChange(fieldLabel, `Signed by ${user?.email} at ${new Date().toISOString()}`);
    } else {
      handleFieldChange(fieldLabel, '');
    }
  };

  const validateForm = (): boolean => {
    for (const field of fields) {
      if (field.required) {
        const value = formData[field.label];
        if (field.type === 'checkbox') {
          if (!value) {
            toast.error(`Please check: ${field.label}`);
            return false;
          }
        } else if (field.type === 'signature') {
          if (!signatureConfirmed[field.label]) {
            toast.error(`Please confirm signature for: ${field.label}`);
            return false;
          }
        } else {
          if (!value || (typeof value === 'string' && !value.trim())) {
            toast.error(`Please fill in: ${field.label}`);
            return false;
          }
        }
      }
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!user) {
      toast.error('You must be logged in to submit forms');
      return;
    }

    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('form_submissions').insert({
        form_template_id: form.id,
        form_name: form.name,
        building_id: selectedBuilding || null,
        submitted_by: user.id,
        form_data: formData,
        status: 'submitted',
      });

      if (error) throw error;

      toast.success('Form submitted successfully');
      onOpenChange(false);
      onSubmitSuccess?.();
    } catch (error: any) {
      console.error('Error submitting form:', error);
      toast.error(error.message || 'Failed to submit form');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderField = (field: FormField, index: number) => {
    const widthClass = field.width === 'half' ? 'w-full md:w-[calc(50%-0.5rem)]' : 'w-full';
    const value = formData[field.label] || '';

    return (
      <div key={index} className={`space-y-2 ${widthClass}`}>
        <Label className="flex items-center gap-1">
          {field.label}
          {field.required && <span className="text-destructive">*</span>}
        </Label>

        {field.type === 'text' && (
          <Input
            value={value}
            onChange={(e) => handleFieldChange(field.label, e.target.value)}
            placeholder={`Enter ${field.label.toLowerCase()}`}
            maxLength={500}
          />
        )}

        {field.type === 'date' && (
          <Input
            type="date"
            value={value}
            onChange={(e) => handleFieldChange(field.label, e.target.value)}
          />
        )}

        {field.type === 'time' && (
          <Input
            type="time"
            value={value}
            onChange={(e) => handleFieldChange(field.label, e.target.value)}
          />
        )}

        {field.type === 'textarea' && (
          <Textarea
            value={value}
            onChange={(e) => handleFieldChange(field.label, e.target.value)}
            placeholder={`Enter ${field.label.toLowerCase()}`}
            rows={3}
            maxLength={2000}
          />
        )}

        {field.type === 'select' && (
          <Select
            value={value}
            onValueChange={(val) => handleFieldChange(field.label, val)}
          >
            <SelectTrigger>
              <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {field.type === 'checkbox' && (
          <div className="flex items-center gap-2 pt-1">
            <Checkbox
              id={`field-${index}`}
              checked={!!value}
              onCheckedChange={(checked) => handleFieldChange(field.label, checked)}
            />
            <Label htmlFor={`field-${index}`} className="font-normal cursor-pointer">
              Confirm
            </Label>
          </div>
        )}

        {field.type === 'signature' && (
          <div className="space-y-2">
            <div
              className={`h-20 border-2 border-dashed rounded-md flex items-center justify-center transition-colors ${
                signatureConfirmed[field.label]
                  ? 'border-success bg-success/10 text-success'
                  : 'border-muted-foreground/30 text-muted-foreground'
              }`}
            >
              {signatureConfirmed[field.label] ? (
                <span className="text-sm font-medium">✓ Signed by {user?.email}</span>
              ) : (
                <span className="text-sm">Click below to sign</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id={`sig-${index}`}
                checked={signatureConfirmed[field.label] || false}
                onCheckedChange={(checked) =>
                  handleSignatureConfirm(field.label, checked as boolean)
                }
              />
              <Label htmlFor={`sig-${index}`} className="text-sm font-normal cursor-pointer">
                I confirm this is my digital signature
              </Label>
            </div>
          </div>
        )}
      </div>
    );
  };

  const orgName = organization?.name || 'FM Comply';
  const logoUrl = organization?.logo_url;
  const primaryColor = organization?.primary_color || '#2563eb';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col overflow-hidden">
        {/* Corporate Branding Header */}
        <div className="flex-shrink-0 pb-3 border-b-4" style={{ borderColor: primaryColor }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {logoUrl ? (
                <img src={logoUrl} alt={orgName} className="h-10 w-10 rounded-lg object-contain" />
              ) : (
                <div 
                  className="h-10 w-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: primaryColor }}
                >
                  <ClipboardCheck className="h-5 w-5 text-white" />
                </div>
              )}
              <div>
                <span className="font-semibold text-sm" style={{ color: primaryColor }}>
                  {orgName}
                </span>
                <p className="text-xs text-muted-foreground">Digital Form Submission</p>
              </div>
            </div>
            <Badge variant="outline" className="text-xs">
              {form.category}
            </Badge>
          </div>
        </div>

        <DialogHeader className="flex-shrink-0 pt-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              {form.icon}
            </div>
            <div>
              <DialogTitle className="text-xl">{form.name}</DialogTitle>
              <p className="text-sm text-muted-foreground">{form.description}</p>
            </div>
          </div>
        </DialogHeader>

        <Separator className="my-4 flex-shrink-0" />

        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-6 pr-4 pb-4">
            {/* Building Selection */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Associated Building (Optional)
              </Label>
              <Select value={selectedBuilding} onValueChange={setSelectedBuilding}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a building (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {buildings?.map((building) => (
                    <SelectItem key={building.id} value={building.id}>
                      {building.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Form Fields */}
            <div className="flex flex-wrap gap-4">
              {fields.map((field, index) => renderField(field, index))}
            </div>

            {fields.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <p>No form fields available</p>
              </div>
            )}
          </div>
        </ScrollArea>

        <Separator className="my-4 flex-shrink-0" />

        <DialogFooter className="flex-shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Submit Form
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
