import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import type { Challenge } from '@ipc/contracts';
import { api, relativeTime } from '../shared/api.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { Avatar, Card, Chip, EmptyState, Hero, Icon } from '../shared/ui/primitives.tsx';
import { LoadingLabel, SkeletonCard } from '../shared/ui/Skeleton.tsx';

/**
 * A prompt with a deadline.
 *
 * The wins board has existed since the beginning and nothing ever asked
 * anybody to use it. An empty box captioned "share a win" is a blank page, and
 * a blank page with no deadline is something everyone intends to fill later.
 * This page is the opposite of a blank page: one question, one week, and the
 * other entries visible underneath so nobody is posting into silence.
 *
 * Entering opens the ordinary win form. An entry *is* a win — same
 * photographs, same comments, same board afterwards — which is why a challenge
 * keeps paying after it closes, and why a member only ever learns one way to
 * post their work.
 */

function Countdown({ c }: { c: Challenge }) {
  if (c.status === 'closed') return <Chip>Closed</Chip>;
  if (c.status === 'draft') return <Chip tone="yellow">Draft</Chip>;
  if (c.daysLeft < 0) return <Chip>Ended</Chip>;
  if (c.daysLeft === 0) return <Chip tone="pink">Last day</Chip>;
  return (
    <Chip tone={c.daysLeft <= 2 ? 'pink' : 'green'}>
      {c.daysLeft} day{c.daysLeft === 1 ? '' : 's'} left
    </Chip>
  );
}

function ChallengeCard({ c }: { c: Challenge }) {
  return (
    <div className="card lift card-linked" style={{ padding: '16px 18px', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <Link
          to="/challenges/$slug"
          params={{ slug: c.slug }}
          className="stretch-link"
          style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, color: 'inherit' }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{c.title}</span>
            <Countdown c={c} />
            {c.minTier !== 'free' && <Chip tone="pink">{c.minTier}</Chip>}
          </span>
          {/* The prompt, not the title, is what makes somebody pick up a camera. */}
          <span style={{ fontSize: 12.5, lineHeight: 1.55 }} className="muted">
            {c.prompt}
          </span>
        </Link>
      </div>

      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, flexWrap: 'wrap' }} className="dim">
        <span className="num">
          {c.entryCount} {c.entryCount === 1 ? 'entry' : 'entries'}
        </span>
        {c.myEntrySlug && (
          <>
            <span>·</span>
            <span style={{ color: 'var(--green-ink)' }}>You are in this one</span>
          </>
        )}
        {c.winner && (
          <>
            <span>·</span>
            <span>Won by {c.winner.authorName}</span>
          </>
        )}
        <span style={{ flex: 1 }} />
        {c.canEnter && (
          <Link
            to="/wins/submit"
            search={{ challenge: c.slug }}
            className="btn btn-pink above-link"
            style={{ color: '#fff' }}
          >
            Enter
          </Link>
        )}
      </span>
    </div>
  );
}

export function ChallengesPage() {
  const challenges = useQuery({ queryKey: ['challenges'], queryFn: api.challenges });
  const items = challenges.data ?? [];
  const open = items.filter((c) => c.status === 'open');
  const past = items.filter((c) => c.status !== 'open');

  return (
    <Page>
      <Hero
        tone="rose"
        eyebrow="Challenges · One prompt at a time"
        title="Something to shoot this week."
        sub="A question with a deadline, answered by everybody at once. Your entry lands on the wins board like any other — it just has company."
      />

      {challenges.isPending && (
        <>
          <LoadingLabel>Loading challenges</LoadingLabel>
          <SkeletonCard />
        </>
      )}

      {!challenges.isPending && items.length === 0 && (
        <Card>
          <EmptyState
            icon="heart"
            title="No challenges yet"
            hint="When one opens you will hear about it. In the meantime the wins board takes anything, any time."
          />
          <Link to="/wins" className="btn btn-soft" style={{ alignSelf: 'flex-start' }}>
            The wins board
          </Link>
        </Card>
      )}

      {open.length > 0 && (
        <>
          <span className="section-label">Open now</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {open.map((c) => (
              <ChallengeCard key={c.id} c={c} />
            ))}
          </div>
        </>
      )}

      {past.length > 0 && (
        <>
          <span className="section-label">Finished</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {past.map((c) => (
              <ChallengeCard key={c.id} c={c} />
            ))}
          </div>
        </>
      )}
    </Page>
  );
}

