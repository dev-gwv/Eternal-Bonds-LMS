import { describe, expect, test } from 'bun:test';
import {
  badgeEarned, nextStreak, progressPercent, rankBetween, shouldAutoComplete, tierAllows,
} from '@ipc/domain';
import { can } from '@ipc/permissions';
import { Dashboard, Performance, ShareInsight, SubmitWin } from '@ipc/contracts';

/**
 * Platform second half: domain rules, the permissions matrix and the
 * Think Tank / Wins contracts that enforce the blueprint.
 */

describe('tier gating', () => {
  test('diamond reaches diamond content, silver does not', () => {
    expect(tierAllows('diamond', 'diamond')).toBe(true);
    expect(tierAllows('silver', 'diamond')).toBe(false);
    expect(tierAllows('franchisee', 'free')).toBe(true);
  });
});

describe('progress math', () => {
  test('percent guards divide-by-zero', () => {
    expect(progressPercent(100, 0)).toBe(0);
    expect(progressPercent(45, 100)).toBe(45);
  });
  test('auto-complete at 90%', () => {
    expect(shouldAutoComplete(90, 100)).toBe(true);
    expect(shouldAutoComplete(89, 100)).toBe(false);
  });
});

describe('streaks', () => {
  test('consecutive days continue, gaps reset', () => {
    expect(nextStreak(3, '2026-09-19', '2026-09-20')).toBe(4);
    expect(nextStreak(3, '2026-09-18', '2026-09-20')).toBe(1);
    expect(nextStreak(3, '2026-09-20', '2026-09-20')).toBe(3);
  });
});

describe('badges', () => {
  const stats = { lessonsCompleted: 10, insightsPublished: 0, winsPublished: 1, streakDays: 7, questionsAnswered: 0 };
  test('ten lessons earns momentum', () => {
    expect(badgeEarned({ kind: 'lessons_completed', count: 10 }, stats)).toBe(true);
    expect(badgeEarned({ kind: 'insights_published', count: 1 }, stats)).toBe(false);
  });
  test('unknown rules never earn', () => {
    expect(badgeEarned({ kind: 'teleportation', count: 1 }, stats)).toBe(false);
  });
});

describe('permissions matrix', () => {
  test('admins can do everything; members cannot author or moderate', () => {
    expect(can({ role: 'admin', tier: 'free', action: 'course.author' })).toBe(true);
    expect(can({ role: 'member', tier: 'diamond', action: 'course.author' })).toBe(false);
    expect(can({ role: 'member', tier: 'free', action: 'member.moderate' })).toBe(false);
  });
  test('photolancer briefs need silver', () => {
    expect(can({ role: 'member', tier: 'free', action: 'brief.publish' })).toBe(false);
    expect(can({ role: 'member', tier: 'silver', action: 'brief.publish' })).toBe(true);
  });
});

describe('blueprint enforcement', () => {
  test('thin wins are rejected by the contract', () => {
    const r = SubmitWin.safeParse({ title: 'Won', bigIdeaMd: 'short', howItHappenedMd: 'short' });
    expect(r.success).toBe(false);
  });
  test('thin insights are rejected by the contract', () => {
    const r = ShareInsight.safeParse({
      title: 'Hi', situationMd: 'x', bigIdeaMd: 'y', domainSlug: 'business', impactSlug: 'growth',
    });
    expect(r.success).toBe(false);
  });
});

describe('reorder ranks', () => {
  test('midpoints never rewrite siblings', () => {
    expect(rankBetween(100, 200)).toBe(150);
    expect(rankBetween(null, 100)).toBeLessThan(100);
    expect(rankBetween(100, null)).toBeGreaterThan(100);
  });
});

describe('momentum performance', () => {
  test('quiz/exam splits are gone; consistency/completion/streak parse', () => {
    const r = Performance.safeParse({
      totalScore: 64,
      breakdown: { consistency: 70, completion: 62, streak: 37 },
      trend: [{ label: 'Sep', value: 78 }],
    });
    expect(r.success).toBe(true);
  });

  test('the old fiction no longer validates', () => {
    const r = Performance.safeParse({
      totalScore: 80,
      breakdown: { participation: 55, quiz: 15, exam: 10 },
      trend: [],
    });
    expect(r.success).toBe(false);
  });
});

describe('dashboard composite', () => {
  test('stats + activity + performance + leaderboard + workshops parse together', () => {
    const r = Dashboard.safeParse({
      stats: {
        lessonsCompleted: 12, coursesInProgress: 2, minutesLearned: 486,
        streakDays: 4, longestStreakDays: 11, xp: 2450, rank: 18,
        workshopsAttended: 0, upcomingWorkshops: 3,
      },
      activity: [{ day: 'mon', courses: 10, workshops: 0, library: 5 }],
      performance: {
        totalScore: 64,
        breakdown: { consistency: 70, completion: 62, streak: 37 },
        trend: [],
      },
      leaderboard: [{ rank: 1, name: 'A', initials: 'A', xp: 100 }],
      workshops: [],
    });
    expect(r.success).toBe(true);
  });
});
