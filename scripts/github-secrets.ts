/**
 * Prints exactly what to paste into GitHub → Settings → Secrets and variables
 * → Actions, read from your local .env.
 *
 *   bun scripts/github-secrets.ts
 *
 * It exists because the values are already sitting in .env and copying them by
 * hand across six fields is how one of them ends up with a trailing space and
 * a deploy fails for a reason nobody can see. Nothing is written anywhere and
 * nothing leaves the machine — it reads .env and prints.
 *
 * Two things it is deliberately opinionated about:
 *
 *   - It converts DATABASE_URL to the **session pooler (5432)** for CI. The
 *     6543 transaction pooler is for the Worker, which has no long-lived
 *     process; CI runs `supabase db push`, which is ordinary DDL in ordinary
 *     transactions and wants an ordinary connection.
 *   - It marks the VITE_* three as *variables*, not secrets. They are compiled
 *     into a public bundle, so filing them as secrets would be pretending
 *     otherwise — and GitHub masks secret values in logs, which breaks the
 *     post-deploy health check.
 *
 * Run it with `--reveal` to print the values. Without it you get a checklist
 * with everything masked, which is the safer thing to have on screen if
 * anybody is watching.
 */
import { existsSync, readFileSync } from 'node:fs';

const reveal = process.argv.includes('--reveal');

if (!existsSync('.env')) {
  console.error('\nNo .env here. Run this from the repository root.\n');
  process.exit(1);
}

/** Minimal parser: KEY=value, ignoring comments, blanks and wrapping quotes. */
const env = new Map<string, string>();
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq < 1) continue;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  // An empty value is absent, not a value. `VITE_API_URL=` is normal locally —
  // the client falls back to a same-origin path — but copied into CI it would
  // build a web app that calls itself, and every request would 404 against the
  // static asset handler. `??` would not have caught it: '' is not nullish.
  if (value !== '') env.set(key, value);
}

/** Swap the transaction pooler for the session pooler, ports and host alike. */
function toSessionPooler(url: string): string {
  return url.replace(':6543/', ':5432/');
}

const mask = (v: string) => {
  if (v.length <= 12) return '•'.repeat(v.length);
  return `${v.slice(0, 6)}${'•'.repeat(Math.min(24, v.length - 10))}${v.slice(-4)}`;
};

type Row = {
  kind: 'Secret' | 'Variable';
  name: string;
  value: string | null;
  note: string;
};

const db = env.get('DATABASE_URL');

/**
 * The deployed API's address.
 *
 * Not a secret — it is the origin every browser talks to, and it is compiled
 * into the public bundle. It is not in .env because local development runs
 * against localhost and leaves it unset, so the client falls back to a
 * same-origin path. CI has to be told explicitly.
 */
const API_ORIGIN = env.get('VITE_API_URL') ?? 'https://eternal-bonds-api.dev-d9b.workers.dev';

/**
 * Ask wrangler which account it is logged into.
 *
 * An account id is an identifier, not a credential — it appears in dashboard
 * URLs — so reading it out of the local OAuth session and printing it is fine,
 * and saves a trip to the dashboard for the one value that is merely tedious
 * rather than secret. Deliberately *not* hardcoded: this repo should not carry
 * one person's account id.
 */
async function cloudflareAccountId(): Promise<string | null> {
  try {
    const proc = Bun.spawn(['bun', 'x', 'wrangler', 'whoami'], { stdout: 'pipe', stderr: 'pipe' });
    const out = await new Response(proc.stdout).text();
    // The table row is `│ Some Account │ <32 hex> │`.
    return out.match(/\b[0-9a-f]{32}\b/)?.[0] ?? null;
  } catch {
    return null;
  }
}

