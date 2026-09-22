/**
 * Proves the database is actually wired correctly, rather than assuming it.
 *
 *   bun run db:verify
 *
 * Checks, in order: connection, every expected table, RLS enabled on all of
 * them, policies present, the SQL helpers, the sign-up trigger, and seed rows.
 * Then it runs each worker job for real and reports what it did.
 *
 * Exits non-zero on the first hard failure so it is usable in CI.
 */
import { sql } from 'drizzle-orm';
import { createDb } from '@ipc/db';
import { NotificationKind } from '@ipc/contracts';
import { JOBS, runJob } from '@ipc/worker';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'DATABASE_URL is not set.\n' +
      'Copy .env.example to .env and fill in the session-pooler connection string\n' +
      '(Supabase dashboard → Project Settings → Database → Connection string → Session pooler).',
  );
  process.exit(1);
}

const db = createDb(url, { max: 1 });

const EXPECTED_TABLES = [
  'users', 'memberships', 'courses', 'modules', 'lessons', 'enrollments',
  'lesson_progress', 'workshops', 'workshop_registrations', 'channels',
  'posts', 'post_media', 'library_categories', 'library_items',
  'activity_events', 'outbox', 'jobs', 'job_schedule', 'daily_activity',
  'streaks', 'member_stats', 'idempotency_keys', 'rate_limits',
  'post_likes', 'post_comments', 'comment_likes',
  'notifications', 'notification_prefs', 'push_tokens',
  'plans', 'orders', 'payments', 'webhook_events', 'channel_reads',
  // Scheduling and sequencing.
  'cohorts', 'cohort_members', 'journeys', 'journey_steps',
  // The ledgers behind every automated message. Each one is what stops a job
  // sending the same thing twice, so an unprotected one is a real problem.
  'learning_nudges', 'module_unlock_notices', 'cohort_deadline_notices',
  'onboarding_notices',
];

// Service-role-only tables: RLS on with no policy, deliberately. No policy
// means no access for anon or authenticated, which is exactly right for a
// queue and an event outbox that only the worker should ever touch.
const NO_POLICY_EXPECTED = new Set([
  'jobs', 'job_schedule', 'outbox', 'idempotency_keys', 'rate_limits',
  // Raw provider payloads. Service-role only, deliberately.
  'webhook_events',
]);

let failures = 0;
const pass = (label: string, detail = '') => console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`);
const fail = (label: string, detail = '') => {
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  failures += 1;
};
const warn = (label: string, detail = '') => console.log(`  warn  ${label}${detail ? ` — ${detail}` : ''}`);

console.log('\nConnection');
try {
  const [row] = await db.execute<{ version: string; db: string }>(
    sql`select version() as version, current_database() as db`,
  );
  pass('connected', `${row?.db} · ${row?.version?.split(',')[0]}`);
} catch (error) {
  fail('connect', error instanceof Error ? error.message : String(error));
  console.error('\nCould not connect. Nothing else can be checked.\n');
  process.exit(1);
}

console.log('\nTables');
const tables = await db.execute<{ table_name: string }>(sql`
  select table_name from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
`);
const present = new Set([...tables].map((t) => t.table_name));
const missing = EXPECTED_TABLES.filter((t) => !present.has(t));
if (missing.length === 0) pass(`all ${EXPECTED_TABLES.length} tables present`);
else fail('missing tables', missing.join(', ') + '  → run `bun run db:push`');

console.log('\nRow Level Security');
const rls = await db.execute<{ tablename: string; rowsecurity: boolean }>(sql`
  select tablename, rowsecurity from pg_tables where schemaname = 'public'
`);
const unprotected = [...rls].filter((t) => present.has(t.tablename) && !t.rowsecurity);
if (unprotected.length === 0) pass('enabled on every table');
else fail('RLS disabled', unprotected.map((t) => t.tablename).join(', '));

const policies = await db.execute<{ tablename: string; count: number }>(sql`
  select tablename, count(*)::int as count from pg_policies
  where schemaname = 'public' group by tablename
`);
const policyCount = new Map([...policies].map((p) => [p.tablename, Number(p.count)]));
const withoutPolicy = EXPECTED_TABLES.filter(
  (t) => present.has(t) && !NO_POLICY_EXPECTED.has(t) && !(policyCount.get(t) ?? 0),
);
if (withoutPolicy.length === 0) {
  const total = [...policyCount.values()].reduce((a, b) => a + b, 0);
  pass(`${total} policies across ${policyCount.size} tables`);
} else {
  // RLS on with no policy means members can read nothing — safe, but wrong.
  fail('tables with RLS but no policy', withoutPolicy.join(', '));
}

console.log('\nFunctions and triggers');
for (const fn of [
  'current_tier', 'tier_allows', 'is_admin', 'handle_new_user',
  'grant_membership', 'bump_post_likes', 'bump_post_comments', 'ensure_notification_prefs',
  'unread_count', 'mark_channel_read', 'emit_outbox',
]) {
  const [row] = await db.execute<{ exists: boolean }>(sql`
    select exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = ${fn}
    ) as exists
  `);
  row?.exists ? pass(`public.${fn}()`) : fail(`public.${fn}() missing`);
}

for (const [name, why] of [
  ['on_auth_user_created', 'profiles are created on sign-up'],
  ['users_notification_prefs', 'every member has a preferences row'],
  ['post_likes_count', 'likes_count stays correct under concurrency'],
  ['post_comments_count', 'comments_count follows soft deletes'],
  ['comment_likes_count', 'comment likes are counted'],
  ['courses_touch_updated_at', 'the course list can order by what changed'],
] as const) {
  const [row] = await db.execute<{ exists: boolean }>(sql`
    select exists (select 1 from pg_trigger where tgname = ${name}) as exists
  `);
  row?.exists ? pass(name, why) : fail(`${name} missing`, why);
}

const [priceList] = await db.execute<{ count: number }>(sql`select count(*)::int as count from plans where is_active`);
Number(priceList?.count) > 0
  ? pass(`${priceList!.count} active plans`)
  : fail('no plans', 'nobody can buy a membership');

console.log('\nSeed content');
for (const [table, label] of [
  ['channels', 'channels'],
  ['library_categories', 'library categories'],
  ['courses', 'courses'],
  ['lessons', 'lessons'],
  ['workshops', 'workshops'],
] as const) {
  if (!present.has(table)) continue;
  const [row] = await db.execute<{ count: number }>(sql`select count(*)::int as count from ${sql.identifier(table)}`);
  const count = Number(row?.count ?? 0);
  count > 0 ? pass(`${count} ${label}`) : warn(`no ${label}`, 'run `bun run db:seed`');
}

const [bucket] = await db.execute<{ exists: boolean; public: boolean }>(sql`
  select true as exists, public from storage.buckets where id = 'ipc-media'
