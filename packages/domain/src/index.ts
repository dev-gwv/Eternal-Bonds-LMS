/**
 * Pure business logic: no I/O, trivially unit-tested, reused by API + worker.
 * Anything here must be deterministic given its inputs.
 */

export type Tier = 'free' | 'silver' | 'diamond' | 'franchisee';

const TIER_RANK: Record<Tier, number> = { free: 0, silver: 1, diamond: 2, franchisee: 3 };

/** Tier gating: does `member` reach content requiring `minTier`? */
export function tierAllows(member: Tier, minTier: Tier): boolean {
  return TIER_RANK[member] >= TIER_RANK[minTier];
}

/** Lesson progress → percent. Guards divide-by-zero on zero-length lessons. */
export function progressPercent(watchedSeconds: number, durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  return Math.min(100, Math.round((watchedSeconds / durationSeconds) * 100));
}

/** Auto-complete at 90% watched, in addition to the manual toggle. */
export function shouldAutoComplete(watchedSeconds: number, durationSeconds: number): boolean {
  return durationSeconds > 0 && watchedSeconds / durationSeconds >= 0.9;
}

/** Vote-cycle scoring: raw votes win; featuring is a recorded decision, not a derived max. */
export function rankInsights<T extends { votes: number; createdAt: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => b.votes - a.votes || Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
}

/** Streak continuation in the member's own timezone date (YYYY-MM-DD). */
export function nextStreak(current: number, lastActiveOn: string | null, today: string): number {
  if (!lastActiveOn) return 1;
  if (lastActiveOn === today) return current;
  const d = (s: string) => Date.parse(`${s}T00:00:00Z`);
  const diffDays = Math.round((d(today) - d(lastActiveOn)) / 86400000);
  if (diffDays === 1) return current + 1;
  return 1;
}

export type BadgeRule = { kind: string; count: number };

/** Does a stat snapshot satisfy a badge rule? The worker evaluates this over activity_events. */
export function badgeEarned(
  rule: BadgeRule,
  stats: { lessonsCompleted: number; insightsPublished: number; winsPublished: number; streakDays: number; questionsAnswered: number },
): boolean {
  switch (rule.kind) {
    case 'lessons_completed': return stats.lessonsCompleted >= rule.count;
    case 'insights_published': return stats.insightsPublished >= rule.count;
    case 'wins_published': return stats.winsPublished >= rule.count;
    case 'streak_days': return stats.streakDays >= rule.count;
    case 'questions_answered': return stats.questionsAnswered >= rule.count;
    default: return false;
  }
}

/** Fractional-rank midpoint for drag reorder without rewriting siblings. */
export function rankBetween(before: number | null, after: number | null): number {
  if (before == null && after == null) return 1000;
  if (before == null) return after! - 1;
  if (after == null) return before + 1;
  return (before + after) / 2;
}
