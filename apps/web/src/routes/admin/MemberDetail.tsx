import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import type { AdminMemberDetail, Tier } from '@ipc/contracts';
import { adminApi } from '../../shared/admin-api.ts';
import { relativeTime } from '../../shared/api.ts';
import { PageHeader, Page } from '../../shared/layout/AppShell.tsx';
import { Avatar, Card, Chip, EmptyState, Icon } from '../../shared/ui/primitives.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { ConfirmButton, ErrorNote, Field, Select, Toolbar } from './studio-ui.tsx';

/**
 * One learner, in enough detail to decide what to say to them.
 *
 * The course list is the point: which course, how far in, and when they last
 * touched it. "Stopped at lesson 4 of 22, six weeks ago" is a message you can
 * write; "inactive member" is not.
 */

const TIERS: readonly Tier[] = ['free', 'silver', 'diamond', 'franchisee'] as const;

function CourseRow({ c }: { c: AdminMemberDetail['courses'][number] }) {
  const done = c.completedAt !== null;
  return (
    <div className="card-row" style={{ gap: 12 }}>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 12, fontWeight: 500 }}>{c.title}</span>
        <span style={{ fontSize: 10 }} className="dim">
          {done
            ? `Finished ${relativeTime(c.completedAt!)} ago`
            : c.lastLessonTitle
              ? `Last on “${c.lastLessonTitle}”${c.lastActivityAt ? ` · ${relativeTime(c.lastActivityAt)} ago` : ''}`
              : 'Enrolled, not started'}
        </span>
      </span>

      <span style={{ width: 150, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, height: 5, borderRadius: 999, background: 'var(--track)' }}>
          <span
            style={{
              display: 'block',
              width: `${c.progress}%`,
              height: '100%',
              borderRadius: 999,
              background: done ? 'var(--green)' : 'var(--pink)',
            }}
          />
        </span>
        <span style={{ fontSize: 10, width: 30, textAlign: 'right' }} className="num dim">
          {c.progress}%
        </span>
      </span>

      <span style={{ width: 70, textAlign: 'right', fontSize: 10 }} className="dim">
        {c.lessonsDone}/{c.lessonsTotal}
      </span>
      {done && <Chip tone="green">Done</Chip>}
    </div>
  );
}

