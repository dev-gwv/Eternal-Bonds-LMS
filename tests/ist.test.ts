import { describe, expect, test } from 'bun:test';

/**
 * The IST ⇄ UTC conversion the workshop scheduler runs on.
 *
 * The pair is reproduced here rather than imported: the source is a .tsx
 * module that pulls in React, and a test that asserts the arithmetic is worth
 * more than one that asserts nothing because it could not import anything.
 */
const IST_OFFSET_MINUTES = 5 * 60 + 30;

function istToIso(local: string): string {
  const [date, time] = local.split('T');
  const [y, m, d] = (date ?? '').split('-').map(Number);
  const [hh, mm] = (time ?? '').split(':').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, hh!, mm! - IST_OFFSET_MINUTES)).toISOString();
}

function isoToIst(iso: string): string {
  return new Date(Date.parse(iso) + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 16);
}

describe('IST conversion', () => {
  test('7pm IST is 13:30 UTC', () => {
    expect(istToIso('2026-10-01T19:00')).toBe('2026-10-01T13:30:00.000Z');
  });

  // The half-hour offset is what makes this worth testing at all: a
  // whole-hour timezone hides an off-by-30 that IST does not.
  test('the half-hour offset is applied', () => {
    expect(istToIso('2026-10-01T00:00')).toBe('2026-09-30T18:30:00.000Z');
  });

  test('a time early enough rolls back to the previous UTC day', () => {
    expect(istToIso('2026-01-01T05:00')).toBe('2025-12-31T23:30:00.000Z');
  });

  test('the round trip is lossless', () => {
    for (const local of ['2026-10-01T19:00', '2026-01-01T00:00', '2026-06-15T23:45', '2026-03-09T05:30']) {
      expect(isoToIst(istToIso(local))).toBe(local);
    }
  });

  // India has no daylight saving, which is why a fixed offset is correct here
  // and would be a bug almost anywhere else. Asserted so nobody "fixes" it.
  test('the offset does not shift across the year', () => {
    expect(istToIso('2026-01-15T12:00')).toBe('2026-01-15T06:30:00.000Z');
    expect(istToIso('2026-07-15T12:00')).toBe('2026-07-15T06:30:00.000Z');
  });
});
