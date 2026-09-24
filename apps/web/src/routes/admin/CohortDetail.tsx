import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import type { CohortDetail, CohortMember } from '@ipc/contracts';
import { adminApi } from '../../shared/admin-api.ts';
import { relativeTime } from '../../shared/api.ts';
import { PageHeader, Page } from '../../shared/layout/AppShell.tsx';
import { Avatar, Card, Chip, EmptyState, Icon } from '../../shared/ui/primitives.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { ConfirmButton, ErrorNote, Toolbar } from './studio-ui.tsx';
import { useToast } from '../../shared/ui/Toast.tsx';

/**
 * One cohort: who is in it, where they are, and what opens when.
 *
 * The roster is sorted by least-finished first, which is the whole reason to
 * open this page. With one author, the scarce resource is attention, and it
 * should land on the four people the schedule has left behind rather than the
 * thirty who are fine.
 */

function MemberRow({
  m,
  onRemove,
  busy,
}: {
  m: CohortMember;
  onRemove: () => void;
  busy: boolean;
}) {
  return (
    <div className="card-row" style={{ gap: 12 }}>
      <Avatar initials={m.initials} size={32} tone={m.behind ? 'pink' : 'blue'} />

      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{m.fullName}</span>
          {m.behind && <Chip tone="yellow">Behind</Chip>}
        </span>
        <span style={{ fontSize: 10 }} className="dim">
          {m.email ?? 'No email'} ·{' '}
          {m.lastActivityAt ? `last active ${relativeTime(m.lastActivityAt)} ago` : 'never opened it'}
        </span>
      </span>

      <span style={{ width: 150, maxWidth: '38vw', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, height: 5, borderRadius: 999, background: 'var(--track)' }}>
          <span
            style={{
              display: 'block',
              width: `${m.progress}%`,
              height: '100%',
              borderRadius: 999,
              background: m.progress === 100 ? 'var(--green)' : m.behind ? 'var(--yellow)' : 'var(--pink)',
            }}
          />
        </span>
        <span style={{ fontSize: 10, width: 30, textAlign: 'right' }} className="num dim">
          {m.progress}%
        </span>
      </span>

      <span style={{ width: 62, textAlign: 'right', fontSize: 10 }} className="dim num hide-sm">
        {m.lessonsDone}/{m.lessonsTotal}
      </span>

      {/* No confirm. The undo toast asks nothing up front and is there at the
          only moment the question matters — after the mistake. */}
      <button type="button" className="btn btn-ghost" style={{ color: 'var(--red)' }} disabled={busy} onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}

function AddMembers({ cohort }: { cohort: CohortDetail }) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');

  // The roster search, reused. An admin filling a cohort is looking through
  // the same list they would look through anywhere else.
  const roster = useQuery({
    queryKey: ['admin', 'members', 'all', query],
    queryFn: () => adminApi.members({ q: query || undefined }),
    enabled: query.trim().length >= 2,
  });

  const add = useMutation({
    mutationFn: (userId: string) => adminApi.addCohortMembers(cohort.id, [userId]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'cohort', cohort.id] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'cohorts'] });
    },
  });

  const already = new Set(cohort.members.map((m) => m.userId));
  const found = (roster.data?.items ?? []).filter((m) => !already.has(m.id)).slice(0, 8);

  return (
    <Card title="Add members">
      <ErrorNote error={add.error} />
      <div className="search">
        <input
          type="search"
          value={query}
          placeholder="Search by name, email or code"
          aria-label="Search members to add"
          onChange={(e) => setQuery(e.target.value)}
        />
        <Icon name="search" size={15} strokeWidth={2} color="var(--ink-2)" />
      </div>

      {query.trim().length >= 2 && found.length === 0 && !roster.isPending && (
        <span style={{ fontSize: 11 }} className="dim">
          Nobody matching who is not already in this cohort.
        </span>
      )}

      {found.map((m) => (
        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar initials={m.initials} size={26} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 11.5 }}>
            {m.fullName}
            <span className="dim" style={{ marginLeft: 6, fontSize: 10 }}>
              {m.memberCode}
            </span>
          </span>
          <button
            type="button"
            className="btn btn-soft"
            disabled={add.isPending}
            onClick={() => add.mutate(m.id)}
          >
            Add
          </button>
        </div>
      ))}

      <span style={{ fontSize: 10.5, lineHeight: 1.5 }} className="dim">
        Adding somebody enrols them in the course too — a schedule for a course they cannot open would be
        no use to anybody.
      </span>
    </Card>
  );
}