`);
if (!bucket?.exists) fail('the ipc-media bucket is missing', 'run `bun run db:push`');
else if (bucket.public) fail('the ipc-media bucket is public', 'paid lessons would be readable by anyone with the key');
else pass('ipc-media bucket exists and is private');

const [admins] = await db.execute<{ count: number }>(
  sql`select count(*)::int as count from users where role = 'admin'`,
);
Number(admins?.count) > 0
  ? pass(`${admins!.count} admin(s)`, 'the studio is reachable')
  : warn('no admins yet', "update public.users set role = 'admin' where email = '…'");

const [members] = await db.execute<{ count: number }>(sql`select count(*)::int as count from users`);
const memberCount = Number(members?.count ?? 0);
memberCount > 0
  ? pass(`${memberCount} member profiles`)
  : warn('no members yet', 'sign up once in the app — the trigger creates the profile');

// A notification_kind in Postgres that the contract does not list is not a
// cosmetic mismatch: the browser parses the whole feed with that schema, so a
// single unknown value makes every notification fail to parse and the bell go
// dark. This drifted once already, and the contract suite only caught it
// because a row of the new kind happened to exist to parse.
/*
 * Tables an admin screen writes to, which therefore need an is_admin() policy.
 *
 * This check exists because the same bug happened seven times: a table gets a
 * policy for the member case, an admin endpoint is written against it, and
 * nothing verifies the admin can actually reach the table. The endpoint
 * compiles, typechecks, and returns 500 the first time somebody presses the
 * button — which is only ever discovered by pressing it.
 *
 * A member policy is not an admin policy: `*_select_own` and `using (true)`
 * are both member policies.
 */
console.log('\nAdmin write access');
{
  const ADMIN_WRITES = [
    'courses', 'modules', 'lessons', 'lesson_resources', 'workshops',
    'cohorts', 'cohort_members', 'journeys', 'journey_steps',
    'events', 'event_insights', 'feature_flags', 'channel_moderators',
    'memberships', 'audit_log', 'reports',
  ];
  const rows = await db.execute<{ tablename: string; has_admin: boolean }>(sql`
    select p.tablename,
           bool_or(coalesce(p.qual, '') like '%is_admin%'
                or coalesce(p.with_check, '') like '%is_admin%') as has_admin
    from pg_policies p
    where p.schemaname = 'public'
    group by p.tablename
  `);
  const byTable = new Map(rows.map((r) => [r.tablename, r.has_admin]));
  const gaps = ADMIN_WRITES.filter((t) => present.has(t) && byTable.has(t) && !byTable.get(t));

  gaps.length === 0
    ? pass(`${ADMIN_WRITES.filter((t) => present.has(t)).length} admin-written tables all reachable`)
    : fail(
        `no is_admin() policy on ${gaps.join(', ')}`,
        'the admin endpoint against it will 500 the first time it is used',
      );
}

console.log('\nNotification kinds');
{
  const rows = await db.execute<{ label: string }>(sql`
    select e.enumlabel as label
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'notification_kind'
  `);
  const inDb = new Set(rows.map((r) => r.label));
  const inContract = new Set<string>(NotificationKind.options);

  const missing = [...inDb].filter((k) => !inContract.has(k));
  const extra = [...inContract].filter((k) => !inDb.has(k));

  missing.length === 0
    ? pass(`${inDb.size} kinds, all present in the contract`)
    : fail(`the contract is missing ${missing.join(', ')}`, 'add them to NotificationKind in @ipc/contracts');

  // The other direction is harmless to read but means somebody wrote a kind
  // the database will reject on insert.
  if (extra.length > 0) warn(`the contract has ${extra.join(', ')}, which Postgres does not`);
}

console.log('\nWorker jobs');
for (const job of JOBS) {
  const outcome = await runJob(db, job.kind);
  outcome.ok
    ? pass(job.kind, `${outcome.ms}ms ${JSON.stringify(outcome.result)}`)
    : fail(job.kind, outcome.error);
}

console.log(
  failures === 0
    ? '\nEverything checks out. The API will report "source": "supabase" at /health.\n'
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
