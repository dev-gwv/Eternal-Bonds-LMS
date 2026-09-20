/**
 * Image pipeline.
 *
 * Avatars and win proof need resize, format conversion and EXIF stripping —
 * phone screenshots leak location and device. The API validates and signs;
 * the worker does the heavy transform with `sharp` when installed, and this
 * module degrades to pass-through when it is not.
 *
 * Constraints enforced at the boundary: allowlist of mimes, 10MB cap, and
 * EXIF is never served — `stripExif` runs before any public URL is minted.
 */

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 10 * 1024 * 1024;

export function assertImage(mime: string, sizeBytes: number): void {
  if (!ALLOWED.has(mime)) throw new Error(`Unsupported image type: ${mime}`);
  if (sizeBytes > MAX_BYTES) throw new Error('Image is larger than 10MB');
}

/** Variants the worker materialises per upload. The API serves these, never the original. */
export const VARIANTS = [
  { name: 'thumb', width: 256 },
  { name: 'medium', width: 1024 },
] as const;

export function variantKey(storageKey: string, variant: string): string {
  const dot = storageKey.lastIndexOf('.');
  return dot < 0 ? `${storageKey}.${variant}` : `${storageKey.slice(0, dot)}.${variant}${storageKey.slice(dot)}`;
}
