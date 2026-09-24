import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, type CoverKind } from '../api.ts';
import { Icon } from './primitives.tsx';
import { useToast } from './Toast.tsx';

/**
 * One cover picker, for everything that has a cover.
 *
 * Courses had this first, written inline in the course builder. Adding covers
 * to workshops, journeys, insights and library items meant either four more
 * copies of the downscale-upload-record dance, or one component — and the
 * downscale is exactly the sort of detail that drifts between copies until
 * one page is uploading 8MB originals.
 *
 * The downscale is not only about bandwidth: re-encoding through a canvas
 * strips EXIF, and EXIF on a photographer's image carries the GPS coordinates
 * of wherever it was taken. Nobody asked to publish their home address with a
 * course cover.
 */

const EDGE = 1600;

/** Downscale, re-encode, and lose the metadata on the way through. */
async function toJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const width = Math.min(EDGE, bitmap.width);
  const height = Math.round((width / bitmap.width) * bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
  return blob ?? file;
}

export function CoverPicker({
  kind,
  id,
  coverUrl,
  label = 'Cover image',
  hint = '16:9, resized to 1600px. Shown on the card and the page.',
  invalidate,
  aspect = '16 / 9',
}: {
  kind: CoverKind;
  id: string;
  coverUrl: string | null;
  label?: string;
  hint?: string;
  /** The query keys whose data contains this cover. */
  invalidate: unknown[][];
  aspect?: string;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Shown immediately after an upload, so the card does not sit empty while a
  // refetch and a fresh signature come back.
  const [preview, setPreview] = useState<string | null>(null);

  const refresh = () => {
    for (const key of invalidate) queryClient.invalidateQueries({ queryKey: key });
  };

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const blob = await toJpeg(file);
      const ticket = await api.coverTicket(kind, id, 'image/jpeg');
      const put = await fetch(ticket.url, {
        method: ticket.method,
        headers: { 'content-type': 'image/jpeg' },
        body: blob,
      });
      if (!put.ok) throw new Error(`Storage refused the upload (${put.status})`);
      await api.setCover(kind, id, ticket.key);
      setPreview(URL.createObjectURL(blob));
      refresh();
      toast.show('Cover updated');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const clear = useMutation({
    mutationFn: () => api.clearCover(kind, id),
    onSuccess: () => {
      setPreview(null);
      refresh();
      toast.show('Cover removed');
    },
    onError: toast.error,
  });

  const shown = preview ?? coverUrl;

  return (
    <div className="field">
      <span>{label}</span>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <span
          style={{
            width: 168,
            aspectRatio: aspect,
            borderRadius: 'var(--r-ctl)',
            overflow: 'hidden',
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            background: shown ? 'var(--soft)' : 'var(--grad-brand)',
            border: '1px solid var(--hair)',
          }}
        >
          {shown ? (
            <img src={shown} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ fontSize: 10, color: '#fff', opacity: 0.9 }}>No cover</span>
          )}
        </span>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-soft" disabled={busy} onClick={() => input.current?.click()}>
              <Icon name="image" size={13} />
              {busy ? 'Uploading…' : shown ? 'Replace' : 'Upload cover'}
            </button>
            {shown && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ color: 'var(--red)' }}
                disabled={clear.isPending}
                onClick={() => clear.mutate()}
              >
                Remove
              </button>
            )}
          </span>
          <span style={{ fontSize: 10.5, lineHeight: 1.5 }} className="dim">
            {hint} Location data is removed before it is uploaded.
          </span>
        </div>
      </div>
    </div>
  );
}
