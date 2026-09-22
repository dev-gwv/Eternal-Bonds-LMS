import { Link } from '@tanstack/react-router';
import type { ContinueItem } from '@ipc/contracts';
import { relativeTime } from '../api.ts';
import { Icon } from './primitives.tsx';

/**
 * Pick up where you left off.
 *
 * `enrollments.last_lesson_id` has held this answer since the first migration
 * and nothing ever read it, so a member returning after a week landed on a
 * dashboard of charts and had to remember which course, which module, which
 * lesson. That recall cost is most of the reason people do not come back, and
 * removing it is the cheapest retention work in the app.
 *
 * The first card is wide and the rest are small on purpose: there is usually
 * one right answer, and a row of four equal cards makes the member choose
 * again — which is the decision they came here to avoid.
 */

function Bar({ progress, tone = 'var(--pink)' }: { progress: number; tone?: string }) {
  return (
    <span style={{ display: 'block', height: 5, borderRadius: 999, background: 'var(--track)', overflow: 'hidden' }}>
      <span style={{ display: 'block', width: `${progress}%`, height: '100%', borderRadius: 999, background: tone }} />
    </span>
  );
}

function subtitle(item: ContinueItem) {
  if (!item.lastActivityAt) return 'Enrolled — not opened yet';
  const where = item.lessonTitle ? `Stopped on “${item.lessonTitle}”` : 'In progress';
  return `${where} · ${relativeTime(item.lastActivityAt)} ago`;
}

export function ContinueRail({ items }: { items: ContinueItem[] }) {
  if (items.length === 0) return null;
  const [first, ...rest] = items;
  if (!first) return null;

  return (
    <>
      <span className="section-label">Pick up where you left off</span>

      <Link
        to="/courses/$slug"
        params={{ slug: first.courseSlug }}
        className="card lift"
        style={{ color: 'inherit', textDecoration: 'none', padding: '16px 18px', gap: 10 }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{first.courseTitle}</span>
            <span style={{ fontSize: 11 }} className="muted">
              {subtitle(first)}
            </span>
          </span>
          <span className="btn btn-pink" style={{ flexShrink: 0, pointerEvents: 'none' }}>
            <Icon name="play" size={13} />
            {first.lastActivityAt ? 'Resume' : 'Start'}
          </span>
        </div>

        <Bar progress={first.progress} />
        <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }} className="dim">
          <span className="num">
            {first.lessonsDone} of {first.lessonsTotal} lessons · {first.progress}%
          </span>
          {first.minutesLeft !== null && <span className="num">{first.minutesLeft} min left</span>}
        </span>
      </Link>

      {rest.length > 0 && (
        <div className="grid grid-3">
          {rest.map((item) => (
            <Link
              key={item.courseId}
              to="/courses/$slug"
              params={{ slug: item.courseSlug }}
              className="card lift"
              style={{ color: 'inherit', textDecoration: 'none', padding: '12px 14px', gap: 8 }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.35 }}>{item.courseTitle}</span>
              <Bar progress={item.progress} tone="var(--blue)" />
              <span style={{ fontSize: 10 }} className="dim num">
                {item.progress}%
                {item.minutesLeft !== null ? ` · ${item.minutesLeft} min left` : ''}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
