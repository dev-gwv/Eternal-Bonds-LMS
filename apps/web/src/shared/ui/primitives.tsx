import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';

/* Small building blocks shared by every page. Each maps to a class in
   styles.css so colours live in tokens, not in components. */

export function Card({
  title,
  action,
  children,
  style,
}: PropsWithChildren<{ title?: string; action?: ReactNode; style?: CSSProperties }>) {
  return (
    <div className="card" style={style}>
      {(title || action) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {title && <span className="card-title" style={{ flex: 1 }}>{title}</span>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function Avatar({
  initials,
  src,
  size = 30,
  tone = 'pink',
  ring = false,
}: {
  initials: string;
  /**
   * A photograph, if the member has one. Initials remain the fallback rather
   * than a placeholder silhouette: two letters in the member's own tier colour
   * say who this is, and a grey outline of a head says nothing.
   */
  src?: string | null;
  size?: number;
  tone?: 'pink' | 'yellow' | 'blue' | 'grey';
  /** Gradient halo for profile-level avatars. */
  ring?: boolean;
}) {
  const tones = {
    pink: { background: 'linear-gradient(135deg, #fbd3e3, #f5a8c6)', color: 'var(--pink-deep)' },
    yellow: { background: 'linear-gradient(135deg, #fde9b8, #f9d976)', color: '#7a5c0a' },
    blue: { background: 'linear-gradient(135deg, #d5e5fb, #aecdf3)', color: '#2c4f86' },
    grey: { background: 'linear-gradient(135deg, #f3f3f7, #e2e2ea)', color: 'var(--ink-2)' },
  } as const;
  const core = src ? (
    <img
      className="avatar"
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      style={{ width: size, height: size, objectFit: 'cover', flexShrink: 0 }}
      // A signed link expires. When it does, fall back to initials rather than
      // leaving a broken-image glyph where somebody's face was.
      onError={(e) => {
        e.currentTarget.style.display = 'none';
      }}
    />
  ) : (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36), ...tones[tone] }}
    >
      {initials}
    </span>
  );
  if (!ring) return core;
  return (
    <span
      style={{
        display: 'inline-flex',
        padding: 2.5,
        borderRadius: 999,
        background: 'var(--grad-brand)',
        boxShadow: 'var(--sh-brand)',
        flexShrink: 0,
      }}
    >
      {core}
    </span>
  );
}

export function Tile({
  children,
  size = 40,
  tone = 'pink',
}: PropsWithChildren<{ size?: number; tone?: 'pink' | 'yellow' | 'blue' | 'green' }>) {
  const tones = {
    pink: { background: 'linear-gradient(135deg, #fbd3e3, #f5a8c6)', color: 'var(--pink-deep)' },
    yellow: { background: 'linear-gradient(135deg, #fde9b8, #f9d976)', color: '#7a5c0a' },
    blue: { background: 'linear-gradient(135deg, #d5e5fb, #aecdf3)', color: '#2c4f86' },
    green: { background: 'linear-gradient(135deg, #cdeeda, #a3d9ba)', color: '#1f6340' },
  } as const;
  return (
    <span className="tile" style={{ width: size, height: size, ...tones[tone] }}>
      {children}
    </span>
  );
}

/**
 * The premium signature banner: pastel mesh, serif title, eyebrow kick.
 * Deep ink on pastel keeps contrast above 4.5:1 — white-on-pink never does,
 * except hero-ink which is white on near-black plum.
 */
export function Hero({
  eyebrow,
  title,
  sub,
  actions,
  tone = 'rose',
}: {
  eyebrow: string;
  title: string;
  sub?: string;
  actions?: ReactNode;
  tone?: 'rose' | 'gold' | 'sky' | 'ink';
}) {
  return (
    <section className={`hero hero-${tone}`}>
      <span className="hero-eyebrow">{eyebrow}</span>
      <h2 className="hero-title">{title}</h2>
      {sub && <p className="hero-sub">{sub}</p>}
      {actions && <div className="hero-actions">{actions}</div>}
    </section>
  );
}

export function Chip({
  children,
  tone = 'grey',
}: PropsWithChildren<{ tone?: 'grey' | 'pink' | 'yellow' | 'blue' | 'green' }>) {
  const cls = tone === 'grey' ? 'chip' : `chip chip-${tone}`;
  return <span className={cls}>{children}</span>;
}

export function StatTile({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: 'pink' | 'yellow' | 'blue' | 'green';
  icon: ReactNode;
}) {
  return (
    <div className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
      <Tile tone={tone}>{icon}</Tile>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 10 }} className="dim">{label}</span>
        <span className="stat num">{value}</span>
      </div>
    </div>
  );
}

