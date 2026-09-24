/**
 * Proves the rules a challenge relies on, and that they live in the database.
 *
 *   bun run db:test-challenges
 *
 * An entry is a win, which is what makes the feature small — it inherits
 * photographs, moderation, reactions and the board for free. The price is that
 * the rules about *entering* have to be enforced on `wins`, a table that four
 * other code paths write to. So they are a trigger and a unique index rather
 * than an `if` in one handler:
 *
 *   - one entry per member per challenge (index, not a read-then-write)
 *   - no entering a closed challenge, or one that has run out of days
 *   - no entering above your tier
 *
 * The API reports all three before a member writes anything. These checks are
 * about what happens when it does not — a refactor, a second code path, or two
 * tabs.
 */
import { sql } from 'drizzle-orm';
import { createDb, withUser } from '@ipc/db';
import * as challenges from '../services/api/src/challenges.ts';
import { runChallengeLifecycle } from '../services/worker/src/jobs/learning.ts';
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
const free = crypto.randomUUID();
const everyone = [admin, free];
const slug = `audit-challenge-${stamp}`;
const paidSlug = `audit-paid-${stamp}`;
let challengeId = '';
let paidId = '';

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function createUser(id: string, email: string, role: 'admin' | 'member') {
  await db.execute(sql`
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data, aud, role)
    values (${id}::uuid, ${email}, '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated')
    on conflict (id) do nothing
  `);
  await db.execute(sql`update users set role = ${role}, full_name = ${'Ch ' + role} where id = ${id}::uuid`);
}

/** Enter as a member would: an insert into `wins` carrying a challenge. */
async function enter(userId: string, cid: string, title: string) {
  return withUser(db, userId, async (tx) => {
    await tx.execute(sql`
      insert into wins (author_id, slug, title, big_idea_md, how_it_happened_md, status, challenge_id)
      values (${userId}::uuid, ${`${title.toLowerCase().replace(/\W+/g, '-')}-${Date.now().toString(36)}`},
              ${title}, 'x', 'y', 'published', ${cid}::uuid)
    `);
  });
}

const refused = async (label: string, fn: () => Promise<unknown>, expect: RegExp) => {
  try {
    await fn();
    check(label, false, 'it was allowed');
  } catch (e) {
    const msg = (e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message;
    check(label, expect.test(msg), msg.slice(0, 90));
  }
};

try {
  console.log('\nSetup');
  await createUser(admin, `ch-admin-${stamp}@example.test`, 'admin');
  await createUser(free, `ch-free-${stamp}@example.test`, 'member');
  check('an admin and a free member exist', true);

  console.log('\nCreating');
  const made = await challenges.createChallenge(env, admin, {
    slug,
    title: 'One light, one portrait',
    prompt: 'Shoot a portrait using one light source. Window counts.',
    briefMd: null,
    startsOn: day(0),
    endsOn: day(6),
    minTier: 'free',
    status: 'open',
  });
  challengeId = made.id;
  check('an admin can create one', made.slug === slug);
  check('it starts with no entries', made.entryCount === 0);
  check('and is open to enter', made.canEnter, JSON.stringify({ status: made.status, days: made.daysLeft }));

  // A draft must not be visible to a member — it is the week's prompt before
  // anybody has decided it is the week's prompt.
  const draft = await challenges.createChallenge(env, admin, {
    slug: paidSlug,
    title: 'Diamond only',
    prompt: 'Something only paid members may enter.',
    briefMd: null,
    startsOn: day(0),
    endsOn: day(6),
    minTier: 'diamond',
    status: 'draft',
  });
  paidId = draft.id;
  const asFreeDraft = await challenges.listChallenges(env, free);
  check('a draft is invisible to members', !asFreeDraft.some((c) => c.slug === paidSlug));

  console.log('\nEntering');
  await enter(free, challengeId, 'My entry');
  const afterEntry = (await challenges.listChallenges(env, free)).find((c) => c.slug === slug);
  check('the entry counts', afterEntry?.entryCount === 1, String(afterEntry?.entryCount));
  check('and the member is marked as in', afterEntry?.myEntrySlug !== null);
  check('so they cannot enter again from the UI', afterEntry?.canEnter === false);

  // The index, not the handler. Two tabs is all it takes to beat a check.
  await refused(
    'a second entry is refused by the database',
    () => enter(free, challengeId, 'My second entry'),
    /duplicate key|unique/i,
  );

  console.log('\nThe rules a trigger has to hold');
  await db.execute(sql`update challenges set status = 'open' where id = ${paidId}::uuid`);
  await refused(
    'a free member cannot enter a diamond challenge',
    () => enter(free, paidId, 'Above my tier'),
    /diamond members and above/i,
  );

  await db.execute(sql`update challenges set status = 'closed' where id = ${challengeId}::uuid`);
  const other = crypto.randomUUID();
  everyone.push(other);
  await createUser(other, `ch-other-${stamp}@example.test`, 'member');
  await refused(
    'nobody can enter a closed challenge',
    () => enter(other, challengeId, 'Too late'),
    /not open for entries/i,
  );

  // Ended but still marked open — the case the cron has not caught up with.
  await db.execute(sql`
    update challenges set status = 'open', starts_on = ${day(-10)}::date, ends_on = ${day(-1)}::date
    where id = ${challengeId}::uuid
  `);
  await refused(
    'nor one whose last day has passed',
    () => enter(other, challengeId, 'Yesterday'),
    /closed on/i,
  );

  console.log('\nJudging');
  await db.execute(sql`update challenges set status = 'closed' where id = ${challengeId}::uuid`);
  const detail = await challenges.getChallenge(env, admin, slug);
  check('the entries are listed', detail.entries.length === 1, String(detail.entries.length));
  const entrySlug = detail.entries[0]!.winSlug;

  const judged = await challenges.pickWinner(env, admin, challengeId, entrySlug);
  check('a winner can be picked', judged.winner?.winSlug === entrySlug);
  const withWinner = await challenges.getChallenge(env, admin, slug);
  check('and is marked on the entry', withWinner.entries[0]?.isWinner === true);

  await refused(
    'an entry from another challenge is refused',
    () => challenges.pickWinner(env, admin, paidId, entrySlug),
    /not in this challenge/i,
  );

  console.log('\nThe job');
  const first = await runChallengeLifecycle(db);
  check('it congratulates the winner', first.won >= 1, JSON.stringify(first));
  const second = await runChallengeLifecycle(db);
  check('and never again', second.won === 0, JSON.stringify(second));

  const [note] = await db.execute<{ title: string; link: string }>(sql`
    select title, link from notifications where user_id = ${free}::uuid and kind = 'challenge.won'
  `);
  check('the message names the challenge', note?.title?.includes('One light') === true, note?.title);
  check('and links to it', note?.link === `/challenges/${slug}`, note?.link);

  console.log('\nDeleting the prompt keeps the work');
  await challenges.deleteChallenge(env, admin, challengeId);
  const [orphan] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from wins where author_id = ${free}::uuid and challenge_id is null
  `);
  check('the entry survives as an ordinary win', Number(orphan?.n) === 1, String(orphan?.n));
  challengeId = '';
} finally {
  console.log('\nCleanup');
  for (const id of [challengeId, paidId].filter(Boolean)) {
    await db.execute(sql`delete from challenges where id = ${id}::uuid`);
  }
  await db.execute(sql`delete from auth.users where id in ${sql.raw(`('${everyone.join("','")}')`)}`);
  await db.$client.end({ timeout: 5 });
}

console.log(failures === 0 ? '\nChallenges hold.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
