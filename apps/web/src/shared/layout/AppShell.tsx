import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { Suspense, useEffect, useState, type PropsWithChildren, type ReactNode } from 'react';
import { OfflineBanner } from '../offline.tsx';
import { Icon } from '../ui/primitives.tsx';
import { GlobalSearch } from '../ui/GlobalSearch.tsx';
import { NotificationBell } from '../ui/NotificationBell.tsx';
import { UserMenu } from '../ui/UserMenu.tsx';
import { useSession } from '../session.tsx';
import { devLoginEnabled } from '../supabase.ts';
import { SignInPage } from '../../routes/SignIn.tsx';

/**
 * Navigation, grouped by what a member came for.
 *
 * Ten sections in a horizontal bar had stopped being scannable. Grouped by the
 * club's own thesis — join to learn, stay for peers, pay again for outcomes —
 * they become four short lists, and the structure itself tells a new member
 * what the club is for.
 */
const GROUPS = [
  {
    label: 'Learn',
    items: [
      { to: '/', label: 'Dashboard', icon: 'dashboard' },
      { to: '/courses', label: 'Courses', icon: 'courses' },
      { to: '/library', label: 'Library', icon: 'library' },
    ],
  },
  {
    label: 'Belong',
    items: [
      { to: '/community', label: 'Community', icon: 'community' },
      { to: '/think-tank', label: 'Think Tank', icon: 'comment' },
      { to: '/wins', label: 'Wins', icon: 'heart' },
      { to: '/members', label: 'Members', icon: 'people' },
    ],
  },
  {
    label: 'Live',
    items: [
      { to: '/events', label: 'Events', icon: 'workshops' },
      { to: '/workshops', label: 'Workshops', icon: 'play' },
    ],
  },
  {
    label: 'Earn',
    items: [{ to: '/photolancer', label: 'Photolancer', icon: 'search' }],
  },
] as const;

/** Active-section matching, in one place rather than a nested ternary. */
function isActive(to: string, pathname: string): boolean {
  if (to === '/') return pathname === '/';
  if (to === '/courses') return pathname.startsWith('/courses') || pathname.startsWith('/learn');
  // /members must not match /members/me, which belongs to the profile.
  if (to === '/members') return pathname === '/members' || pathname.startsWith('/members/');
  return pathname.startsWith(to);
}

/**
 * The header: identity, search, notifications, you.
 *
 * Everything else moved to the sidebar. It carried ten nav pills, a Studio
 * pill, a settings gear, a bell and a name chip; the first thing a member saw
 * on every page was a wall of controls.
 */
function TopBar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="topbar">
      <button type="button" className="icon-btn nav-toggle" aria-label="Open navigation" onClick={onMenu}>
        <Icon name="grid" />
      </button>

      <Link to="/" className="wordmark" style={{ color: 'inherit' }}>
        <span className="wordmark-dot" />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span className="wordmark-name">ETERNAL</span>
          <span className="wordmark-sub">BONDS</span>
        </div>
      </Link>

      <div style={{ flex: 1 }} />

      <div className="topbar-actions">
        <GlobalSearch />
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}

/**
 * Primary navigation.
 *
 * A sidebar rather than a top bar because ten sections do not fit across a
 * header and will only grow. Vertical space is cheap, the labels stay
 * readable, and the groups give a new member a map of what the club offers
 * rather than a row of equally-weighted words.
 */
function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className={open ? 'sidebar is-open' : 'sidebar'} aria-label="Sections">
      {GROUPS.map((group) => (
        <div key={group.label} className="sidebar-group">
          <span className="sidebar-label">{group.label}</span>
          {group.items.map((item) => {
            const active = isActive(item.to, pathname);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={active ? 'side-link is-active' : 'side-link'}
              >
                <Icon name={item.icon} size={16} strokeWidth={active ? 2 : 1.7} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
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
      <Link to="/legal">Privacy & Terms</Link>
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
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  // Only used below the sidebar breakpoint, where it is a slide-over drawer.
  const [navOpen, setNavOpen] = useState(false);

  // Close the drawer on navigation. Without this, tapping a link on a phone
  // leaves the overlay covering the page you just asked for.
  useEffect(() => setNavOpen(false), [pathname]);

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
      <a href="#main" className="skip-link">Skip to content</a>
      <div className="panel">
        <TopBar onMenu={() => setNavOpen((o) => !o)} />
        <OfflineBanner />
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
        <div className="shell">
          <Sidebar open={navOpen} onNavigate={() => setNavOpen(false)} />

          {/* Only rendered while the drawer is open, so it cannot intercept
              clicks on a desktop where the sidebar is always visible. */}
          {navOpen && (
            <button
              type="button"
              className="sidebar-scrim"
              aria-label="Close navigation"
              onClick={() => setNavOpen(false)}
            />
          )}

          <main id="main" className="shell-main">
            <Suspense fallback={<span className="muted" style={{ fontSize: 12 }}>Loading section…</span>}>
              <Outlet />
            </Suspense>
            <Footer />
          </main>
        </div>
      </div>
    </div>
  );
}

/** Wraps a page's body so every route gets the same vertical rhythm. */
export function Page({ children }: PropsWithChildren) {
  return <main id="main" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</main>;
}
