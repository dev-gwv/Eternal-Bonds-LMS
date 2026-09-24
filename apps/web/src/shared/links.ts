/**
 * Splits a stored link into the shape TanStack expects.
 *
 * Notification links and search hits are built server-side as plain strings —
 * `/community?post=<id>` — because they also have to work in an email, where
 * there is no router. Passing that whole string as `to` makes TanStack look
 * for a route literally named "/community?post=…", which does not exist, so
 * the navigation silently did nothing useful.
 */
export function splitLink(link: string): { to: string; search: Record<string, string> } {
  const [to, query] = link.split('?');
  if (!query) return { to: link, search: {} };
  const search: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(query)) search[k] = v;
  return { to: to || '/', search };
}
