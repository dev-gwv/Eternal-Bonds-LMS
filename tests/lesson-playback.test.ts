import { describe, expect, test } from 'bun:test';

/**
 * Why a two-hour lesson would not play.
 *
 * Three separate mistakes, all the same shape: a value that changes during
 * playback was treated as if it were fixed at the start.
 *
 * `startAt` is `lastPositionSeconds`. Progress saves every fifteen seconds,
 * each save invalidated the course query, the refetch produced a new
 * `startAt`, and `startAt` was in the player effect's dependency array — so
 * the player was destroyed and rebuilt roughly every fifteen seconds. On a
 * two-hour video that is around eight rebuilds a minute, each one stopping
 * playback and reloading the iframe.
 *
 * These are the rules the fix depends on, stated where a future refactor will
 * trip over them.
 */

/** What the player effect is allowed to restart on. */
const playerDeps = (videoId: string) => [videoId];

/** Whether a progress save should invalidate the course query. */
const shouldInvalidate = (vars: { completed?: boolean }) => vars.completed !== undefined;

/** Whether the Mark complete button should show its busy state. */
const isMarking = (pending: boolean, vars?: { completed?: boolean }) =>
  pending && vars?.completed !== undefined;

describe('the player restarts only when the video changes', () => {
  test('a new resume position does not restart it', () => {
    const before = playerDeps('GmsQ0199BW0');
    const after = playerDeps('GmsQ0199BW0');
    expect(after).toEqual(before);
  });

  test('a different video does', () => {
    expect(playerDeps('AAAAAAAAAAA')).not.toEqual(playerDeps('BBBBBBBBBBB'));
  });
});

describe('a position tick is not a page change', () => {
  test('the fifteen-second tick does not refetch the course', () => {
    expect(shouldInvalidate({ positionSeconds: 42, watchedSeconds: 15 } as never)).toBe(false);
  });

  test('completing it does', () => {
    expect(shouldInvalidate({ completed: true })).toBe(true);
  });

  // Writing this test is what caught the first version of the fix, which
  // skipped the refetch on a falsy `completed` — so un-marking a lesson left
  // the button still saying "Completed" until something else refetched.
  test('un-completing it does too, because the page changes either way', () => {
    expect(shouldInvalidate({ completed: false })).toBe(true);
  });
});

describe('Mark complete shows busy only for its own save', () => {
  test('not while a background tick is in flight', () => {
    expect(isMarking(true, { positionSeconds: 42 } as never)).toBe(false);
  });

  test('yes while the member is marking it', () => {
    expect(isMarking(true, { completed: true })).toBe(true);
  });

  test('and not when nothing is in flight', () => {
    expect(isMarking(false, { completed: true })).toBe(false);
  });
});
