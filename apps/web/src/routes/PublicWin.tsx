import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { PublicWin } from '@ipc/contracts';
import { Gallery } from '../shared/ui/Gallery.tsx';

/**
 * A member's win, on the open internet.
 *
 * The one page in this app that renders outside the auth shell, because it is
 * the only page whose job is to be read by somebody who is not a member. A
 * ₹1.2L booking story locked behind a login is a marketing asset with the
 * marketing removed.
 *
 * It fetches directly rather than through `api.ts`: that client attaches a
 * bearer token when there is a session, and this page must behave identically
 * for a member and a stranger. If it looked different when logged in, the one
 * person who never sees the real thing is the author checking their own link.
 *
 * The join card at the bottom is the entire commercial point, and it is at the
 * bottom on purpose — a stranger who has just read how somebody doubled their
 * close rate is a warmer lead than one who met a signup wall first.
 */

const BASE = import.meta.env.VITE_API_URL ?? '';

async function fetchPublicWin(slug: string) {
  const res = await fetch(`${BASE}/v1/public/wins/${encodeURIComponent(slug)}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(res.status === 404 ? 'not-found' : `Could not load (${res.status})`);
  return PublicWin.parse(await res.json());
}

export function PublicWinPage({ slug }: { slug: string }) {
  const win = useQuery({
    queryKey: ['public-win', slug],
    queryFn: () => fetchPublicWin(slug),
    retry: false,
    staleTime: 5 * 60_000,
  });

  // No shell means no PageHeader, so the tab title is set by hand. It is also
  // what somebody sees in a bookmark and in a link preview's fallback.
  useEffect(() => {
    if (win.data) document.title = `${win.data.title} · India Photographers Club`;
    return () => {
      document.title = 'India Photographers Club';
    };
  }, [win.data]);

  if (win.isPending) {
    return (
      <main style={shell}>
        <span style={{ fontSize: 12, color: '#6b6b76' }}>Loading…</span>
      </main>
    );
  }

  if (win.error || !win.data) {
    const missing = (win.error as Error | null)?.message === 'not-found';
    return (
      <main style={shell}>
        <h1 style={{ fontSize: 20, margin: 0 }}>{missing ? 'Not here' : 'Something went wrong'}</h1>
        <p style={{ fontSize: 13, lineHeight: 1.7, color: '#6b6b76' }}>
          {missing
            ? 'This story is not shared publicly, or the link is wrong.'
            : 'Try again in a moment.'}
        </p>
        <a href="/" style={link}>
          India Photographers Club
        </a>
      </main>
    );
  }

  const w = win.data;
  const when = new Date(w.createdAt).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <main style={shell}>
      <a href="/" style={{ ...link, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        India Photographers Club
      </a>

      <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 11, color: '#9a9aa4' }}>
          {w.category} · {when}
        </span>
        <h1 style={{ fontSize: 'clamp(22px, 4vw, 32px)', lineHeight: 1.25, margin: 0 }}>{w.title}</h1>
        <span style={{ fontSize: 13, color: '#6b6b76' }}>by {w.authorName}, a club member</span>
      </header>

      {w.media.length > 0 && <Gallery media={w.media} />}

      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h2 style={heading}>The big idea</h2>
        <p style={body}>{w.bigIdeaMd}</p>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h2 style={heading}>How it happened</h2>
        <p style={body}>{w.howItHappenedMd}</p>
      </section>

      {w.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {w.tags.map((t) => (
            <span
              key={t}
              style={{
                fontSize: 11,
                padding: '4px 10px',
                borderRadius: 999,
                background: '#f4f4f6',
                color: '#6b6b76',
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {/* The point of the page, and last on purpose: somebody who has just
          read how this was done is a warmer lead than one met at the door. */}
      <aside
        style={{
          marginTop: 12,
          padding: '20px 22px',
          borderRadius: 14,
          background: 'linear-gradient(135deg, #fdecf5 0%, #f9d6e6 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <strong style={{ fontSize: 15 }}>This is what members share here.</strong>
        <span style={{ fontSize: 13, lineHeight: 1.65, color: '#7a4258' }}>
          Photographers in the club post exactly how a booking happened, so the next person can copy
          it. Courses, weekly live sessions, and a few hundred people doing the same work.
        </span>
        <a
          href="/"
          style={{
            alignSelf: 'flex-start',
            marginTop: 4,
            background: '#e0457b',
            color: '#fff',
            fontSize: 13,
            fontWeight: 500,
            padding: '10px 20px',
            borderRadius: 10,
            textDecoration: 'none',
          }}
        >
          See the club
        </a>
      </aside>

      <footer style={{ fontSize: 11, color: '#9a9aa4', paddingTop: 8 }}>
        Shared by its author. India Photographers Club.
      </footer>
    </main>
  );
}

/* Plain objects rather than the app's CSS variables: this page renders without
   the shell, so it cannot rely on anything the shell sets up. */
const shell: React.CSSProperties = {
  maxWidth: 680,
  margin: '0 auto',
  padding: '48px 16px 64px',
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  fontFamily: 'inherit',
  color: '#26262e',
};

const heading: React.CSSProperties = { fontSize: 13, margin: 0, letterSpacing: '0.02em' };
const body: React.CSSProperties = { fontSize: 14, lineHeight: 1.75, margin: 0, whiteSpace: 'pre-wrap' };
const link: React.CSSProperties = { color: '#e0457b', textDecoration: 'none', fontSize: 13 };
