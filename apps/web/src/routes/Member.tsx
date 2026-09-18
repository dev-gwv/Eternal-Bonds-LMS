import { useQuery } from '@tanstack/react-query';
import { api, durationLabel, hoursMinutes } from '../shared/api.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { ActivityChart, ProgressRing, ScoreGauge, TrendLine } from '../shared/ui/charts.tsx';
import { Card, Chip, Dropdown, Icon, Tile } from '../shared/ui/primitives.tsx';

const SERIES_LABELS = [
  { key: 'participation', label: 'Participation', color: 'var(--s1)' },
  { key: 'quiz', label: 'Quiz', color: 'var(--s2)' },
  { key: 'exam', label: 'Exam', color: 'var(--s3)' },
] as const;

const CONTACT_TONE = { email: 'pink', phone: 'yellow', address: 'blue' } as const;

export function MemberPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const activity = useQuery({ queryKey: ['activity'], queryFn: api.activity });
  const performance = useQuery({ queryKey: ['performance'], queryFn: api.performance });
  const courses = useQuery({ queryKey: ['courses'], queryFn: () => api.courses() });

  const watched = (activity.data ?? []).reduce((s, d) => s + d.courses + d.workshops + d.library, 0);
  const { hours, minutes } = hoursMinutes(watched);
  const member = me.data;

  return (
    <Page>
      <PageHeader
        title="Member Details"
        back="/"
        crumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Members', to: '/' }, { label: 'Member Details' }]}
      />

      <div className="content">
        {/* Profile column */}
        <div className="card" style={{ width: 286, flexShrink: 0, padding: 14, gap: 14 }}>
          <div style={{ position: 'relative', height: 128 }}>
            <div
              style={{
                height: 92,
                borderRadius: 12,
                background: 'linear-gradient(135deg, #f9a8c9 0%, #f27fb0 55%, #f9b9d4 100%)',
              }}
            />
            <span
              className="avatar"
              style={{
                position: 'absolute',
                left: '50%',
                bottom: 0,
                transform: 'translateX(-50%)',
                width: 76,
                height: 76,
                background: 'var(--yellow)',
                border: '4px solid #fff',
                fontSize: 22,
                color: '#7a5a00',
              }}
            >
              {member?.initials ?? '··'}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
            <div style={{ display: 'flex', gap: 7 }}>
              <Chip>{member?.memberCode ?? '—'}</Chip>
              {member?.active && <Chip tone="blue">Active</Chip>}
            </div>
            <span style={{ fontSize: 17, fontWeight: 600 }}>{member?.fullName ?? 'Loading…'}</span>
            <span style={{ fontSize: 11 }} className="dim">
              {member ? `Joined on ${new Date(member.joinedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="icon-btn btn-sq" style={{ width: 38, height: 38, background: '#fff', border: '1px solid #ececf1' }} aria-label="Email member">
              <Icon name="mail" />
            </button>
            <button type="button" className="icon-btn btn-sq" style={{ width: 38, height: 38, background: '#fff', border: '1px solid #ececf1' }} aria-label="Call member">
              <Icon name="phone" />
            </button>
            <button type="button" className="btn btn-blue btn-sq" style={{ flex: 1, fontSize: 12 }}>
              <Icon name="comment" size={15} strokeWidth={1.9} />
              Chat
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 11, paddingTop: 12, borderTop: '1px solid var(--rule)' }}>
            <span className="card-title">Contact</span>
            {member && (
              <>
                <ContactRow tone={CONTACT_TONE.email} icon="mail" label="Email" value={member.email} />
                <ContactRow tone={CONTACT_TONE.phone} icon="phone" label="Phone number" value={member.phone} />
                <ContactRow tone={CONTACT_TONE.address} icon="pin" label="Address" value={member.city} />
              </>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 12, borderTop: '1px solid var(--rule)' }}>
            <span className="card-title">Social media</span>
            {(member?.socials ?? []).map((s) => (
              <div key={s.network} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="tile" style={{ width: 24, height: 24, borderRadius: 7, background: '#f3f3f7', color: 'var(--ink-2)', fontSize: 10, fontWeight: 600 }}>
                  {s.network.slice(0, 2).toLowerCase()}
                </span>
                <span style={{ flex: 1, fontSize: 11 }}>{s.network}</span>
                <span style={{ fontSize: 11 }} className="dim">{s.handle}</span>
              </div>
            ))}
          </div>

          <button type="button" className="btn btn-soft btn-sq" style={{ marginTop: 'auto', padding: 11, fontSize: 12 }}>
            <Icon name="edit" size={14} strokeWidth={1.9} />
            Edit
          </button>
        </div>

        {/* Right column */}
        <div className="col col-main">
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <Card
              title="Learning Activity"
              action={<Dropdown label="This Week" />}
              style={{ flex: '1 1 380px', minHeight: 286 }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                <span className="metric num">{hours}</span>
                <span style={{ fontSize: 11 }} className="dim">hours</span>
                <span className="metric num">{minutes}</span>
                <span style={{ fontSize: 11 }} className="dim">minutes</span>
              </div>
              {activity.data && <ActivityChart days={activity.data} />}
            </Card>

            <Card title="Performance" action={<Dropdown label="Last 6 Months" />} style={{ width: 396, minHeight: 286 }}>
              {performance.data && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <ScoreGauge performance={performance.data} />
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {SERIES_LABELS.map((s) => (
                        <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="swatch" style={{ background: s.color }} />
                          <span style={{ flex: 1, fontSize: 11 }} className="muted">{s.label}</span>
                          <span style={{ fontSize: 11, fontWeight: 600 }}>{performance.data.breakdown[s.key]}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <TrendLine points={performance.data.trend} />
                  <div className="callout">
                    Success is the sum of small efforts, repeated day in and day out. Keep pushing forward.
                  </div>
                </>
              )}
            </Card>
          </div>

          <Card
            title="Enrolled Courses"
            style={{ flex: 1 }}
            action={
              <>
                <Dropdown label="All Status" />
                <button type="button" className="btn btn-blue">View All</button>
              </>
            }
          >
            {(courses.data ?? []).slice(0, 4).map((course) => (
              <div key={course.id} className="card-row">
                <Tile size={40} tone={course.status === 'completed' ? 'blue' : 'pink'}>
                  <span style={{ fontSize: 11, fontWeight: 600 }}>
                    {course.title.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
                  </span>
                </Tile>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{course.title}</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ fontSize: 10, color: 'var(--pink-ink)', textTransform: 'capitalize' }}>{course.category}</span>
                    <span style={{ fontSize: 10, textTransform: 'capitalize' }} className="dim">{course.level}</span>
                  </div>
                </div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11 }} className="muted">
                  <Icon name="play" size={13} strokeWidth={1.9} color="var(--ink-3)" />
                  {course.lessonCount}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11 }} className="muted">
                  <Icon name="clock" size={13} strokeWidth={1.9} color="var(--ink-3)" />
                  {durationLabel(course.durationMinutes)}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ProgressRing value={course.progress} />
                  <span style={{ fontSize: 11 }} className="muted">{course.progress}%</span>
                </div>
                {course.status === 'completed' ? <Chip tone="green">Completed</Chip> : <Chip tone="yellow">Ongoing</Chip>}
                <span style={{ fontSize: 13, fontWeight: 600, width: 54, textAlign: 'right' }} className="num">
                  {course.score ?? '—'}
                  {course.score !== null && <span style={{ fontSize: 9, fontWeight: 400 }} className="dim">/100</span>}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 96 }}>
                  <span style={{ fontSize: 9 }} className="dim">Certificate:</span>
                  {course.certificateUrl ? (
                    <a href={course.certificateUrl} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10 }}>
                      <Icon name="file" size={11} strokeWidth={1.9} />
                      Download
                    </a>
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10 }} className="muted">
                      <Icon name="file" size={11} strokeWidth={1.9} color="#c9c9d4" />
                      None
                    </span>
                  )}
                </div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </Page>
  );
}

function ContactRow({
  tone,
  icon,
  label,
  value,
}: {
  tone: 'pink' | 'yellow' | 'blue';
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span
        className="avatar"
        style={{
          width: 28,
          height: 28,
          background: tone === 'pink' ? 'var(--pink-tint)' : tone === 'yellow' ? 'var(--yellow-tint)' : 'var(--blue-tint)',
          color: tone === 'pink' ? 'var(--pink-ink)' : tone === 'yellow' ? 'var(--yellow-ink)' : 'var(--blue-ink)',
        }}
      >
        <Icon name={icon} size={13} strokeWidth={1.9} />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ fontSize: 10 }} className="dim">{label}</span>
        <span style={{ fontSize: 11 }}>{value}</span>
      </div>
    </div>
  );
}
