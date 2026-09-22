import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { NotificationPrefs } from '@ipc/contracts';
import { api } from '../shared/api.ts';
import { useSession } from '../shared/session.tsx';
import { signOut } from '../shared/supabase.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { Card, Chip, Icon } from '../shared/ui/primitives.tsx';
import { PublicProfileCard } from '../shared/ui/PublicProfile.tsx';
import { useToast } from '../shared/ui/Toast.tsx';

/**
 * One place for everything about you.
 *
 * Settings were spread across three destinations reached separately from the
 * user menu — /account held the data export and deletion, /notifications held
 * the preferences, /membership held the plan — so a member looking for "stop
 * emailing me" had to guess which of three pages owned it. Guessing between
 * three top-level destinations is the failure; which page they guessed is not
 * the point.
 *
 * **The notification *inbox* deliberately did not move.** /notifications was
 * doing two jobs: a feed of things that happened, and the switches that decide
 * what arrives. The feed is content, not configuration — it belongs behind the
 * bell, where somebody goes to read, not behind a gear, where somebody goes to
 * change something. Only the switches came here.
 *
 * Tabs are real routes rather than local state, so each is linkable, the back
 * button works, and "your notification settings are at /settings/notifications"
 * is a sentence support can actually say.
 */

type Tab = { to: string; label: string; icon: string; exact?: boolean };

const TABS: Tab[] = [
  // Profile is `/settings` itself, so it needs an exact match or it would
  // light up on every other tab as well.
  { to: '/settings', label: 'Profile', icon: 'people', exact: true },
  { to: '/settings/notifications', label: 'Notifications', icon: 'bell' },
  { to: '/settings/membership', label: 'Membership', icon: 'courses' },
  { to: '/settings/privacy', label: 'Privacy & data', icon: 'settings' },
];

function SettingsShell({ children }: { children: React.ReactNode }) {
  const { demo } = useSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Page>
      <PageHeader
        title="Settings"
        back="/"
        crumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Settings' }]}
        actions={
          !demo && (
            <button type="button" className="btn btn-soft" onClick={() => void signOut()}>
              Sign out
            </button>
          )
        }
      />

      {/* Horizontal on a phone and scrollable, rather than a sidebar that
          would eat a third of the screen before any setting is visible. */}
      <nav className="settings-tabs" aria-label="Settings sections">
        {TABS.map((t) => {
          const active = t.exact ? pathname === t.to : pathname.startsWith(t.to);
          return (
            <Link
              key={t.to}
              to={t.to}
              aria-current={active ? 'page' : undefined}
              className={active ? 'settings-tab is-on' : 'settings-tab'}
            >
              <Icon name={t.icon} size={14} strokeWidth={active ? 2 : 1.7} />
              {t.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </Page>
  );
}

/* ── Profile ────────────────────────────────────────────────────────────── */

export function SettingsProfilePage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });

  const [fullName, setFullName] = useState('');
  const [city, setCity] = useState('');

  useEffect(() => {
    if (!me.data) return;
    setFullName(me.data.fullName);
    setCity(me.data.city ?? '');
  }, [me.data]);

  const save = useMutation({
    mutationFn: () => api.updateProfile({ fullName: fullName.trim(), city: city.trim() || null }),
    onSuccess: () => {
      toast.show('Saved');
      queryClient.invalidateQueries({ queryKey: ['me'] });
      queryClient.invalidateQueries({ queryKey: ['onboarding'] });
    },
    onError: toast.error,
  });

  const dirty =
    me.data !== undefined &&
    (fullName.trim() !== me.data.fullName || (city.trim() || null) !== (me.data.city ?? null));

  return (
    <SettingsShell>
      <div className="content">
        <div className="col col-main">
          <Card title="Your details">
            <div className="field-row">
              <label className="field">
                <span>Name</span>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </label>
              <label className="field">
                <span>City</span>
                <input value={city} placeholder="Jaipur" onChange={(e) => setCity(e.target.value)} />
              </label>
            </div>
            <button
              type="button"
              className="btn btn-pink"
              style={{ alignSelf: 'flex-start' }}
              disabled={!dirty || fullName.trim().length < 2 || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </Card>

          <PublicProfileCard />
        </div>

        <div className="col rail">
          <Card title="What cannot be changed here">
            {/* Saying why is cheaper than a support message asking. */}
            <Row label="Member code" value={me.data?.memberCode ?? '—'} why="Issued once, on joining." />
            <Row
              label="Email"
              value={me.data?.email ?? '—'}
              why="Changing it changes how you sign in, so it goes through support."
            />
            <Row label="Phone" value={me.data?.phone ?? '—'} why="Used for sign-in codes." />
            <Row label="Membership" value={me.data?.tier ?? '—'} why="Set by your plan." />
          </Card>
        </div>
      </div>
    </SettingsShell>
  );
}

function Row({ label, value, why }: { label: string; value: string; why: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 8 }}>
      <span style={{ fontSize: 10 }} className="dim">
        {label}
      </span>
      <span style={{ fontSize: 12 }}>{value}</span>
      <span style={{ fontSize: 10, lineHeight: 1.45 }} className="dim">
        {why}
      </span>
    </div>
  );
}

/* ── Notifications ──────────────────────────────────────────────────────── */

