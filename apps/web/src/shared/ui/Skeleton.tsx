import type { CSSProperties } from 'react';

/**
 * Loading placeholders.
 *
 * Every list in the app used to load with a bare string — "Loading courses…"
 * alone in the top-left of an otherwise empty page. It reads as a broken
 * render rather than a pending one, and the layout jumps when the data lands
 * because nothing was holding the space.
 *
 * These hold the shape instead, so the page arrives rather than appears.
 */

export function Skeleton({ width, height = 12, radius = 6, style }: {
  width?: number | string;
  height?: number;
  radius?: number;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width: width ?? '100%',
        height,
        borderRadius: radius,
        background: 'linear-gradient(90deg, var(--soft) 25%, var(--softer) 37%, var(--soft) 63%)',
        backgroundSize: '400% 100%',
        animation: 'skeleton 1.4s ease infinite',
        ...style,
      }}
    />
  );
}

/** A card-shaped placeholder, for grids of cards. */
export function SkeletonCard({ lines = 2, height }: { lines?: number; height?: number }) {
  return (
    <div className="card" style={{ gap: 10 }} aria-hidden="true">
      {height && <Skeleton height={height} radius={11} />}
      <Skeleton width="70%" height={13} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '45%' : '90%'} height={10} />
      ))}
    </div>
  );
}

/** A row-shaped placeholder, for lists. */
export function SkeletonRow() {
  return (
    <div className="card-row" aria-hidden="true">
      <Skeleton width={40} height={40} radius={11} />
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
        <Skeleton width="55%" height={12} />
        <Skeleton width="30%" height={9} />
      </span>
    </div>
  );
}

/**
 * Announces loading to a screen reader, which cannot see the shimmer.
 * Visually hidden, so it costs nothing on screen.
 */
export function LoadingLabel({ children }: { children: string }) {
  return (
    <span
      role="status"
      aria-live="polite"
      style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}
    >
      {children}
    </span>
  );
}
