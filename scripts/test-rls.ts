/**
 * Proves Row Level Security actually isolates members.
 *
 *   bun run db:test-rls
 *
 * This is the M1 exit criterion from PLAN.md: two accounts must not be able to
 * read each other's data, and tier gating must be enforced by the database
 * rather than by the UI choosing what to render.
 *
 * It creates two throwaway members, asserts, and deletes them — including on
 * failure, so a red run does not leave rubbish in the database.
 */
import { sql } from 'drizzle-orm';
import { createDb, withUser } from '@ipc/db';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const db = createDb(url, { max: 1 });

const alice = crypto.randomUUID();
const bob = crypto.randomUUID();

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

async function createMember(id: string, email: string) {
  // Inserting into auth.users fires handle_new_user, which is the same path a
  // real sign-up takes — so this exercises the trigger too.
  await db.execute(sql`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    values (${id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${email}, '', now(), now(), now(), '{}'::jsonb, ${JSON.stringify({ full_name: email.split('@')[0] })}::jsonb)
  `);
}

async function cleanup() {
  await db.execute(sql`delete from auth.users where id in (${alice}, ${bob})`);
}

try {
  console.log('\nSetup');
  await createMember(alice, `rls-alice-${Date.now()}@example.test`);
  await createMember(bob, `rls-bob-${Date.now()}@example.test`);

  const [profiles] = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from public.users where id in (${alice}, ${bob})`,
  );
  check('sign-up trigger created both profiles', Number(profiles?.count) === 2, `${profiles?.count} of 2`);

  const [memberships] = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from public.memberships where user_id in (${alice}, ${bob}) and tier = 'free'`,
  );
  check('both start on the free tier', Number(memberships?.count) === 2);

  console.log('\nTier gating');
  const freeCourses = await withUser(db, alice, (tx) =>
    tx.execute<{ count: number }>(sql`select count(*)::int as count from courses`),
  );
  check(
    'a free member sees no diamond courses',
    Number(freeCourses[0]?.count) === 0,
    `saw ${freeCourses[0]?.count}`,
  );

  await db.execute(sql`
    insert into public.memberships (user_id, tier, status, source)
    values (${alice}, 'diamond', 'active', 'test')
  `);

  const paidCourses = await withUser(db, alice, (tx) =>
    tx.execute<{ count: number }>(sql`select count(*)::int as count from courses`),
  );
  check(
    'the same member sees them once on diamond',
    Number(paidCourses[0]?.count) > 0,
    `saw ${paidCourses[0]?.count}`,
  );

  console.log('\nIsolation');
  // Alice writes a progress row; Bob must not be able to see or touch it.
  const [lesson] = await db.execute<{ id: string }>(sql`select id from lessons limit 1`);
  if (!lesson) {
    check('a lesson exists to test against', false, 'run `bun run db:seed`');
  } else {
    await withUser(db, alice, (tx) =>
      tx.execute(sql`
        insert into lesson_progress (user_id, lesson_id, last_position_seconds, is_completed)
        values (${alice}, ${lesson.id}, 42, true)
      `),
    );

    const aliceSees = await withUser(db, alice, (tx) =>
      tx.execute<{ count: number }>(sql`select count(*)::int as count from lesson_progress`),
    );
    check('Alice sees her own progress', Number(aliceSees[0]?.count) === 1);

    const bobSees = await withUser(db, bob, (tx) =>
      tx.execute<{ count: number }>(sql`select count(*)::int as count from lesson_progress`),
    );
    check("Bob cannot see Alice's progress", Number(bobSees[0]?.count) === 0, `saw ${bobSees[0]?.count}`);

    // An UPDATE that matches no visible row affects zero rows — RLS makes the
    // write a no-op rather than an error, which is the behaviour to assert.
    const bobUpdate = await withUser(db, bob, (tx) =>
      tx.execute(sql`update lesson_progress set last_position_seconds = 999 where lesson_id = ${lesson.id}`),
    );
    const [after] = await db.execute<{ pos: number }>(
      sql`select last_position_seconds as pos from lesson_progress where user_id = ${alice}`,
    );
    check("Bob cannot overwrite Alice's progress", Number(after?.pos) === 42, `position is ${after?.pos}`);
    void bobUpdate;
  }

  const bobProfiles = await withUser(db, bob, (tx) =>
    tx.execute<{ count: number }>(sql`select count(*)::int as count from public.users`),
  );
  // Profiles are deliberately visible club-wide — it is a community, and the
  // member directory depends on it. Asserted so the intent is explicit.
  check('profiles are visible club-wide (by design)', Number(bobProfiles[0]?.count) >= 2);

  const bobStats = await withUser(db, bob, (tx) =>
    tx.execute<{ count: number }>(sql`select count(*)::int as count from jobs`),
  );
  check('the job queue is invisible to members', Number(bobStats[0]?.count) === 0);
} catch (error) {
  console.error('\nThrew:', error instanceof Error ? error.message : error);
  failures += 1;
} finally {
  await cleanup();
  console.log('\nCleaned up both test members.');
}

console.log(failures === 0 ? '\nRLS holds.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
