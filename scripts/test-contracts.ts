/**
 * Calls every read endpoint against a running API and validates the response
 * against the contract the browser will parse it with.
 *
 *   bun run test:contracts                    # against production
 *   API_URL=http://localhost:8080 bun run test:contracts
 *
 * This exists because of a bug it would have caught in one second: the API
 * returned `certificateKey` while `Course` required `certificateUrl`, so every
 * course failed validation in the browser and the Courses page sat behind its
 * skeletons retrying forever. Typecheck did not see it — the repo layer cast
 * the row `as Course & { certificateKey } as Course`, and a double cast will
 * silence anything.
 *
 * The lesson generalises: the API and the client agree on a Zod schema, but
 * nothing was checking that the API actually *honoured* it at runtime. This
 * is that check.
 */
import { z } from 'zod';
import {
  ActivityDay,
  Channel,
  Comment,
  Course,
  CourseDetail,
  DashboardStats,
  DeletionState,
  LeaderboardRow,
  LibraryCategory,
  Member,
  MembershipState,
  NotificationFeed,
  NotificationPrefs,
  Performance,
  Post,
  SearchResults,
  Viewer,
  Workshop,
} from '@ipc/contracts';

const API = process.env.API_URL ?? 'https://eternal-bonds-api.dev-d9b.workers.dev';
const SUPABASE = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const ANON = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const EMAIL = process.env.TEST_EMAIL ?? 'tester@eternalbonds.test';
const PASSWORD = process.env.TEST_PASSWORD ?? 'EternalBondsTest2026!';

let failures = 0;
const pass = (label: string, detail = '') => console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`);
const fail = (label: string, detail = '') => {
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  failures += 1;
};

/* ── Sign in ───────────────────────────────────────────────────────────────*/

let token = '';
if (SUPABASE && ANON) {
  const res = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = (await res.json()) as { access_token?: string; msg?: string };
  if (body.access_token) token = body.access_token;
  else console.log(`  warn  could not sign in as ${EMAIL} (${body.msg ?? res.status}) — checking anonymously`);
}

const list = <T>(item: z.ZodType<T>) => z.object({ items: z.array(item) });

/**
 * Fetches one endpoint and validates it.
 *
 * A 404 on a resource that does not exist yet is not a contract failure, so it
 * is reported as a skip rather than a red line — this suite is about shape,
 * not about seed data being present.
 */
async function check(path: string, schema: z.ZodType<unknown>, { expectItems = false } = {}) {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      headers: {
        accept: 'application/json',
        'x-client': 'contract-test',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (error) {
    fail(path, `request failed: ${error instanceof Error ? error.message : error}`);
    return;
  }

  if (res.status === 404) {
    console.log(`  skip  ${path} — 404, nothing to check against`);
    return;
  }
  if (!res.ok) {
    fail(path, `HTTP ${res.status}`);
    return;
  }

  const json = await res.json().catch(() => null);
  if (json === null) {
    fail(path, 'body was not JSON');
    return;
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    // The first issue names the exact field, which is the whole point.
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    fail(path, issues);
    return;
  }

  const count = (json as { items?: unknown[] }).items?.length;
  if (expectItems && count === 0) {
    console.log(`  warn  ${path} — valid but empty`);
    return;
  }
  pass(path, count === undefined ? '' : `${count} item(s)`);
}

console.log(`\nContract conformance · ${API}`);
console.log(token ? `signed in as ${EMAIL}\n` : 'anonymous\n');

console.log('Health');
await check('/health', z.object({ ok: z.boolean(), source: z.enum(['seed', 'supabase']), version: z.string() }));

console.log('\nContent');
await check('/v1/courses', list(Course), { expectItems: true });
await check('/v1/workshops?scope=upcoming', list(Workshop));
await check('/v1/workshops?scope=completed', list(Workshop));
await check('/v1/library/categories', list(LibraryCategory), { expectItems: true });
await check('/v1/community/channels', list(Channel), { expectItems: true });
await check('/v1/community/posts', list(Post));
await check('/v1/community/leaderboard', list(LeaderboardRow));
await check('/v1/search?q=a', SearchResults);

console.log('\nThe member');
if (token) {
  await check('/v1/me', Member);
  await check('/v1/me/viewer', Viewer);
  await check('/v1/me/stats', DashboardStats);
  await check('/v1/me/activity', list(ActivityDay));
  await check('/v1/me/performance', Performance);
  await check('/v1/me/notifications', NotificationFeed);
  await check('/v1/me/prefs', NotificationPrefs);
  await check('/v1/me/deletion', DeletionState);
  await check('/v1/billing/membership', MembershipState);
} else {
  console.log('  skip  needs a session');
}

console.log('\nDetail routes');
if (token) {
  const res = await fetch(`${API}/v1/courses`, { headers: { authorization: `Bearer ${token}` } });
  const first = ((await res.json().catch(() => ({}))) as { items?: { slug: string }[] }).items?.[0];
  if (first) await check(`/v1/courses/${first.slug}`, CourseDetail);
  else console.log('  skip  no course to open');

  const postsRes = await fetch(`${API}/v1/community/posts`, { headers: { authorization: `Bearer ${token}` } });
  const post = ((await postsRes.json().catch(() => ({}))) as { items?: { id: string }[] }).items?.[0];
  if (post) await check(`/v1/community/posts/${post.id}/comments`, list(Comment));
  else console.log('  skip  no post to open');
} else {
  console.log('  skip  needs a session');
}

console.log(
  failures === 0
    ? '\nEvery endpoint matches its contract.\n'
    : `\n${failures} endpoint(s) do not match the contract the browser parses with.\n`,
);
process.exit(failures === 0 ? 0 : 1);