export function ChallengeDetailPage() {
  const { slug } = useParams({ from: '/challenges/$slug' });
  const challenge = useQuery({ queryKey: ['challenge', slug], queryFn: () => api.challenge(slug) });

  if (challenge.isPending) {
    return (
      <Page>
        <SkeletonCard />
        <SkeletonCard lines={4} />
      </Page>
    );
  }
  if (challenge.error || !challenge.data) {
    return (
      <Page>
        <Card>
          <EmptyState icon="heart" title="That challenge is not here" />
          <Link to="/challenges" className="btn btn-soft" style={{ alignSelf: 'flex-start' }}>
            All challenges
          </Link>
        </Card>
      </Page>
    );
  }

  const c = challenge.data;

  return (
    <Page>
      <PageHeader
        title={c.title}
        back="/challenges"
        crumbs={[{ label: 'Challenges', to: '/challenges' }, { label: c.title }]}
        actions={
          c.canEnter ? (
            <Link to="/wins/submit" search={{ challenge: c.slug }} className="btn btn-pink" style={{ color: '#fff' }}>
              <Icon name="plus" size={13} />
              Enter
            </Link>
          ) : c.myEntrySlug ? (
            <Link to="/wins/$slug" params={{ slug: c.myEntrySlug }} className="btn btn-soft">
              Your entry
            </Link>
          ) : undefined
        }
      />

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 200, fontSize: 14, fontWeight: 600 }}>{c.prompt}</span>
          <Countdown c={c} />
        </div>
        <span style={{ fontSize: 11 }} className="dim num">
          {c.startsOn} — {c.endsOn} · {c.entryCount} {c.entryCount === 1 ? 'entry' : 'entries'}
        </span>
        {c.briefMd && (
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.7, whiteSpace: 'pre-wrap' }} className="muted">
            {c.briefMd}
          </p>
        )}
      </Card>

      {/* Why the button is not there, rather than no button and no reason. */}
      {!c.canEnter && !c.myEntrySlug && c.status === 'open' && (
        <div className="callout">
          {c.daysLeft < 0
            ? 'This one has ended. The entries are below, and there will be another.'
            : `This challenge is for ${c.minTier} members and above.`}
        </div>
      )}
      {c.myEntrySlug && c.status === 'open' && (
        <div className="callout callout-green">
          <strong>You are in this one.</strong> One entry each, so the board stays a gallery rather than a feed.
        </div>
      )}

      <span className="section-label">
        {c.entries.length > 0 ? 'The entries' : 'Nobody has entered yet'}
      </span>

      {c.entries.length === 0 ? (
        <Card>
          <EmptyState
            icon="heart"
            title={c.canEnter ? 'Be the first' : 'No entries'}
            hint={
              c.canEnter
                ? 'Somebody has to go first, and the first entry is the one that makes the rest feel possible.'
                : 'This one closed without any.'
            }
          />
        </Card>
      ) : (
        <div className="grid grid-3">
          {c.entries.map((e) => (
            <Link
              key={e.winSlug}
              to="/wins/$slug"
              params={{ slug: e.winSlug }}
              className="card lift"
              style={{ color: 'inherit', padding: 0, overflow: 'hidden', gap: 0 }}
            >
              {e.coverUrl ? (
                <img
                  src={e.coverUrl}
                  alt=""
                  loading="lazy"
                  style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <span
                  style={{
                    width: '100%',
                    aspectRatio: '4 / 3',
                    display: 'grid',
                    placeItems: 'center',
                    background: 'var(--soft)',
                  }}
                >
                  <Icon name="image" size={22} color="var(--ink-4)" />
                </span>
              )}
              <span style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600 }}>{e.title}</span>
                  {e.isWinner && <Chip tone="green">Winner</Chip>}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <Avatar initials={e.authorInitials} size={20} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 10.5 }} className="dim">
                    {e.authorName} · {relativeTime(e.createdAt)}
                  </span>
                  <span style={{ fontSize: 10.5, display: 'inline-flex', alignItems: 'center', gap: 4 }} className="dim">
                    <Icon name="heart" size={11} />
                    {e.reactions}
                  </span>
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}
