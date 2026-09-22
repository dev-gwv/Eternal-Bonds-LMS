import { useCallback, useEffect, useRef, useState } from 'react';
import { ACCEPT_ATTR, MAX_PER_POST, type Pending, rejectReason } from '../media.ts';
import { Icon } from './primitives.tsx';

/**
 * Choose photographs, see them, drop the wrong one.
 *
 * The picker holds files locally and uploads nothing: the target post or win
 * does not exist until it is submitted, and a ticket needs its id. So the
 * caller creates the row, then hands this list to `uploadAll`.
 *
 * Drag-and-drop is on the whole box rather than a small target, because on a
 * desktop that is how photographers actually move files, and paste is wired
 * too — a screenshot goes straight from clipboard into a post.
 */

let counter = 0;
const nextKey = () => `pick-${++counter}`;

export function usePicker() {
  const [items, setItems] = useState<Pending[]>([]);

  // Object URLs are a real leak if the component unmounts mid-compose, which
  // it does every time somebody navigates away from a half-written post.
  useEffect(
    () => () => {
      for (const i of items) URL.revokeObjectURL(i.preview);
    },
    // Intentionally on unmount only: revoking on every change would kill the
    // preview of images still on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const add = useCallback((files: FileList | File[]) => {
    setItems((current) => {
      const room = MAX_PER_POST - current.length;
      if (room <= 0) return current;
      const next: Pending[] = [];
      for (const file of Array.from(files).slice(0, room)) {
        const reason = rejectReason(file);
        next.push({
          key: nextKey(),
          file,
          preview: URL.createObjectURL(file),
          status: reason ? 'failed' : 'queued',
          progress: 0,
          error: reason ?? undefined,
        });
      }
      return [...current, ...next];
    });
  }, []);

  const remove = useCallback((key: string) => {
    setItems((current) => {
      const hit = current.find((i) => i.key === key);
      if (hit) URL.revokeObjectURL(hit.preview);
      return current.filter((i) => i.key !== key);
    });
  }, []);

  const patch = useCallback((key: string, next: Partial<Pending>) => {
    setItems((current) => current.map((i) => (i.key === key ? { ...i, ...next } : i)));
  }, []);

  const reset = useCallback(() => {
    setItems((current) => {
      for (const i of current) URL.revokeObjectURL(i.preview);
      return [];
    });
  }, []);

  /** Anything worth sending: rejected files are shown but never uploaded. */
  const uploadable = items.filter((i) => i.status !== 'failed' || !rejectReason(i.file));

  return { items, add, remove, patch, reset, uploadable };
}

export function PickerButton({
  onPick,
  disabled,
  count,
}: {
  onPick: (files: FileList) => void;
  disabled?: boolean;
  count: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const full = count >= MAX_PER_POST;
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onPick(e.target.files);
          // Reset so picking the same file twice in a row still fires.
          e.target.value = '';
        }}
      />
      <button
        type="button"
        className="btn btn-soft"
        disabled={disabled || full}
        title={full ? `Up to ${MAX_PER_POST} photos` : 'Add photos'}
        onClick={() => input.current?.click()}
      >
        <Icon name="image" size={14} />
        {count > 0 ? `${count} photo${count === 1 ? '' : 's'}` : 'Add photos'}
      </button>
    </>
  );
}

export function PickerStrip({
  items,
  onRemove,
  onRetry,
}: {
  items: Pending[];
  onRemove: (key: string) => void;
  onRetry?: () => void;
}) {
  if (items.length === 0) return null;
  const failed = items.some((i) => i.status === 'failed');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {items.map((i) => (
          <div
            key={i.key}
            style={{
              position: 'relative',
              width: 78,
              height: 78,
              borderRadius: 10,
              overflow: 'hidden',
              background: 'var(--soft)',
              border: i.status === 'failed' ? '1px solid var(--red)' : '1px solid var(--rule)',
            }}
          >
            <img
              src={i.preview}
              alt=""
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                opacity: i.status === 'uploading' ? 0.45 : 1,
              }}
            />

            {i.status === 'uploading' && (
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  bottom: 0,
                  height: 3,
                  width: `${Math.round(i.progress * 100)}%`,
                  background: 'var(--pink)',
                  transition: 'width 120ms linear',
                }}
              />
            )}

            {i.status === 'done' && (
              <span
                style={{
                  position: 'absolute',
                  right: 4,
                  bottom: 4,
                  background: 'var(--green)',
                  borderRadius: 999,
                  padding: 2,
                  display: 'flex',
                }}
              >
                <Icon name="check" size={10} color="#fff" strokeWidth={3} />
              </span>
            )}

            {i.status !== 'uploading' && (
              <button
                type="button"
                aria-label={`Remove ${i.file.name}`}
                onClick={() => onRemove(i.key)}
                style={{
                  position: 'absolute',
                  top: 3,
                  right: 3,
                  border: 0,
                  cursor: 'pointer',
                  borderRadius: 999,
                  width: 18,
                  height: 18,
                  display: 'grid',
                  placeItems: 'center',
                  background: 'rgba(0,0,0,0.6)',
                  color: '#fff',
                  fontSize: 11,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {failed && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5 }} className="field-error">
          {items.find((i) => i.status === 'failed')?.error ?? 'Some photos did not upload'}
          {onRetry && (
            <button type="button" className="btn btn-ghost" style={{ fontSize: 10.5 }} onClick={onRetry}>
              Try again
            </button>
          )}
        </span>
      )}
    </div>
  );
}