function TierForm({ member, onDone }: { member: AdminMemberDetail; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [tier, setTier] = useState<Tier>(member.tier);
  const [months, setMonths] = useState('12');
  const [reason, setReason] = useState('');

  const grant = useMutation({
    mutationFn: () =>
      adminApi.grantTier(member.id, {
        tier,
        months: months === 'forever' ? null : Number(months),
        reason: reason.trim(),
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(['admin', 'member', member.id], next);
      queryClient.invalidateQueries({ queryKey: ['admin', 'members'] });
      onDone();
    },
  });

  return (
    <Card title="Grant a tier by hand">
      <ErrorNote error={grant.error} />
      <span style={{ fontSize: 11, lineHeight: 1.55 }} className="muted">
        For a member who paid outside the app, a founding member, or a comp. Payments made through
        checkout grant themselves — you should not need this for those.
      </span>
      <div className="field-row">
        <Field label="Tier">
          <Select value={tier} options={TIERS} onChange={setTier} />
        </Field>
        <Field label="For how long">
          <select value={months} onChange={(e) => setMonths(e.target.value)}>
            <option value="1">1 month</option>
            <option value="3">3 months</option>
            <option value="6">6 months</option>
            <option value="12">12 months</option>
            <option value="24">24 months</option>
            <option value="forever">No end date</option>
          </select>
        </Field>
      </div>
      <Field label="Why (recorded in the audit log)">
        <input
          value={reason}
          placeholder="Paid by bank transfer on 12 Sep"
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <Toolbar>
        <button
          type="button"
          className="btn btn-pink"
          disabled={reason.trim().length < 3 || grant.isPending}
          onClick={() => grant.mutate()}
        >
          {grant.isPending ? 'Granting…' : 'Grant tier'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </Toolbar>
    </Card>
  );
}

export function MemberDetailPage() {
  const { id } = useParams({ from: '/admin/members/$id' });
  const queryClient = useQueryClient();
  const [granting, setGranting] = useState(false);

  const member = useQuery({ queryKey: ['admin', 'member', id], queryFn: () => adminApi.member(id) });

  const suspend = useMutation({
    mutationFn: (suspended: boolean) =>
      adminApi.setSuspended(id, {
        suspended,
        reason: suspended ? 'Suspended from the members console' : 'Reinstated from the members console',
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(['admin', 'member', id], next);
      queryClient.invalidateQueries({ queryKey: ['admin', 'members'] });
    },
  });

  if (member.isPending) {
    return (
      <Page>
        <Skeleton width={220} height={22} />
        <Skeleton height={120} radius={14} />
        <Skeleton height={200} radius={14} />
      </Page>
    );
  }
  if (member.error || !member.data) {
    return (
      <Page>
        <ErrorNote error={member.error ?? new Error('Member not found')} />
      </Page>
    );
  }

  const m = member.data;

  return (
    <Page>
      <PageHeader
        title={m.fullName}
        back="/admin/members"
        crumbs={[{ label: 'Studio', to: '/admin' }, { label: 'Members', to: '/admin/members' }, { label: m.fullName }]}
        actions={
          <Toolbar>
            <button type="button" className="btn btn-soft" onClick={() => setGranting((g) => !g)}>
              <Icon name="edit" size={13} />
              Grant tier
            </button>
            {m.suspended ? (
              <button
                type="button"
                className="btn btn-green"
                disabled={suspend.isPending}
                onClick={() => suspend.mutate(false)}
              >
                Reinstate
              </button>
            ) : (
              <ConfirmButton
                label="Suspend"
                confirmLabel="Really suspend"
                disabled={suspend.isPending || m.role === 'admin'}
                onConfirm={() => suspend.mutate(true)}
              />
            )}
          </Toolbar>
        }
      />

      <ErrorNote error={suspend.error} />
      {granting && <TierForm member={m} onDone={() => setGranting(false)} />}

      <div className="content">
        <div className="col col-main">
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <Avatar initials={m.initials} size={52} tone={m.suspended ? 'grey' : 'blue'} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{m.fullName}</span>
                  <Chip tone="pink">{m.tier}</Chip>
                  {m.role !== 'member' && <Chip tone="blue">{m.role}</Chip>}
                  {m.suspended && <Chip tone="pink">Suspended</Chip>}
                </span>
                <span style={{ fontSize: 11 }} className="muted">
                  {m.memberCode} · joined {relativeTime(m.joinedAt)} ago
                  {m.lastSeenAt ? ` · last active ${relativeTime(m.lastSeenAt)} ago` : ' · never active'}
                </span>
                <span style={{ fontSize: 11 }} className="dim">
                  {[m.email, m.phone, m.city].filter(Boolean).join(' · ') || 'No contact details on file'}
                </span>
              </div>
            </div>
            {m.bio && (
              <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.6 }} className="muted">
                {m.bio}
              </p>
            )}
          </Card>

          <span className="section-label">Courses</span>
          {m.courses.length === 0 ? (
            <Card>
              <EmptyState
                icon="courses"
                title="Not enrolled in anything"
                hint="They joined but have not started a course. Worth a nudge."
              />
            </Card>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {m.courses.map((c) => <CourseRow key={c.courseId} c={c} />)}
            </div>
          )}
        </div>

        <div className="col rail">
          <Card title="At a glance">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                ['XP', m.xp.toLocaleString('en-IN')],
                ['Lessons', String(m.lessonsCompleted)],
                ['Streak', `${m.streakDays}d`],
                ['Courses', `${m.coursesCompleted}/${m.coursesEnrolled}`],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 10 }} className="dim">{label}</span>
                  <span className="metric num">{value}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Membership history">
            {m.memberships.map((ms, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                <Chip tone={ms.status === 'active' ? 'green' : undefined}>{ms.tier}</Chip>
                <span className="dim" style={{ flex: 1 }}>
                  {ms.source} · {new Date(ms.startedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                </span>
                <span className="dim">
                  {ms.expiresAt
                    ? new Date(ms.expiresAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })
                    : 'no end'}
                </span>
              </div>
            ))}
          </Card>

          <Card title="Recent activity" style={{ flex: 1 }}>
            {m.timeline.length === 0 ? (
              <EmptyState icon="clock" title="Nothing recorded yet" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {m.timeline.slice(0, 15).map((t, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 11 }}>
                    <span style={{ flex: 1 }}>{t.summary}</span>
                    <span style={{ fontSize: 10 }} className="dim">{relativeTime(t.at)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}
