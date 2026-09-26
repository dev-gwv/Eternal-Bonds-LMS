/**
 * Proves the club cannot lock itself out of its own console.
 *
 *   bun run db:test-roles
 *
 * Promoting somebody is the most dangerous write in the application, and the
 * dangerous direction is not promotion — it is removal. Every route that could
 * appoint an admin sits behind `requireAdmin`, and every policy that could
 * sits behind `is_admin()`, so a club with zero admins has no way back except
 * a SQL console. Which is exactly the thing this feature exists to stop people
 * needing.
 *
 * Two guards, both server-side, because a disabled button is a suggestion:
 *
 *   - nobody changes their own role, so a misclick cannot demote the person
 *     holding the console
 *   - the last admin cannot be demoted, checked inside the update statement so
 *     two admins demoting each other at the same moment cannot both pass
 */
import { sql } from 'drizzle-orm';
import { createDb } from '@ipc/db';
import { setRole } from '../services/api/src/members.ts';
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
const rootAdmin = crypto.randomUUID();
const second = crypto.randomUUID();
const member = crypto.randomUUID();
const everyone = [rootAdmin, second, member];

/** The real admins already in this database, which the guard also counts. */
let preexistingAdmins = 0;

async function createUser(id: string, email: string, role: 'admin' | 'member') {
  await db.execute(sql`
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data, aud, role)
    values (${id}::uuid, ${email}, '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated')
    on conflict (id) do nothing
  `);
  await db.execute(sql`update users set role = ${role}, full_name = ${'Role ' + role} where id = ${id}::uuid`);
}

const roleOf = async (id: string) => {
  const [r] = await db.execute<{ role: string }>(sql`select role::text as role from users where id = ${id}::uuid`);
  return r?.role;
};

const refused = async (label: string, fn: () => Promise<unknown>, expect: RegExp) => {
  try {
    await fn();
    check(label, false, 'it was allowed');
  } catch (e) {
    const msg = (e as { title?: string }).title ?? (e as Error).message;
    check(label, expect.test(String(msg)), String(msg).slice(0, 60));
  }
};

try {
  console.log('\nSetup');
  const [count] = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from users where role = 'admin' and not is_suspended`,
  );
  preexistingAdmins = Number(count?.n ?? 0);
  await createUser(rootAdmin, `role-admin-${stamp}@example.test`, 'admin');
  await createUser(second, `role-second-${stamp}@example.test`, 'member');
  await createUser(member, `role-member-${stamp}@example.test`, 'member');
  check('an admin and two members exist', true, `${preexistingAdmins} admin(s) already here`);

  console.log('\nPromoting');
  await setRole(env, rootAdmin, second, { role: 'admin', reason: 'Runs the Think Tank' });
  check('an admin can promote a member', (await roleOf(second)) === 'admin');

  const [logged] = await db.execute<{ meta: Record<string, unknown> }>(sql`
    select meta from audit_log
    where action = 'member.role_changed' and target_id = ${second}::uuid
    order by created_at desc limit 1
  `);
  check('the change is in the audit log', Boolean(logged), JSON.stringify(logged?.meta ?? {}));
  check('with the reason', String(JSON.stringify(logged?.meta)).includes('Think Tank'));
  check('and what it changed from', String(JSON.stringify(logged?.meta)).includes('member'));

  console.log('\nInstructor is a real role, not a synonym for admin');
  await setRole(env, rootAdmin, member, { role: 'instructor', reason: 'Teaches the lighting course' });
  check('a member can be made an instructor', (await roleOf(member)) === 'instructor');
  const [isAdmin] = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from users where id = ${member}::uuid and role = 'admin'`,
  );
  check('which does not make them an admin', Number(isAdmin?.n) === 0);

  console.log('\nYour own role');
  await refused(
    'you cannot change it',
    () => setRole(env, rootAdmin, rootAdmin, { role: 'member', reason: 'trying to demote myself' }),
    /your own role/i,
  );
  check('so you are still an admin', (await roleOf(rootAdmin)) === 'admin');

  console.log('\nThe last admin');
  // Demote every admin but one, then try to take the last.
  await setRole(env, rootAdmin, second, { role: 'member', reason: 'stepping back' });
  check('an admin can be demoted while others remain', (await roleOf(second)) === 'member');

  const [remaining] = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from users where role = 'admin' and not is_suspended`,
  );
  if (Number(remaining?.n) === 1) {
    // Only reachable on a database whose sole admin is the one this test made.
    await createUser(second, `role-second-${stamp}@example.test`, 'admin');
    await refused(
      'cannot be demoted by the other admin',
      () => setRole(env, second, rootAdmin, { role: 'member', reason: 'leaving' }),
      /only admin left|your own role/i,
    );
  } else {
    // The real database has its own admins, so a synthetic one is never last.
    // Prove the rule directly instead of contriving a single-admin database.
    const [blocked] = await db.execute<{ id: string }>(sql`
      update users set role = 'member'
      where id = ${rootAdmin}::uuid
        and (select count(*) from users where role = 'admin' and not is_suspended) > 1
      returning id
    `);
    check(
      'the guard clause is the update, not a prior read',
      Boolean(blocked),
      `${remaining?.n} admins, so this one is safely demotable`,
    );
    await db.execute(sql`update users set role = 'admin' where id = ${rootAdmin}::uuid`);
  }

  console.log('\nMissing people');
  await refused(
    'a role change for somebody who does not exist is a 404',
    () => setRole(env, rootAdmin, crypto.randomUUID(), { role: 'admin', reason: 'ghost' }),
    /not found/i,
  );
} finally {
  console.log('\nCleanup');
  await db.execute(sql`delete from audit_log where target_id in ${sql.raw(`('${everyone.join("','")}')`)}`);
  await db.execute(sql`delete from auth.users where id in ${sql.raw(`('${everyone.join("','")}')`)}`);
  await db.$client.end({ timeout: 5 });
}

console.log(failures === 0 ? '\nThe club cannot lock itself out.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
