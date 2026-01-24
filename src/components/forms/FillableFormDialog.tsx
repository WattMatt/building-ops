import { useState, useEffect, useRef } from 'react';
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
import { Loader2, Send, Building2, ClipboardCheck, Camera, X, ImagePlus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { FormField } from '@/lib/formFields';

interface FormTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: React.ReactNode;
  fields?: FormField[];
}

interface PhotoUpload {
  file: File;
  preview: string;
}

interface FillableFormDialogProps {
  form: FormTemplate | null;
  fields: FormField[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitSuccess?: () => void;
  preselectedBuildingId?: string;
  preselectedBuildingName?: string;
}

export function FillableFormDialog({
  form,
  fields,
  open,
  onOpenChange,
  onSubmitSuccess,
  preselectedBuildingId,
  preselectedBuildingName,
}: FillableFormDialogProps) {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [selectedBuilding, setSelectedBuilding] = useState<string>('');
  const [signatureConfirmed, setSignatureConfirmed] = useState<Record<string, boolean>>({});
  const [photoUploads, setPhotoUploads] = useState<Record<string, PhotoUpload[]>>({});
  const [uploadingPhotos, setUploadingPhotos] = useState<Record<string, boolean>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

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
  // Reset form when dialog opens, pre-select building if provided
  useEffect(() => {
    if (open) {
      setFormData({});
      setSelectedBuilding(preselectedBuildingId || '');
      setSignatureConfirmed({});
      setPhotoUploads({});
      setUploadingPhotos({});
    }
  }, [open, preselectedBuildingId]);

  // Cleanup previews on unmount
  useEffect(() => {
    return () => {
      Object.values(photoUploads).flat().forEach(p => URL.revokeObjectURL(p.preview));
    };
  }, [photoUploads]);

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

  const handlePhotoAdd = (fieldLabel: string, files: FileList | null, maxPhotos: number = 5) => {
    if (!files || files.length === 0) return;
    
    const currentPhotos = photoUploads[fieldLabel] || [];
    const remainingSlots = maxPhotos - currentPhotos.length;
    
    if (remainingSlots <= 0) {
      toast.error(`Maximum ${maxPhotos} photos allowed for ${fieldLabel}`);
      return;
    }

    const newPhotos: PhotoUpload[] = [];
    const filesToAdd = Array.from(files).slice(0, remainingSlots);
    
    for (const file of filesToAdd) {
      if (!file.type.startsWith('image/')) {
        toast.error(`${file.name} is not an image file`);
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} is too large (max 10MB)`);
        continue;
      }
      newPhotos.push({
        file,
        preview: URL.createObjectURL(file),
      });
    }

    if (newPhotos.length > 0) {
      setPhotoUploads(prev => ({
        ...prev,
        [fieldLabel]: [...currentPhotos, ...newPhotos],
      }));
    }
  };

  const handlePhotoRemove = (fieldLabel: string, index: number) => {
    setPhotoUploads(prev => {
      const photos = prev[fieldLabel] || [];
      URL.revokeObjectURL(photos[index]?.preview);
      return {
        ...prev,
        [fieldLabel]: photos.filter((_, i) => i !== index),
      };
    });
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
        } else if (field.type === 'photo') {
          const photos = photoUploads[field.label] || [];
          if (photos.length === 0) {
            toast.error(`Please add at least one photo for: ${field.label}`);
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

  const uploadPhotosToStorage = async (): Promise<string[]> => {
    const allUrls: string[] = [];
    
    for (const [fieldLabel, photos] of Object.entries(photoUploads)) {
      for (const photo of photos) {
        const fileName = `form-submissions/${user?.id}/${Date.now()}-${photo.file.name}`;
        const { error: uploadError } = await supabase.storage
          .from('tenant-documents')
          .upload(fileName, photo.file);

        if (uploadError) {
          console.error('Photo upload error:', uploadError);
          continue;
        }

        const { data: urlData } = supabase.storage
          .from('tenant-documents')
          .getPublicUrl(fileName);

        if (urlData) {
          allUrls.push(urlData.publicUrl);
          // Also store in form data for reference
          handleFieldChange(fieldLabel, [...(formData[fieldLabel] || []), urlData.publicUrl]);
        }
      }
    }
    
    return allUrls;
  };

  const handleSubmit = async () => {
    if (!user) {
      toast.error('You must be logged in to submit forms');
      return;
    }

    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      // Upload photos first
      const photoUrls = await uploadPhotosToStorage();

      // Prepare form data with photo URLs
      const finalFormData = { ...formData };
      for (const [fieldLabel, photos] of Object.entries(photoUploads)) {
        if (photos.length > 0) {
          finalFormData[fieldLabel] = photoUrls.filter((_, i) => {
            // Map URLs back to their fields based on upload order
            let count = 0;
            for (const [label, labelPhotos] of Object.entries(photoUploads)) {
              if (label === fieldLabel) {
                return i >= count && i < count + labelPhotos.length;
              }
              count += labelPhotos.length;
            }
            return false;
          });
        }
      }

      const { error } = await supabase.from('form_submissions').insert({
        form_template_id: form.id,
        form_name: form.name,
        building_id: selectedBuilding || null,
        submitted_by: user.id,
        form_data: finalFormData,
        photo_urls: photoUrls,
        status: 'submitted',
      });

      if (error) throw error;

      // Send email notification to managers (fire and forget)
      if (selectedBuilding) {
        const buildingName = preselectedBuildingName || 
          buildings?.find(b => b.id === selectedBuilding)?.name || 
          'Unknown Building';
        
        supabase.functions.invoke('notify-form-submission', {
          body: {
            formName: form.name,
            buildingId: selectedBuilding,
            buildingName,
            submittedBy: user.email || 'Unknown User',
            submittedAt: new Date().toISOString(),
          }
        }).then(({ error: notifyError }) => {
          if (notifyError) {
            console.error('Failed to send notification:', notifyError);
          } else {
            console.log('Manager notification sent');
          }
        });
      }

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

        {field.type === 'photo' && (
          <div className="space-y-3">
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              ref={(el) => (fileInputRefs.current[field.label] = el)}
              onChange={(e) => handlePhotoAdd(field.label, e.target.files, field.maxPhotos || 5)}
            />
            
            {/* Photo grid */}
            {(photoUploads[field.label]?.length || 0) > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {photoUploads[field.label]?.map((photo, photoIndex) => (
                  <div key={photoIndex} className="relative group aspect-square">
                    <img
                      src={photo.preview}
                      alt={`Photo ${photoIndex + 1}`}
                      className="w-full h-full object-cover rounded-lg border"
                    />
                    <button
                      type="button"
                      onClick={() => handlePhotoRemove(field.label, photoIndex)}
                      className="absolute -top-2 -right-2 h-6 w-6 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            {/* Upload button */}
            {(photoUploads[field.label]?.length || 0) < (field.maxPhotos || 5) && (
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRefs.current[field.label]?.click()}
                className="w-full h-24 border-2 border-dashed flex flex-col items-center justify-center gap-2 hover:border-primary hover:bg-primary/5"
              >
                <ImagePlus className="h-6 w-6 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Add photos ({photoUploads[field.label]?.length || 0}/{field.maxPhotos || 5})
                </span>
              </Button>
            )}
            
            <p className="text-xs text-muted-foreground">
              Max {field.maxPhotos || 5} photos, 10MB each. Supported: JPG, PNG, WebP
            </p>
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
                {preselectedBuildingId ? 'Building' : 'Associated Building (Optional)'}
              </Label>
              {preselectedBuildingId ? (
                <div className="h-10 px-3 border rounded-md bg-muted flex items-center">
                  <span className="text-sm font-medium">{preselectedBuildingName || 'Selected Building'}</span>
                </div>
              ) : (
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
              )}
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
