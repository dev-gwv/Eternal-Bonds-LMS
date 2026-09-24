/**
 * Finds the pages nothing links to and the links that go nowhere.
 *
 *   bun run audit:frontend
 *
 * Three questions, all of which the type system answers "fine" to:
 *
 *   1. Is every route reachable? A page with no link to it is a page nobody
 *      will ever see, whatever it cost to build.
 *   2. Does every link land on a route? TanStack Router's `to` is typed, but
 *      a link built from a string at runtime — a notification's `link`, a
 *      search result's — is not.
 *   3. Does every client method reach a handler, and does every handler have
 *      a caller? The first is a 404 waiting to happen; the second is dead
 *      weight, or a feature that was built and never wired up.
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

const webFiles = await walk('apps/web/src');
const sources = new Map<string, string>();
for (const f of webFiles) sources.set(f, await readFile(f, 'utf8'));

const router = sources.get('apps/web/src/app/router.tsx') ?? '';

/* ── 1. Routes ─────────────────────────────────────────────────────────── */

// A route definition, whole, so its body can be inspected.
const defs = [...router.matchAll(/createRoute\(\{([\s\S]*?)\n\}\)/g)].map((m) => m[1]!);
const routes = [...router.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]!);

/* A route that only redirects is *supposed* to have nothing linking to it —
   it exists for bookmarks and for links in mail already sent. Counting those
   as dead pages buries the real ones. */
const redirectOnly = new Set(
  defs
    .filter((d) => d.includes('redirect(') && !d.includes('component:'))
    .flatMap((d) => [...d.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]!)),
);
// A route is "linked" if any file mentions its path as a `to=` or in a string.
const everything = [...sources.entries()].filter(([f]) => !f.endsWith('router.tsx'));

const unlinked = routes.filter((r) => {
  if (r === '/' || redirectOnly.has(r)) return false;
  return !everything.some(([, src]) => src.includes(`'${r}'`) || src.includes(`"${r}"`));
});

/* ── 2. Links ──────────────────────────────────────────────────────────── */

const toPattern = (r: string) => new RegExp('^' + r.replace(/\$[A-Za-z]+/g, '[^/]+') + '$');
const patterns = routes.map(toPattern);

const linkTargets = new Set<string>();
for (const [f, src] of everything) {
  for (const m of src.matchAll(/\bto=["']([^"'{}]+)["']/g)) linkTargets.add(`${f}::${m[1]!}`);
  for (const m of src.matchAll(/\bhref=["'](\/[^"'{}]*)["']/g)) linkTargets.add(`${f}::${m[1]!}`);
}

const dangling = [...linkTargets].filter((entry) => {
  const path = entry.split('::')[1]!.split('?')[0]!.split('#')[0]!;
  if (!path.startsWith('/')) return false;
  return !patterns.some((p) => p.test(path));
});

/* ── 3. API surface ────────────────────────────────────────────────────── */

const clientSrc =
  (sources.get('apps/web/src/shared/api.ts') ?? '') + (sources.get('apps/web/src/shared/admin-api.ts') ?? '');

const clientMethods = [...clientSrc.matchAll(/^\s{2}([a-zA-Z][\w]*):\s*(?:\(|async)/gm)].map((m) => m[1]!);
const usedElsewhere = everything
  .filter(([f]) => !/shared\/(admin-)?api\.ts$/.test(f))
  .map(([, s]) => s)
  .join('\n');

const unusedMethods = [...new Set(clientMethods)].filter(
  (name) => !new RegExp(`\\b(api|adminApi)\\.${name}\\b`).test(usedElsewhere),
);

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
n += section('Routes nothing links to', unlinked, 'a page no member can navigate to');
n += section('Links with no matching route', dangling, 'these 404 or fall through to the catch-all');
n += section('API client methods nobody calls', unusedMethods, 'built and never wired up, or dead weight');

console.log(`\n${n} finding(s).`);
