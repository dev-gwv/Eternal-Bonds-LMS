import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api, dayNumber, hoursMinutes, monthShort, timeRange, xpLabel } from '../shared/api.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { ActivityChart } from '../shared/ui/charts.tsx';
import { Card, DateBadge, Dropdown, EmptyState, Icon, StatTile } from '../shared/ui/primitives.tsx';

const TONES = ['pink', 'yellow', 'blue', 'green'] as const;

export function DashboardPage() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  const activity = useQuery({ queryKey: ['activity'], queryFn: api.activity });
  const workshops = useQuery({ queryKey: ['workshops', 'upcoming'], queryFn: () => api.workshops('upcoming') });
  const leaderboard = useQuery({ queryKey: ['leaderboard'], queryFn: api.leaderboard });

  const watched = (activity.data ?? []).reduce((sum, d) => sum + d.courses + d.workshops + d.library, 0);
  const { hours, minutes } = hoursMinutes(watched);

  return (
    <Page>
      <PageHeader
        title="Dashboard"
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Dashboard' }]}
        actions={<Dropdown label="This Week" />}
      />

      <div className="content">
        <div className="col col-main">
          <div className="grid grid-4">
            <StatTile label="Total workshops" tone="pink" icon={<Icon name="workshops" size={18} strokeWidth={1.9} />}
              value={stats.data ? String(stats.data.totalWorkshops) : '—'} />
            <StatTile label="Registrations" tone="yellow" icon={<Icon name="people" size={18} strokeWidth={1.9} />}
              value={stats.data ? stats.data.registrations.toLocaleString('en-IN') : '—'} />
            <StatTile label="Attendees" tone="blue" icon={<Icon name="check" size={18} strokeWidth={2.3} />}
              value={stats.data ? String(stats.data.attendees) : '—'} />
            <StatTile label="Attendance rate" tone="green" icon={<Icon name="chart" size={18} strokeWidth={1.9} />}
              value={stats.data ? `${stats.data.attendanceRate}%` : '—'} />
          </div>

          <Card
            title="Learning Activity"
            action={<span style={{ fontSize: 10 }} className="dim">Last 7 days</span>}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
              <span className="metric num">{hours}</span>
              <span style={{ fontSize: 11 }} className="dim">hours</span>
              <span className="metric num">{minutes}</span>
              <span style={{ fontSize: 11 }} className="dim">minutes</span>
            </div>
            {activity.data && <ActivityChart days={activity.data} />}
          </Card>
        </div>

        <div className="col rail">
          <Card title="Upcoming" action={<Link to="/workshops" style={{ fontSize: 11 }}>See all</Link>}>
            {(workshops.data ?? []).slice(0, 3).map((w, i) => (
              <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <DateBadge month={monthShort(w.startsAt)} day={dayNumber(w.startsAt)} tone={TONES[i % TONES.length]} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: 500, lineHeight: 1.35 }}>{w.title}</span>
                  <span style={{ fontSize: 10 }} className="dim">{timeRange(w.startsAt, w.endsAt)}</span>
                </div>
              </div>
            ))}
          </Card>

          <Card title="Leaderboard" style={{ flex: 1 }}>
            {(leaderboard.data ?? []).length === 0 && !leaderboard.isPending && (
              <EmptyState
                icon="chart"
                title="No rankings yet"
                hint="Finish a lesson or post a win and you will be on it."
              />
            )}
            {(leaderboard.data ?? []).map((row) => (
              <div
                key={row.rank}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '7px 10px',
                  borderRadius: 10,
                  background: row.rank === 1 ? 'var(--pink-tint)' : 'transparent',
                }}
              >
                <span
                  className="avatar"
                  style={{
                    width: 20,
                    height: 20,
                    fontSize: 10,
                    background: row.rank === 1 ? 'var(--pink)' : 'var(--soft)',
                    color: row.rank === 1 ? '#fff' : 'var(--ink-2)',
                  }}
                >
                  {row.rank}
                </span>
                <span style={{ flex: 1, fontSize: 11, fontWeight: row.rank === 1 ? 500 : 400 }}>{row.name}</span>
                <span
                  className="num"
                  style={{ fontSize: 10, fontWeight: 600, color: row.rank === 1 ? 'var(--pink-strong)' : 'var(--ink-2)' }}
                >
                  {xpLabel(row.xp)} XP
                </span>
              </div>
            ))}
          </Card>

          <div className="promo">
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--yellow-deep)' }}>You are 3.1K XP away</span>
            <span style={{ fontSize: 11, lineHeight: 1.5, color: '#7a5a00' }}>
              Finish one section or post a win to break into the club top 25.
            </span>
            <Link to="/courses" className="btn" style={{ alignSelf: 'flex-start', background: '#fff', color: 'var(--yellow-deep)' }}>
              Continue learning
            </Link>
          </div>
        </div>
      </div>
    </Page>
  );
}
