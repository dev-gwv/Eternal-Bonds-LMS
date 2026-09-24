import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { fetchViewer } from '../admin-api.ts';
import { api } from '../api.ts';
import { signOut } from '../supabase.ts';
import { Avatar, Icon } from './primitives.tsx';

/**
 * Everything about *you*, behind one avatar.
 *
 * The header used to carry a Studio pill, a settings gear, a notification
 * bell and a name-and-tier chip, all competing with ten nav items. Four of
 * those are the same thing — "my stuff" — and collapsing them into one
 * control is most of what makes the header readable again.
 *
 * Admin entries are filtered by `canAuthor`, which only decides whether the
 * link is worth showing: every admin route re-checks server-side, so a forged
 * answer here buys a dead link and nothing else.
 */

type Item = { to: string; label: string; icon: string; hint?: string };

const MEMBER: Item[] = [
  { to: '/members/me', label: 'My profile', icon: 'people' },
  // Notifications is the inbox, not the switches — those live in Settings.
  { to: '/notifications', label: 'Notifications', icon: 'bell', hint: 'What has happened' },
  { to: '/settings', label: 'Settings', icon: 'settings', hint: 'Profile, alerts, plan, privacy' },
];

const ADMIN: Item[] = [
  { to: '/admin', label: 'Studio', icon: 'edit', hint: 'Courses and workshops' },
  { to: '/admin/members', label: 'Members', icon: 'people', hint: 'Roster and progress' },
  { to: '/admin/cohorts', label: 'Cohorts', icon: 'calendar', hint: 'Start dates and drip' },
  { to: '/admin/revenue', label: 'Revenue', icon: 'chart', hint: 'What came in' },
  { to: '/admin/moderation', label: 'Moderation', icon: 'bell', hint: 'Reports and reviews' },
];

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 5 * 60_000, retry: false });
  const viewer = useQuery({ queryKey: ['viewer'], queryFn: fetchViewer, staleTime: 5 * 60_000 });

  // Click-outside and Escape both close it, and Escape returns focus to the
  // button — otherwise a keyboard user is dropped at the top of the document.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const row = (item: Item) => (
    <Link key={item.to} to={item.to} className="menu-row" onClick={() => setOpen(false)}>
      <Icon name={item.icon} size={15} color="var(--ink-3)" />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 500 }}>{item.label}</span>
        {item.hint && (
          <span style={{ display: 'block', fontSize: 10 }} className="dim">
            {item.hint}
          </span>
        )}
      </span>
    </Link>
  );

  return (
    <div style={{ position: 'relative' }} ref={box}>
      <button
        ref={button}
        type="button"
        className="avatar-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={me.data ? `Account menu for ${me.data.fullName}` : 'Account menu'}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar initials={me.data?.initials ?? '··'} src={me.data?.avatarUrl} size={32} />
      </button>

      {open && (
        <div role="menu" className="menu-panel">
          <div className="menu-head">
            <Avatar initials={me.data?.initials ?? '··'} src={me.data?.avatarUrl} size={38} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600 }}>
                {me.data?.fullName ?? 'Loading…'}
              </span>
              <span style={{ display: 'block', fontSize: 10.5 }} className="dim">
                {me.data?.email ?? me.data?.memberCode ?? ''}
              </span>
              {me.data && (
                <span
                  style={{
                    display: 'inline-block',
                    marginTop: 4,
                    fontSize: 9,
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--pink-ink)',
                    background: 'var(--pink-tint)',
                    borderRadius: 999,
                    padding: '2px 8px',
                  }}
                >
                  {me.data.tier}
                </span>
              )}
            </span>
          </div>

          <div className="menu-group">{MEMBER.map(row)}</div>

          {viewer.data?.canAuthor && (
            <>
              <div className="menu-label">Running the club</div>
              <div className="menu-group">{ADMIN.map(row)}</div>
            </>
          )}

          <div className="menu-group" style={{ borderTop: '1px solid var(--rule)', paddingTop: 4 }}>
            <button
              type="button"
              className="menu-row"
              style={{ width: '100%', border: 0, background: 'transparent', color: 'var(--red)' }}
              onClick={() => void signOut()}
            >
              <Icon name="back" size={15} color="var(--red)" />
              <span style={{ flex: 1, textAlign: 'left', fontSize: 12, fontWeight: 500 }}>Sign out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
