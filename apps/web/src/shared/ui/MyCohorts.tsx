import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api } from '../api.ts';
import { Card, Chip, Icon } from './primitives.tsx';

/**
 * The schedule a member is actually on.
 *
 * Cohorts have gated the drip since they were built and have been sending
 * unlock notices for weeks that members had no way to look at: "Week two is
 * open" arriving about a timetable that existed nowhere in their interface.
 * This is that timetable.
 *
 * It shows the *cohort's* dates rather than a personalised set. Everybody in a
 * January group reaches week three on the same day, and giving each person
 * their own version would undo the one thing a cohort is for — the sense that
 * other people are at the same place.
 */
export function MyCohorts() {
  const cohorts = useQuery({ queryKey: ['my-cohorts'], queryFn: api.myCohorts, staleTime: 5 * 60_000 });
  const items = cohorts.data ?? [];
  if (items.length === 0) return null;

  return (
    <>
      <span className="section-label">Your group</span>
      {items.map((c) => {
        const notStarted = c.dayNumber < 1;
        const nextUp = c.schedule.find((s) => !s.open);

        return (
          <Card key={c.id}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</span>
                  {notStarted ? (
                    <Chip tone="blue">Starts {c.startsOn}</Chip>
                  ) : (
                    <Chip tone="green">Day {c.dayNumber}</Chip>
                  )}
                </span>
                <span style={{ fontSize: 11 }} className="muted">
                  {c.courseTitle} · {c.memberCount} member{c.memberCount === 1 ? '' : 's'} on the same schedule
                </span>
              </span>

              <Link
                to="/courses/$slug"
                params={{ slug: c.courseSlug }}
                className="btn btn-pink"
                style={{ color: '#fff' }}
              >
                <Icon name="play" size={13} />
                Continue
              </Link>
            </div>

            <span style={{ display: 'block', height: 5, borderRadius: 999, background: 'var(--track)' }}>
              <span
                style={{
                  display: 'block',
                  width: `${c.progress}%`,
                  height: '100%',
                  borderRadius: 999,
                  background: 'var(--pink)',
                }}
              />
            </span>
            <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }} className="dim">
              <span className="num">
                {c.lessonsDone} of {c.lessonsTotal} lessons · {c.progress}%
              </span>
              {c.endsOn && <span>Wraps up {c.endsOn}</span>}
            </span>

            {/* The timetable: what opened, what is next, and when. That is the
                entire reason to be in a cohort rather than alone. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, paddingTop: 4 }}>
              {c.schedule.map((s) => (
                <div key={s.title} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 11.5 }}>
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 999,
                      flexShrink: 0,
                      display: 'grid',
                      placeItems: 'center',
                      background: s.open ? 'var(--green)' : 'var(--soft)',
                      border: s.open ? 'none' : '1px solid var(--hair)',
                    }}
                  >
                    {s.open && <Icon name="check" size={9} strokeWidth={3.4} color="#fff" />}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, color: s.open ? 'var(--ink)' : 'var(--ink-3)' }}>
                    {s.title}
                  </span>
                  <span style={{ fontSize: 10 }} className="dim">
                    {s.opensOn === null ? 'Open' : s.open ? 'Opened' : `Opens ${s.opensOn}`}
                  </span>
                </div>
              ))}
            </div>

            {nextUp?.opensOn && (
              <span style={{ fontSize: 11 }} className="muted">
                Next up: {nextUp.title}, on {nextUp.opensOn}. You will be told when it opens.
              </span>
            )}
          </Card>
        );
      })}
    </>
  );
}
