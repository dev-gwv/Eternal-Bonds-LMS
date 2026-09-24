import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../shared/api.ts';
import { Page } from '../shared/layout/AppShell.tsx';
import { Avatar, Card, EmptyState, Hero, Icon } from '../shared/ui/primitives.tsx';
import { SkeletonCard, LoadingLabel } from '../shared/ui/Skeleton.tsx';
import { Link } from '@tanstack/react-router';

export function DirectoryPage() {
  const [q, setQ] = useState('');
  const members = useQuery({ queryKey: ['directory', q], queryFn: () => api.directory(q || undefined) });
  const badges = useQuery({ queryKey: ['badges'], queryFn: api.badges });
  return (
    <Page>
      <Hero
        tone="rose"
        eyebrow="Members · The mastermind"
        title="Find your people."
        sub="The real value of the club is peers — searchable by expertise, city and craft."
      />
      <input className="input" placeholder="Search by name, city or expertise…" value={q}
        onChange={(e) => setQ(e.target.value)} aria-label="Search members" />
      <span className="section-label">My badges</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {badges.data?.filter((b) => b.earned).map((b) => (
          <span key={b.id} className="btn btn-soft" title={b.description ?? b.name}>🏅 {b.name}</span>
        ))}
        {badges.data && badges.data.filter((b) => b.earned).length === 0 && (
          <span className="muted" style={{ fontSize: 12 }}>Complete lessons to earn your first badge.</span>
        )}
      </div>
      <span className="section-label">Directory</span>
      {members.isPending ? <SkeletonCard /> : members.isError ? <LoadingLabel>Something went wrong</LoadingLabel> :
        members.data.length === 0 ? <EmptyState title="No members found" hint="Try a different search." /> :
        members.data.map((m) => (
          // The directory listed people it could not take you to. Each row is
          // a link now, which is what everybody expected it already was.
          <Link
            key={m.id}
            to="/members/$id"
            params={{ id: m.id }}
            className="card-row lift"
            style={{ color: 'inherit', gap: 10 }}
          >
            <Avatar initials={m.initials} size={36} tone="blue" />
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontSize: 12 }}>{m.fullName}</strong>
              <span style={{ display: 'block', fontSize: 11 }} className="muted">
                {[m.city, ...m.expertise].filter(Boolean).join(' · ') || 'Member'}
              </span>
            </span>
            <span style={{ display: 'inline-flex', transform: 'rotate(-90deg)' }}>
              <Icon name="chevron" size={14} color="var(--ink-3)" />
            </span>
          </Link>
        ))}
    </Page>
  );
}

export { ReportButton } from '../shared/ui/ReportButton.tsx';
