import { describe, expect, test } from 'bun:test';
import { xpLabel } from '../apps/web/src/shared/format.ts';

describe('xpLabel', () => {
  test('shows small values as-is', () => {
    expect(xpLabel(0)).toBe('0');
    expect(xpLabel(90)).toBe('90');
    expect(xpLabel(999)).toBe('999');
  });
  test('compacts thousands', () => {
    expect(xpLabel(1000)).toBe('1K');
    expect(xpLabel(1500)).toBe('1.5K');
    expect(xpLabel(12345)).toBe('12K');
  });
  test('compacts lakhs', () => {
    expect(xpLabel(100000)).toBe('1L');
    expect(xpLabel(125000)).toBe('1.25L');
  });
});
