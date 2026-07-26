import { useEffect } from 'react';
import { X } from 'lucide-react';
import './PhotoLightbox.css';

/** Enlarges a member's ORIGINAL photo (photo_url, never the thumbnail) in a full-screen overlay. */
export function PhotoLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="photo-lightbox-backdrop" role="dialog" aria-modal="true" aria-label={alt || 'Photo'} onClick={onClose}>
      <button type="button" className="photo-lightbox-close" onClick={onClose} aria-label="Close">
        <X size={22} strokeWidth={2} />
      </button>
      <img src={src} alt={alt} className="photo-lightbox-image" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
