import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, relativeTime } from '../shared/api.ts';
import { Page } from '../shared/layout/AppShell.tsx';
import { Card, Chip, EmptyState, Hero } from '../shared/ui/primitives.tsx';
import { LoadingLabel, SkeletonCard } from '../shared/ui/Skeleton.tsx';

/** Photolancer: paid work inside the club. Briefs → applications → agreed terms. */
export function PhotolancerPage() {
  const qc = useQueryClient();
  const briefs = useQuery({ queryKey: ['briefs'], queryFn: api.briefs });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', bodyMd: '', city: '' });
  const [pitch, setPitch] = useState<Record<string, string>>({});

  const create = useMutation({
    mutationFn: () => api.createBrief({ ...form, city: form.city || null, budgetPaise: null, shootOn: null }),
    onSuccess: () => { setShowForm(false); setForm({ title: '', bodyMd: '', city: '' }); qc.invalidateQueries({ queryKey: ['briefs'] }); },
  });
  const apply = useMutation({
    mutationFn: ({ id, pitchMd }: { id: string; pitchMd: string }) => api.applyBrief(id, pitchMd),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['briefs'] }),
  });

  return (
    <Page>
      <Hero
        tone="ink"
        eyebrow="Photolancer · Paid work inside the club"
        title="Real shoots, real budgets."
        sub="Clients post briefs with dates and budgets. Your profile, tier and finished courses travel with every application."
        actions={<button className="btn btn-pink" style={{ color: '#fff' }} onClick={() => setShowForm((s) => !s)}>Post a brief</button>}
      />
      {showForm && (
        <Card>
          <label style={{ fontSize: 12 }}>Shoot title<input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label style={{ fontSize: 12 }}>What is actually wanted<textarea className="input" rows={4} value={form.bodyMd} onChange={(e) => setForm({ ...form, bodyMd: e.target.value })} /></label>
          <label style={{ fontSize: 12 }}>City<input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
          <button className="btn btn-pink" disabled={form.title.trim().length < 8 || form.bodyMd.trim().length < 20 || create.isPending}
            onClick={() => create.mutate()}>Publish brief</button>
        </Card>
      )}
      <span className="section-label">Open briefs</span>
      {briefs.isPending ? <SkeletonCard /> : briefs.isError ? <LoadingLabel>Something went wrong</LoadingLabel> :
        briefs.data.length === 0 ? <EmptyState title="No open briefs" hint="Post one, or check the community — members pass briefs there every week." /> :
        briefs.data.map((b) => (
          <Card key={b.id}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <strong style={{ fontSize: 13, flex: 1 }}>{b.title}</strong>
              {b.city && <Chip>{b.city}</Chip>}
              <Chip tone="pink">{b.applicationCount} applied</Chip>
            </div>
            <p style={{ fontSize: 12 }} className="muted">{b.bodyMd.slice(0, 300)}</p>
            <span style={{ fontSize: 10 }} className="dim">{relativeTime(b.createdAt)}</span>
            {b.appliedByMe ? <span className="muted" style={{ fontSize: 12 }}>✓ Applied — your profile, tier and finished courses travelled with it.</span> : (
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" placeholder="Your pitch…" value={pitch[b.id] ?? ''}
                  onChange={(e) => setPitch((p) => ({ ...p, [b.id]: e.target.value }))} aria-label="Pitch" />
                <button className="btn btn-soft" disabled={!(pitch[b.id] ?? '').trim() || apply.isPending}
                  onClick={() => apply.mutate({ id: b.id, pitchMd: pitch[b.id] ?? '' })}>Apply</button>
              </div>
            )}
          </Card>
        ))}
    </Page>
  );
}
