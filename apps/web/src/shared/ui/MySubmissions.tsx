import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api, relativeTime } from '../api.ts';
import { Chip } from './primitives.tsx';

/**
 * Wins the member has submitted, including the ones still in review.
 *
 * Submitting a first win ended at "In review" and then nothing. The board does
 * not show a pending win and no page listed it, so the only way to learn it
 * had survived was to notice it appear one day. Somebody who has just written
 * six paragraphs about how they doubled their close rate deserves better than
 * silence — and the ones who get silence do not write a second.
 */
export function MySubmissions() {
  const mine = useQuery({ queryKey: ['my-submissions'], queryFn: api.mySubmissions, staleTime: 60_000 });
  const items = mine.data ?? [];
  if (items.length === 0) return null;

  const pending = items.filter((w) => w.status === 'pending').length;

  return (
    <>
      <span className="section-label">Your submissions</span>
      {pending > 0 && (
        <div className="callout">
          {pending === 1 ? 'One win is' : `${pending} wins are`} waiting for review. First wins are read by a
          moderator; after that yours publish straight away.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {items.map((w) => {
          const row = (
            <>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500 }}>{w.title}</span>
              <span style={{ fontSize: 10 }} className="dim">
                {relativeTime(w.createdAt)} ago
              </span>
              {w.status === 'published' ? (
                <Chip tone="green">Live</Chip>
              ) : w.status === 'pending' ? (
                <Chip tone="yellow">In review</Chip>
              ) : (
                // Named rather than hidden. A member whose win was taken down
                // should be able to see that, not quietly wonder.
                <Chip tone="pink">Not shown</Chip>
              )}
            </>
          );

          // Only a published win has a page to open.
          return w.status === 'published' ? (
            <Link
              key={w.id}
              to="/wins/$slug"
              params={{ slug: w.slug }}
              className="card-row lift"
              style={{ color: 'inherit', gap: 10 }}
            >
              {row}
            </Link>
          ) : (
            <div key={w.id} className="card-row" style={{ gap: 10 }}>
              {row}
            </div>
          );
        })}
      </div>
    </>
  );
}
