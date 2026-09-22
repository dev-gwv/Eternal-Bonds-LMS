import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../shared/api.ts';
import { PageHeader, Page } from '../../shared/layout/AppShell.tsx';
import { Card } from '../../shared/ui/primitives.tsx';

/** Studio → Moderation: reports queue, audit log, feature flags, event scheduler. */
export function ModerationPage() {
  const qc = useQueryClient();
  const reports = useQuery({ queryKey: ['reports'], queryFn: api.reports });
  const pending = useQuery({ queryKey: ['pending-wins'], queryFn: api.pendingWins });
  const audit = useQuery({ queryKey: ['audit'], queryFn: api.audit });
  const flags = useQuery({ queryKey: ['flags'], queryFn: api.flags });
  const [event, setEvent] = useState({ slug: '', title: '', startsAt: '', endsAt: '' });
  const [msg, setMsg] = useState<string | null>(null);

  const review = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'published' | 'hidden' }) => {
      await api.reviewWin(id, status);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-wins'] });
      qc.invalidateQueries({ queryKey: ['wins'] });
    },
  });

  const resolve = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'actioned' | 'dismissed' }) => {
      const res = await fetch(`/v1/moderation/reports/${id}/resolve`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Could not resolve');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports'] }),
  });

  const openReports = (reports.data ?? []).filter((r: { status: string }) => r.status === 'open');
  const pendingWins = pending.data ?? [];

  return (
    <Page>
      <PageHeader title="Moderation" crumbs={[{ label: 'Studio', to: '/admin' }, { label: 'Moderation' }]} />
      <span className="section-label">Wins awaiting review</span>
      {pendingWins.map((w: { id: string; title: string; bigIdeaMd: string; authorName: string }) => (
        <Card key={w.id}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 220 }}>
              <strong style={{ fontSize: 12 }}>{w.title}</strong>
              <span style={{ display: 'block', fontSize: 11 }} className="muted">
                by {w.authorName} · {w.bigIdeaMd.slice(0, 140)}
              </span>
            </span>
            <button className="btn btn-soft" disabled={review.isPending}
              onClick={() => review.mutate({ id: w.id, status: 'hidden' })}>Hide</button>
            <button className="btn btn-pink" disabled={review.isPending} style={{ color: '#fff' }}
              onClick={() => review.mutate({ id: w.id, status: 'published' })}>Publish</button>
          </div>
        </Card>
      ))}
      {pendingWins.length === 0 && !pending.isPending && (
        <Card><span className="muted" style={{ fontSize: 12 }}>No wins waiting.</span></Card>
      )}
      <span className="section-label">Reports queue</span>
      {openReports.map((r: { id: string; targetType: string; reason: string }) => (
        <Card key={r.id}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: 1, fontSize: 12 }}><strong>{r.targetType}</strong> · {r.reason}</span>
            <button className="btn btn-soft" onClick={() => resolve.mutate({ id: r.id, status: 'dismissed' })}>Dismiss</button>
            <button className="btn btn-pink" onClick={() => resolve.mutate({ id: r.id, status: 'actioned' })}>Action</button>
          </div>
        </Card>
      ))}
      {openReports.length === 0 && (
        <Card><span className="muted" style={{ fontSize: 12 }}>Queue is clear.</span></Card>
      )}

      <span className="section-label">Schedule live session</span>
      <Card>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="input" placeholder="slug" value={event.slug} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEvent({ ...event, slug: e.target.value })} aria-label="Event slug" />
          <input className="input" placeholder="Title" value={event.title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEvent({ ...event, title: e.target.value })} aria-label="Event title" />
          <input className="input" type="datetime-local" value={event.startsAt} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEvent({ ...event, startsAt: e.target.value })} aria-label="Starts at" />
          <input className="input" type="datetime-local" value={event.endsAt} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEvent({ ...event, endsAt: e.target.value })} aria-label="Ends at" />
          <button className="btn btn-pink" onClick={() =>
            api.createEvent({
              slug: event.slug, title: event.title,
              startsAt: new Date(event.startsAt).toISOString(), endsAt: new Date(event.endsAt).toISOString(),
              descriptionMd: null, joinUrl: null, minTier: 'free', isFeaturedSession: false, insightIds: [],
            }).then(() => setMsg('Scheduled.')).catch((e) => setMsg(e.message))}>Schedule</button>
        </div>
        {msg && <p style={{ fontSize: 12 }}>{msg}</p>}
      </Card>

      <span className="section-label">Feature flags</span>
      {(flags.data ?? []).map((f: { key: string; enabled: boolean }) => (
        <Card key={f.key}><span style={{ fontSize: 12 }}><strong>{f.key}</strong>: {f.enabled ? 'on' : 'off'}</span></Card>
      ))}

      <span className="section-label">Audit log</span>
      {(audit.data ?? []).slice(0, 20).map((a: { id: string; action: string; actorName: string | null; targetType: string | null }) => (
        <Card key={a.id}>
          <span style={{ fontSize: 12 }}><strong>{a.action}</strong> by {a.actorName ?? 'system'} · {a.targetType ?? ''}</span>
        </Card>
      ))}
    </Page>
  );
}
