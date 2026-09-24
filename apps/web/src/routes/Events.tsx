import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, getRouteApi } from '@tanstack/react-router';
import { api, relativeTime, timeRange } from '../shared/api.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { Card, Chip, EmptyState, Hero } from '../shared/ui/primitives.tsx';
import { ConfirmButton } from '../shared/ui/ConfirmButton.tsx';
import { Gallery } from '../shared/ui/Gallery.tsx';
import { ReportButton } from '../shared/ui/ReportButton.tsx';
import { SkeletonCard, LoadingLabel } from '../shared/ui/Skeleton.tsx';

export function EventsPage() {
  const qc = useQueryClient();
  const events = useQuery({ queryKey: ['events'], queryFn: api.events });
  const rsvp = useMutation({
    mutationFn: ({ id, rsvpd }: { id: string; rsvpd: boolean }) => api.rsvpEvent(id, rsvpd),
    onSettled: () => qc.invalidateQueries({ queryKey: ['events'] }),
  });
  return (
    <Page>
      <Hero
        tone="sky"
        eyebrow="Live sessions · Every week"
        title="Be in the room."
        sub="The weekly featured-insight session, workshops and calls — RSVP and the join link appears here."
      />
      <span className="section-label">Upcoming</span>
      {events.isPending ? <SkeletonCard /> : events.isError ? <LoadingLabel>Something went wrong</LoadingLabel> :
        events.data.length === 0 ? <EmptyState title="No sessions scheduled" hint="The weekly featured-insight session appears here." /> :
        events.data.map((e) => (
          <Card key={e.id}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 220 }}>
                <strong style={{ fontSize: 13 }}>{e.title}</strong>
                {e.isFeaturedSession && <span className="nav-soon" style={{ marginLeft: 8 }}>Featured session</span>}
                <span style={{ display: 'block', fontSize: 11 }} className="muted">{timeRange(e.startsAt, e.endsAt)} · {e.rsvpCount} going</span>
                {e.featuredInsights.length > 0 && (
                  <span style={{ display: 'block', fontSize: 11 }} className="muted">
                    Featuring: {e.featuredInsights.map((i) => i.title).join(' · ')}
                  </span>
                )}
              </span>
              {/* A past session with a recording is the point of the whole
                  ritual: it stops being an hour that happened and becomes
                  something a member who joined in March can still watch. */}
              {e.recordingCourseSlug && e.recordingLessonSlug ? (
                <Link
                  className="btn btn-pink"
                  to="/learn/$courseSlug/$lessonSlug"
                  params={{ courseSlug: e.recordingCourseSlug, lessonSlug: e.recordingLessonSlug }}
                  style={{ color: '#fff' }}
                >
                  Watch the recording
                </Link>
              ) : e.rsvpd && e.joinUrl ? (
                <a className="btn btn-pink" href={e.joinUrl} target="_blank" rel="noreferrer">Join</a>
              ) : new Date(e.endsAt).getTime() < Date.now() ? (
                <span style={{ fontSize: 11 }} className="dim">
                  Finished — recording not posted yet
                </span>
              ) : (
                /* Cancelling confirms; saying yes does not. Cancelling gives
                   up a seat that may be the last one, and on a phone this
                   button sits exactly where the RSVP button was a moment ago. */
                e.rsvpd ? (
                  <ConfirmButton
                    label="Cancel RSVP"
                    confirmLabel="Give up my seat"
                    className="btn btn-soft"
                    disabled={rsvp.isPending}
                    onConfirm={() => rsvp.mutate({ id: e.id, rsvpd: false })}
                  />
                ) : (
                  <button className="btn btn-soft" disabled={rsvp.isPending}
                    onClick={() => rsvp.mutate({ id: e.id, rsvpd: true })}>
                    RSVP
                  </button>
                )
              )}
            </div>
          </Card>
        ))}
    </Page>
  );
}

const winRoute = getRouteApi('/wins/$slug');

