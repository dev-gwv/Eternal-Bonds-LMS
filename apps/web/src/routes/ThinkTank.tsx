import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { Insight } from '@ipc/contracts';
import { api, relativeTime } from '../shared/api.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { Avatar, Card, Chip, EmptyState, Hero, Icon } from '../shared/ui/primitives.tsx';
import { LoadingLabel, SkeletonCard } from '../shared/ui/Skeleton.tsx';
import { useDraft } from '../shared/ui/useDraft.ts';

function InsightCard({ insight }: { insight: Insight }) {
  const qc = useQueryClient();
  const vote = useMutation({
    mutationFn: (v: boolean) => api.voteInsight(insight.id, v),
    onSettled: () => qc.invalidateQueries({ queryKey: ['insights'] }),
  });
  return (
    <article className="card lift" style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar initials={insight.author.initials} size={34} tone="yellow" />
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{insight.author.name}</span>
          <span style={{ fontSize: 10, marginLeft: 8 }} className="dim">{relativeTime(insight.createdAt)}</span>
        </div>
        {insight.domainSlug && <Chip tone="yellow">{insight.domainSlug}</Chip>}
      </div>
      <Link to="/think-tank/$slug" params={{ slug: insight.slug }} style={{ color: 'inherit', textDecoration: 'none' }}>
        <h3 style={{ margin: '8px 0 4px', fontSize: 14 }}>{insight.title}</h3>
      </Link>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }} className="muted">{insight.bigIdeaMd.slice(0, 220)}</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn btn-soft" disabled={vote.isPending}
          onClick={() => vote.mutate(!insight.votedByMe)} aria-pressed={insight.votedByMe}>
          ▲ {insight.votes}{insight.votedByMe ? ' · voted' : ' · vote'}
        </button>
        <Link to="/think-tank/$slug" params={{ slug: insight.slug }} className="btn btn-soft">Read</Link>
      </div>
    </article>
  );
}

/**
 * The week, stated at the top.
 *
 * Promoting Think Tank out of Community is only worth doing if the page shows
 * the thing that makes it a ritual rather than another list: voting is open,
 * it closes on a date, and what wins becomes a live session. The cycle has
 * been opened and closed by a scheduled job since the ritual work; nothing
 * ever displayed it, so from a member's side there was no week at all.
 */
function ThisWeek() {
  const cycle = useQuery({ queryKey: ['vote-cycle'], queryFn: api.voteCycle, staleTime: 5 * 60_000 });
  if (!cycle.data) return null;

  const ends = new Date(cycle.data.endsOn);
  const days = Math.max(0, Math.ceil((ends.getTime() - Date.now()) / 86_400_000));

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span
          style={{
            width: 38, height: 38, borderRadius: 999, flexShrink: 0,
            display: 'grid', placeItems: 'center', background: 'var(--pink-tint)',
          }}
        >
          <Icon name="bulb" size={18} color="var(--pink-ink)" />
        </span>
        <span style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {days === 0 ? 'Voting closes today' : `Voting closes in ${days} day${days === 1 ? '' : 's'}`}
          </span>
          <span style={{ fontSize: 11.5, lineHeight: 1.5 }} className="muted">
            The most-voted insight becomes this week's live session. Post one, or vote on the ones below.
          </span>
        </span>
        <Link to="/events" className="btn btn-soft">
          <Icon name="calendar" size={13} />
          Sessions
        </Link>
      </div>
    </Card>
  );
}

export function ThinkTankPage() {
  const [domain, setDomain] = useState<string | undefined>(undefined);
  const [dilemma, setDilemma] = useState('');
  const insights = useQuery({ queryKey: ['insights', domain], queryFn: () => api.insights({ domain }) });
  const solutions = useQuery({
    queryKey: ['solutions', dilemma], queryFn: () => api.solutions(dilemma),
    enabled: dilemma.trim().length >= 3,
  });

  return (
    <Page>
      <Hero
        tone="rose"
        eyebrow="Think Tank · Weekly vote"
        title="Ideas worth stealing."
        sub="Operators sharing what actually worked — voted up by the club, featured in the live session."
        actions={<Link to="/think-tank/share" className="btn btn-pink" style={{ color: '#fff' }}>Share an insight</Link>}
      />

      <ThisWeek />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {['business', 'marketing', 'mindset', 'sales', 'operations'].map((d) => (
          <button key={d} className={`btn ${domain === d ? 'btn-pink' : 'btn-soft'}`}
            style={domain === d ? { color: '#fff' } : undefined}
            onClick={() => setDomain(domain === d ? undefined : d)}>{d}</button>
        ))}
      </div>

      <span className="section-label">Solution Finder</span>
      <Card>
        <input className="input" placeholder="What dilemma are you facing?" value={dilemma}
          onChange={(e) => setDilemma(e.target.value)} aria-label="Describe your dilemma" />
        {solutions.data && solutions.data.length === 0 && dilemma.trim().length >= 3 && (
          <p className="muted" style={{ fontSize: 12 }}>
            Nothing matched — your question was logged for the team, and you can{' '}
            <Link to="/community">ask in #ask-for-help</Link>.
          </p>
        )}
        {solutions.data?.map((s) => (
          <div key={s.id} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
            <strong style={{ fontSize: 12 }}>{s.dilemma}</strong>
            <p className="muted" style={{ fontSize: 12 }}>{s.bodyMd.slice(0, 200)}</p>
          </div>
        ))}
      </Card>

      <span className="section-label">This week's insights</span>
      {insights.isPending ? <><SkeletonCard /><SkeletonCard /></> :
        insights.isError ? <LoadingLabel>Something went wrong</LoadingLabel> :
        insights.data.items.length === 0 ? <EmptyState title="No insights yet" hint="Be the first to share one." /> :
        insights.data.items.map((i) => <InsightCard key={i.id} insight={i} />)}
    </Page>
  );
}

export function ShareInsightPage() {
  // Autosaved. Three paragraphs of real thought lived only in React state,
  // so a phone call lost them — and nobody writes it a second time.
  const [form, setForm, clearDraft] = useDraft('insight', {
    title: '', situationMd: '', bigIdeaMd: '', domainSlug: 'business', impactSlug: 'growth',
  });
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await api.shareInsight({ ...form, howMd: '', steps: [] });
      clearDraft();
      setDone(r.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  if (done) return (
    <Page><PageHeader title="Published" crumbs={[{ label: 'Think Tank', to: '/think-tank' }, { label: 'Published' }]} />
      <Card><p>Your insight is live in this week's vote.</p><Link to="/think-tank" className="btn btn-pink">Back to library</Link></Card>
    </Page>
  );
  const set = (k: keyof typeof form) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Page>
      <PageHeader title="Share an insight" crumbs={[{ label: 'Think Tank', to: '/think-tank' }, { label: 'Share' }]} />
      <Card>
        <label style={{ fontSize: 12 }}>Title<input className="input" value={form.title} onChange={set('title')} minLength={8} maxLength={140} /></label>
        <label style={{ fontSize: 12 }}>Situation<textarea className="input" value={form.situationMd} onChange={set('situationMd')} rows={4} /></label>
        <label style={{ fontSize: 12 }}>Big idea<textarea className="input" value={form.bigIdeaMd} onChange={set('bigIdeaMd')} rows={4} /></label>
        {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</p>}
        <button className="btn btn-pink" onClick={save}>Publish to this week's vote</button>
      </Card>
    </Page>
  );
}
