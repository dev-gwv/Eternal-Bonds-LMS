import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api, dayNumber, hoursMinutes, monthShort, timeRange, xpLabel } from '../shared/api.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { ActivityChart } from '../shared/ui/charts.tsx';
import { Card, DateBadge, EmptyState, Hero, Icon, StatTile } from '../shared/ui/primitives.tsx';
import { LoadingLabel, Skeleton, SkeletonCard } from '../shared/ui/Skeleton.tsx';

const TONES = ['pink', 'yellow', 'blue', 'green'] as const;

export function DashboardPage() {
  // One round trip for first paint (GET /v1/me/dashboard) instead of five
  // parallel queries — five TLS handshakes on a phone over 4G.
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 5 * 60_000, retry: false });

  const stats = dashboard.data?.stats;
  const activityDays = dashboard.data?.activity ?? [];
  const workshopList = dashboard.data?.workshops ?? [];
  const board = dashboard.data?.leaderboard ?? [];

  const watched = activityDays.reduce((sum, d) => sum + d.courses + d.workshops + d.library, 0);
  const { hours, minutes } = hoursMinutes(watched);
  // The tile covers 30 days and the chart covers 7, so they are different
  // numbers on purpose — the tile says so in its label.
  const learned = hoursMinutes(stats?.minutesLearned ?? 0);

  // How much XP separates them from the member directly above. Null when they
  // have none yet — there is no gap to close if the race has not started.
  // 'capped' when their rank is beyond the board the API returns: claiming a
  // gap of zero there would read as "top of the club" to someone at rank 51.
  const gapToNext = (() => {
    if (!stats || stats.xp === 0 || stats.rank === null) return null;
    if (stats.rank === 1) return 0;
    const above = board.filter((r) => r.xp > stats.xp).sort((a, b) => a.xp - b.xp)[0];
    if (above) return Math.max(0, above.xp - stats.xp);
    return 'capped' as const;
  })();

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = me.data?.fullName.split(' ')[0];
  const streak = stats?.streakDays ?? 0;

  return (
    <Page>
      <PageHeader
        title="Dashboard"
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Dashboard' }]}
        actions={
          <Link to="/courses" className="btn btn-pink" style={{ color: '#fff' }}>
            Continue learning
          </Link>
        }
      />

      <Hero
        tone="ink"
        eyebrow={`Day streak · ${streak} ${streak === 1 ? 'day' : 'days'} and counting`}
        title={firstName ? `${greeting}, ${firstName}.` : `${greeting}.`}
        sub={
          typeof gapToNext === 'number' && gapToNext > 0
            ? `You're ${gapToNext.toLocaleString('en-IN')} XP from the member above you. One lesson closes it.`
            : 'Small efforts, repeated daily. Pick up where you left off.'
        }
        actions={
          <>
            <Link to="/courses" className="btn btn-pink" style={{ color: '#fff' }}>Continue learning</Link>
            <Link to="/think-tank" className="btn btn-soft">This week's insights</Link>
          </>
        }
      />

      <div className="content">
        <div className="col col-main">
          {/* A member's four numbers, not the organiser's. These used to be
              total workshops, registrations, attendees and attendance rate —
              facts about the club, on the landing page of one person in it. */}
          <div className="grid grid-4">
            {dashboard.isPending ? (
              <>
                <LoadingLabel>Loading your stats</LoadingLabel>
                {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={1} />)}
              </>
            ) : (
              <>
                <StatTile
                  label="Lessons finished"
                  tone="pink"
                  icon={<Icon name="check" size={18} strokeWidth={2.3} />}
                  value={String(stats?.lessonsCompleted ?? 0)}
                />
                <StatTile
                  label={learned.hours > 0 ? 'Learning time · 30 days' : 'Learning time'}
                  tone="yellow"
                  icon={<Icon name="clock" size={18} strokeWidth={1.9} />}
                  value={learned.hours > 0 ? `${learned.hours}h ${learned.minutes}m` : `${learned.minutes}m`}
                />
                <StatTile
                  label={
                    (stats?.streakDays ?? 0) > 0
                      ? `Day streak · best ${stats?.longestStreakDays}`
                      : 'Day streak'
                  }
                  tone="blue"
                  icon={<Icon name="chart" size={18} strokeWidth={1.9} />}
                  value={String(stats?.streakDays ?? 0)}
                />
                <StatTile
                  // Rank is null until they have any XP — an unranked member
                  // is not in last place, and saying so would be a small lie.
                  label={stats?.rank ? `XP · rank ${stats.rank}` : 'XP'}
                  tone="green"
                  icon={<Icon name="courses" size={18} strokeWidth={1.9} />}
                  value={(stats?.xp ?? 0).toLocaleString('en-IN')}
                />
              </>
            )}
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
            {dashboard.isPending ? (
              <Skeleton height={192} radius={12} />
            ) : (
              <ActivityChart days={activityDays} />
            )}
          </Card>
        </div>

        <div className="col rail">
          <Card title="Upcoming" action={<Link to="/workshops" style={{ fontSize: 11 }}>See all</Link>}>
            {workshopList.length === 0 && !dashboard.isPending && (
              <EmptyState icon="workshops" title="Nothing scheduled" hint="Live sessions show up here." />
            )}
            {workshopList.slice(0, 3).map((w, i) => (
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
            {board.length === 0 && !dashboard.isPending && (
              <EmptyState
                icon="chart"
                title="No rankings yet"
                hint="Finish a lesson or post a win and you will be on it."
              />
            )}
            {/* The API returns the top 50 so the gap promo can find the member
                directly above anyone at a realistic rank; the rail shows ten. */}
            {board.slice(0, 10).map((row) => (
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

          {/* Was a hardcoded "You are 3.1K XP away … top 25" shown to everyone,
              including members with no XP at all. Now it only appears when
              there is a real gap to close, and states the real number. */}
          {stats && gapToNext !== null && (
            <div className="promo">
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--yellow-deep)' }}>
                {gapToNext === 0
                  ? `You are ${stats.rank === 1 ? 'top of the club' : `rank ${stats.rank}`}`
                  : gapToNext === 'capped'
                    ? `You are rank ${stats.rank} — climb into the top 50`
                    : `${xpLabel(gapToNext)} XP to rank ${(stats.rank ?? 2) - 1}`}
              </span>
              <span style={{ fontSize: 11, lineHeight: 1.5, color: '#7a5a00' }}>
                {gapToNext === 0
                  ? 'Hold it by keeping the streak going.'
                  : 'Finishing a lesson earns XP. So does posting a win.'}
              </span>
              <Link to="/courses" className="btn" style={{ alignSelf: 'flex-start', background: '#fff', color: 'var(--yellow-deep)' }}>
                Continue learning
              </Link>
            </div>
          )}

          {stats && stats.xp === 0 && (
            <div className="promo">
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--yellow-deep)' }}>Start earning XP</span>
              <span style={{ fontSize: 11, lineHeight: 1.5, color: '#7a5a00' }}>
                Finish your first lesson to get on the leaderboard.
              </span>
              <Link to="/courses" className="btn" style={{ alignSelf: 'flex-start', background: '#fff', color: 'var(--yellow-deep)' }}>
                Browse courses
              </Link>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}
