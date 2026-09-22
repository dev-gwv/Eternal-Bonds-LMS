/**
 * Proves the weekly Think Tank ritual runs itself.
 *
 *   bun run db:test-thinktank
 *
 * A ritual is defined by happening on time, so the checks that matter are the
 * ones about repetition: running the opener hourly must produce one cycle a
 * week and not one an hour, and closing the same cycle twice must not feature
 * two winners or schedule two sessions.
 *
 * The other one worth having is the empty week. A cycle where nobody voted
 * must close quietly — featuring a zero-vote insight would teach members that
 * voting does not matter, which is the one lesson this mechanism exists to
 * avoid.
 */
import { sql } from 'drizzle-orm';
import { createDb } from '@ipc/db';
import { closeVoteCycle, openVoteCycle } from '../services/worker/src/jobs/thinktank.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const db = createDb(url, { max: 1 });

const winner = crypto.randomUUID();
const runnerUp = crypto.randomUUID();
const everyone = [winner, runnerUp];
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

const mine = <T>(rows: T[]) => rows;
let cycleId = '';
const insightIds: string[] = [];
const createdCycles: string[] = [];

// Cycles are global, so any already-open one would make the opener a no-op and
// the closer touch real data. Both are parked for the run and put back after.
let parked: { id: string; status: string }[] = [];

try {
  console.log('\nSetup');
  await createMember(winner, `tt-winner-${stamp}@example.test`);
  await createMember(runnerUp, `tt-runner-${stamp}@example.test`);

  parked = mine(
    await db.execute<{ id: string; status: string }>(
      sql`select id, status from vote_cycles where status = 'open'`,
    ),
  );
  if (parked.length > 0) {
    await db.execute(sql`update vote_cycles set status = 'parked-by-test' where status = 'open'`);
  }
  console.log(`  note  parked ${parked.length} real open cycle(s) for the duration`);

  console.log('\nOpening');
  const opened = await openVoteCycle(db);
  check('a cycle opens when there is none', opened.opened === 1, `opened=${opened.opened}`);

  const again = await openVoteCycle(db);
  check('running it again opens nothing', again.opened === 0, `opened=${again.opened}`);
  const third = await openVoteCycle(db);
  check('nor does a third run', third.opened === 0, `opened=${third.opened}`);

  const [current] = await db.execute<{ id: string; starts_on: string; ends_on: string }>(
    sql`select id, starts_on, ends_on from vote_cycles where status = 'open' order by starts_on desc limit 1`,
  );
  cycleId = current!.id;
  createdCycles.push(cycleId);
  const span =
    (Date.parse(String(current!.ends_on)) - Date.parse(String(current!.starts_on))) / 86_400_000;
  check('and it runs a week', span === 6, `${span + 1} days`);

  console.log('\nVoting');
  for (const [i, author] of [winner, runnerUp].entries()) {
    const [ins] = await db.execute<{ id: string }>(sql`
      insert into insights (author_id, vote_cycle_id, slug, title, situation_md, big_idea_md, how_md, status, votes_count)
      values (
        ${author}, ${cycleId}::uuid, ${`tt-${stamp}-${i}`},
        ${i === 0 ? 'The same-evening quotation' : 'A second idea nobody voted for as much'},
        'Situation', 'Big idea', 'How', 'published', ${i === 0 ? 12 : 3}
      )
      returning id
    `);
    insightIds.push(ins!.id);
  }
  check('two insights are in the cycle', insightIds.length === 2);

  console.log('\nClosing before the end date');
  const early = await closeVoteCycle(db);
  check('an open cycle is left alone', early.closed === 0, `closed=${early.closed}`);

  console.log('\nClosing after it');
  await db.execute(sql`update vote_cycles set ends_on = current_date - 1 where id = ${cycleId}`);
  const closed = await closeVoteCycle(db);
  check('the cycle closes', closed.closed === 1, `closed=${closed.closed}`);
  check('and features exactly one winner', closed.featured === 1, `featured=${closed.featured}`);

  const [featured] = await db.execute<{ id: string; title: string }>(sql`
    select id, title from insights where featured_at is not null and id in ${sql.raw(`('${insightIds.join("','")}')`)}
  `);
  check('the most-voted one', featured?.id === insightIds[0], featured?.title);

  const [session] = await db.execute<{ title: string; join_url: string | null; is_featured_session: boolean }>(sql`
    select title, join_url, is_featured_session from events
    where title like ${'Think Tank: %'} order by created_at desc limit 1
  `);
  check('a session was pencilled in', Boolean(session), session?.title);
  check('marked as the featured session', session?.is_featured_session === true);
  // A cron job must not invent a meeting link.
  check('with no join link invented for it', session?.join_url === null);

  const [told] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from notifications
    where user_id = ${winner} and kind = 'thinktank.featured'
  `);
  check('the author was told their insight won', Number(told!.n) === 1);

  const [others] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from notifications
    where user_id = ${runnerUp} and kind = 'thinktank.featured'
  `);
  check('and everybody else was told which one it is', Number(others!.n) === 1);

  console.log('\nRunning the closer again');
  const repeat = await closeVoteCycle(db);
  check('nothing closes twice', repeat.closed === 0, `closed=${repeat.closed}`);
  const [sessions] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from events where title like ${'Think Tank: %'}
  `);
  check('and no second session appears', Number(sessions!.n) === 1, `${sessions!.n}`);

  console.log('\nA week nobody voted in');
  const [empty] = await db.execute<{ id: string }>(sql`
    insert into vote_cycles (starts_on, ends_on, status)
    values (current_date - 14, current_date - 8, 'open')
    returning id
  `);
  createdCycles.push(empty!.id);
  const quiet = await closeVoteCycle(db);
  check('it still closes', quiet.closed === 1, `closed=${quiet.closed}`);
  // Featuring a zero-vote insight teaches members that voting does not matter.
  check('but features nobody', quiet.featured === 0, `featured=${quiet.featured}`);

  console.log('\nAnd then next week opens');
  const next = await openVoteCycle(db);
  check('a new cycle opens once the old one closed', next.opened === 1, `opened=${next.opened}`);
  const [fresh] = await db.execute<{ id: string }>(
    sql`select id from vote_cycles where status = 'open' order by starts_on desc limit 1`,
  );
  createdCycles.push(fresh!.id);
} finally {
  console.log('\nCleanup');
  await db.execute(sql`delete from events where title like ${'Think Tank: %'} and created_at > now() - interval '1 hour'`);
  if (insightIds.length) {
    await db.execute(sql`delete from insights where id in ${sql.raw(`('${insightIds.join("','")}')`)}`);
  }
  if (createdCycles.length) {
    await db.execute(sql`delete from vote_cycles where id in ${sql.raw(`('${createdCycles.join("','")}')`)}`);
  }
  // Put the club's real cycle back exactly as it was.
  if (parked.length > 0) {
    await db.execute(sql`update vote_cycles set status = 'open' where status = 'parked-by-test'`);
  }
  await db.execute(sql`delete from auth.users where id in ${sql.raw(`('${everyone.join("','")}')`)}`);
  await db.$client.end({ timeout: 5 });
}

console.log(failures === 0 ? '\nThe ritual runs itself.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
