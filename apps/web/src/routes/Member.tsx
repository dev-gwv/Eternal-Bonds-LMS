import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api, durationLabel, hoursMinutes } from '../shared/api.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { ActivityChart, ProgressRing, ScoreGauge, TrendLine } from '../shared/ui/charts.tsx';
import { Card, Chip, Dropdown, Icon, Tile } from '../shared/ui/primitives.tsx';
import { MyCohorts } from '../shared/ui/MyCohorts.tsx';
import { MySubmissions } from '../shared/ui/MySubmissions.tsx';

const SERIES_LABELS = [
  { key: 'consistency', label: 'Consistency · active days', color: 'var(--s1)' },
  { key: 'completion', label: 'Completion · lessons finished', color: 'var(--s2)' },
  { key: 'streak', label: 'Streak · longest run', color: 'var(--s3)' },
] as const;

const CONTACT_TONE = { email: 'pink', phone: 'yellow', address: 'blue' } as const;

export function MemberPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const activity = useQuery({ queryKey: ['activity'], queryFn: api.activity });
  const performance = useQuery({ queryKey: ['performance'], queryFn: api.performance });
  const courses = useQuery({ queryKey: ['courses'], queryFn: () => api.courses() });
  const certificates = useQuery({ queryKey: ['certificates'], queryFn: api.certificates, retry: false });
  const badges = useQuery({ queryKey: ['badges'], queryFn: api.badges, retry: false });

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
        <div className="card" style={{ width: 'min(286px, 100%)', flexShrink: 0, padding: 14, gap: 14 }}>
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
                color: 'var(--yellow-deep)',
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
{/* mailto: and tel: rather than buttons — the phone already knows what to
                do with both, and a button that opens nothing is worse than no
                button. Disabled when the member has not given us the detail. */}
            <a
              href={member?.email ? `mailto:${member.email}` : undefined}
              className="icon-btn btn-sq"
              aria-label={member?.email ? `Email ${member.fullName}` : 'No email on file'}
              aria-disabled={!member?.email}
              style={{
                width: 38, height: 38, background: 'var(--panel)', border: '1px solid #ececf1',
                color: 'inherit', opacity: member?.email ? 1 : 0.4,
                pointerEvents: member?.email ? 'auto' : 'none',
              }}
            >
              <Icon name="mail" />
            </a>
            <a
              href={member?.phone ? `tel:${member.phone.replace(/\s+/g, '')}` : undefined}
              className="icon-btn btn-sq"
              aria-label={member?.phone ? `Call ${member.fullName}` : 'No phone on file'}
              aria-disabled={!member?.phone}
              style={{
                width: 38, height: 38, background: 'var(--panel)', border: '1px solid #ececf1',
                color: 'inherit', opacity: member?.phone ? 1 : 0.4,
                pointerEvents: member?.phone ? 'auto' : 'none',
              }}
            >
              <Icon name="phone" />
            </a>
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
                <span className="tile" style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--soft)', color: 'var(--ink-2)', fontSize: 10, fontWeight: 600 }}>
                  {s.network.slice(0, 2).toLowerCase()}
                </span>
                <span style={{ flex: 1, fontSize: 11 }}>{s.network}</span>
                <span style={{ fontSize: 11 }} className="dim">{s.handle}</span>
              </div>
            ))}
          </div>

          <Link to="/settings" className="btn btn-soft btn-sq" style={{ marginTop: 'auto', padding: 11, fontSize: 12, color: 'inherit' }}>
            <Icon name="edit" size={14} strokeWidth={1.9} />
            Account settings
          </Link>
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

            <Card title="Momentum" action={<Dropdown label="Last 6 Months" />} style={{ width: 'min(396px, 100%)', minHeight: 286 }}>
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
              <Link to="/courses" className="btn btn-soft" style={{ color: 'inherit' }}>
                View all
              </Link>
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

          <Card title="Certificates & badges" style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(certificates.data ?? []).map((c) => (
                <span key={c.id} className="btn btn-soft" title={`${c.courseTitle} · ${c.code}`}>
                  🎓 {c.courseTitle}
                </span>
              ))}
              {(badges.data ?? []).filter((b) => b.earned).map((b) => (
                <span key={b.id} className="btn btn-soft" title={b.description ?? b.name}>🏅 {b.name}</span>
              ))}
              {(certificates.data ?? []).length === 0 && (badges.data ?? []).filter((b) => b.earned).length === 0 && (
                <span className="muted" style={{ fontSize: 12 }}>
                  Finish a course for a certificate — members post them, and that's free distribution.
                </span>
              )}
            </div>
            <Link to="/legal" style={{ fontSize: 11 }}>Privacy & Terms</Link>
          </Card>
        </div>
      </div>

      <MyCohorts />
      <MySubmissions />
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
