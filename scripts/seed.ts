/**
 * Applies supabase/seed.sql to the connected database.
 *
 *   bun run db:seed
 *
 * `supabase db reset` runs the seed automatically, but that drops everything
 * first — which is wrong for a project that already has members in it. This
 * applies the same file idempotently (every statement is `on conflict do
 * nothing`), so it is safe to run against a live database.
 */
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { createDb } from '@ipc/db';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Fill it in .env first.');
  process.exit(1);
}

const file = new URL('../supabase/seed.sql', import.meta.url);
const statements = readFileSync(file, 'utf8')
  // Strip comments so a `;` inside one cannot split a statement.
  .replace(/^\s*--.*$/gm, '')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

const db = createDb(url, { max: 1 });

let applied = 0;
for (const statement of statements) {
  try {
    await db.execute(sql.raw(statement));
    applied += 1;
  } catch (error) {
    console.error(`\nFailed on:\n${statement.slice(0, 200)}…\n`, error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

console.log(`Applied ${applied} seed statements.`);
process.exit(0);
