import { LazyMotion, MotionConfig, domAnimation, m } from 'motion/react';
import type { Transition, Variants } from 'motion/react';

/**
 * Motion, on a budget.
 *
 * Two decisions keep this from costing what an animation library usually
 * costs.
 *
 * **`LazyMotion` with `domAnimation` and the `m` component**, not the full
 * `motion` export. The complete feature set is around 34KB gzipped; this
 * subset is closer to 5KB and covers everything below — transforms, opacity,
 * layout, enter and exit. Importing `motion` anywhere in the app would quietly
 * pull the rest back in, which is why this module re-exports `m` and the app
 * imports from here rather than from the package.
 *
 * **`reducedMotion="user"` at the root.** Every animation here becomes an
 * instant state change for somebody who has asked their system for less
 * motion, without a single check at a call site. That matters more than usual
 * for this audience: vestibular sensitivity is common, and a photographer
 * colour-grading for four hours is exactly the person who turns animation off.
 *
 * The house style is short and small. Nothing moves more than about 8px and
 * nothing takes longer than 220ms, because the job of motion here is to say
 * *where a thing came from* — not to be noticed. A list that slides in from
 * the side on every keystroke is worse than a list that appears.
 */

export { AnimatePresence } from 'motion/react';
export { m };

/** The default curve: quick out of the gate, settles without a bounce. */
export const EASE: Transition = { duration: 0.2, ease: [0.2, 0.9, 0.3, 1] };

/** Content arriving: a short rise, because it came from below the fold. */
export const rise: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: EASE },
  exit: { opacity: 0, y: -4, transition: { duration: 0.12 } },
};

/** Something appearing in place — a panel, a dialog, a preview. */
export const pop: Variants = {
  hidden: { opacity: 0, scale: 0.97 },
  show: { opacity: 1, scale: 1, transition: EASE },
  exit: { opacity: 0, scale: 0.98, transition: { duration: 0.12 } },
};

/**
 * A list where children arrive one after another.
 *
 * `staggerChildren` is deliberately tiny. At 0.04s a twenty-item feed finishes
 * in under a second; at the 0.1s most examples use, the last post lands two
 * seconds after the first and the page feels slow rather than considered.
 */
export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};

/**
 * Wraps the app once. Everything else is `m.div` with the variants above.
 */
export function Motion({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user" transition={EASE}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}

/**
 * A list that animates its children in, and animates removals out.
 *
 * Used where items genuinely come and go — the feed, a roster, search results.
 * Not used for static content, where the animation is pure cost.
 */
export function StaggerList({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <m.div variants={stagger} initial="hidden" animate="show" className={className} style={style}>
      {children}
    </m.div>
  );
}

/** One child of a StaggerList. */
export function StaggerItem({
  children,
  className,
  style,
  layout,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /** Animate position changes too — for lists that reorder, like a roster. */
  layout?: boolean;
}) {
  return (
    <m.div variants={rise} layout={layout} className={className} style={style}>
      {children}
    </m.div>
  );
}
