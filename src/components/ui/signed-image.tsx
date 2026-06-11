import { useEffect, useState } from 'react';
import { resolveStorageUrl } from '@/integrations/supabase/storage';
import { ImageOff } from 'lucide-react';

/**
 * Renders an image stored in Supabase Storage. Resolves the stored URL to a
 * signed URL (for the private tenant-documents bucket) before loading.
 */
export function SignedImage({ src, alt, className }: { src: string; alt?: string; className?: string }) {
  const [resolved, setResolved] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setResolved(null);
    resolveStorageUrl(src)
      .then((url) => { if (active) { if (url) setResolved(url); else setFailed(true); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [src]);

  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-muted text-muted-foreground ${className ?? ''}`}>
        <ImageOff className="h-4 w-4" />
      </div>
    );
  }
  if (!resolved) {
    return <div className={`animate-pulse bg-muted ${className ?? ''}`} />;
  }
  return <img src={resolved} alt={alt ?? ''} className={className} />;
}
