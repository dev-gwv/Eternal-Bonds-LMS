import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../shared/api.ts';
import { useSession } from '../shared/session.tsx';
import { signOut } from '../shared/supabase.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { Card, Chip, Icon } from '../shared/ui/primitives.tsx';
import { PublicProfileCard } from '../shared/ui/PublicProfile.tsx';

/**
 * Account settings, including the two things that are legally required and
 * painful to retrofit: a data export (DPDP portability) and an in-app deletion
 * path (Apple 5.1.1(v), DPDP erasure).
 *
 * Deletion is a 30-day soft delete. Authored posts are anonymised by the purge
 * job rather than removed, so community threads do not develop holes.
 */
export function AccountPage() {
  const { demo } = useSession();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');

  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const deletion = useQuery({ queryKey: ['deletion'], queryFn: api.deletionState });

  const schedule = useMutation({
    mutationFn: () => api.scheduleDeletion(reason || undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deletion'] }),
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelDeletion(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deletion'] }),
  });

  const scheduled = deletion.data?.scheduled ?? false;
  const purgeAt = deletion.data?.purgeAt;

  return (
    <Page>
      <PageHeader
        title="Account"
        back="/"
        crumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Account' }]}
        actions={
          !demo && (
            <button type="button" className="btn btn-soft" onClick={() => void signOut()}>
              Sign out
            </button>
          )
        }
      />

      <div className="content">
        <div className="col col-main">
          <Card title="Profile">
            {me.data ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
                <Field label="Name" value={me.data.fullName} />
                <Field label="Member code" value={me.data.memberCode} />
                <Field label="Email" value={me.data.email || '—'} />
                <Field label="Phone" value={me.data.phone || '—'} />
                <Field label="City" value={me.data.city || '—'} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 10 }} className="dim">Membership</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Chip tone="pink">{me.data.tier}</Chip>
                    <Link to="/membership" style={{ fontSize: 11, color: 'var(--pink-ink)' }}>
                      {me.data.tier === 'free' ? 'Upgrade' : 'Manage'}
                    </Link>
                  </span>
                </div>
              </div>
            ) : (
              <span style={{ fontSize: 12 }} className="muted">Loading…</span>
            )}
          </Card>

          {/* The Profile card above is entirely read-only, so until now there
              was nothing on this page a member could actually change about
              themselves — while the endpoint to do it sat with no caller. */}
          <PublicProfileCard />

          <Card
            title="Notifications"
            action={
              <Link to="/notifications" className="btn btn-soft">
                Open
              </Link>
            }
          >
            <span style={{ fontSize: 12, lineHeight: 1.6 }} className="muted">
              Choose what reaches you by email and push, and set the hours when nothing should buzz your phone.
            </span>
          </Card>

          <Card title="Your data">
            <span style={{ fontSize: 12, lineHeight: 1.6 }} className="muted">
              Download everything the club holds about you — profile, posts, progress,
              registrations and activity — as a single JSON file.
            </span>
            <a href={api.exportUrl} download className="btn btn-blue btn-sq" style={{ alignSelf: 'flex-start' }}>
              <Icon name="file" size={14} strokeWidth={1.9} />
              Download my data
            </a>
          </Card>

          <Card title="Delete account">
            {scheduled ? (
              <>
                <div className="callout">
                  Your account is scheduled for deletion
                  {purgeAt ? ` on ${new Date(purgeAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}.
                  You can cancel any time before then — after that it cannot be undone.
                </div>
                <button
                  type="button"
                  className="btn btn-pink"
                  style={{ alignSelf: 'flex-start' }}
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate()}
                >
                  {cancel.isPending ? 'Cancelling…' : 'Keep my account'}
                </button>
              </>
            ) : (
              <>
                <span style={{ fontSize: 12, lineHeight: 1.6 }} className="muted">
                  Deleting removes your profile, progress and registrations after a 30-day grace
                  period. Posts you have written stay in the community with your name removed, so
                  conversations other members rely on do not break.
                </span>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 11 }} className="dim">Why are you leaving? (optional)</span>
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="It helps us fix the real problem"
                    style={input}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 11 }} className="dim">Type DELETE to confirm</span>
                  <input
                    type="text"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="DELETE"
                    style={input}
                  />
                </label>

                <button
                  type="button"
                  className="btn"
                  style={{
                    alignSelf: 'flex-start',
                    background: confirm === 'DELETE' ? 'var(--red)' : 'var(--soft)',
                    color: confirm === 'DELETE' ? '#fff' : 'var(--ink-3)',
                  }}
                  disabled={confirm !== 'DELETE' || schedule.isPending}
                  onClick={() => schedule.mutate()}
                >
                  {schedule.isPending ? 'Scheduling…' : 'Delete my account'}
                </button>

                {schedule.isError && (
                  <span style={{ fontSize: 11, color: 'var(--red)' }}>{schedule.error.message}</span>
                )}
              </>
            )}
          </Card>
        </div>

        <div className="col rail">
          <Card title="Sessions">
            <span style={{ fontSize: 12, lineHeight: 1.6 }} className="muted">
              {demo
                ? 'Running in demo mode — no session to manage until Supabase is connected.'
                : 'Signed in on this device.'}
            </span>
          </Card>
          <div className="promo">
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--yellow-deep)' }}>Need help instead?</span>
            <span style={{ fontSize: 10, lineHeight: 1.5, color: '#7a5a00' }}>
              Most things members want to delete can be fixed by muting a channel or changing
              notification settings.
            </span>
          </div>
        </div>
      </div>
    </Page>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10 }} className="dim">{label}</span>
      <span style={{ fontSize: 13 }}>{value}</span>
    </div>
  );
}

const input: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--ink)',
  background: 'var(--soft)',
  border: '1px solid var(--hair)',
  borderRadius: 'var(--r-ctl)',
  padding: '10px 12px',
  outline: 'none',
  maxWidth: 380,
};
