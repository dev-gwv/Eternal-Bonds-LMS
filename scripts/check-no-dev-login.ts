/**
 * Fails if a built bundle still contains the test sign-in button.
 *
 *   bun run check:no-dev-login
 *
 * The button is dead code in a normal build and the bundler removes it. This
 * asserts that rather than trusting it — a build config change, a bundler
 * upgrade or a refactor could quietly stop the folding, and the failure mode
 * is a one-click login sitting in production where nobody looks.
 *
 * Runs in CI after the build.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'apps/web/dist/assets';
const MARKERS = ['REMOVE BEFORE LAUNCH', 'Skip login'];

let files: string[];
try {
  files = readdirSync(dir).filter((f) => f.endsWith('.js'));
} catch {
  console.error(`No build found at ${dir}. Run \`bun run build\` first.`);
  process.exit(1);
}

const wanted = process.env.EXPECT_DEV_LOGIN === 'true';
const found: string[] = [];

for (const file of files) {
  const source = readFileSync(join(dir, file), 'utf8');
  for (const marker of MARKERS) {
    if (source.includes(marker)) found.push(`${file}: "${marker}"`);
  }
}

if (wanted) {
  // The other direction matters too: a test build whose button vanished would
  // send someone hunting for a broken deploy that is working exactly as built.
  found.length > 0
    ? console.log(`Test sign-in present, as expected (EXPECT_DEV_LOGIN=true).`)
    : (console.error('EXPECT_DEV_LOGIN=true but the button is not in the bundle.'), process.exit(1));
} else if (found.length > 0) {
  console.error('The test sign-in button is in the production bundle:\n  ' + found.join('\n  '));
  console.error('\nRebuild without VITE_DEV_LOGIN_EMAIL and VITE_DEV_LOGIN_PASSWORD.');
  process.exit(1);
} else {
  console.log('No test sign-in in the bundle.');
}
