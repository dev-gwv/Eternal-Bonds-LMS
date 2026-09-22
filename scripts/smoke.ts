/**
 * Smoke: boots the real Hono app in seed mode (no DATABASE_URL) and walks
 * every public read surface — old and new. Fails loudly on the first
 * non-2xx or unparseable body.
 *
 *   bun scripts/smoke.ts
 *
 * In-process via app.request: no port, no database, no network. This is the
 * closest thing to a browser e2e that runs in CI in under a second; the
 * Playwright journeys in PLAN §5 remain the launch follow-up.
 */
import { app } from '../services/api/src/app.ts';
import { EnvSchema } from '../services/api/src/env.ts';

const env = EnvSchema.parse({ NODE_ENV: 'test', ALLOWED_ORIGINS: '*' });

const routes = [
  '/health',
  '/v1/courses',
  '/v1/workshops',
  '/v1/community/channels',
  '/v1/community/posts',
  '/v1/community/leaderboard',
  '/v1/library/categories',
  '/v1/search?q=photo',
  '/v1/think-tank/domains',
  '/v1/think-tank/insights',
  '/v1/think-tank/insights/same-evening-quotation',
  '/v1/think-tank/solutions?q=discount',
  '/v1/think-tank/cycles/current',
  '/v1/wins',
  '/v1/wins/first-1-2l-package',
  '/v1/events',
  '/v1/photolancer/briefs',
  '/v1/directory',
  '/v1/me/dashboard',
  '/v1/moderation/flags',
];

let failures = 0;
for (const path of routes) {
  const res = await app.request(path, { method: 'GET' }, env);
  const body = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(body); } catch { /* health-adjacent plain text */ }
  if (res.status >= 200 && res.status < 300 && (json !== null || path === '/health')) {
    console.log(`  ok    ${res.status} ${path}`);
  } else {
    failures++;
    console.log(`  FAIL  ${res.status} ${path} — ${body.slice(0, 160)}`);
  }
}

// Write paths stay gated: anonymous POST must be 401, not 500.
const gated: Array<[string, string, string]> = [
  ['POST', '/v1/think-tank/insights', '{}'],
  ['POST', '/v1/wins', '{}'],
  ['POST', '/v1/moderation/reports', '{}'],
];
for (const [method, path, body] of gated) {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body,
  }, env);
  if (res.status === 401 || res.status === 422) {
    console.log(`  ok    ${res.status} ${method} ${path} (gated)`);
  } else {
    failures++;
    console.log(`  FAIL  ${res.status} ${method} ${path} — expected 401/422`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log('\nsmoke: all green');
