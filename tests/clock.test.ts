import { describe, expect, test } from 'bun:test';
import { clock } from '../apps/web/src/shared/format.ts';

/**
 * A two-hour lesson displayed as "80:00".
 *
 * `clock` was minutes-and-seconds at every length, which is fine for an eight
 * minute lesson and nonsense for a course recording — it reads as eighty
 * minutes until you work out that it cannot be, and it is useless as the label
 * on a scrubber you are dragging.
 */
describe('clock', () => {
  test.each([
    [0, '0:00'],
    [9, '0:09'],
    [70, '1:10'],
    [599, '9:59'],
    [3599, '59:59'],
    // The case that prompted this.
    [3600, '1:00:00'],
    [4800, '1:20:00'],
    [7325, '2:02:05'],
  ])('%i seconds is %s', (seconds, expected) => {
    expect(clock(seconds)).toBe(expected);
  });

  test('a fractional second does not leak into the label', () => {
    expect(clock(70.9)).toBe('1:10');
  });

  test.each([[-5], [Number.NaN], [Number.POSITIVE_INFINITY]])('%p is 0:00 rather than a crash', (v) => {
    expect(clock(v as number)).toBe('0:00');
  });
});
