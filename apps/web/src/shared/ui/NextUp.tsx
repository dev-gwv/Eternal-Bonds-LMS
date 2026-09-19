import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api, dayHeading, timeRange } from '../api.ts';
import { Card, EmptyState } from './primitives.tsx';

/**
 * The next workshop, from the real schedule.
 *
 * This card used to be a hardcoded title with a hardcoded "Live in 14m" and a
 * button that did nothing. The countdown is the part worth getting right: a
 * member glances at it to decide whether to go and make tea, so it ticks, and
 * it changes state at the moment the session actually starts.
 *
 * The join link only exists for members who registered — the API withholds it
 * otherwise — so the button reflects that rather than pretending.
 */

function countdown(startsAt: string, endsAt: string): { label: string; live: boolean } | null {
  const now = Date.now();
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);

  if (now >= end) return null;
  if (now >= start) return { label: 'Live now', live: true };

  const minutes = Math.round((start - now) / 60_000);
  if (minutes < 60) return { label: `Starts in ${Math.max(1, minutes)}m`, live: minutes <= 15 };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { label: `Starts in ${hours}h`, live: false };
  return { label: `In ${Math.round(hours / 24)} days`, live: false };
}

export function NextUp() {
  const workshops = useQuery({ queryKey: ['workshops', 'upcoming'], queryFn: () => api.workshops('upcoming') });

  // Re-render every 30s so the countdown does not freeze at whatever it said
  // when the page loaded. Cheap: it is one small component.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const next = (workshops.data ?? []).find((w) => Date.parse(w.endsAt) > Date.now());

  if (!next) {
    return (
      <Card title="Next up">
        <EmptyState
          icon="workshops"
          title="Nothing scheduled"
          hint="Live workshops appear here as soon as one is on the calendar."
        />
      </Card>
    );
  }

  const state = countdown(next.startsAt, next.endsAt);

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="card-title" style={{ flex: 1 }}>Next up</span>
        {state && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 10,
              fontWeight: 500,
              color: state.live ? 'var(--green-ink)' : 'var(--ink-3)',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: state.live ? 'var(--green-ink)' : 'var(--ink-4)',
              }}
            />
            {state.label}
          </span>
        )}
      </div>

      <span style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.35 }}>{next.title}</span>
      <span style={{ fontSize: 10 }} className="dim">
        {dayHeading(next.startsAt)} · {timeRange(next.startsAt, next.endsAt)}
      </span>

      {next.registered && next.joinUrl ? (
        <a
          href={next.joinUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="btn btn-blue btn-sq"
          style={{ padding: 9 }}
        >
          Join the call
        </a>
      ) : (
        // Registration lives on the Workshops page, which also explains the
        // session. Duplicating the action here would duplicate the state.
        <Link to="/workshops" className="btn btn-soft btn-sq" style={{ padding: 9 }}>
          {next.registered ? 'Join link comes closer to the time' : 'Register'}
        </Link>
      )}
    </Card>
  );
}
