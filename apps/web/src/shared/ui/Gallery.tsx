import { useEffect, useState } from 'react';
import type { MediaItem } from '@ipc/contracts';

/**
 * How attached photographs are shown, everywhere.
 *
 * Two decisions worth stating:
 *
 * **A single photograph is not cropped.** This is a photographers' club; a
 * square thumbnail of somebody's 3:2 landscape throws away the composition
 * they came to show. One image renders whole, capped by height. Two or more
 * fall into a grid, where a consistent shape beats a ragged one — but the
 * lightbox always shows the full frame.
 *
 * **The lightbox is a plain overlay, not a dependency.** Escape closes, arrows
 * move, the backdrop closes. That is the entire feature, and it is smaller
 * than any library that offers it.
 */

export function Gallery({ media }: { media: MediaItem[] }) {
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
      if (e.key === 'ArrowRight') setOpen((i) => (i === null ? null : (i + 1) % media.length));
      if (e.key === 'ArrowLeft') setOpen((i) => (i === null ? null : (i - 1 + media.length) % media.length));
    };
    document.addEventListener('keydown', onKey);
    // Stop the feed scrolling underneath the lightbox.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, media.length]);

  if (media.length === 0) return null;

  const single = media.length === 1;

  return (
    <>
      <div
        style={
          single
            ? { display: 'block' }
            : {
                display: 'grid',
                gridTemplateColumns: media.length === 2 ? '1fr 1fr' : 'repeat(3, 1fr)',
                gap: 4,
              }
        }
      >
        {media.map((m, i) => (
          <button
            key={m.id}
            type="button"
            aria-label={`Open photo ${i + 1} of ${media.length}`}
            onClick={() => setOpen(i)}
            style={{
              padding: 0,
              border: 0,
              background: 'var(--soft)',
              cursor: 'zoom-in',
              borderRadius: single ? 12 : 8,
              overflow: 'hidden',
              display: 'block',
              width: '100%',
              // A grid cell is square; a lone photo keeps its own shape.
              aspectRatio: single ? undefined : '1 / 1',
              maxHeight: single ? 520 : undefined,
            }}
          >
            <img
              src={m.url}
              alt=""
              loading="lazy"
              decoding="async"
              width={m.width ?? undefined}
              height={m.height ?? undefined}
              style={{
                display: 'block',
                width: '100%',
                height: single ? 'auto' : '100%',
                maxHeight: single ? 520 : undefined,
                objectFit: single ? 'contain' : 'cover',
              }}
            />
          </button>
        ))}
      </div>

      {open !== null && media[open] && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo"
          onClick={() => setOpen(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            background: 'rgba(0,0,0,0.88)',
            display: 'grid',
            placeItems: 'center',
            padding: 24,
            cursor: 'zoom-out',
          }}
        >
          <img
            src={media[open]!.url}
            alt=""
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', cursor: 'default' }}
          />
          {media.length > 1 && (
            <span
              style={{
                position: 'fixed',
                bottom: 20,
                color: 'rgba(255,255,255,0.8)',
                fontSize: 11,
                letterSpacing: '0.04em',
              }}
            >
              {open + 1} / {media.length} · arrow keys to move, Esc to close
            </span>
          )}
        </div>
      )}
    </>
  );
}
