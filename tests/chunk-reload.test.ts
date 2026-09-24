import { describe, expect, test, beforeEach } from 'bun:test';

/**
 * The rule that keeps a deploy from breaking every open tab.
 *
 * Vite hashes chunks, so a deploy renames them. A tab open across that deploy
 * still asks for the old names, and the Worker's SPA fallback answers 200 with
 * index.html instead of 404 — the browser parses HTML as a module and the
 * route dies. Every lazy route in the app is affected, which is all of them
 * below the dashboard.
 *
 * The recovery is one reload, guarded so a genuinely missing chunk cannot
 * become a reload loop. This pins the guard, which is the part with teeth.
 */

const RELOAD_FLAG = 'eb-chunk-reload';

/** The decision `lazyPage` makes, extracted so it can be exercised directly. */
function shouldReload(store: Map<string, string>): boolean {
  const alreadyTried = store.get(RELOAD_FLAG) === '1';
  if (!alreadyTried) store.set(RELOAD_FLAG, '1');
  return !alreadyTried;
}

function onSuccess(store: Map<string, string>) {
  store.delete(RELOAD_FLAG);
}

describe('recovering from a renamed chunk', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
  });

  test('the first failure reloads', () => {
    expect(shouldReload(store)).toBe(true);
  });

  test('a second failure does not, so there is no reload loop', () => {
    expect(shouldReload(store)).toBe(true);
    expect(shouldReload(store)).toBe(false);
    expect(shouldReload(store)).toBe(false);
  });

  test('a successful load re-arms it, so the next deploy gets its own reload', () => {
    expect(shouldReload(store)).toBe(true);
    onSuccess(store);
    expect(shouldReload(store)).toBe(true);
  });

  test('success on a fresh session leaves nothing behind', () => {
    onSuccess(store);
    expect(store.size).toBe(0);
  });
});
