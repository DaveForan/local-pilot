import { useEffect, useState } from 'react';

/** Full-screen image viewer. Click backdrop or hit Escape to dismiss. */
export function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} />
      <button className="lightbox-close" aria-label="Close image" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}

/** A clickable thumbnail that opens itself in a lightbox. */
export function LightboxImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`lightbox-thumb ${className ?? ''}`}
        onClick={() => setOpen(true)}
        aria-label="Open image"
      >
        <img src={src} alt={alt ?? ''} />
      </button>
      {open && <ImageLightbox src={src} onClose={() => setOpen(false)} />}
    </>
  );
}