export function CohortDetailPage() {
  const { id } = useParams({ from: '/admin/cohorts/$id' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const cohort = useQuery({ queryKey: ['admin', 'cohort', id], queryFn: () => adminApi.cohort(id) });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'cohort', id] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'cohorts'] });
  };

  const remove = useMutation({
    mutationFn: (userId: string) => adminApi.removeCohortMember(id, userId),
    onSuccess: refresh,
    onError: (e) => {
      toast.error(e);
      refresh();
    },
  });

  /**
   * Take the member off the roster on screen straight away, and only call the
   * API once the undo window closes. Nothing has happened server-side until
   * then, so Undo is genuinely free rather than a second write that might fail.
   */
  const removeWithUndo = (member: { userId: string; fullName: string }) => {
    queryClient.setQueryData(['admin', 'cohort', id], (old: CohortDetail | undefined) =>
      old ? { ...old, members: old.members.filter((m) => m.userId !== member.userId) } : old,
    );
    toast.withUndo(
      `${member.fullName} removed from the cohort`,
      () => remove.mutate(member.userId),
      refresh,
    );
  };

  const close = useMutation({
    mutationFn: (isOpen: boolean) => {
      const c = cohort.data!;
      return adminApi.updateCohort(id, {
        courseId: c.courseId,
        slug: c.slug,
        name: c.name,
        startsOn: c.startsOn,
        endsOn: c.endsOn,
        capacity: c.capacity,
        isOpen,
      });
    },
    onSuccess: (next) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'cohort', id] });
      toast.show(next.isOpen ? 'Cohort reopened' : 'Cohort closed to new members');
    },
    onError: toast.error,
  });

  /**
   * Deleting the cohort.
   *
   * `adminApi.deleteCohort` and its endpoint have existed since cohorts were
   * built; no button ever called them, so a cohort created by mistake — wrong
   * course, wrong start date — stayed in the list forever with no way to
   * remove it. Closing it only stops new members joining.
   *
   * Members are not deleted with it. A cohort row carries a schedule, not
   * progress: everyone in it keeps every lesson they finished and simply stops
   * being on a shared timetable.
   */
  const destroy = useMutation({
    mutationFn: () => adminApi.deleteCohort(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'cohorts'] });
      toast.show('Cohort deleted — nobody lost any progress');
      navigate({ to: '/admin/cohorts' });
    },
    onError: toast.error,
  });

  if (cohort.isPending) {
    return (
      <Page>
        <Skeleton width={240} height={22} />
        <Skeleton height={140} radius={14} />
        <Skeleton height={240} radius={14} />
      </Page>
    );
  }
  if (cohort.error || !cohort.data) {
    return (
      <Page>
        <ErrorNote error={cohort.error ?? new Error('Cohort not found')} />
      </Page>
    );
  }

  const c = cohort.data;
  const behind = c.members.filter((m) => m.behind);
  const done = c.members.filter((m) => m.progress === 100);

  return (
    <Page>
      <PageHeader
        title={c.name}
        back="/admin/cohorts"
        crumbs={[{ label: 'Studio', to: '/admin' }, { label: 'Cohorts', to: '/admin/cohorts' }, { label: c.name }]}
        actions={
          <Toolbar>
            <button
              type="button"
              className="btn btn-soft"
              disabled={close.isPending}
              onClick={() => close.mutate(!c.isOpen)}
            >
              {c.isOpen ? 'Close to new members' : 'Reopen'}
            </button>
            <ConfirmButton
              label="Delete cohort"
              confirmLabel={`Delete — ${c.members.length} member${c.members.length === 1 ? '' : 's'} keep their progress`}
              disabled={destroy.isPending}
              onConfirm={() => destroy.mutate()}
              style={{ color: 'var(--red)' }}
            />
          </Toolbar>
        }
      />

      <ErrorNote error={remove.error ?? close.error ?? destroy.error} />

      <div className="content">
        <div className="col col-main">
          <Card>
            <div
              style={{
                display: 'grid',
                // Four fixed columns become four unreadable slivers on a phone.
                gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                gap: 14,
              }}
            >
              {[
                ['Members', `${c.memberCount}${c.capacity !== null ? ` / ${c.capacity}` : ''}`],
                ['Average progress', `${c.averageProgress}%`],
                ['Behind', String(behind.length)],
                ['Finished', String(done.length)],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 10 }} className="dim">
                    {label}
                  </span>
                  <span className="metric num">{value}</span>
                </div>
              ))}
            </div>
            <span style={{ fontSize: 11 }} className="muted">
              {c.courseTitle} · started {c.startsOn}
              {c.endsOn ? ` · should finish by ${c.endsOn}` : ''}
            </span>
          </Card>

          {behind.length > 0 && (
            <div className="callout">
              {behind.length} member{behind.length === 1 ? ' is' : 's are'} behind what the schedule has opened.
              {c.endsOn
                ? ' They are warned automatically a week before the end date — this is who to message before that.'
                : ' Set an end date and they will be warned automatically a week before it.'}
            </div>
          )}

          <span className="section-label">Roster</span>
          {c.members.length === 0 ? (
            <Card>
              <EmptyState icon="people" title="Nobody in this cohort yet" hint="Add members from the panel on the right." />
            </Card>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {c.members.map((m) => (
                <MemberRow
                  key={m.userId}
                  m={m}
                  busy={remove.isPending}
                  onRemove={() => removeWithUndo(m)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="col rail">
          <AddMembers cohort={c} />

          <Card title="Timetable" style={{ flex: 1 }}>
            {c.schedule.length === 0 ? (
              <EmptyState icon="calendar" title="No modules yet" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {c.schedule.map((s) => {
                  const opened = s.opensOn === null || new Date(s.opensOn).getTime() <= Date.now();
                  return (
                    <div key={s.moduleId} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 11 }}>
                      <span style={{ flex: 1, minWidth: 0 }}>{s.title}</span>
                      <span style={{ fontSize: 10 }} className={opened ? 'dim' : undefined}>
                        {s.opensOn === null ? 'Open' : opened ? `Opened ${s.opensOn}` : `Opens ${s.opensOn}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <span style={{ fontSize: 10, lineHeight: 1.5 }} className="dim">
              Set which day each module opens in the course builder. Members are told automatically when one does.
            </span>
          </Card>
        </div>
      </div>
    </Page>
  );
}
