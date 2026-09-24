import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api } from '../api.ts';
import { Avatar, Icon } from './primitives.tsx';
import { useToast } from './Toast.tsx';

/**
 * Setting a profile picture — which, until now, no member could do.
 *
 * `users.avatar_url` has existed since the first migration. Exactly one admin
 * query read it and nothing ever wrote it, so every avatar in the application
 * is two letters on a coloured circle. For a club whose members are
 * photographers, "you cannot show your face here" is a strange thing to have
 * shipped.
 *
 * Reuses the media pipeline the feed already uses: the same downscale and
 * re-encode, which crops to a square and strips EXIF on the way through. That
 * last part matters more for an avatar than for anything else — a profile
 * photograph is the image most likely to have been taken at home.
 */

const MAX_BYTES = 10 * 1024 * 1024;
const EDGE = 512;

/** Square, centred, re-encoded. The crop is the only thing added over the feed path. */
async function toSquareJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = EDGE;
  canvas.height = EDGE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }
  // Centre crop. A face is almost always in the middle of a portrait, and
  // asking somebody to position a crop box is a step most will abandon.
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, EDGE, EDGE);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  return blob ?? file;
}

export function AvatarPicker() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const me = useQuery({ queryKey: ['me'], queryFn: api.me });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['me'] });
    // Avatars appear on posts, comments and the directory too.
    queryClient.invalidateQueries({ queryKey: ['posts'] });
    queryClient.invalidateQueries({ queryKey: ['directory'] });
  };

  const upload = async (file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error(new Error('That image is larger than 10MB'));
      return;
    }
    setBusy(true);
    try {
      const blob = await toSquareJpeg(file);
      const ticket = await api.avatarTicket('image/jpeg');
      const put = await fetch(ticket.url, {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg' },
        body: blob,
      });
      if (!put.ok) throw new Error(`Storage refused the upload (${put.status})`);
      await api.setAvatar(ticket.key);
      refresh();
      toast.show('Photo updated');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const clear = useMutation({
    mutationFn: api.clearAvatar,
    onSuccess: () => {
      refresh();
      toast.show('Photo removed — back to your initials');
    },
    onError: toast.error,
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <Avatar initials={me.data?.initials ?? '··'} src={me.data?.avatarUrl} size={64} ring />

      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-soft" disabled={busy} onClick={() => input.current?.click()}>
            <Icon name="image" size={13} />
            {busy ? 'Uploading…' : me.data?.avatarUrl ? 'Change photo' : 'Add a photo'}
          </button>
          {me.data?.avatarUrl && (
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
          Square crop, resized to 512px. Location data is removed before it is uploaded.
        </span>
      </div>
    </div>
  );
}
