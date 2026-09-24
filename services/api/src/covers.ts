import { sql } from 'drizzle-orm';
import { withUser } from '@ipc/db';
import type { Env } from './env.ts';
import { HttpError } from './lib/problem.ts';
import { createStorage } from './lib/storage.ts';
import { getDb } from './repo.ts';

/**
 * One cover image mechanism, for everything that has one.
 *
 * Courses got a cover first and the pattern was copied by hand: a ticket
 * endpoint, a set endpoint, a clear endpoint, a picker component, a signing
 * call on the read path. Adding it to workshops, journeys, insights and
 * library items would have been four more copies of five things, and the
 * fourth copy of anything is where the versions start disagreeing about, say,
 * how wide an image is downscaled to.
 *
 * So: one column name (`cover_key`) on every table that has one, an allowlist
 * of which tables those are, and one set of endpoints keyed by it. The
 * allowlist is the security boundary — `kind` arrives from the browser, and
 * without it this is an arbitrary-table-update endpoint with a friendly name.
 */

/** The only tables this may touch, and where their images live in storage. */
const COVERABLE = {
  course: { table: 'courses', prefix: 'covers/courses' },
  workshop: { table: 'workshops', prefix: 'covers/workshops' },
  journey: { table: 'journeys', prefix: 'covers/journeys' },
  insight: { table: 'insights', prefix: 'covers/insights' },
  'library-item': { table: 'library_items', prefix: 'covers/library' },
} as const;

export type CoverKind = keyof typeof COVERABLE;

export const isCoverKind = (v: string): v is CoverKind => v in COVERABLE;

const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
export type CoverMime = keyof typeof MIME_EXT;

const requireDb = (env: Env) => {
  const db = getDb(env);
  if (!db) throw new HttpError(503, 'Needs a database');
  return db;
};

/**
 * Signs a direct browser-to-storage upload.
 *
 * The bytes never pass through this process — the same two-step as lesson
 * video and avatars. The key is returned so the caller can hand it back once
 * the upload succeeds; a ticket that is never used costs nothing but an
 * orphaned object.
 */
export async function coverTicket(
  env: Env,
  kind: CoverKind,
  id: string,
  mime: CoverMime,
): Promise<{ key: string; url: string; token: string | null; method: 'PUT' }> {
  const key = `${COVERABLE[kind].prefix}/${id}/${crypto.randomUUID()}.${MIME_EXT[mime]}`;
  const { url, token } = await createStorage(env).signedUploadUrl(key);
  return { key, url, token, method: 'PUT' };
}

/**
 * Records the key, or clears it.
 *
 * The table name is interpolated raw, which is only safe because `kind` has
 * already been narrowed to a key of `COVERABLE` — it can never be a string
 * from the request. The id is parameterised as normal.
 *
 * RLS does the authorisation: every one of these tables has an admin-write
 * policy, and this runs as the caller, so a member reaching this endpoint
 * updates nothing rather than being trusted not to try.
 */
export async function setCover(
  env: Env,
  userId: string,
  kind: CoverKind,
  id: string,
  key: string | null,
): Promise<{ coverUrl: string | null }> {
  const db = requireDb(env);
  const table = COVERABLE[kind].table;

  return withUser(db, userId, async (tx) => {
    const rows = await tx.execute<{ cover_key: string | null }>(sql`
      update ${sql.raw(`public.${table}`)}
      set cover_key = ${key}
      where id = ${id}::uuid
      returning cover_key
    `);
    if (rows.length === 0) throw new HttpError(404, 'Nothing to put a cover on');

    const stored = rows[0]!.cover_key;
    // Signed straight back so the picker can show what it just uploaded
    // without a second round trip and without holding the local blob.
    return {
      coverUrl: stored ? await createStorage(env).signedDownloadUrl(stored, 3600).catch(() => null) : null,
    };
  });
}

/**
 * Signs a batch of keys for a list page.
 *
 * Every read path that shows covers needs this, and doing it one await at a
 * time inside a `.map` is how a twenty-card grid becomes twenty sequential
 * round trips to storage. Nulls and failures come back as null: a missing
 * cover degrades to the gradient placeholder, never to a broken page.
 */
export async function signCovers(env: Env, keys: (string | null)[]): Promise<(string | null)[]> {
  const storage = createStorage(env);
  const unique = [...new Set(keys.filter((k): k is string => Boolean(k)))];
  const signed = new Map<string, string | null>();

  await Promise.all(
    unique.map(async (key) => {
      signed.set(key, await storage.signedDownloadUrl(key, 3600).catch(() => null));
    }),
  );

  return keys.map((k) => (k ? (signed.get(k) ?? null) : null));
}
