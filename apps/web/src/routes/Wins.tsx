import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { Win } from '@ipc/contracts';
import { api, relativeTime } from '../shared/api.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { Avatar, Card, Chip, EmptyState, Hero } from '../shared/ui/primitives.tsx';
import { SkeletonCard, LoadingLabel } from '../shared/ui/Skeleton.tsx';

function WinCard({ win }: { win: Win }) {
  const qc = useQueryClient();
  const react = useMutation({
    mutationFn: (r: boolean) => api.reactWin(win.id, r),
    onSettled: () => qc.invalidateQueries({ queryKey: ['wins'] }),
  });
  return (
    <article className="card lift" style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar initials={win.author.initials} size={34} tone="pink" />
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{win.author.name}</span>
          <span style={{ fontSize: 10, marginLeft: 8 }} className="dim">{relativeTime(win.createdAt)}</span>
        </div>
        <Chip tone="pink">{win.category}</Chip>
      </div>
      <Link to="/wins/$slug" params={{ slug: win.slug }} style={{ color: 'inherit', textDecoration: 'none' }}>
        <h3 style={{ margin: '8px 0 4px', fontSize: 14 }}>{win.title}</h3>
      </Link>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }} className="muted">{win.bigIdeaMd.slice(0, 220)}</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn btn-soft" disabled={react.isPending} onClick={() => react.mutate(!win.reactedByMe)}>
          ♥ {win.reactions}
        </button>
        <Link to="/wins/$slug" params={{ slug: win.slug }} className="btn btn-soft">💬 {win.comments}</Link>
      </div>
    </article>
  );
}

export function WinsPage() {
  const [category, setCategory] = useState<string | undefined>(undefined);
  const wins = useQuery({ queryKey: ['wins', category], queryFn: () => api.wins({ category }) });
  return (
    <Page>
      <Hero
        tone="gold"
        eyebrow="Wins Board · Proof of work"
        title="Proof that the work works."
        sub="Structured breakdowns — the big idea and exactly how it happened — so any member can copy the play."
        actions={<Link to="/wins/submit" className="btn btn-pink" style={{ color: '#fff' }}>Post a win</Link>}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {['general', 'revenue', 'clients', 'mindset'].map((c) => (
          <button key={c} className={`btn ${category === c ? 'btn-pink' : 'btn-soft'}`}
            style={category === c ? { color: '#fff' } : undefined}
            onClick={() => setCategory(category === c ? undefined : c)}>{c}</button>
        ))}
      </div>
      <span className="section-label">Latest wins</span>
      {wins.isPending ? <><SkeletonCard /><SkeletonCard /></> :
        wins.isError ? <LoadingLabel>Something went wrong</LoadingLabel> :
        wins.data.items.length === 0 ? <EmptyState title="No wins yet" hint="Post the first one — members copy the shape of what they see." /> :
        wins.data.items.map((w) => <WinCard key={w.id} win={w} />)}
    </Page>
  );
}

export function SubmitWinPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ title: '', bigIdeaMd: '', howItHappenedMd: '', category: 'general' });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async () => {
    setError(null);
    try {
      const r = await api.submitWin({ ...form, tags: [], publicShare: false, occurredOn: null });
      setDone(r.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit');
    }
  };
  if (done) return (
    <Page><PageHeader title="In review" crumbs={[{ label: 'Wins', to: '/wins' }, { label: 'Submitted' }]} />
      <Card><p>First wins go through moderation, then auto-approve once trusted. We'll notify you.</p>
      <Link to="/wins" className="btn btn-pink">Back to board</Link></Card></Page>
  );
  return (
    <Page>
      <PageHeader title="Post a win" crumbs={[{ label: 'Wins', to: '/wins' }, { label: step === 1 ? 'Write' : 'Preview' }]} />
      {step === 1 ? (
        <Card>
          <label style={{ fontSize: 12 }}>Title<input className="input" value={form.title} onChange={set('title')} /></label>
          <label style={{ fontSize: 12 }}>The big idea (min 40 chars)<textarea className="input" rows={4} value={form.bigIdeaMd} onChange={set('bigIdeaMd')} /></label>
          <label style={{ fontSize: 12 }}>How it happened (min 40 chars)<textarea className="input" rows={4} value={form.howItHappenedMd} onChange={set('howItHappenedMd')} /></label>
          {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</p>}
          <button className="btn btn-pink" onClick={() => setStep(2)}>Preview</button>
        </Card>
      ) : (
        <Card>
          <h3 style={{ marginTop: 0 }}>{form.title || '(untitled)'}</h3>
          <p style={{ fontSize: 12 }}>{form.bigIdeaMd}</p>
          <p style={{ fontSize: 12 }} className="muted">{form.howItHappenedMd}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-soft" onClick={() => setStep(1)}>Edit</button>
            <button className="btn btn-pink" onClick={submit}>Submit for review</button>
          </div>
        </Card>
      )}
    </Page>
  );
}
