import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import type { Notification } from '@ipc/contracts';
import { api, relativeTime } from '../api.ts';
import { Icon } from './primitives.tsx';

/**
 * The bell in the header.
 *
 * It polls rather than holding a realtime subscription. A notification arriving
 * thirty seconds late costs nothing, and a websocket per member costs a
 * connection per member — that trade only flips when the club is an order of
 * magnitude bigger, and swapping to Supabase Realtime later changes this file
 * and nothing else.
 */

const POLL_MS = 30_000;

const ICON: Record<string, string> = {
  'post.replied': 'comment',
  'post.liked': 'heart',
  'comment.liked': 'heart',
  'workshop.reminder': 'workshops',
  'workshop.starting': 'workshops',
  'course.published': 'courses',
  'membership.activated': 'check',
  'membership.expiring': 'clock',
  'digest.weekly': 'chart',
  system: 'bell',
};

export function NotificationBell() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const feed = useQuery({
    queryKey: ['notifications'],
    queryFn: api.notifications,
    // Stops when the tab is hidden — nobody needs a background tab polling.
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  });

  const markRead = useMutation({
    mutationFn: (id?: string) => api.markNotificationsRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  // Click outside and Escape both close it. A dropdown that only closes by
  // clicking the same button again is a dropdown people leave open.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const unread = feed.data?.unread ?? 0;

  const openNotification = (n: Notification) => {
    if (!n.read) markRead.mutate(n.id);
    setOpen(false);
    // The link is an in-app path, so it is routed rather than navigated —
    // the same row has to work in a native build with a different origin.
    if (n.link) navigate({ to: n.link });
  };

  return (
    <div style={{ position: 'relative' }} ref={panel}>
      <button
        type="button"
        className="icon-btn"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="bell" />
        {unread > 0 && <span className="dot" />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 340,
            maxHeight: 420,
            overflowY: 'auto',
            background: 'var(--panel)',
            border: '1px solid var(--hair)',
            borderRadius: 'var(--r-card)',
            boxShadow: '0 12px 32px rgba(46,46,56,.12)',
            zIndex: 40,
            padding: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px 6px' }}>
            <span className="section-label" style={{ flex: 1 }}>
              Notifications
            </span>
            {unread > 0 && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 10 }}
                onClick={() => markRead.mutate(undefined)}
              >
                Mark all read
              </button>
            )}
          </div>

          {feed.isLoading && (
            <div style={{ padding: '12px 10px', fontSize: 11 }} className="dim">
              Loading…
            </div>
          )}

          {feed.data?.items.length === 0 && (
            <div style={{ padding: '18px 10px', fontSize: 11, textAlign: 'center' }} className="dim">
              Nothing yet. Replies, likes and new courses land here.
            </div>
          )}

          {feed.data?.items.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => openNotification(n)}
              style={{
                display: 'flex',
                gap: 10,
                width: '100%',
                textAlign: 'left',
                padding: '9px 10px',
                borderRadius: 10,
                border: 0,
                // The unread marker is a background tint, not a dot: it stays
                // legible for someone who cannot see the pink.
                background: n.read ? 'transparent' : 'var(--pink-tint)',
              }}
            >
              <Icon name={ICON[n.kind] ?? 'bell'} size={15} color="var(--ink-2)" />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 11.5, fontWeight: n.read ? 500 : 600 }}>{n.title}</span>
                {n.body && (
                  <span
                    style={{
                      display: 'block',
                      fontSize: 10.5,
                      lineHeight: 1.5,
                      marginTop: 2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    className="muted"
                  >
                    {n.body}
                  </span>
                )}
                <span style={{ display: 'block', fontSize: 9.5, marginTop: 3 }} className="dim">
                  {relativeTime(n.createdAt)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
