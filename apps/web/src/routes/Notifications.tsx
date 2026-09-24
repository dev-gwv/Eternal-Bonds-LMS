import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { NotificationPrefs } from '@ipc/contracts';
import { api, relativeTime } from '../shared/api.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { Card, Chip, Icon } from '../shared/ui/primitives.tsx';
import { splitLink } from '../shared/links.ts';

/**
 * The full notification history, and the switches that control it.
 *
 * The bell shows the last thirty; this is where somebody goes to find the
 * thing they dismissed, and to turn off whatever is annoying them. Those two
 * jobs belong on the same page — a preferences screen somewhere else is a
 * preferences screen nobody finds while irritated.
 */

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

const SWITCHES: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  { key: 'inApp', label: 'In the app', hint: 'The bell in the header. Turning this off is unusual.' },
  { key: 'emailDigest', label: 'Weekly digest email', hint: 'One email a week: what you learned and earned.' },
  { key: 'emailActivity', label: 'Activity emails', hint: 'Replies to your posts, and new courses on your tier.' },
  { key: 'push', label: 'Push notifications', hint: 'Needs a device to have registered. Quiet hours always apply.' },
];

export function NotificationsPage() {
  const queryClient = useQueryClient();

  const feed = useQuery({ queryKey: ['notifications'], queryFn: api.notifications });
  const prefs = useQuery({ queryKey: ['prefs'], queryFn: api.prefs });

  const markRead = useMutation({
    mutationFn: (id?: string) => api.markNotificationsRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const save = useMutation({
    mutationFn: (patch: Partial<NotificationPrefs>) => api.updatePrefs(patch),
    onSuccess: (next) => queryClient.setQueryData(['prefs'], next),
  });

  return (
    <Page>
      <PageHeader
        title="Notifications"
        back="/"
        crumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Notifications' }]}
        actions={
          (feed.data?.unread ?? 0) > 0 ? (
            <button type="button" className="btn btn-soft" onClick={() => markRead.mutate(undefined)}>
              Mark all read
            </button>
          ) : undefined
        }
      />

      <div className="content">
        <div className="col col-main">
          {feed.isLoading && <span style={{ fontSize: 12 }} className="muted">Loading…</span>}
          {feed.error && <div className="alert">{(feed.error as Error).message}</div>}

          {feed.data?.items.length === 0 && (
            <div className="empty">
              Nothing yet. Replies to your posts, new courses on your tier and workshop reminders land here.
            </div>
          )}

          <Card style={{ gap: 0, padding: 0 }}>
            {feed.data?.items.map((n, i) => {
              const row = (
                <>
                  <Icon name={ICON[n.kind] ?? 'bell'} size={16} color="var(--ink-2)" />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12, fontWeight: n.read ? 500 : 600 }}>{n.title}</span>
                    {n.body && (
                      <span style={{ display: 'block', fontSize: 11, lineHeight: 1.55, marginTop: 2 }} className="muted">
                        {n.body}
                      </span>
                    )}
                  </span>
                  {!n.read && <Chip tone="pink">New</Chip>}
                  <span style={{ fontSize: 10 }} className="dim">
                    {relativeTime(n.createdAt)}
                  </span>
                </>
              );

              const style = {
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 16px',
                borderTop: i === 0 ? 0 : '1px solid var(--rule)',
                background: n.read ? 'transparent' : 'var(--pink-tint)',
                color: 'inherit',
              } as const;

              // A notification with nowhere to go is not a link. Rendering one
              // anyway gives a pointer cursor that lies about what a click does.
              return n.link ? (
                <Link
                  key={n.id}
                  {...splitLink(n.link)}
                  style={style}
                  onClick={() => !n.read && markRead.mutate(n.id)}
                >
                  {row}
                </Link>
              ) : (
                <div key={n.id} style={style}>
                  {row}
                </div>
              );
            })}
          </Card>
        </div>

        <div className="col rail">
          {/* The switches moved to Settings. Two places to change the same
              preference is how one of them ends up stale — and the version a
              member remembers is whichever they saw last. */}
          <Card title="Too much, or not enough?">
            <span style={{ fontSize: 11.5, lineHeight: 1.6 }} className="muted">
              Choose what reaches you by email and push, and set the hours when nothing should buzz
              your phone.
            </span>
            <Link to="/settings/notifications" className="btn btn-soft" style={{ alignSelf: 'flex-start' }}>
              Notification settings
            </Link>
          </Card>
        </div>
      </div>
    </Page>
  );
}