export function WinDetailPage() {
  const { slug } = winRoute.useParams();
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const win = useQuery({ queryKey: ['win', slug], queryFn: () => api.win(slug) });
  const id = win.data?.id;

  const comments = useQuery({
    queryKey: ['win-comments', id],
    queryFn: () => api.winComments(id!),
    enabled: Boolean(id),
  });

  const add = useMutation({
    mutationFn: (bodyMd: string) => api.addWinComment(id!, bodyMd),
    onSuccess: () => {
      setDraft('');
      void qc.invalidateQueries({ queryKey: ['win-comments', id] });
      void qc.invalidateQueries({ queryKey: ['win', slug] });
    },
  });

  const react = useMutation({
    mutationFn: (r: boolean) => api.reactWin(id!, r),
    onSettled: () => qc.invalidateQueries({ queryKey: ['win', slug] }),
  });

  return (
    <Page>
      <PageHeader title="Win" crumbs={[{ label: 'Wins', to: '/wins' }, { label: slug }]} />
      {win.isPending ? (
        <SkeletonCard />
      ) : win.isError ? (
        <LoadingLabel>Something went wrong</LoadingLabel>
      ) : (
        <>
          <Card>
            <h2 style={{ marginTop: 0 }}>{win.data.title}</h2>
            <p style={{ fontSize: 12 }} className="muted">
              By {win.data.author.name} · {win.data.category}
              {win.data.occurredOn ? ` · ${win.data.occurredOn}` : ''}
            </p>

            {/* Proof first, prose after — it is what a member scrolled here for. */}
            {win.data.media.length > 0 && <Gallery media={win.data.media} />}

            <h4>The big idea</h4>
            <p style={{ fontSize: 12, lineHeight: 1.7 }}>{win.data.bigIdeaMd}</p>
            <h4>How it happened</h4>
            <p style={{ fontSize: 12, lineHeight: 1.7 }}>{win.data.howItHappenedMd}</p>

            {win.data.tags.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {win.data.tags.map((t) => (
                  <Chip key={t}>{t}</Chip>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--softer)' }}>
              <button
                className="btn btn-soft"
                disabled={react.isPending}
                onClick={() => react.mutate(!win.data.reactedByMe)}
              >
                ♥ {win.data.reactions}
              </button>
              <span style={{ flex: 1 }} />
              <ReportButton targetType="win" targetId={win.data.id} />
            </div>
          </Card>

          <Card title={`Discussion (${comments.data?.length ?? win.data.comments})`}>
            <form
              style={{ display: 'flex', gap: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim()) add.mutate(draft.trim());
              }}
            >
              <input
                className="input"
                style={{ flex: 1 }}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask how they did it, or say what you would copy"
                aria-label="Add a comment"
              />
              <button type="submit" className="btn btn-pink" disabled={!draft.trim() || add.isPending}>
                {add.isPending ? 'Posting…' : 'Comment'}
              </button>
            </form>
            {add.isError && <span className="field-error">{(add.error as Error).message}</span>}

            {comments.isPending && <LoadingLabel>Loading the discussion</LoadingLabel>}
            {comments.data?.length === 0 && (
              <span style={{ fontSize: 11 }} className="dim">
                Nobody has replied yet. The first question is usually the useful one.
              </span>
            )}
            {comments.data?.map((c) => (
              <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600 }}>
                  {c.authorName}
                  <span style={{ fontWeight: 400, marginLeft: 6 }} className="dim">
                    {relativeTime(c.createdAt)}
                  </span>
                </span>
                <span style={{ fontSize: 12, lineHeight: 1.6 }}>{c.bodyMd}</span>
              </div>
            ))}
          </Card>
        </>
      )}
    </Page>
  );
}

const insightRoute = getRouteApi('/think-tank/$slug');

