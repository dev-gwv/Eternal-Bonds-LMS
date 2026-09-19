import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Workshop } from '@ipc/contracts';
import { api, dayHeading, timeRange } from '../shared/api.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { NextUp } from '../shared/ui/NextUp.tsx';
import { LoadingLabel, Skeleton, SkeletonRow } from '../shared/ui/Skeleton.tsx';
import { Card, Chip, Dropdown, Icon } from '../shared/ui/primitives.tsx';

function groupByDay(items: Workshop[]) {
  const groups = new Map<string, Workshop[]>();
  for (const w of items) {
    const key = dayHeading(w.startsAt);
    groups.set(key, [...(groups.get(key) ?? []), w]);
  }
  return [...groups.entries()];
}

function WorkshopRow({ workshop, onToggle, busy }: { workshop: Workshop; onToggle: (registered: boolean) => void; busy: boolean }) {
  return (
    <div className="card-row" style={workshop.registered ? { background: '#fafcf8' } : undefined}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{workshop.title}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10 }} className="muted">{timeRange(workshop.startsAt, workshop.endsAt)}</span>
          {workshop.registered ? (
            <Chip tone="green">
              <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--green-ink)' }} />
              Registered
            </Chip>
          ) : (
            <Chip tone="blue">Zoom Webinar</Chip>
          )}
          {workshop.occurrence && (
            <Chip>Occurrence {workshop.occurrence.index} of {workshop.occurrence.total}</Chip>
          )}
        </div>
      </div>
      <button
        type="button"
        className="btn btn-soft btn-sq"
        onClick={() => workshop.registered && onToggle(false)}
        disabled={busy}
      >
        {workshop.registered ? 'Cancel' : 'Copy link'}
      </button>
      <button
        type="button"
        className={workshop.registered ? 'btn btn-green btn-sq' : 'btn btn-pink btn-sq'}
        disabled={busy}
        onClick={() => (workshop.registered ? window.open(workshop.joinUrl ?? '#', '_blank') : onToggle(true))}
      >
        {busy ? '…' : workshop.registered ? 'Join' : 'Register'}
      </button>
    </div>
  );
}

export function WorkshopsPage() {
  const [scope, setScope] = useState<'upcoming' | 'completed'>('upcoming');
  const queryClient = useQueryClient();
  const workshops = useQuery({ queryKey: ['workshops', scope], queryFn: () => api.workshops(scope) });

  const registration = useMutation({
    mutationFn: ({ id, registered }: { id: string; registered: boolean }) => api.setRegistration(id, registered),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workshops'] }),
  });
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });

  const groups = groupByDay(workshops.data ?? []);
  const registeredCount = (workshops.data ?? []).filter((w) => w.registered).length;

  return (
    <Page>
      <PageHeader
        title="Workshops"
        crumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Workshops' }]}
        actions={
          <>
            <div style={{ display: 'flex', background: 'var(--soft)', borderRadius: 999, padding: 3 }}>
              {(['upcoming', 'completed'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={scope === s ? 'btn btn-pink' : 'btn'}
                  style={{ padding: '8px 18px', background: scope === s ? undefined : 'transparent', color: scope === s ? undefined : 'var(--ink-2)', textTransform: 'capitalize' }}
                  onClick={() => setScope(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-blue">Add to calendar</button>
          </>
        }
      />

      <div className="content">
        <div className="col col-main">
          {workshops.isPending && (
            <>
              <LoadingLabel>Loading workshops</LoadingLabel>
              <Skeleton width={140} height={10} style={{ margin: '4px 0 10px' }} />
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </>
          )}
          {groups.length === 0 && !workshops.isPending && (
            <Card>
              <span style={{ fontSize: 13, fontWeight: 600 }}>No {scope} workshops</span>
              <span style={{ fontSize: 11 }} className="muted">
                Sessions appear here as soon as the club schedules them.
              </span>
            </Card>
          )}
          {groups.map(([day, items]) => (
            <div key={day} style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <span className="section-label">{day}</span>
              {items.map((w) => (
                <WorkshopRow
                  key={w.id}
                  workshop={w}
                  busy={registration.isPending && registration.variables?.id === w.id}
                  onToggle={(registered) => registration.mutate({ id: w.id, registered })}
                />
              ))}
            </div>
          ))}
        </div>

        <div className="col rail">
          {/* This rail used to show an attendance-rate gauge over club-wide
              registration totals, and a "Registrations trend" line drawn from
              five hardcoded numbers. Both are organiser metrics on a member's
              page, and one of them was fiction. */}
          <NextUp />

          <Card title="Your workshops">
            {stats.isPending ? (
              <>
                <Skeleton width="60%" height={13} />
                <Skeleton width="40%" height={13} />
              </>
            ) : (
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span className="metric num">{stats.data?.workshopsAttended ?? 0}</span>
                  <span style={{ fontSize: 10 }} className="dim">Attended</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span className="metric num">{registeredCount}</span>
                  <span style={{ fontSize: 10 }} className="dim">You are registered for</span>
                </div>
              </div>
            )}
            <span style={{ fontSize: 10.5, lineHeight: 1.55 }} className="dim">
              Registering adds it to the list and unlocks the join link closer to the time.
            </span>
          </Card>

          <Card title="Getting the most from a session" style={{ flex: 1 }}>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, lineHeight: 1.75, color: 'var(--ink-2)' }}>
              <li>Register early — the join link only appears for members who did.</li>
              <li>Recordings are added to Courses afterwards, so a clash is not a loss.</li>
              <li>Questions asked live get answered live. Bring one.</li>
            </ul>
          </Card>
        </div>
      </div>
    </Page>
  );
}
