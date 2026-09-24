import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api } from '../api.ts';
import { Card, Chip, Icon } from './primitives.tsx';

/**
 * The path the member chose, on the page they land on.
 *
 * Journeys answer "what do I do first?" and then, until now, immediately
 * forgot the answer: picking one navigated and recorded nothing, so the next
 * morning the dashboard looked exactly as it did before — eighteen courses and
 * no route through them. A path you have to go and find again is not a path.
 *
 * One at a time on purpose. A member may follow several, but showing three
 * here would recreate the problem journeys exist to solve; the most recently
 * chosen unfinished one is the one they meant.
 */
export function MyPath() {
  const journeys = useQuery({ queryKey: ['journeys'], queryFn: api.journeys, staleTime: 60_000 });

  const mine = (journeys.data ?? [])
    .filter((j) => j.following && j.progress < 100)
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
  const j = mine[0];
  if (!j) return null;

  return (
    <>
      <span className="section-label">Your path</span>
      <Card>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <Link to="/journeys/$slug" params={{ slug: j.slug }} style={{ fontSize: 13, fontWeight: 600, color: 'inherit' }}>
                {j.title}
              </Link>
              <Chip tone="pink">
                {j.stepsDone} of {j.stepCount}
              </Chip>
            </span>
            <span style={{ fontSize: 11 }} className="muted">
              {j.promise}
            </span>
          </span>

          {/* Straight into the course, not to the journey page. Somebody who
              already knows which path they are on does not need to be shown
              the path again before they can press play. */}
          {j.nextCourseSlug && (
            <Link
              to="/courses/$slug"
              params={{ slug: j.nextCourseSlug }}
              className="btn btn-pink"
              style={{ color: '#fff' }}
            >
              <Icon name="play" size={13} />
              {j.progress > 0 ? 'Continue' : 'Start'}
            </Link>
          )}
        </div>

        <span style={{ display: 'block', height: 5, borderRadius: 999, background: 'var(--track)' }}>
          <span
            style={{
              display: 'block',
              width: `${j.progress}%`,
              height: '100%',
              borderRadius: 999,
              background: 'var(--pink)',
            }}
          />
        </span>
        {j.nextCourseTitle && (
          <span style={{ fontSize: 10.5 }} className="dim">
            {j.progress > 0 ? 'Next' : 'Starts with'}: {j.nextCourseTitle}
          </span>
        )}
      </Card>
    </>
  );
}
