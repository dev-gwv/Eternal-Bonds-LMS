import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Suspense, useEffect, useState, type PropsWithChildren, type ReactNode } from 'react';
import { OfflineBanner } from '../offline.tsx';
import { Icon } from '../ui/primitives.tsx';
import { Wordmark } from '../ui/Logo.tsx';
import { GlobalSearch } from '../ui/GlobalSearch.tsx';
import { NotificationBell } from '../ui/NotificationBell.tsx';
import { UserMenu } from '../ui/UserMenu.tsx';
import { useSession } from '../session.tsx';
import { devLoginEnabled } from '../supabase.ts';
import { api } from '../api.ts';
import { PublicWinPage } from '../../routes/PublicWin.tsx';
import { WelcomePage } from '../../routes/Welcome.tsx';
import { SignInPage } from '../../routes/SignIn.tsx';

/**
 * Two levels of navigation, which is one more than we had and one fewer than
 * two parallel menus.
 *
 * The top bar carries the six destinations members already know from the old
 * app, so nobody has to relearn where things are. The sidebar carries what is
 * *inside* the section they are in. The rule that keeps this from becoming two
 * competing menus: nothing appears in both.
 *
 * Sections without sub-navigation render no rail at all. An empty sidebar is
 * worse than none, and a rail that appears and disappears is honest about
 * whether there is anywhere else to go.
 */
type NavItem = { to: string; label: string; icon: string };

const SECTIONS: { to: string; label: string; icon: string; owns: string[]; sub: NavItem[] }[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', owns: [], sub: [] },
  {
    to: '/community',
    label: 'Community',
    icon: 'community',
    // Wins and the directory are "the community". Think Tank is not: it is a
    // weekly ritual with its own cycle, its own voting and its own session,
    // and burying a ritual one level down is how it stops happening.
    owns: ['/wins', '/members'],
    sub: [
      { to: '/community', label: 'Feed', icon: 'comment' },
      { to: '/wins', label: 'Wins', icon: 'heart' },
      { to: '/members', label: 'Members', icon: 'people' },
    ],
  },
  {
    // Promoted out of Community, and Photolancer's old slot. Photolancer was a
    // separate product behind an iframe; this is the thing the club actually
    // runs every week.
    to: '/think-tank',
    label: 'Think Tank',
    icon: 'bulb',
    owns: [],
    sub: [],
  },
  {
    to: '/workshops',
    label: 'Workshops',
    icon: 'workshops',
    owns: ['/events'],
    sub: [
      { to: '/workshops', label: 'Live calls', icon: 'play' },
      { to: '/events', label: 'Events', icon: 'workshops' },
    ],
  },
  {
    to: '/courses',
    label: 'Courses',
    icon: 'courses',
    owns: ['/learn', '/journeys'],
    sub: [
      // Journeys first: it is the answer to "where do I start", and a member
      // who needs that question answered should not have to find it behind
      // the grid of eighteen tiles that prompted it.
      { to: '/journeys', label: 'Journeys', icon: 'chart' },
      { to: '/courses', label: 'All courses', icon: 'courses' },
    ],
  },
  // No rail on the Library yet: its categories are in-page rather than routes.
  // It gets one when it gains sub-pages — the alternative is inventing links
  // that go nowhere.
  { to: '/library', label: 'Library', icon: 'library', owns: [], sub: [] },
];

/** Which top-level section a path belongs to, including the paths it owns. */
function sectionFor(pathname: string) {
  return (
    SECTIONS.find(
      (sec) =>
        sec.to !== '/' &&
        (pathname === sec.to || pathname.startsWith(`${sec.to}/`) ||
          sec.owns.some((o) => pathname === o || pathname.startsWith(`${o}/`))),
    ) ?? SECTIONS[0]!
  );
}

/**
 * The header: the six destinations, plus search, notifications and you.
 *
 * Six because that is what the club's existing platform has and what members
 * already know — the sections we added since are one level down, where they
 * belong, rather than competing for room up here.
 */

/**
 * Bottom navigation, on phones only.
 *
 * The top bar works on a laptop and is wrong on a phone for a physical reason:
 * the top of a large screen is the hardest place to reach one-handed, and this
 * app's audience uses it standing at a shoot, not sitting at a desk. Every
 * native app puts primary navigation at the bottom, and the Capacitor build
 * will be judged against those rather than against websites.
 *
 * Four destinations, not six. A bottom bar with six items gives each one a
 * target narrower than a thumb; the two that come out are Library and Think
 * Tank, which are both still one tap away inside Courses and Community.
 */
const BOTTOM: NavItem[] = [
  { to: '/', label: 'Home', icon: 'dashboard' },
  { to: '/courses', label: 'Learn', icon: 'courses' },
  { to: '/community', label: 'Community', icon: 'community' },
  { to: '/think-tank', label: 'Think Tank', icon: 'bulb' },
];

