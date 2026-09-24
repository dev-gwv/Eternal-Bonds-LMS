/**
 * Apply one Supabase migration and record it, without the CLI.
 *
 * `supabase db push` is the normal route and remains the one CI takes. This
 * exists because pushing from here means handing the CLI a connection string
 * on a command line, and because it pushes *everything* pending — fine in CI,
 * a poor way to apply one file you just wrote and want to see fail on its own.
 *
 * It writes the same ledger row the CLI does, so the two stay interchangeable:
 * a file applied here is skipped by a later `db push`, and vice versa.
 *
 *   bun --env-file=.env scripts/apply-migration.ts 20260924110000_journey_members.sql
 */
import { readFile } from 'node:fs/promises';
import { sql as raw } from 'drizzle-orm';
import { createDb } from '@ipc/db';

const file = process.argv[2];
if (!file) throw new Error('Which migration? Pass its filename.');

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

// The version is the leading timestamp, which is what the ledger keys on.
const version = /^(\d+)_/.exec(file)?.[1];
if (!version) throw new Error(`${file} does not start with a timestamp`);

const db = createDb(url, { max: 1 });

const already = await db.execute<{ version: string }>(
  raw`select version from supabase_migrations.schema_migrations where version = ${version}`,
);

if (already.length > 0) {
  console.log(`${file} is already recorded — nothing to do.`);
} else {
  const body = await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
  // Sent whole, because the file carries its own transaction blocks. Wrapping
  // it in another would break `alter type ... add value`, which cannot run in
  // a transaction that later uses the new value.
  await db.execute(raw.raw(body));
  await db.execute(raw`
    insert into supabase_migrations.schema_migrations (version, name)
    values (${version}, ${file.replace(/^\d+_/, '').replace(/\.sql$/, '')})
    on conflict (version) do nothing
  `);
  console.log(`Applied and recorded ${file}`);
}

process.exit(0);
