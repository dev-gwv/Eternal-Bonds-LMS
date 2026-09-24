/**
 * Proves the cover endpoint is not an arbitrary-table-update endpoint.
 *
 *   bun run db:test-covers
 *
 * One mechanism serves five kinds of thing, and `kind` arrives from the
 * browser. Two properties keep that from being a mistake:
 *
 *   - `kind` is narrowed against an allowlist before it reaches a query. The
 *     table name is interpolated raw — it has to be, you cannot parameterise
 *     an identifier — so the allowlist is the only thing between this and
 *     `update <whatever they sent>`.
 *   - Who may set a cover on what is the RLS policy on that table, not a
 *     second list in the API. An insight author may cover their own insight;
 *     the same member reaching for a course updates zero rows.
 *
 * The second is why the routes are mounted once for everybody instead of an
 * admin copy and a member copy. This test is what makes that safe to claim.
 */
import { sql } from 'drizzle-orm';
import { createDb } from '@ipc/db';
import { isCoverKind, setCover } from '../services/api/src/covers.ts';
import { EnvSchema } from '../services/api/src/env.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const env = EnvSchema.parse(process.env);
const db = createDb(url, { max: 1 });

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const stamp = Date.now();
const admin = crypto.randomUUID();
const author = crypto.randomUUID();
const other = crypto.randomUUID();
const everyone = [admin, author, other];
let courseId = '';
let insightId = '';

async function createUser(id: string, email: string, role: 'admin' | 'member') {
  await db.execute(sql`
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data, aud, role)
    values (${id}::uuid, ${email}, '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated')
    on conflict (id) do nothing
  `);
  await db.execute(sql`update users set role = ${role}, full_name = ${'Cover ' + role} where id = ${id}::uuid`);
}

const refused = async (label: string, fn: () => Promise<unknown>) => {
  try {
    await fn();
    check(label, false, 'it was allowed');
  } catch (e) {
    const msg = (e as { title?: string; message?: string }).title ?? (e as Error).message;
    check(label, true, String(msg).slice(0, 60));
  }
};

try {
  console.log('\nSetup');
  await createUser(admin, `cover-admin-${stamp}@example.test`, 'admin');
  await createUser(author, `cover-author-${stamp}@example.test`, 'member');
  await createUser(other, `cover-other-${stamp}@example.test`, 'member');

  const [course] = await db.execute<{ id: string }>(sql`
    insert into courses (slug, title, category, level, language, min_tier, is_published)
    values (${'cover-fixture-' + stamp}, 'Cover fixture', 'business', 'beginner', 'english', 'free', true)
    returning id
  `);
  courseId = course!.id;

  const [insight] = await db.execute<{ id: string }>(sql`
    insert into insights (author_id, slug, title, situation_md, big_idea_md, how_md, status)
    values (${author}::uuid, ${'cover-insight-' + stamp}, 'Cover insight', 's', 'b', 'h', 'published')
    returning id
  `);
  insightId = insight!.id;
  check('a course and a member-authored insight exist', true);

  console.log('\nThe allowlist');
  check('a known kind is accepted', isCoverKind('course') && isCoverKind('library-item'));
  check('an unknown one is not', !isCoverKind('users') && !isCoverKind('wins'));

  console.log('\nAdmins');
  const set = await setCover(env, admin, 'course', courseId, 'covers/courses/x.jpg');
  check('an admin can set a course cover', 'coverUrl' in set);
  const [stored] = await db.execute<{ cover_key: string | null }>(sql`
    select cover_key from courses where id = ${courseId}::uuid
  `);
  check('and it is recorded', stored?.cover_key === 'covers/courses/x.jpg', String(stored?.cover_key));

  await setCover(env, admin, 'course', courseId, null);
  const [cleared] = await db.execute<{ cover_key: string | null }>(sql`
    select cover_key from courses where id = ${courseId}::uuid
  `);
  check('and can clear it', cleared?.cover_key === null);

  console.log('\nAuthors');
  await setCover(env, author, 'insight', insightId, 'covers/insights/mine.jpg');
  const [own] = await db.execute<{ cover_key: string | null }>(sql`
    select cover_key from insights where id = ${insightId}::uuid
  `);
  check('an author can cover their own insight', own?.cover_key === 'covers/insights/mine.jpg');

  console.log('\nEverybody else');
  // The row is invisible to the update, so it affects nothing and reports a
  // 404 — the same answer as a challenge that does not exist, on purpose.
  await refused('a member cannot cover a course', () =>
    setCover(env, other, 'course', courseId, 'covers/courses/nope.jpg'),
  );
  const [untouched] = await db.execute<{ cover_key: string | null }>(sql`
    select cover_key from courses where id = ${courseId}::uuid
  `);
  check('and the course is untouched', untouched?.cover_key === null);

  await refused("a member cannot cover somebody else's insight", () =>
    setCover(env, other, 'insight', insightId, 'covers/insights/nope.jpg'),
  );
  const [stillMine] = await db.execute<{ cover_key: string | null }>(sql`
    select cover_key from insights where id = ${insightId}::uuid
  `);
  check('and the insight keeps the author picture', stillMine?.cover_key === 'covers/insights/mine.jpg');

  console.log('\nMissing rows');
  await refused('a cover on something that does not exist is a 404', () =>
    setCover(env, admin, 'journey', crypto.randomUUID(), 'covers/journeys/x.jpg'),
  );
} finally {
  console.log('\nCleanup');
  if (insightId) await db.execute(sql`delete from insights where id = ${insightId}::uuid`);
  if (courseId) await db.execute(sql`delete from courses where id = ${courseId}::uuid`);
  await db.execute(sql`delete from auth.users where id in ${sql.raw(`('${everyone.join("','")}')`)}`);
  await db.$client.end({ timeout: 5 });
}

console.log(failures === 0 ? '\nCovers stay where they belong.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