function BottomNav() {
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  return (
    <nav className="bottomnav" aria-label="Primary">
      {BOTTOM.map((item) => {
        const active =
          item.to === '/' ? pathname === '/' : sectionFor(pathname).to === item.to || pathname.startsWith(item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? 'page' : undefined}
            className={active ? 'bottomnav-item is-on' : 'bottomnav-item'}
          >
            <Icon name={item.icon} size={19} strokeWidth={active ? 2.1 : 1.7} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function TopBar({ onMenu, hasSub }: { onMenu: () => void; hasSub: boolean }) {
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const current = sectionFor(pathname);

  return (
    <header className="topbar">
      {hasSub && (
        <button type="button" className="icon-btn nav-toggle" aria-label="Open section menu" onClick={onMenu}>
          <Icon name="grid" />
        </button>
      )}

      <Link to="/" className="wordmark" style={{ color: 'inherit' }} aria-label="Eternal Bonds, home">
        <Wordmark />
      </Link>

      <nav className="nav" aria-label="Sections">
        {SECTIONS.map((sec) => {
          const active = sec.to === '/' ? pathname === '/' : current.to === sec.to;
          return (
            <Link
              key={sec.to}
              to={sec.to}
              aria-current={active ? 'page' : undefined}
              className={active ? 'nav-pill is-active' : 'nav-pill'}
            >
              <Icon name={sec.icon} strokeWidth={active ? 1.9 : 1.7} />
              <span>{sec.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="topbar-actions">
        <GlobalSearch />
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}

/**
 * What is inside the section you are in.
 *
 * Never duplicates the top bar: a link appears in one or the other, never
 * both, which is what stops two menus becoming two answers to the same
 * question.
 */
function Sidebar({
  items,
  open,
  onNavigate,
}: {
  items: NavItem[];
  open: boolean;
  onNavigate: () => void;
}) {
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  if (items.length === 0) return null;

  return (
    <nav className={open ? 'sidebar is-open' : 'sidebar'} aria-label="In this section">
      <div className="sidebar-group">
        {items.map((item) => {
          // Exact match, or a child of it — /wins is active on /wins/some-slug
          // but /community must not light up for /community-anything.
          const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
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
      {/* Wrapped, so the actions are a bounded flex child rather than however
          many loose elements a page happened to pass. Unwrapped, a single
          full-width control could take the whole row and crush the title. */}
      {actions && <div className="pagehead-actions">{actions}</div>}
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

  const sub = sectionFor(pathname).sub;

  // The one route that renders outside the gate. A public win has to look the
  // same to a stranger and to a signed-in member — if it differed when logged
  // in, the one person who never sees the real page is the author checking
  // their own link. Matched before the loading branch too, so a shared link
  // does not flash "Loading your membership" at somebody who has none.
  const publicWin = pathname.match(/^\/w\/([^/]+)$/);
  if (publicWin) return <PublicWinPage slug={decodeURIComponent(publicWin[1]!)} />;

  if (status === 'loading') {
    return (
      <div className="app" style={{ display: 'grid', placeItems: 'center' }}>
        <span style={{ fontSize: 12 }} className="muted">Loading your membership…</span>
      </div>
    );
  }

  if (status === 'signed-out') return <SignInPage />;

  // A member who has never been through setup goes there first, once. The
  // wizard renders bare — it is a full-page flow and the surrounding nav is
  // exactly the distraction it exists to remove.
  if (pathname === '/welcome') return <WelcomePage />;
  return <Shell sub={sub} demo={demo} navOpen={navOpen} setNavOpen={setNavOpen} />;
}

/**
 * Sends a brand-new member into setup, once.
 *
 * Only on the dashboard: intercepting every route would hijack a link somebody
 * followed from an email, which is both rude and the one moment they had a
 * specific destination in mind. And only when the answer is known — while the
 * query is loading `dismissed` is undefined, and redirecting on undefined
 * would send a returning member through setup again on every cold start.
 */
function useFirstRunRedirect(pathname: string) {
  const navigate = useNavigate();
  const onboarding = useQuery({
    queryKey: ['onboarding'],
    queryFn: api.onboarding,
    staleTime: 5 * 60_000,
    retry: false,
  });

  useEffect(() => {
    if (pathname !== '/') return;
    const data = onboarding.data;
    if (!data) return;
    if (data.completedAt || data.dismissed) return;
    // Nothing done at all. Somebody mid-way through has already seen it and
    // gets the dashboard checklist instead.
    if (data.done > 0) return;
    void navigate({ to: '/welcome', replace: true });
  }, [pathname, onboarding.data, navigate]);
}

function Shell({
  sub,
  demo,
  navOpen,
  setNavOpen,
}: {
  sub: NavItem[];
  demo: boolean;
  navOpen: boolean;
  setNavOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  useFirstRunRedirect(pathname);


  return (
    <div className="app">
      <a href="#main" className="skip-link">Skip to content</a>
      <div className="panel">
        <TopBar onMenu={() => setNavOpen((o) => !o)} hasSub={sub.length > 0} />
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
          <Sidebar items={sub} open={navOpen} onNavigate={() => setNavOpen(false)} />

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
      <BottomNav />
    </div>
  );
}

/** Wraps a page's body so every route gets the same vertical rhythm. */
export function Page({ children }: PropsWithChildren) {
  // A <div>, not a second <main>. The shell already renders `main#main`, and
  // two of them — with the same id — meant the skip link pointed at whichever
  // the browser found first and a screen reader offered two main landmarks.
  return <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>;
}
