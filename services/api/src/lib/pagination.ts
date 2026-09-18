import { z } from 'zod';

/**
 * Cursor pagination, never offset: a feed mutates under you, and offset paging
 * makes a mobile client show duplicates as it scrolls.
 */
export const PageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type Page<T> = { items: T[]; nextCursor: string | null };

export const encodeCursor = (value: string) => Buffer.from(value, 'utf8').toString('base64url');
export const decodeCursor = (cursor: string | undefined) =>
  cursor ? Buffer.from(cursor, 'base64url').toString('utf8') : null;

/** Slices an already-sorted array; the DB-backed version uses a keyset WHERE. */
export function paginate<T>(rows: T[], limit: number, key: (row: T) => string, cursor?: string): Page<T> {
  const after = decodeCursor(cursor);
  const start = after ? rows.findIndex((r) => key(r) === after) + 1 : 0;
  const slice = rows.slice(start, start + limit);
  const last = slice.at(-1);
  const more = start + limit < rows.length;
  return { items: slice, nextCursor: more && last ? encodeCursor(key(last)) : null };
}
