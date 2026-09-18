import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Workshop } from '@ipc/contracts';
import { api, dayHeading, timeRange } from '../shared/api.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { TrendLine } from '../shared/ui/charts.tsx';
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
  const rate = stats.data?.attendanceRate ?? 0;
  const gaugeLen = Math.PI * 52;

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
          {workshops.isPending && <p className="muted" style={{ fontSize: 12 }}>Loading workshops…</p>}
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
          <Card title="Attendance" action={<Dropdown label="Last 5" />}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <svg width="120" height="76" viewBox="0 0 140 86" role="img" aria-label={`Attendance rate ${rate} percent`}>
                <path d="M18 74 A52 52 0 0 1 122 74" fill="none" stroke="var(--track)" strokeWidth="15" strokeLinecap="round" />
                <path
                  d="M18 74 A52 52 0 0 1 122 74"
                  fill="none"
                  stroke="var(--s1)"
                  strokeWidth="15"
                  strokeLinecap="round"
                  strokeDasharray={`${((rate / 100) * gaugeLen).toFixed(1)} ${gaugeLen.toFixed(1)}`}
                />
                <text x="70" y="58" textAnchor="middle" fontSize="9" fill="var(--ink-3)">Attendance</text>
                <text x="70" y="76" textAnchor="middle" fontSize="20" fontWeight="600" fill="var(--ink)">{rate}%</text>
              </svg>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 9 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 10 }} className="dim">Registrations</span>
                  <span style={{ fontSize: 14, fontWeight: 600 }} className="num">
                    {stats.data?.registrations.toLocaleString('en-IN') ?? '—'}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 10 }} className="dim">Attendees</span>
                  <span style={{ fontSize: 14, fontWeight: 600 }} className="num">{stats.data?.attendees ?? '—'}</span>
                </div>
              </div>
            </div>
          </Card>

          <Card title="Registrations trend" style={{ flex: 1 }}>
            <TrendLine
              width={266}
              height={110}
              points={[
                { label: 'W1', value: 31 },
                { label: 'W2', value: 48 },
                { label: 'W3', value: 42 },
                { label: 'W4', value: 66 },
                { label: 'W5', value: 82 },
              ]}
            />
            <div className="callout" style={{ marginTop: 'auto' }}>
              Show-up climbs when the reminder goes out two hours before. Keep it on.
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}
