import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api } from '../api.ts';
import { Card, Chip, Icon } from './primitives.tsx';

/**
 * This week's prompt, on the page everybody lands on.
 *
 * A challenge only works if it is unavoidable. Put it one click away on a
 * /challenges page and it becomes a thing members discover on Thursday, by
 * which point the week is gone — and the whole mechanism is that everybody
 * answers the same question at the same time.
 *
 * One at a time, the one closing soonest. Two prompts is no prompt.
 */
export function OpenChallenge() {
  const challenges = useQuery({ queryKey: ['challenges'], queryFn: api.challenges, staleTime: 5 * 60_000 });

  const open = (challenges.data ?? [])
    .filter((c) => c.status === 'open' && c.daysLeft >= 0)
    .sort((a, b) => a.daysLeft - b.daysLeft);
  const c = open[0];
  if (!c) return null;

  return (
    <>
      <span className="section-label">This week</span>
      <Card>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <Link
                to="/challenges/$slug"
                params={{ slug: c.slug }}
                style={{ fontSize: 13, fontWeight: 600, color: 'inherit' }}
              >
                {c.title}
              </Link>
              <Chip tone={c.daysLeft <= 2 ? 'pink' : 'green'}>
                {c.daysLeft === 0 ? 'Last day' : `${c.daysLeft} day${c.daysLeft === 1 ? '' : 's'} left`}
              </Chip>
            </span>
            <span style={{ fontSize: 12, lineHeight: 1.55 }} className="muted">
              {c.prompt}
            </span>
            <span style={{ fontSize: 10.5 }} className="dim num">
              {c.entryCount} {c.entryCount === 1 ? 'entry' : 'entries'} so far
            </span>
          </span>

          {/* Straight into the form. Somebody who has read the prompt and
              decided does not need to read the challenge page first. */}
          {c.canEnter ? (
            <Link
              to="/wins/submit"
              search={{ challenge: c.slug }}
              className="btn btn-pink"
              style={{ color: '#fff' }}
            >
              <Icon name="plus" size={13} />
              Enter
            </Link>
          ) : c.myEntrySlug ? (
            <Link to="/challenges/$slug" params={{ slug: c.slug }} className="btn btn-soft">
              <Icon name="check" size={13} strokeWidth={3} />
              You are in
            </Link>
          ) : (
            <Link to="/challenges/$slug" params={{ slug: c.slug }} className="btn btn-soft">
              See the entries
            </Link>
          )}
        </div>
      </Card>
    </>
  );
}
