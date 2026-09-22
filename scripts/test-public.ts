/**
 * Proves the public win page shows exactly what it should and nothing else.
 *
 *   bun run db:test-public
 *
 * This is the only surface in the app a stranger can read, so the checks that
 * matter are all negative: a draft must not be readable, an opted-out win must
 * not be readable, a suspended author's win must not be readable, and none of
 * them may be *distinguishable* from a slug that was never real — anything
 * else confirms a guessed URL.
 *
 * Every query here runs through `withUser(db, null)`, which drops to the anon
 * role, so what passes is what the policies allow rather than what a handler
 * remembered to filter.
 */
import { sql } from 'drizzle-orm';
import { withUser, createDb } from '@ipc/db';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const db = createDb(url, { max: 1 });

const author = crypto.randomUUID();
const banned = crypto.randomUUID();
const everyone = [author, banned];
const stamp = Date.now();

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

async function createMember(id: string, email: string) {
  await db.execute(sql`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    values (${id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${email}, '', now(), now(), now(), '{}'::jsonb, ${JSON.stringify({ full_name: email.split('@')[0] })}::jsonb)
  `);
  await db.execute(sql`
    insert into public.memberships (user_id, tier, status, source) values (${id}, 'diamond', 'active', 'test')
  `);
}

async function makeWin(
  owner: string,
  key: string,
  status: string,
  publicShare: boolean,
): Promise<string> {
  const [w] = await db.execute<{ id: string }>(sql`
    insert into wins (author_id, slug, title, big_idea_md, how_it_happened_md, category, status, public_share)
    values (
      ${owner}, ${`pub-${key}-${stamp}`}, ${`A win: ${key}`},
      ${'The big idea, at least forty characters long so the check passes.'},
      ${'How it happened, also at least forty characters long here.'},
      'revenue', ${status}, ${publicShare}
    )
    returning id
  `);
  return w!.id;
}

/** What an anonymous visitor can see, by slug. */
const asStranger = (slug: string) =>
  withUser(db, null, async (tx) => {
    const rows = await tx.execute<{ id: string; title: string }>(
      sql`select id, title from wins where slug = ${slug}`,
    );
    return rows[0] ?? null;
  });

const winIds: string[] = [];

try {
  console.log('\nSetup');
  await createMember(author, `pub-author-${stamp}@example.test`);
  await createMember(banned, `pub-banned-${stamp}@example.test`);

  const shared = await makeWin(author, 'shared', 'published', true);
  const notShared = await makeWin(author, 'private', 'published', false);
  const draft = await makeWin(author, 'draft', 'pending', true);
  const bySuspended = await makeWin(banned, 'suspended', 'published', true);
  winIds.push(shared, notShared, draft, bySuspended);
  check('four wins exist in four states', winIds.length === 4);

  console.log('\nWhat a stranger can read');
  const ok = await asStranger(`pub-shared-${stamp}`);
  check('a published, opted-in win is public', ok !== null, ok?.title);

  console.log('\nWhat a stranger cannot');
  check('a published win the author did not share is not', (await asStranger(`pub-private-${stamp}`)) === null);
  check('a draft that was opted in is not', (await asStranger(`pub-draft-${stamp}`)) === null);

  // Suspension is a moderation action and it has to reach the public copy,
  // or the one thing a removed member keeps is their shop window.
  await db.execute(sql`update users set is_suspended = true where id = ${banned}`);
  check("a suspended author's win is not", (await asStranger(`pub-suspended-${stamp}`)) === null);

  // And it comes back if they are reinstated.
  await db.execute(sql`update users set is_suspended = false where id = ${banned}`);
  check('and returns when they are reinstated', (await asStranger(`pub-suspended-${stamp}`)) !== null);
  await db.execute(sql`update users set is_suspended = true where id = ${banned}`);

  console.log('\nThe media follows the same rule');
  for (const [id, key] of [
    [shared, 'shared'],
    [notShared, 'private'],
  ] as const) {
    await db.execute(sql`
      insert into win_media (win_id, storage_key, mime)
      values (${id}, ${`wins/${id}/proof.jpg`}, 'image/jpeg')
    `);
  }
  const visibleMedia = await withUser(db, null, async (tx) =>
    tx.execute<{ id: string }>(sql`
      select m.id from win_media m where m.win_id in (${shared}::uuid, ${notShared}::uuid)
    `),
  );
  check(
    'only the shared win exposes its photographs',
    visibleMedia.length === 1,
    `${visibleMedia.length} of 2 visible`,
  );

  console.log('\nThe author byline');
  const [name] = await withUser(db, null, async (tx) =>
    tx.execute<{ n: string | null }>(sql`select public.public_win_author(${shared}::uuid) as n`),
  );
  check('a name comes back for the shared win', Boolean(name?.n), name?.n ?? '');

  const [hidden] = await withUser(db, null, async (tx) =>
    tx.execute<{ n: string | null }>(sql`select public.public_win_author(${notShared}::uuid) as n`),
  );
  // The function carries the same three conditions, so it cannot become a way
  // to confirm that a private win exists.
  check('and nothing for one that is not shared', hidden?.n === null);

  console.log('\nNothing else leaked');
  const users = await withUser(db, null, async (tx) =>
    tx.execute<{ n: number }>(sql`select count(*)::int as n from users`),
  );
  check('anon still cannot read the users table', Number(users[0]?.n ?? 0) === 0, `${users[0]?.n} rows`);

  const posts = await withUser(db, null, async (tx) =>
    tx.execute<{ n: number }>(sql`select count(*)::int as n from posts`),
  );
  check('nor the community feed', Number(posts[0]?.n ?? 0) === 0, `${posts[0]?.n} rows`);

  const otherWins = await withUser(db, null, async (tx) =>
    tx.execute<{ n: number }>(sql`select count(*)::int as n from wins`),
  );
  check('and sees only shared wins in the wins table', Number(otherWins[0]?.n ?? 0) === 1, `${otherWins[0]?.n} rows`);
} finally {
  console.log('\nCleanup');
  if (winIds.length) {
    await db.execute(sql`delete from wins where id in ${sql.raw(`('${winIds.join("','")}')`)}`);
  }
  await db.execute(sql`delete from auth.users where id in ${sql.raw(`('${everyone.join("','")}')`)}`);
  await db.$client.end({ timeout: 5 });
}

console.log(failures === 0 ? '\nThe public surface holds.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
