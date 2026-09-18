import { describe, expect, test } from 'bun:test';
import { CourseInput, CreateComment, LessonInput, WorkshopInput } from '@ipc/contracts';
import { withinQuietHours } from '../services/worker/src/delivery/push.ts';
import { timingSafeEqual } from '../services/api/src/lib/video-provider.ts';

/**
 * Unit tests for the logic that is easy to get subtly wrong and impossible to
 * notice when it is.
 *
 * Deliberately *not* here: anything that needs a database. Those live in
 * scripts/test-rls.ts and scripts/test-studio.ts and run against real
 * Postgres, because the thing they prove — that RLS refuses a member — cannot
 * be proved against a mock.
 */

describe('quiet hours', () => {
  // The window almost always crosses midnight, which is exactly the case a
  // naive `from <= now && now < to` gets wrong — it would silently disable
  // quiet hours for everyone who set a sensible one.
  test('a window crossing midnight covers both sides of it', () => {
    expect(withinQuietHours(23 * 60, '22:00', '08:00')).toBe(true);
    expect(withinQuietHours(2 * 60, '22:00', '08:00')).toBe(true);
    expect(withinQuietHours(7 * 60 + 59, '22:00', '08:00')).toBe(true);
  });

  test('daytime is not quiet', () => {
    expect(withinQuietHours(12 * 60, '22:00', '08:00')).toBe(false);
    expect(withinQuietHours(8 * 60, '22:00', '08:00')).toBe(false);
    expect(withinQuietHours(21 * 60 + 59, '22:00', '08:00')).toBe(false);
  });

  test('a same-day window still works', () => {
    expect(withinQuietHours(14 * 60, '13:00', '15:00')).toBe(true);
    expect(withinQuietHours(16 * 60, '13:00', '15:00')).toBe(false);
  });

  test('the start is inclusive and the end is not', () => {
    expect(withinQuietHours(22 * 60, '22:00', '08:00')).toBe(true);
    expect(withinQuietHours(8 * 60, '22:00', '08:00')).toBe(false);
  });
});

describe('signature comparison', () => {
  test('equal strings match', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true);
  });

  test('different strings do not', () => {
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false);
  });

  test('different lengths do not', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });

  test('an empty expected value never matches a real signature', () => {
    expect(timingSafeEqual('deadbeef', '')).toBe(false);
  });
});

describe('course input', () => {
  const valid = {
    slug: 'lighting-for-weddings',
    title: 'Lighting for weddings',
    category: 'business',
    level: 'beginner',
    language: 'hindi',
    minTier: 'diamond',
  };

  test('accepts a well-formed course', () => {
    expect(CourseInput.safeParse(valid).success).toBe(true);
  });

  test('a draft is the default', () => {
    expect(CourseInput.parse(valid).isPublished).toBe(false);
  });

  // A slug reaches a URL and a unique index. Spaces and capitals produce
  // either a 404 or a duplicate that reads identically to the original.
  test.each([
    ['Lighting For Weddings', 'capitals'],
    ['lighting for weddings', 'spaces'],
    ['-leading-hyphen', 'a leading hyphen'],
    ['trailing-hyphen-', 'a trailing hyphen'],
    ['double--hyphen', 'a doubled hyphen'],
    ['ab', 'being too short'],
  ])('rejects %p (%s)', (slug) => {
    expect(CourseInput.safeParse({ ...valid, slug }).success).toBe(false);
  });
});

describe('workshop input', () => {
  const base = {
    title: 'Posing and direction',
    platform: 'zoom_webinar',
    minTier: 'diamond',
  };

  test('accepts a workshop that ends after it starts', () => {
    const result = WorkshopInput.safeParse({
      ...base,
      startsAt: '2026-10-01T13:30:00.000Z',
      endsAt: '2026-10-01T15:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  // Easy to produce by typing the end time first, and it makes the workshop
  // invisible on every list that filters by `ends_at >= now()`.
  test('rejects one that ends before it starts', () => {
    const result = WorkshopInput.safeParse({
      ...base,
      startsAt: '2026-10-01T15:00:00.000Z',
      endsAt: '2026-10-01T13:30:00.000Z',
    });
    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0]?.path).toEqual(['endsAt']);
  });

  test('rejects a zero-length workshop', () => {
    const at = '2026-10-01T13:30:00.000Z';
    expect(WorkshopInput.safeParse({ ...base, startsAt: at, endsAt: at }).success).toBe(false);
  });

  test('capacity defaults to unlimited rather than zero', () => {
    const parsed = WorkshopInput.parse({
      ...base,
      startsAt: '2026-10-01T13:30:00.000Z',
      endsAt: '2026-10-01T15:00:00.000Z',
    });
    expect(parsed.capacity).toBeNull();
  });
});

describe('comment input', () => {
  test('trims and accepts real text', () => {
    expect(CreateComment.parse({ bodyMd: '  good shot  ' }).bodyMd).toBe('good shot');
  });

  test('rejects whitespace pretending to be a comment', () => {
    expect(CreateComment.safeParse({ bodyMd: '   ' }).success).toBe(false);
  });

  test('a top-level comment has no parent', () => {
    expect(CreateComment.parse({ bodyMd: 'hello' }).parentId).toBeNull();
  });

  test('rejects an over-long comment rather than truncating it', () => {
    expect(CreateComment.safeParse({ bodyMd: 'x'.repeat(2001) }).success).toBe(false);
  });
});

describe('lesson input', () => {
  test('a new lesson has no duration until a file says otherwise', () => {
    expect(LessonInput.parse({ slug: 'first-lesson', title: 'First lesson' }).durationSeconds).toBe(0);
  });

  test('rejects an absurd duration', () => {
    expect(
      LessonInput.safeParse({ slug: 'first-lesson', title: 'First', durationSeconds: 60 * 60 * 24 }).success,
    ).toBe(false);
  });
});
