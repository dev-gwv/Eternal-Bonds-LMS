import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { AdminMember, MemberRisk } from '@ipc/contracts';
import { adminApi } from '../../shared/admin-api.ts';
import { relativeTime } from '../../shared/api.ts';
import { PageHeader, Page } from '../../shared/layout/AppShell.tsx';
import { Avatar, Card, Chip, EmptyState, Icon } from '../../shared/ui/primitives.tsx';
import { LoadingLabel, SkeletonRow } from '../../shared/ui/Skeleton.tsx';
import { ErrorNote, Toolbar } from './studio-ui.tsx';

/**
 * The roster.
 *
 * The club has hundreds of members and no way, until now, to look at one. What
 * makes this useful rather than just a list is the **risk** column: with a
 * single author running everything, the scarce resource is his attention, and
 * this page exists to point it at the twenty people worth a message rather
 * than the eight hundred who are fine.
 *
 * "Stalled" is the group that earns the page — somebody mid-course who stopped
 * is the most recoverable member there is, and completely invisible otherwise.
 */

const RISK: Record<MemberRisk, { label: string; tone: 'green' | 'yellow' | 'pink' | 'blue' | 'grey'; hint: string }> = {
  active: { label: 'Active', tone: 'green', hint: 'Did something in the last week' },
  idle: { label: 'Idle', tone: 'blue', hint: 'Quiet for 1–3 weeks' },
  stalled: { label: 'Stalled', tone: 'yellow', hint: 'Started a course and stopped — the ones worth a message' },
  dormant: { label: 'Dormant', tone: 'pink', hint: 'Nothing for over two months' },
  never_started: { label: 'Never started', tone: 'grey', hint: 'Joined but has not opened a lesson' },
};

const FILTERS: { key: string; label: string; count: (t: Totals) => number }[] = [
  { key: 'all', label: 'Everyone', count: (t) => t.all },
  { key: 'stalled', label: 'Stalled', count: (t) => t.stalled },
  { key: 'idle', label: 'Idle', count: (t) => t.idle },
  { key: 'dormant', label: 'Dormant', count: (t) => t.dormant },
  { key: 'never_started', label: 'Never started', count: (t) => t.neverStarted },
  { key: 'active', label: 'Active', count: (t) => t.active },
];

type Totals = {
  all: number; active: number; idle: number; stalled: number;
  dormant: number; neverStarted: number; suspended: number;
};

function MemberRow({ m }: { m: AdminMember }) {
  const risk = RISK[m.risk];
  return (
    <Link
      to="/admin/members/$id"
      params={{ id: m.id }}
      className="card-row"
      style={{ color: 'inherit', opacity: m.suspended ? 0.55 : 1 }}
    >
      <Avatar initials={m.initials} size={34} tone={m.suspended ? 'grey' : 'blue'} />

      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{m.fullName}</span>
          {m.suspended && <Chip tone="pink">Suspended</Chip>}
          {m.role === 'admin' && <Chip tone="blue">Admin</Chip>}
        </span>
        <span style={{ fontSize: 10 }} className="dim">
          {m.memberCode}
          {m.city ? ` · ${m.city}` : ''}
          {m.email ? ` · ${m.email}` : ''}
        </span>
      </span>

      <span style={{ width: 92, textAlign: 'right', fontSize: 11 }} className="muted">
        {m.coursesEnrolled > 0 ? `${m.coursesCompleted}/${m.coursesEnrolled} courses` : '—'}
      </span>
      <span style={{ width: 70, textAlign: 'right', fontSize: 11 }} className="num muted">
        {m.xp.toLocaleString('en-IN')} XP
      </span>
      <span style={{ width: 84, textAlign: 'right', fontSize: 10 }} className="dim">
        {m.lastSeenAt ? relativeTime(m.lastSeenAt) : 'never'}
      </span>

      <span style={{ width: 104, textAlign: 'right' }}>
        <Chip tone={risk.tone === 'grey' ? undefined : risk.tone}>{risk.label}</Chip>
      </span>
      <Chip>{m.tier}</Chip>
    </Link>
  );
}

export function MembersPage() {
  const [risk, setRisk] = useState('all');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  // The roster is server-filtered, so every keystroke would be a query.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  const roster = useQuery({
    queryKey: ['admin', 'members', risk, debounced],
    queryFn: () => adminApi.members({ risk, q: debounced || undefined }),
  });

  const totals = roster.data?.totals;

  return (
    <Page>
      <PageHeader
        title="Members"
        back="/admin"
        crumbs={[{ label: 'Studio', to: '/admin' }, { label: 'Members' }]}
        actions={
          <div className="search" style={{ width: 'clamp(180px, 22vw, 300px)' }}>
            <input
              type="search"
              value={query}
              placeholder="Name, email, code or city"
              aria-label="Search members"
              onChange={(e) => setQuery(e.target.value)}
            />
            <Icon name="search" size={15} strokeWidth={2} color="var(--ink-2)" />
          </div>
        }
      />

      <ErrorNote error={roster.error} />

      <Toolbar>
        {FILTERS.map((f) => {
          const active = risk === f.key;
          return (
            <button
              key={f.key}
              type="button"
              className={active ? 'btn btn-pink' : 'btn btn-soft'}
              title={f.key === 'all' ? undefined : RISK[f.key as MemberRisk]?.hint}
              onClick={() => setRisk(f.key)}
            >
              {f.label}
              {totals && (
                <span style={{ opacity: 0.75, marginLeft: 2 }} className="num">
                  {f.count(totals)}
                </span>
              )}
            </button>
          );
        })}
      </Toolbar>

      {risk === 'stalled' && (
        <div className="callout">
          Members who started a course and stopped between three weeks and two months ago. This is the most
          recoverable group in the club — a single message usually brings them back.
        </div>
      )}

      {roster.isPending && (
        <>
          <LoadingLabel>Loading the roster</LoadingLabel>
          {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
        </>
      )}

      {roster.data?.items.length === 0 && !roster.isPending && (
        <Card>
          <EmptyState
            icon="people"
            title={debounced ? `Nobody matches “${debounced}”` : 'Nobody in this group'}
            hint={debounced ? 'Try a shorter search.' : 'Which is good news, if the group is Stalled or Dormant.'}
          />
        </Card>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {roster.data?.items.map((m) => <MemberRow key={m.id} m={m} />)}
      </div>

      {roster.data?.nextCursor && (
        <span style={{ fontSize: 10.5, textAlign: 'center' }} className="dim">
          Showing the {roster.data.items.length} most recent. Narrow with search or a filter to see further back.
        </span>
      )}
    </Page>
  );
}
