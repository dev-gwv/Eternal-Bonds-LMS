/**
 * The other two directions.
 *
 *   bun run audit:backend
 *
 * `audit:frontend` asks whether every client method has a call site. It cannot
 * see the gap that hid the library for this project's whole life, because that
 * gap was one level further back: tables with RLS policies, no endpoints, and
 * so no client method to be unused.
 *
 * So this walks the other way:
 *
 *   1. Every route the API serves — is anything calling it? An endpoint with
 *      no caller is either dead weight or a feature that stopped one step
 *      short of being usable.
 *   2. Every table in the schema — does any query touch it? A table nothing
 *      reads is a feature that was designed and abandoned, and it will keep
 *      looking like progress in the migration folder forever.
 */
import { readdir, readFile, stat } from 'node:fs/promises';

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const name of await readdir(dir)) {
    const full = `${dir}/${name}`;
    if ((await stat(full)).isDirectory()) await walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const read = async (files: string[]) =>
  (await Promise.all(files.map((f) => readFile(f, 'utf8')))).join('\n');

const apiFiles = await walk('services/api/src');
const webFiles = await walk('apps/web/src');
const workerFiles = await walk('services/worker/src');
const scriptFiles = (await readdir('scripts')).filter((f) => f.endsWith('.ts')).map((f) => `scripts/${f}`);

const webSrc = await read(webFiles);
const apiSrc = await read(apiFiles);
const otherSrc = (await read(workerFiles)) + (await read(scriptFiles));

/* ── 1. Routes with no caller ──────────────────────────────────────────── */

/** Where each router is mounted, so a route's path can be reassembled. */
const MOUNTS: Record<string, string> = {};
for (const m of apiSrc.matchAll(/\.route\('([^']+)',\s*(\w+)\)/g)) MOUNTS[m[2]!] = m[1]!;

type Route = { file: string; verb: string; path: string; router: string };
const routes: Route[] = [];

for (const file of apiFiles) {
  const src = await readFile(file, 'utf8');
  for (const block of src.split(/export const (\w+) = new Hono/).slice(1)) {
    // split() alternates [name, body, name, body, ...]
    if (!block.includes('.get(') && !block.includes('.post(') && !block.includes('.patch(')
        && !block.includes('.put(') && !block.includes('.delete(')) {
      var routerName = block.trim();
      continue;
    }
    for (const m of block.matchAll(/\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
      if (m[2] === 'userId') continue;
      routes.push({ file, verb: m[1]!.toUpperCase(), path: m[2]!, router: routerName! });
    }
  }
}

/** Turn a route into the literal prefix a client string would contain. */
function callablePath(r: Route): string {
  const chain: string[] = [];
  let name: string | undefined = r.router;
  // Walk up the mount chain (a router mounted inside another).
  const seen = new Set<string>();
  while (name && MOUNTS[name] !== undefined && !seen.has(name)) {
    seen.add(name);
    chain.unshift(MOUNTS[name]!);
    const parent = Object.entries(MOUNTS).find(([child]) => child === name);
    name = undefined;
    void parent;
  }
  return chain.join('') + (r.path === '/' ? '' : r.path);
}

/** The first literal segment of a path is enough to find a call site. */
const searchable = (p: string) => p.split('/:')[0]!.replace(/\{[^}]*\}/g, '');

const uncalled = routes.filter((r) => {
  const tail = searchable(r.path);
  if (tail === '' || tail === '/') return false;
  const needle = tail.replace(/^\//, '');
  if (needle.length < 3) return false;
  return !webSrc.includes(needle) && !otherSrc.includes(needle);
});

/* ── 2. Tables nothing touches ─────────────────────────────────────────── */

const schema = await readFile('packages/db/src/schema.ts', 'utf8');
/* Both names, because a table is reached two ways: as the Drizzle export
   (`libraryItems`) from a query builder, and as the SQL identifier
   (`library_items`) inside a raw `sql` template. Checking only one of them
   leaves half the codebase invisible to this check. */
const tables = [...schema.matchAll(/export const (\w+) = pgTable\(\s*\n?\s*'([a-z_]+)'/g)].map((m) => ({
  binding: m[1]!,
  sqlName: m[2]!,
}));

const everything = apiSrc + otherSrc + webSrc;
const untouched = tables
  .filter(({ binding, sqlName }) => !everything.includes(binding) && !everything.includes(sqlName))
  .map(({ sqlName }) => sqlName);

/* ── Report ────────────────────────────────────────────────────────────── */

const section = (title: string, rows: string[], note: string) => {
  console.log(`\n${title}`);
  if (rows.length === 0) console.log('  none');
  else {
    for (const r of rows) console.log(`  ${r}`);
    console.log(`  → ${note}`);
  }
  return rows.length;
};

let n = 0;
n += section(
  'API routes nothing calls',
  uncalled.map((r) => `${r.verb.padEnd(6)} ${callablePath(r)}   (${r.file.split('/').pop()})`),
  'an endpoint with no caller is a feature that stopped one step short',
);
n += section('Tables no query touches', untouched, 'designed, migrated, and never used');

console.log(`\n${n} finding(s).`);
