/**
 * Dialog for quick building avatar/logo updates from BuildingDetails page
 */

import { useState, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, Upload, Palette, ImageIcon } from 'lucide-react';
import { BuildingAvatarPicker } from '@/components/avatar/BuildingAvatarPicker';
import { BuildingAvatar } from './BuildingAvatar';
import { ImageCropper } from '@/components/avatar/ImageCropper';

interface BuildingAvatarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buildingId: string;
  buildingName: string;
  currentLogoUrl: string | null;
  currentAvatarColor: string | null;
  onSuccess: () => void;
}

export function BuildingAvatarDialog({
  open,
  onOpenChange,
  buildingId,
  buildingName,
  currentLogoUrl,
  currentAvatarColor,
  onSuccess,
}: BuildingAvatarDialogProps) {
  const [logoUrl, setLogoUrl] = useState<string | null>(currentLogoUrl);
  const [avatarColor, setAvatarColor] = useState<string | null>(currentAvatarColor);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cropperOpen, setCropperOpen] = useState(false);
  const [cropImage, setCropImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be less than 5MB');
      return;
    }

    // Read file for cropper
    const reader = new FileReader();
    reader.onload = (event) => {
      setCropImage(event.target?.result as string);
      setCropperOpen(true);
    };
    reader.readAsDataURL(file);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleCropComplete = async (croppedBlob: Blob) => {
    setUploading(true);
    try {
      const fileName = `${buildingId}-${Date.now()}.jpg`;
      const filePath = `${buildingId}/${fileName}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('building-logos')
        .upload(filePath, croppedBlob, {
          contentType: 'image/jpeg',
          upsert: true,
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('building-logos')
        .getPublicUrl(filePath);

      setLogoUrl(publicUrl);
      toast.success('Logo uploaded successfully');
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Failed to upload logo');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('buildings')
        .update({
          logo_url: logoUrl,
          avatar_color: avatarColor,
        })
        .eq('id', buildingId);

      if (error) throw error;

      toast.success('Avatar updated successfully');
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('Save error:', error);
      toast.error('Failed to update avatar');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveLogo = () => {
    setLogoUrl(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Change Building Avatar</DialogTitle>
            <DialogDescription>
              Upload a logo or choose a pattern for {buildingName}
            </DialogDescription>
          </DialogHeader>

          {/* Current Preview */}
          <div className="flex justify-center py-4">
            <BuildingAvatar
              name={buildingName}
              logoUrl={logoUrl}
              avatarColor={avatarColor}
              size="lg"
              className="w-20 h-20"
            />
          </div>

          <Tabs defaultValue="upload" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="upload" className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4" />
                Upload
              </TabsTrigger>
              <TabsTrigger value="pattern" className="flex items-center gap-2">
                <Palette className="h-4 w-4" />
                Pattern
              </TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="mt-4 space-y-4">
              <div className="flex flex-col items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-full"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Choose Image
                    </>
                  )}
                </Button>
                {logoUrl && !logoUrl.includes('dicebear') && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRemoveLogo}
                    className="text-destructive hover:text-destructive"
                  >
                    Remove current logo
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Recommended: Square image, at least 200x200px
              </p>
            </TabsContent>

            <TabsContent value="pattern" className="mt-4">
              <BuildingAvatarPicker
                selectedUrl={logoUrl?.includes('dicebear') ? logoUrl : null}
                selectedColor={avatarColor}
                onSelect={(url) => setLogoUrl(url)}
                onColorChange={setAvatarColor}
                buildingName={buildingName}
                disabled={saving}
              />
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image Cropper */}
      {cropImage && (
        <ImageCropper
          open={cropperOpen}
          onOpenChange={setCropperOpen}
          imageSrc={cropImage}
          onCropComplete={handleCropComplete}
          aspectRatio={1}
          circularCrop={false}
        />
      )}
    </>
  );
}
