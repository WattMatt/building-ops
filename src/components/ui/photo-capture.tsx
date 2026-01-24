import { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, Upload, X, ImagePlus, Loader2, Smartphone, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export interface PhotoFile {
  file: File;
  preview: string;
}

interface PhotoCaptureProps {
  /** Maximum number of photos allowed */
  maxPhotos?: number;
  /** Maximum file size in MB (after compression) */
  maxSizeMB?: number;
  /** Current photos */
  photos: PhotoFile[];
  /** Callback when photos change */
  onPhotosChange: (photos: PhotoFile[]) => void;
  /** Whether the component is disabled */
  disabled?: boolean;
  /** Size variant for the capture buttons */
  size?: 'sm' | 'md' | 'lg';
  /** Whether to show the photo count */
  showCount?: boolean;
  /** Custom class name */
  className?: string;
  /** Label for the photo field */
  label?: string;
  /** Whether photos are required */
  required?: boolean;
  /** Accepted image types */
  acceptedTypes?: string[];
  /** Enable image compression (default: true) */
  enableCompression?: boolean;
  /** Target max dimension for compression (default: 1920) */
  maxDimension?: number;
  /** JPEG quality for compression (0-1, default: 0.8) */
  compressionQuality?: number;
}

/**
 * A cross-device photo capture component that handles:
 * - Camera capture on mobile devices (opens native camera)
 * - File upload from gallery on all devices
 * - Direct camera access option on desktop
 * - Image compression and validation
 */
export function PhotoCapture({
  maxPhotos = 5,
  maxSizeMB = 10,
  photos,
  onPhotosChange,
  disabled = false,
  size = 'md',
  showCount = true,
  className,
  label,
  required = false,
  acceptedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  enableCompression = true,
  maxDimension = 1920,
  compressionQuality = 0.8,
}: PhotoCaptureProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      const userAgent = navigator.userAgent || navigator.vendor;
      const isMobileDevice = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
        userAgent.toLowerCase()
      );
      // Also check for touch capability as a secondary indicator
      const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      setIsMobile(isMobileDevice || (hasTouchScreen && window.innerWidth < 768));
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const remainingSlots = maxPhotos - photos.length;
  const canAddMore = remainingSlots > 0 && !disabled;

  /**
   * Compress an image using Canvas API
   */
  const compressImage = useCallback(async (file: File): Promise<File> => {
    // Skip compression for small files (< 500KB) or if disabled
    if (!enableCompression || file.size < 500 * 1024) {
      return file;
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      img.onload = () => {
        try {
          let { width, height } = img;

          // Calculate new dimensions while maintaining aspect ratio
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          canvas.width = width;
          canvas.height = height;

          if (!ctx) {
            resolve(file); // Fallback to original if context unavailable
            return;
          }

          // Draw image with white background (for transparent PNGs)
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          // Convert to blob
          canvas.toBlob(
            (blob) => {
              if (blob && blob.size < file.size) {
                // Only use compressed version if it's smaller
                const compressedFile = new File([blob], file.name, {
                  type: 'image/jpeg',
                  lastModified: Date.now(),
                });
                console.log(
                  `Compressed ${file.name}: ${(file.size / 1024).toFixed(0)}KB → ${(compressedFile.size / 1024).toFixed(0)}KB`
                );
                resolve(compressedFile);
              } else {
                // Original is smaller, use it
                resolve(file);
              }
            },
            'image/jpeg',
            compressionQuality
          );
        } catch (error) {
          console.error('Compression error:', error);
          resolve(file); // Fallback to original on error
        }
      };

      img.onerror = () => {
        console.error('Failed to load image for compression');
        resolve(file); // Fallback to original on error
      };

      // Load image from file
      img.src = URL.createObjectURL(file);
    });
  }, [enableCompression, maxDimension, compressionQuality]);

  const validateAndProcessFile = useCallback(async (file: File): Promise<PhotoFile | null> => {
    // Validate file type
    const isValidType = acceptedTypes.some(type => {
      if (type.includes('*')) {
        return file.type.startsWith(type.replace('*', ''));
      }
      return file.type === type || file.type.startsWith('image/');
    });

    if (!isValidType) {
      toast.error(`${file.name} is not a supported image format`);
      return null;
    }

    // Compress the image first
    const processedFile = await compressImage(file);

    // Validate file size after compression
    const maxBytes = maxSizeMB * 1024 * 1024;
    if (processedFile.size > maxBytes) {
      toast.error(`${file.name} exceeds ${maxSizeMB}MB limit even after compression`);
      return null;
    }

    // Create preview URL
    const preview = URL.createObjectURL(processedFile);

    return { file: processedFile, preview };
  }, [acceptedTypes, maxSizeMB, compressImage]);

  const handleFilesSelected = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0 || !canAddMore) return;

    setIsProcessing(true);
    
    try {
      const filesToProcess = Array.from(files).slice(0, remainingSlots);
      const processedPhotos: PhotoFile[] = [];

      for (const file of filesToProcess) {
        const processed = await validateAndProcessFile(file);
        if (processed) {
          processedPhotos.push(processed);
        }
      }

      if (processedPhotos.length > 0) {
        onPhotosChange([...photos, ...processedPhotos]);
        
        if (processedPhotos.length < filesToProcess.length) {
          toast.warning(`${processedPhotos.length} of ${filesToProcess.length} photos added`);
        }
      }
    } catch (error) {
      console.error('Error processing files:', error);
      toast.error('Failed to process some images');
    } finally {
      setIsProcessing(false);
      // Reset inputs
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (galleryInputRef.current) galleryInputRef.current.value = '';
    }
  }, [canAddMore, remainingSlots, photos, onPhotosChange, validateAndProcessFile]);

  const handleRemovePhoto = useCallback((index: number) => {
    const photoToRemove = photos[index];
    if (photoToRemove?.preview) {
      URL.revokeObjectURL(photoToRemove.preview);
    }
    onPhotosChange(photos.filter((_, i) => i !== index));
  }, [photos, onPhotosChange]);

  const openCamera = () => {
    if (cameraInputRef.current) {
      cameraInputRef.current.click();
    }
  };

  const openGallery = () => {
    if (galleryInputRef.current) {
      galleryInputRef.current.click();
    }
  };

  const sizeClasses = {
    sm: {
      preview: 'h-14 w-14',
      button: 'h-14 w-14',
      icon: 'h-4 w-4',
      text: 'text-[10px]',
    },
    md: {
      preview: 'h-20 w-20',
      button: 'h-20 w-20',
      icon: 'h-5 w-5',
      text: 'text-xs',
    },
    lg: {
      preview: 'h-24 w-24',
      button: 'h-24 w-24',
      icon: 'h-6 w-6',
      text: 'text-sm',
    },
  };

  const sizes = sizeClasses[size];

  return (
    <div className={cn('space-y-2', className)}>
      {label && (
        <label className="flex items-center gap-2 text-sm font-medium">
          <Camera className="h-4 w-4" />
          {label}
          {required && <span className="text-destructive">*</span>}
          {showCount && (
            <span className="text-muted-foreground font-normal">
              ({photos.length}/{maxPhotos})
            </span>
          )}
        </label>
      )}

      <div className="flex flex-wrap gap-2">
        {/* Photo previews */}
        {photos.map((photo, index) => (
          <div key={index} className={cn('relative group', sizes.preview)}>
            <img
              src={photo.preview}
              alt={`Photo ${index + 1}`}
              className="h-full w-full object-cover rounded-lg border"
            />
            {!disabled && (
              <button
                type="button"
                onClick={() => handleRemovePhoto(index)}
                className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                aria-label={`Remove photo ${index + 1}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}

        {/* Add photo buttons */}
        {canAddMore && !isProcessing && (
          <>
            {/* Camera capture button - prominent on mobile */}
            <button
              type="button"
              onClick={openCamera}
              disabled={disabled}
              className={cn(
                sizes.button,
                'border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-1',
                'text-muted-foreground hover:border-primary hover:text-primary',
                'transition-colors cursor-pointer',
                'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
                disabled && 'opacity-50 cursor-not-allowed'
              )}
              aria-label="Take photo with camera"
            >
              <Camera className={sizes.icon} />
              <span className={sizes.text}>
                {isMobile ? 'Camera' : 'Take'}
              </span>
            </button>

            {/* Gallery/file upload button */}
            <button
              type="button"
              onClick={openGallery}
              disabled={disabled}
              className={cn(
                sizes.button,
                'border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-1',
                'text-muted-foreground hover:border-primary hover:text-primary',
                'transition-colors cursor-pointer',
                'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
                disabled && 'opacity-50 cursor-not-allowed'
              )}
              aria-label="Upload from gallery"
            >
              <ImagePlus className={sizes.icon} />
              <span className={sizes.text}>
                {isMobile ? 'Gallery' : 'Upload'}
              </span>
            </button>
          </>
        )}

        {/* Loading state */}
        {isProcessing && (
          <div className={cn(
            sizes.button,
            'border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-1',
            'text-muted-foreground'
          )}>
            <Loader2 className={cn(sizes.icon, 'animate-spin')} />
            <span className={sizes.text}>Processing</span>
          </div>
        )}
      </div>

      {/* Hidden file inputs */}
      {/* Camera input - uses capture attribute for direct camera access */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => handleFilesSelected(e.target.files)}
        className="hidden"
        aria-hidden="true"
      />

      {/* Gallery input - allows multiple file selection */}
      <input
        ref={galleryInputRef}
        type="file"
        accept={acceptedTypes.join(',')}
        multiple={remainingSlots > 1}
        onChange={(e) => handleFilesSelected(e.target.files)}
        className="hidden"
        aria-hidden="true"
      />

      {/* Helper text */}
      {canAddMore && !isProcessing && (
        <p className="text-xs text-muted-foreground">
          {isMobile ? (
            <>Tap <strong>Camera</strong> to take a photo or <strong>Gallery</strong> to choose existing</>
          ) : (
            <>Add up to {remainingSlots} more photo{remainingSlots !== 1 ? 's' : ''} (max {maxSizeMB}MB each)</>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Simplified single photo capture for avatars/logos
 */
interface SinglePhotoCaptureProps {
  /** Current image URL or preview */
  currentImage?: string | null;
  /** Placeholder content when no image */
  placeholder?: React.ReactNode;
  /** Callback when a new photo is selected */
  onPhotoSelect: (file: File) => void;
  /** Whether upload is in progress */
  isUploading?: boolean;
  /** Whether the component is disabled */
  disabled?: boolean;
  /** Size of the capture area */
  size?: 'sm' | 'md' | 'lg';
  /** Shape of the image */
  shape?: 'circle' | 'square' | 'rounded';
  /** Accepted image types */
  acceptedTypes?: string[];
  /** Maximum file size in MB */
  maxSizeMB?: number;
  /** Custom class name */
  className?: string;
  /** Enable image compression (default: true) */
  enableCompression?: boolean;
  /** Target max dimension for compression (default: 512 for avatars) */
  maxDimension?: number;
  /** JPEG quality for compression (0-1, default: 0.85) */
  compressionQuality?: number;
}

export function SinglePhotoCapture({
  currentImage,
  placeholder,
  onPhotoSelect,
  isUploading = false,
  disabled = false,
  size = 'md',
  shape = 'circle',
  acceptedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  maxSizeMB = 2,
  className,
  enableCompression = true,
  maxDimension = 512,
  compressionQuality = 0.85,
}: SinglePhotoCaptureProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      const userAgent = navigator.userAgent || navigator.vendor;
      const isMobileDevice = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
        userAgent.toLowerCase()
      );
      setIsMobile(isMobileDevice || window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const compressImage = useCallback(async (file: File): Promise<File> => {
    // Skip compression for small files or if disabled
    if (!enableCompression || file.size < 100 * 1024) {
      return file;
    }

    return new Promise((resolve) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      img.onload = () => {
        try {
          let { width, height } = img;

          // Calculate new dimensions while maintaining aspect ratio
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          canvas.width = width;
          canvas.height = height;

          if (!ctx) {
            resolve(file);
            return;
          }

          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob(
            (blob) => {
              if (blob && blob.size < file.size) {
                const compressedFile = new File([blob], file.name, {
                  type: 'image/jpeg',
                  lastModified: Date.now(),
                });
                console.log(
                  `Compressed avatar: ${(file.size / 1024).toFixed(0)}KB → ${(compressedFile.size / 1024).toFixed(0)}KB`
                );
                resolve(compressedFile);
              } else {
                resolve(file);
              }
            },
            'image/jpeg',
            compressionQuality
          );
        } catch {
          resolve(file);
        }
      };

      img.onerror = () => resolve(file);
      img.src = URL.createObjectURL(file);
    });
  }, [enableCompression, maxDimension, compressionQuality]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate type
    if (!acceptedTypes.some(type => file.type === type || file.type.startsWith('image/'))) {
      toast.error('Please select a valid image file');
      return;
    }

    setIsCompressing(true);
    
    try {
      // Compress the image
      const processedFile = await compressImage(file);

      // Validate size after compression
      if (processedFile.size > maxSizeMB * 1024 * 1024) {
        toast.error(`File size must be less than ${maxSizeMB}MB`);
        return;
      }

      onPhotoSelect(processedFile);
    } finally {
      setIsCompressing(false);
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const sizeClasses = {
    sm: 'h-16 w-16',
    md: 'h-24 w-24',
    lg: 'h-32 w-32',
  };

  const shapeClasses = {
    circle: 'rounded-full',
    square: 'rounded-none',
    rounded: 'rounded-lg',
  };

  const buttonSizeClasses = {
    sm: 'h-6 w-6',
    md: 'h-8 w-8',
    lg: 'h-10 w-10',
  };

  return (
    <div className={cn('relative inline-block', className)}>
      <div
        className={cn(
          sizeClasses[size],
          shapeClasses[shape],
          'bg-muted overflow-hidden flex items-center justify-center',
          'border-2 border-muted'
        )}
      >
        {currentImage ? (
          <img
            src={currentImage}
            alt="Current photo"
            className="h-full w-full object-cover"
          />
        ) : (
          placeholder || <Camera className="h-8 w-8 text-muted-foreground" />
        )}
      </div>

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || isUploading || isCompressing}
        className={cn(
          buttonSizeClasses[size],
          'absolute -bottom-1 -right-1',
          'bg-primary text-primary-foreground rounded-full',
          'flex items-center justify-center',
          'hover:bg-primary/90 transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
          'shadow-md',
          (disabled || isUploading || isCompressing) && 'opacity-50 cursor-not-allowed'
        )}
        aria-label="Change photo"
      >
        {isUploading || isCompressing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Camera className="h-4 w-4" />
        )}
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept={acceptedTypes.join(',')}
        capture={isMobile ? 'environment' : undefined}
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
      />
    </div>
  );
}
