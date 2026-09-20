import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { api, timeRange } from '../shared/api.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { Card, EmptyState, Hero } from '../shared/ui/primitives.tsx';
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
              {e.rsvpd && e.joinUrl ? (
                <a className="btn btn-pink" href={e.joinUrl} target="_blank" rel="noreferrer">Join</a>
              ) : (
                <button className="btn btn-soft" disabled={rsvp.isPending}
                  onClick={() => rsvp.mutate({ id: e.id, rsvpd: !e.rsvpd })}>
                  {e.rsvpd ? 'Cancel RSVP' : 'RSVP'}
                </button>
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
  const win = useQuery({ queryKey: ['win', slug], queryFn: () => api.win(slug) });
  return (
    <Page>
      <PageHeader title="Win" crumbs={[{ label: 'Wins', to: '/wins' }, { label: slug }]} />
      {win.isPending ? <SkeletonCard /> : win.isError ? <LoadingLabel>Something went wrong</LoadingLabel> : (
        <Card>
          <h2 style={{ marginTop: 0 }}>{win.data.title}</h2>
          <p style={{ fontSize: 12 }} className="muted">By {win.data.author.name}</p>
          <h4>The big idea</h4>
          <p style={{ fontSize: 12, lineHeight: 1.7 }}>{win.data.bigIdeaMd}</p>
          <h4>How it happened</h4>
          <p style={{ fontSize: 12, lineHeight: 1.7 }}>{win.data.howItHappenedMd}</p>
          {win.data.media.map((m) => (
            <img key={m.id} src={m.url} alt="Win proof" style={{ maxWidth: '100%', borderRadius: 10, marginTop: 8 }} loading="lazy" />
          ))}
        </Card>
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
