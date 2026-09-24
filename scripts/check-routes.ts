/**
 * Catches a route that can never be reached.
 *
 *   bun run check:routes
 *
 * Hono matches in registration order, so `.get('/:id')` written above
 * `.get('/badges')` answers every request to `/badges` — and answers it with
 * whatever `/:id` does when handed the string "badges". That is not a 404 the
 * next person will recognise; in the case that prompted this file it was a
 * 500 from Postgres refusing `'badges'::uuid`, on the member page, for every
 * member, because the badge strip lives there. Nothing failed at build time,
 * no test covered it, and the endpoint had worked for weeks before an
 * unrelated feature added a wildcard above it.
 *
 * The real fix is a constrained pattern — `/:id{[0-9a-fA-F-]{36}}` cannot
 * match "badges" — and this check is how anybody finds out they needed one.
 * A bare `:param` is flagged only when a literal sibling is actually behind
 * it, so the common case of a wildcard with nothing after it stays quiet.
 */
import { readdir, readFile } from 'node:fs/promises';

const DIRS = ['services/api/src/modules'];
const VERBS = /\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;

let problems = 0;

for (const dir of DIRS) {
  for (const file of await readdir(dir)) {
    if (!file.endsWith('.ts')) continue;
    const src = await readFile(`${dir}/${file}`, 'utf8');

    // Each `new Hono` starts its own match order, so they are scanned apart.
    for (const chunk of src.split('new Hono')) {
      const routes = [...chunk.matchAll(VERBS)].map((m) => ({ verb: m[1]!, path: m[2]! }));

      for (const [i, earlier] of routes.entries()) {
        const segs = earlier.path.split('/');
        // A constrained param — `:id{...}` — is not a wildcard for this
        // purpose: that is exactly the fix being recommended.
        if (!segs.some((s) => s.startsWith(':') && !s.includes('{'))) continue;

        for (const later of routes.slice(i + 1)) {
          if (later.verb !== earlier.verb) continue;
          const other = later.path.split('/');
          if (other.length !== segs.length) continue;
          const shadows = segs.every(
            (s, k) => s === other[k] || (s.startsWith(':') && !s.includes('{') && !other[k]!.startsWith(':')),
          );
          if (shadows) {
            problems += 1;
            console.log(
              `  ${file}: ${earlier.verb.toUpperCase()} ${earlier.path} is registered above ${later.path}, ` +
                `so ${later.path} is unreachable.`,
            );
          }
        }
      }
    }
  }
}

if (problems > 0) {
  console.log(
    `\n${problems} unreachable route(s). Move the wildcard below its siblings, ` +
      'or constrain it — `/:id{[0-9a-fA-F-]{36}}` matches a uuid and nothing else.',
  );
  process.exit(1);
}
console.log('Every route is reachable.');
