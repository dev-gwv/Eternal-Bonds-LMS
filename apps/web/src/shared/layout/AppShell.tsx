import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import type { PropsWithChildren, ReactNode } from 'react';
import { fetchViewer } from '../admin-api.ts';
import { api } from '../api.ts';
import { Avatar, Icon } from '../ui/primitives.tsx';
import { GlobalSearch } from '../ui/GlobalSearch.tsx';
import { NotificationBell } from '../ui/NotificationBell.tsx';
import { useSession } from '../session.tsx';
import { devLoginEnabled } from '../supabase.ts';
import { SignInPage } from '../../routes/SignIn.tsx';

/** The six sections, in the order members already know from the old app. */
const SECTIONS = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/community', label: 'Community', icon: 'community' },
  { to: '/workshops', label: 'Workshops', icon: 'workshops' },
  { to: '/courses', label: 'Courses', icon: 'courses' },
  { to: '/library', label: 'Library', icon: 'library' },
  { to: '/photolancer', label: 'Photolancer', icon: 'search' },
] as const;

function TopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Whether to offer the Studio link at all. The API re-checks on every
  // authoring call, so this only decides whether the link is worth showing.
  const viewer = useQuery({ queryKey: ['viewer'], queryFn: fetchViewer, staleTime: 5 * 60_000 });
  // The chip used to be a hardcoded name and tier. Showing someone else's
  // identity in the corner of every page is worse than showing none.
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 5 * 60_000, retry: false });

  return (
    <header className="topbar">
      <div className="wordmark">
        <span className="wordmark-dot" />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span className="wordmark-name">ETERNAL</span>
          <span className="wordmark-sub">BONDS</span>
        </div>
      </div>

      <nav className="nav" aria-label="Sections">
        {SECTIONS.map((s) => {
          const active =
            s.to === '/'
              ? pathname === '/' || pathname.startsWith('/members')
              : s.to === '/courses'
                ? pathname.startsWith('/courses') || pathname.startsWith('/learn')
                : pathname.startsWith(s.to);
          return (
            <Link key={s.to} to={s.to} className={active ? 'nav-pill is-active' : 'nav-pill'}>
              <Icon name={s.icon} strokeWidth={active ? 1.9 : 1.7} />
              <span>{s.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="topbar-actions">
        {viewer.data?.canAuthor && (
          <Link
            to="/admin"
            className={pathname.startsWith('/admin') ? 'nav-pill is-active' : 'nav-pill'}
            style={{ color: 'inherit' }}
          >
            <Icon name="edit" strokeWidth={1.8} />
            <span>Studio</span>
          </Link>
        )}

        <GlobalSearch />

        <Link to="/account" className="userchip" style={{ color: 'inherit' }}>
          <Avatar initials={me.data?.initials ?? '··'} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{me.data?.fullName ?? 'Loading…'}</span>
            <span style={{ fontSize: 10, textTransform: 'capitalize' }} className="dim">
              {me.data?.tier ?? '—'}
            </span>
          </div>
        </Link>

        <NotificationBell />
        <Link to="/account" className="icon-btn" aria-label="Settings" style={{ color: 'inherit' }}>
          <Icon name="settings" />
        </Link>
      </div>
    </header>
  );
}

const srOnly = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
} as const;

/**
 * Every page uses this header: 20px title over a breadcrumb, actions right.
 * `back` is only for detail pages — a section root has nowhere to go back to.
 */
export function PageHeader({
  title,
  crumbs,
  back,
  actions,
}: {
  title: string;
  crumbs: { label: string; to?: string }[];
  back?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="pagehead">
      {back && (
        <Link to={back} className="backlink" aria-label="Back">
          <Icon name="back" size={19} strokeWidth={2} />
        </Link>
      )}
      <div className="pagehead-titles">
        <h1>{title}</h1>
        <div className="crumb">
          {crumbs.map((c, i) => (
            <span key={c.label} style={{ display: 'inline-flex', gap: 5 }}>
              {i > 0 && <span className="sep">/</span>}
              {c.to ? <Link to={c.to}>{c.label}</Link> : <span className="here">{c.label}</span>}
            </span>
          ))}
        </div>
      </div>
      {actions}
    </div>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <span>Copyright © 2026 Eternal Bonds</span>
      <a href="#privacy">Privacy Policy</a>
      <a href="#terms">Terms and conditions</a>
      <a href="#contact">Contact</a>
      <span style={{ flex: 1 }} />
      <span className="social">f</span>
      <span className="social">ig</span>
      <span className="social">yt</span>
    </footer>
  );
}

/**
 * The gate. With Supabase configured an anonymous visitor gets the sign-in
 * screen instead of the app; without it the app runs in demo mode against seed
 * data. One branch, so no dev-only escape hatch is left behind in a route.
 */
export function AppShell() {
  const { status, demo } = useSession();

  if (status === 'loading') {
    return (
      <div className="app" style={{ display: 'grid', placeItems: 'center' }}>
        <span style={{ fontSize: 12 }} className="muted">Loading your membership…</span>
      </div>
    );
  }

  if (status === 'signed-out') return <SignInPage />;

  return (
    <div className="app">
      <div className="panel">
        <TopBar />
        {demo && (
          <div className="callout" role="status">
            Demo mode — the API is serving seed content. Connect Supabase to sign in and write.
          </div>
        )}
        {/* Deliberately loud and always on screen. A one-click sign-in button
            is the kind of thing that survives to launch precisely because it
            only appears on a page nobody looks at twice. */}
        {devLoginEnabled && (
          <div
            className="callout"
            role="alert"
            style={{ background: '#fdeceb', color: '#a3271e', fontWeight: 500 }}
          >
            Test build — the sign-in page has a one-click skip button that anyone can use. Rebuild
            without <code>VITE_DEV_LOGIN_EMAIL</code> and <code>VITE_DEV_LOGIN_PASSWORD</code> before
            real members use this.
          </div>
        )}
        <Outlet />
        <Footer />
      </div>
    </div>
  );
}

/** Wraps a page's body so every route gets the same vertical rhythm. */
export function Page({ children }: PropsWithChildren) {
  return <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>;
}