export function InsightDetailPage() {
  const { slug } = insightRoute.useParams();
  const insight = useQuery({ queryKey: ['insight', slug], queryFn: () => api.insight(slug) });
  return (
    <Page>
      <PageHeader title="Insight" crumbs={[{ label: 'Think Tank', to: '/think-tank' }, { label: slug }]} />
      {insight.isPending ? <SkeletonCard /> : insight.isError ? <LoadingLabel>Something went wrong</LoadingLabel> : (
        <Card>
          <h2 style={{ marginTop: 0 }}>{insight.data.title}</h2>
          <p style={{ fontSize: 12 }} className="muted">By {insight.data.author.name} · ▲ {insight.data.votes}</p>
          <h4>Situation</h4><p style={{ fontSize: 12, lineHeight: 1.7 }}>{insight.data.situationMd}</p>
          <h4>Big idea</h4><p style={{ fontSize: 12, lineHeight: 1.7 }}>{insight.data.bigIdeaMd}</p>
          {insight.data.steps.map((s) => (
            <div key={s.id}><h4>{s.title}</h4><p style={{ fontSize: 12 }}>{s.bodyMd}</p></div>
          ))}
        </Card>
      )}
    </Page>
  );
}

const eventRoute = getRouteApi('/events/$slug');

/**
 * One session.
 *
 * The reminder job has been linking `/events/<slug>` since it was written and
 * no such route existed, so every "your session starts in 24 hours"
 * notification landed on navigation above a blank page — the SPA fallback
 * serves the shell for any path, so it did not even 404 visibly.
 *
 * A detail page rather than redirecting to the list, because a reminder about
 * a specific session should open that session. Finding it again in a list is
 * work the notification was supposed to save.
 */
export function EventDetailPage() {
  const { slug } = eventRoute.useParams();
  const qc = useQueryClient();
  const event = useQuery({ queryKey: ['event', slug], queryFn: () => api.event(slug) });

  const rsvp = useMutation({
    mutationFn: (going: boolean) => api.rsvpEvent(event.data!.id, going),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['event', slug] });
      qc.invalidateQueries({ queryKey: ['events'] });
    },
  });

  if (event.isPending) {
    return (
      <Page>
        <SkeletonCard />
      </Page>
    );
  }
  if (event.isError || !event.data) {
    return (
      <Page>
        <PageHeader title="Session" back="/events" crumbs={[{ label: 'Events', to: '/events' }, { label: slug }]} />
        <Card>
          <EmptyState
            icon="calendar"
            title="That session is not here"
            hint="It may have been removed, or the link may be out of date."
          />
          <Link to="/events" className="btn btn-soft" style={{ alignSelf: 'flex-start' }}>
            All sessions
          </Link>
        </Card>
      </Page>
    );
  }

  const e = event.data;
  const past = new Date(e.endsAt).getTime() < Date.now();

  return (
    <Page>
      <PageHeader
        title={e.title}
        back="/events"
        crumbs={[{ label: 'Events', to: '/events' }, { label: e.title }]}
      />
      <Card>
        <span style={{ fontSize: 11 }} className="muted">
          {timeRange(e.startsAt, e.endsAt)} · {e.rsvpCount} going
        </span>
        {e.isFeaturedSession && <span className="nav-soon">Featured session</span>}
        {e.descriptionMd && (
          <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0 }}>{e.descriptionMd}</p>
        )}

        {e.featuredInsights.length > 0 && (
          <span style={{ fontSize: 12 }} className="muted">
            Featuring: {e.featuredInsights.map((i) => i.title).join(' · ')}
          </span>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
          {e.recordingCourseSlug && e.recordingLessonSlug ? (
            <Link
              className="btn btn-pink"
              to="/learn/$courseSlug/$lessonSlug"
              params={{ courseSlug: e.recordingCourseSlug, lessonSlug: e.recordingLessonSlug }}
              style={{ color: '#fff' }}
            >
              Watch the recording
            </Link>
          ) : e.rsvpd && e.joinUrl ? (
            <a className="btn btn-pink" href={e.joinUrl} target="_blank" rel="noreferrer">
              Join
            </a>
          ) : past ? (
            <span style={{ fontSize: 12 }} className="dim">
              Finished — recording not posted yet
            </span>
          ) : (
            e.rsvpd ? (
              <ConfirmButton
                label="Cancel RSVP"
                confirmLabel="Give up my seat"
                className="btn btn-soft"
                disabled={rsvp.isPending}
                onConfirm={() => rsvp.mutate(false)}
              />
            ) : (
              <button className="btn btn-soft" disabled={rsvp.isPending} onClick={() => rsvp.mutate(true)}>
                RSVP
              </button>
            )
          )}
        </div>
      </Card>
    </Page>
  );
}