const SWITCHES: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  { key: 'inApp', label: 'In the app', hint: 'The bell. Turning this off silences the others too.' },
  { key: 'emailDigest', label: 'Weekly digest', hint: 'One email a week: what you did, what you missed.' },
  { key: 'emailActivity', label: 'Replies by email', hint: 'When somebody replies to your post or win.' },
  { key: 'push', label: 'Push', hint: 'On a device where you have allowed notifications.' },
];

export function SettingsNotificationsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const prefs = useQuery({ queryKey: ['prefs'], queryFn: api.prefs });

  const save = useMutation({
    mutationFn: (patch: Partial<NotificationPrefs>) => api.updatePrefs(patch),
    onSuccess: (next) => queryClient.setQueryData(['prefs'], next),
    onError: toast.error,
  });

  return (
    <SettingsShell>
      <div className="content">
        <div className="col col-main">
          <Card title="What reaches you">
            {prefs.error && <div className="alert">{(prefs.error as Error).message}</div>}
            {prefs.data &&
              SWITCHES.map(({ key, label, hint }) => (
                <label
                  key={key}
                  style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(prefs.data[key])}
                    disabled={save.isPending}
                    onChange={(e) => save.mutate({ [key]: e.target.checked })}
                    style={{ marginTop: 2 }}
                  />
                  <span>
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 500 }}>{label}</span>
                    <span style={{ display: 'block', fontSize: 10.5, lineHeight: 1.5, marginTop: 1 }} className="dim">
                      {hint}
                    </span>
                  </span>
                </label>
              ))}
          </Card>

          {prefs.data && (
            <Card title="Quiet hours">
              <span style={{ fontSize: 11, lineHeight: 1.55 }} className="muted">
                No push between these times, in your own timezone. A notification held back is sent
                afterwards, not dropped.
              </span>
              <div className="field-row">
                <label className="field">
                  <span>From</span>
                  <input
                    type="time"
                    value={prefs.data.quietFrom}
                    onChange={(e) => save.mutate({ quietFrom: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>To</span>
                  <input
                    type="time"
                    value={prefs.data.quietTo}
                    onChange={(e) => save.mutate({ quietTo: e.target.value })}
                  />
                </label>
              </div>
            </Card>
          )}
        </div>

        <div className="col rail">
          <Card title="Looking for your notifications?">
            <span style={{ fontSize: 11.5, lineHeight: 1.6 }} className="muted">
              The list of what has actually happened lives behind the bell — this page is only the
              switches that decide what arrives.
            </span>
            <Link to="/notifications" className="btn btn-soft" style={{ alignSelf: 'flex-start' }}>
              <Icon name="bell" size={13} />
              Open notifications
            </Link>
          </Card>
        </div>
      </div>
    </SettingsShell>
  );
}

/* ── Privacy & data ─────────────────────────────────────────────────────── */

export function SettingsPrivacyPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');

  const deletion = useQuery({ queryKey: ['deletion'], queryFn: api.deletionState });

  const schedule = useMutation({
    mutationFn: () => api.scheduleDeletion(reason || undefined),
    onSuccess: () => {
      toast.show('Deletion scheduled. You have 30 days to change your mind.');
      queryClient.invalidateQueries({ queryKey: ['deletion'] });
    },
    onError: toast.error,
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelDeletion(),
    onSuccess: () => {
      toast.show('Deletion cancelled. Your account stays.');
      queryClient.invalidateQueries({ queryKey: ['deletion'] });
    },
    onError: toast.error,
  });

  const scheduled = deletion.data?.scheduled ?? false;
  const purgeAt = deletion.data?.purgeAt;

  return (
    <SettingsShell>
      <div className="content">
        <div className="col col-main">
          <Card title="Your data">
            <span style={{ fontSize: 12, lineHeight: 1.6 }} className="muted">
              Everything the club holds about you — profile, posts, progress, registrations and
              activity — as a single JSON file.
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
                  {purgeAt
                    ? ` on ${new Date(purgeAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`
                    : ''}
                  . You can cancel any time before then — after that it cannot be undone.
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
                  Deleting removes your profile, progress and registrations after a 30-day grace period.
                  Posts you wrote are anonymised rather than removed, so conversations other members rely
                  on do not develop holes.
                </span>
                <label className="field">
                  <span>Why are you leaving? (optional)</span>
                  <input value={reason} onChange={(e) => setReason(e.target.value)} />
                </label>
                <label className="field">
                  <span>Type DELETE to confirm</span>
                  <input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </label>
                <button
                  type="button"
                  className="btn btn-danger"
                  style={{ alignSelf: 'flex-start' }}
                  disabled={confirm !== 'DELETE' || schedule.isPending}
                  onClick={() => schedule.mutate()}
                >
                  {schedule.isPending ? 'Scheduling…' : 'Delete my account'}
                </button>
              </>
            )}
          </Card>
        </div>

        <div className="col rail">
          <Card title="Who can see you">
            <span style={{ fontSize: 11.5, lineHeight: 1.6 }} className="muted">
              Your directory listing is off unless you turn it on, and your posts are visible to members
              only. A win is private until you tick "share publicly" on it.
            </span>
            <Link to="/settings" className="btn btn-soft" style={{ alignSelf: 'flex-start' }}>
              Directory settings
            </Link>
          </Card>
        </div>
      </div>
    </SettingsShell>
  );
}

/** Membership keeps its own page body; this only wraps it in the tabs. */
export function SettingsMembershipShell({ children }: { children: React.ReactNode }) {
  return <SettingsShell>{children}</SettingsShell>;
}

export { SettingsShell };
