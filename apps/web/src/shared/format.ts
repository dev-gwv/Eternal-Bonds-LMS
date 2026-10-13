/**
 * Pure formatters. No network, no config, no Vite globals.
 *
 * They lived in `api.ts`, which imports the Supabase client, which reads a
 * build-time `define`. That made them unimportable from a test: pulling in
 * `clock` pulled in the whole auth module and failed on `__DEV_LOGIN__ is not
 * defined`. A function that turns a number into a string should not need a
 * browser, a build step or a session to be checked.
 */

/**
 * m:ss, or h:mm:ss once there is an hour of it.
 *
 * It used to be minutes and seconds at every length, so a two-hour lesson
 * displayed as "80:00" — which reads as eighty minutes for exactly as long as
 * it takes you to work out that it cannot be, and is useless as the label on a
 * scrubber somebody is dragging.
 */
export const clock = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
};

/** "45m", "2h" — the rough length on a card, where precision is noise. */
export const durationLabel = (minutes: number) =>
  minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes}m`;

/**
 * Compact XP: "90", "1.5K", "12K", "1.25L".
 *
 * It used to round every value under a lakh to whole thousands, so a member
 * with 90 XP read "0K XP" on the leaderboard. Under a thousand there is
 * nothing to compact; above, one decimal while it still carries meaning.
 */
export const xpLabel = (xp: number) => {
  if (!Number.isFinite(xp)) return '0';
  const n = Math.round(xp);
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  const trim = (s: string) => s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  if (a < 1000) return `${sign}${a}`;
  if (a < 100000) {
    const k = a / 1000;
    return `${sign}${trim(k < 10 ? (Math.floor(k * 10) / 10).toFixed(1) : String(Math.floor(k)))}K`;
  }
  return `${sign}${trim((Math.floor(a / 1000) / 100).toFixed(2))}L`;
};
