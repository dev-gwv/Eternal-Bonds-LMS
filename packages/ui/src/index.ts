/**
 * Shared UI package. The canonical tokens live in `apps/web/src/styles.css`
 * (CSS custom properties read by Tailwind); this package holds the framework-free
 * helpers plus the responsive Modal contract: centered dialog at md+, swipeable
 * bottom sheet below it. Components stay in the web app until a second client
 * needs them — premature extraction is how shared packages go stale.
 */

export const BREAKPOINTS = { md: 768, lg: 1100 } as const;

/** CSS class contract for the responsive modal. The web app implements it. */
export const MODAL_CLASS = 'ipc-modal';

export function initials(name: string): string {
  return name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}