export function DateBadge({
  month,
  day,
  tone = 'pink',
}: {
  month: string;
  day: string;
  tone?: 'pink' | 'yellow' | 'blue' | 'green';
}) {
  const tones = {
    pink: { bg: 'var(--pink-tint)', top: 'var(--pink-ink)', big: 'var(--pink-strong)' },
    yellow: { bg: 'var(--yellow-tint)', top: 'var(--yellow-ink)', big: 'var(--yellow-deep)' },
    blue: { bg: 'var(--blue-tint)', top: 'var(--blue-ink)', big: 'var(--blue-strong)' },
    green: { bg: 'var(--green-tint)', top: 'var(--green-ink)', big: '#1f6340' },
  } as const;
  const t = tones[tone];
  return (
    <div
      style={{
        width: 48,
        borderRadius: 11,
        overflow: 'hidden',
        textAlign: 'center',
        background: t.bg,
        flexShrink: 0,
      }}
    >
      <div style={{ fontSize: 9, fontWeight: 600, color: t.top, paddingTop: 5 }}>{month}</div>
      <div style={{ fontSize: 17, fontWeight: 600, color: t.big, paddingBottom: 5 }}>{day}</div>
    </div>
  );
}

export function Dropdown({ label }: { label: string }) {
  return (
    <button type="button" className="btn btn-ghost">
      {label}
      <Icon name="chevron" size={12} />
    </button>
  );
}

/* Inline stroke icons — no icon dependency, no emoji. */
const paths: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.6" />
      <rect x="14" y="3" width="7" height="7" rx="1.6" />
      <rect x="3" y="14" width="7" height="7" rx="1.6" />
      <rect x="14" y="14" width="7" height="7" rx="1.6" />
    </>
  ),
  community: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19a6 6 0 0 1 12 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5" />
      <path d="M18 19a5.5 5.5 0 0 0-2-4.3" />
    </>
  ),
  workshops: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  ),
  courses: (
    <>
      <path d="M12 6.5C10.5 5 8 4.5 4 5v13c4-.5 6.5 0 8 1.5" />
      <path d="M12 6.5C13.5 5 16 4.5 20 5v13c-4-.5-6.5 0-8 1.5" />
    </>
  ),
  library: (
    <>
      <path d="M5 20V9" />
      <path d="M10 20V4" />
      <path d="M15 20v-8" />
      <path d="M20 20V7" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
      <path d="M10.5 20a2 2 0 0 0 3 0" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3z" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
  /* The three brand marks, drawn in the same 24px stroked style as everything
     else rather than dropped in as filled logos, so the footer reads as one
     set of icons instead of two. */
  instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M16.9 7.1h.01" />
    </>
  ),
  youtube: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="4" />
      <path d="M10.5 9.2v5.6l4.6-2.8z" />
    </>
  ),
  facebook: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <path d="M14.8 8.2h-1.3a1.7 1.7 0 0 0-1.7 1.7V21" />
      <path d="M9.6 13h4.6" />
    </>
  ),
  bulb: (
    <>
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.3.2.5.6.5 1V15h6v-.1c0-.4.2-.8.5-1A6 6 0 0 0 12 3z" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  expand: (
    <>
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
    </>
  ),
  back: (
    <>
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  play: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 9v6l5-3z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  heart: <path d="M12 20s-7-4.6-7-9.3A4 4 0 0 1 12 8a4 4 0 0 1 7 2.7C19 15.4 12 20 12 20z" />,
  comment: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  share: (
    <>
      <path d="M12 3v13" />
      <path d="m8 7 4-4 4 4" />
      <path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1.1 1A16 16 0 0 1 4 5.1 1 1 0 0 1 5 4z" />,
  pin: (
    <>
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4l10-10-4-4L4 16z" />
      <path d="m14 6 4 4" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m5 18 5-5 4 4 2-2 3 3" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.6" />
      <rect x="14" y="3" width="7" height="7" rx="1.6" />
      <rect x="3" y="14" width="7" height="7" rx="1.6" />
      <rect x="14" y="14" width="7" height="7" rx="1.6" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a4 4 0 0 0 5.6.6l3-3a4 4 0 1 0-5.6-5.6L11.6 6.4" />
      <path d="M14 11a4 4 0 0 0-5.6-.6l-3 3a4 4 0 1 0 5.6 5.6l1.4-1.4" />
    </>
  ),
  megaphone: (
    <>
      <path d="m3 11 15-6v14L3 13z" />
      <path d="M7 13v5a2 2 0 0 0 4 0v-3" />
    </>
  ),
  people: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-8 0v2" />
      <circle cx="12" cy="8" r="4" />
    </>
  ),
  chart: (
    <>
      <path d="M4 19V10" />
      <path d="M10 19V5" />
      <path d="M16 19v-6" />
      <path d="M3 19h18" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.8,
  color = 'currentColor',
}: {
  name: keyof typeof paths | string;
  size?: number;
  strokeWidth?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? null}
    </svg>
  );
}

/**
 * What a card shows when it has nothing in it.
 *
 * A panel that renders an empty `.map()` leaves a blank rectangle, which reads
 * as a loading bug rather than as "nothing here yet". Every list in the app
 * should say which of the two it is, and — where there is one — offer the
 * action that fills it.
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        padding: '26px 18px',
        textAlign: 'center',
        flex: 1,
      }}
    >
      {icon && (
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: 11,
            background: 'var(--soft)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Icon name={icon} size={16} color="var(--ink-3)" />
        </span>
      )}
      <span style={{ fontSize: 12, fontWeight: 500 }}>{title}</span>
      {hint && (
        <span style={{ fontSize: 10.5, lineHeight: 1.55, maxWidth: 240 }} className="dim">
          {hint}
        </span>
      )}
      {action}
    </div>
  );
}