const rows: Row[] = [
  {
    kind: 'Secret',
    name: 'DATABASE_URL',
    value: db ? toSessionPooler(db) : null,
    note: 'production migrations · session pooler (5432), not 6543',
  },
  {
    kind: 'Secret',
    name: 'CLOUDFLARE_API_TOKEN',
    value: env.get('CLOUDFLARE_API_TOKEN') ?? null,
    note: 'API and web deploys',
  },
  {
    kind: 'Secret',
    name: 'CLOUDFLARE_ACCOUNT_ID',
    value: env.get('CLOUDFLARE_ACCOUNT_ID') ?? (await cloudflareAccountId()),
    note: 'API and web deploys · an identifier, not a credential',
  },
  {
    kind: 'Variable',
    name: 'VITE_API_URL',
    value: API_ORIGIN,
    note: 'the web build · not a secret, it is a public origin',
  },
  {
    kind: 'Variable',
    name: 'VITE_SUPABASE_URL',
    value: env.get('VITE_SUPABASE_URL') ?? env.get('SUPABASE_URL') ?? null,
    note: 'the web build',
  },
  {
    kind: 'Variable',
    name: 'VITE_SUPABASE_ANON_KEY',
    value: env.get('VITE_SUPABASE_ANON_KEY') ?? env.get('SUPABASE_ANON_KEY') ?? null,
    note: 'the web build',
  },
  // The footer. Optional by design: an unset one is simply not rendered, which
  // is why these are the only rows that stay quiet when they have no value.
  ...(
    [
      ['VITE_SUPPORT_EMAIL', 'footer contact link'],
      ['VITE_SOCIAL_INSTAGRAM', 'footer social link'],
      ['VITE_SOCIAL_YOUTUBE', 'footer social link'],
      ['VITE_SOCIAL_FACEBOOK', 'footer social link'],
    ] as const
  )
    .filter(([name]) => env.get(name) !== null)
    .map(([name, note]) => ({ kind: 'Variable' as const, name, value: env.get(name), note })),
  {
    kind: 'Variable',
    name: 'API_URL',
    value: API_ORIGIN,
    note: 'post-deploy health check (optional)',
  },
];

console.log('\nGitHub → your repo → Settings → Secrets and variables → Actions\n');
console.log('  Secrets go on the "Secrets" tab, Variables on the "Variables" tab.');
console.log('  The VITE_ ones are variables on purpose: they are compiled into a');
console.log('  public bundle, and GitHub masks secret values in logs, which would');
console.log('  break the health check.\n');

const missing: Row[] = [];

for (const row of rows) {
  if (!row.value) {
    missing.push(row);
    console.log(`  ✗ ${row.kind.padEnd(8)} ${row.name}`);
    console.log(`      NOT IN .env — ${row.note}\n`);
    continue;
  }
  const secret = row.kind === 'Secret' && row.name !== 'CLOUDFLARE_ACCOUNT_ID';
  console.log(`  ✓ ${row.kind.padEnd(8)} ${row.name}`);
  console.log(`      ${reveal || !secret ? row.value : mask(row.value)}`);
  console.log(`      ${row.note}\n`);
}

if (!reveal) {
  console.log('  Values are masked. Re-run with --reveal to print them in full:\n');
  console.log('      bun scripts/github-secrets.ts --reveal\n');
}

if (missing.some((m) => m.name === 'CLOUDFLARE_API_TOKEN')) {
  console.log('─'.repeat(72));
  console.log('\nThe API token is the one value that cannot come from anywhere on this');
  console.log('machine. You authenticated wrangler with `wrangler login`, which stores');
  console.log('an OAuth session for *you*; CI is not you and cannot use it. It needs a');
  console.log('token of its own, and creating one is the only manual step here.\n');
  console.log('  API token:   dash.cloudflare.com/profile/api-tokens → Create Token');
  console.log('               → "Edit Cloudflare Workers" template.');
  console.log('               Scope it to this account only, and to the two Workers');
  console.log('               if the template lets you. A token that can edit every');
  console.log('               Worker in the account is how the CRM got overwritten.\n');
}

console.log('─'.repeat(72));
console.log('\nAfter adding them: Actions → Deploy → Run workflow.');
console.log('The gate job prints a table of what it found, so a missing one shows');
console.log('up as `false` there rather than as a silent skip.\n');
