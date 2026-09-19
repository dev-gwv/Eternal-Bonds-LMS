import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { LibraryCategory } from '@ipc/contracts';
import { api } from '../shared/api.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { Card, EmptyState, Icon, Tile } from '../shared/ui/primitives.tsx';

const META: Record<string, { icon: string; tone: 'pink' | 'yellow' | 'blue' | 'green' }> = {
  'business-docs': { icon: 'file', tone: 'pink' },
  templates: { icon: 'grid', tone: 'yellow' },
  scripts: { icon: 'share', tone: 'blue' },
  'winning-ads': { icon: 'megaphone', tone: 'green' },
  'quick-links': { icon: 'link', tone: 'blue' },
  'photo-library': { icon: 'image', tone: 'pink' },
  'training-videos': { icon: 'play', tone: 'yellow' },
};

const TONE_TEXT = {
  pink: 'var(--pink-ink)',
  yellow: 'var(--yellow-ink)',
  blue: 'var(--blue-ink)',
  green: 'var(--green-ink)',
} as const;

const SUGGESTIONS = ['quotation format', 'sadhana link', 'sales script', 'ad template'];

function CategoryCard({ category }: { category: LibraryCategory }) {
  const meta = META[category.slug] ?? { icon: 'file', tone: 'pink' as const };
  return (
    <a href={`#${category.slug}`} className="card" style={{ padding: 15, gap: 10, color: 'inherit' }}>
      <Tile size={38} tone={meta.tone}><Icon name={meta.icon} size={17} /></Tile>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{category.name}</span>
        <span style={{ fontSize: 10 }} className="dim">{category.blurb}</span>
      </div>
      <span style={{ fontSize: 10, fontWeight: 500, color: TONE_TEXT[meta.tone] }}>
        {category.itemCount} {category.unit}
      </span>
    </a>
  );
}

export function LibraryPage() {
  const categories = useQuery({ queryKey: ['library'], queryFn: api.libraryCategories });
  const [query, setQuery] = useState('');

  // Filtered here rather than on the server: the category list is small, fully
  // loaded, and a request per keystroke would be slower than the scan.
  const needle = query.trim().toLowerCase();
  const shown = (categories.data ?? []).filter(
    (c) => needle === '' || c.name.toLowerCase().includes(needle) || c.blurb.toLowerCase().includes(needle),
  );

  return (
    <Page>
      <PageHeader
        title="Library"
        crumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Library' }]}
        actions={
          <>
            <span style={{ fontSize: 11 }} className="dim">
              {categories.data ? `${categories.data.reduce((n, c) => n + c.itemCount, 0)} resources` : ''}
            </span>
          </>
        }
      />

      <section
        style={{
          borderRadius: 16,
          background: 'linear-gradient(135deg, #fdecf5 0%, #fbe3ee 45%, #eaf1fc 100%)',
          padding: 30,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 13,
        }}
      >
        <span className="avatar" style={{ width: 34, height: 34, background: '#fff' }}>
          <span style={{ width: 12, height: 12, borderRadius: 999, background: 'var(--pink)' }} />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 10, letterSpacing: '0.2em', color: '#b07a94', fontWeight: 500 }}>
            ETERNAL BONDS
          </span>
          <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: '0.02em' }}>Your Library</span>
          <span style={{ fontSize: 12 }} className="muted">Everything you need — always within reach</span>
        </div>

        <form
          style={{ display: 'flex', gap: 9, width: 'min(520px, 100%)' }}
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="search" style={{ flex: 1, width: 'auto', background: '#fff', padding: '12px 16px' }}>
            <Icon name="search" size={15} strokeWidth={2} color="var(--ink-3)" />
            <label htmlFor="library-search" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
              Search the library
            </label>
            <input
              id="library-search"
              type="search"
              value={query}
              placeholder="Search — quotation, sadhana link, ad template…"
              onChange={(e) => setQuery(e.target.value)}
              style={{ flex: 1, font: 'inherit', fontSize: 13, border: 0, outline: 'none', background: 'transparent', color: 'var(--ink)' }}
            />
          </div>
          <button type="submit" className="btn btn-pink" style={{ padding: '12px 28px', fontSize: 12 }}>Find</button>
        </form>

        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', justifyContent: 'center' }}>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className="btn"
              style={{
                background: query === s ? 'var(--pink)' : '#fff',
                color: query === s ? '#fff' : 'var(--ink-2)',
                fontSize: 10,
                padding: '6px 13px',
              }}
              onClick={() => setQuery(query === s ? '' : s)}
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      <span className="section-label">
        {needle ? `Matching “${needle}”` : 'Browse category'}
      </span>

      {shown.length === 0 ? (
        <Card>
          <EmptyState
            icon="library"
            title={needle ? `Nothing matches “${needle}”` : 'The library is empty'}
            hint={
              needle
                ? 'Try a shorter word, or clear the search to see every category.'
                : 'Resources appear here as the team adds them.'
            }
            action={
              needle ? (
                <button type="button" className="btn btn-soft" onClick={() => setQuery('')}>
                  Clear search
                </button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid grid-4" style={{ alignContent: 'start' }}>
          {shown.map((c) => <CategoryCard key={c.id} category={c} />)}
        </div>
      )}
    </Page>
  );
}
