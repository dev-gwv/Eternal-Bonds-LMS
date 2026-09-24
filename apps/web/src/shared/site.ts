/**
 * The handful of facts about the club itself that the application renders but
 * does not own: where to write to it, and where it exists elsewhere.
 *
 * These live in build-time config rather than in the database because they are
 * chrome, not content — the footer must render before any request resolves,
 * and a fetch for three URLs that change once a year is a poor trade.
 *
 * Everything here is optional and everything here is public. `VITE_` values
 * are compiled into the bundle every visitor downloads, which is correct for a
 * public Instagram handle and would be a disaster for anything else.
 *
 * The rule the footer follows: a link that is not configured is not rendered.
 * A dead `#contact` anchor is worse than no contact link, because somebody
 * clicks it, nothing happens, and they conclude the site is broken rather than
 * that the club has not filled it in.
 */

const clean = (v: string | undefined): string | null => {
  const s = (v ?? '').trim();
  return s === '' ? null : s;
};

export const supportEmail = clean(import.meta.env.VITE_SUPPORT_EMAIL);

export type SocialLink = { key: string; label: string; href: string };

/** Rendered in this order; each appears only if its handle is configured. */
export const socialLinks: SocialLink[] = [
  { key: 'instagram', label: 'Instagram', value: clean(import.meta.env.VITE_SOCIAL_INSTAGRAM) },
  { key: 'youtube', label: 'YouTube', value: clean(import.meta.env.VITE_SOCIAL_YOUTUBE) },
  { key: 'facebook', label: 'Facebook', value: clean(import.meta.env.VITE_SOCIAL_FACEBOOK) },
].flatMap(({ key, label, value }) =>
  value === null
    ? []
    : // Accept either a full URL or a bare handle, because whoever fills this
      // in will paste whichever one they have to hand.
      [{ key, label, href: /^https?:\/\//i.test(value) ? value : handleUrl(key, value) }],
);

function handleUrl(key: string, handle: string): string {
  const h = handle.replace(/^@/, '');
  if (key === 'instagram') return `https://instagram.com/${h}`;
  if (key === 'youtube') return `https://youtube.com/@${h}`;
  return `https://facebook.com/${h}`;
}
