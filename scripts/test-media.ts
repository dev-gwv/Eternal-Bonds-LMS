/**
 * Proves post and win photographs actually work, under RLS, end to end.
 *
 *   bun run db:test-media
 *
 * The media chain is the kind that fails silently: an upload can succeed, a
 * row can be written, and the image still never appears because the reader
 * hardcoded a count to zero — which is exactly what `listPosts` did until now.
 * So this suite checks both halves, and checks that the ownership rules hold,
 * because the browser uploads straight to storage and the only thing standing
 * between a member and somebody else's post is a policy.
 *
 * Storage is exercised for real when SUPABASE_URL and the service key are set;
 * without them the row-level half still runs.
 */
import { sql } from 'drizzle-orm';
import { createDb, postMedia, winMedia, withUser } from '@ipc/db';
import { listPosts } from '../services/api/src/repo.ts';
import { createStorage } from '../services/api/src/lib/storage.ts';
import { EnvSchema } from '../services/api/src/env.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const env = EnvSchema.parse({
  DATABASE_URL: url,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  STORAGE_BUCKET: process.env.STORAGE_BUCKET,
});
const db = createDb(url, { max: 1 });

const alice = crypto.randomUUID();
const mallory = crypto.randomUUID();
const stamp = Date.now();

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

async function refused(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, 'it was allowed');
  } catch (error) {
    check(label, true, error instanceof Error ? error.message.slice(0, 50) : '');
  }
}

async function createMember(id: string, email: string) {
  await db.execute(sql`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    values (${id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${email}, '', now(), now(), now(), '{}'::jsonb, ${JSON.stringify({ full_name: email.split('@')[0] })}::jsonb)
  `);
  await db.execute(sql`
    insert into public.memberships (user_id, tier, status, source) values (${id}, 'diamond', 'active', 'test')
  `);
}

let postId = '';
let winId = '';
const uploadedKeys: string[] = [];

try {
  console.log('\nSetup');
  await createMember(alice, `media-alice-${stamp}@example.test`);
  await createMember(mallory, `media-mallory-${stamp}@example.test`);

  const [channel] = await db.execute<{ id: string }>(sql`select id from channels limit 1`);
  const [post] = await db.execute<{ id: string }>(sql`
    insert into posts (channel_id, author_id, body_md)
    values (${channel!.id}, ${alice}, 'Shot this at 5pm, window left.')
    returning id
  `);
  postId = post!.id;

  const [win] = await db.execute<{ id: string }>(sql`
    insert into wins (author_id, slug, title, big_idea_md, how_it_happened_md, category, status)
    values (${alice}, ${`media-test-${stamp}`}, 'A test win for the media suite',
            ${'The big idea, at least forty characters long so the check passes.'},
            ${'How it happened, also at least forty characters long here.'},
            'general', 'published')
    returning id
  `);
  winId = win!.id;
  check('a post and a win exist to attach photos to', Boolean(postId && winId));

  console.log('\nStorage');
  // Uploaded before anything is attached, because the feed signs a download
  // url per attachment and a key with no object behind it is dropped rather
  // than served broken — so the read-back below only means something against a
  // file that really exists.
  const haveStorage = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  let realKey = `posts/${postId}/placeholder.png`;

  if (!haveStorage) {
    console.log('  skip  no Supabase credentials in the environment');
  } else {
    const storage = createStorage(env);
    realKey = `posts/${postId}/${crypto.randomUUID()}.png`;
    const ticket = await storage.signedUploadUrl(realKey);
    check('storage mints a signed upload url', ticket.url.includes(realKey));

    // A one-pixel PNG, uploaded exactly the way the browser does it.
    const png = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
      (c) => c.charCodeAt(0),
    );
    const put = await fetch(ticket.url, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: png });
    check('the browser-style PUT is accepted', put.ok, `${put.status} ${put.statusText}`);
    if (put.ok) uploadedKeys.push(realKey);

    const got = await fetch(await storage.signedDownloadUrl(realKey, 60));
    check(
      'and the file reads back through a signed url',
      got.ok && got.headers.get('content-type')?.includes('png') === true,
      `${got.status} ${got.headers.get('content-type')}`,
    );
  }

  console.log('\nOwnership');
  await withUser(db, alice, async (tx) => {
    const row = (
      await tx
        .insert(postMedia)
        .values({ postId, storageKey: realKey, mime: 'image/png', width: 1600, height: 1067 })
        .returning()
    )[0]!;
    check('Alice can attach a photo to her own post', Boolean(row.id));
  });

  await refused("Mallory cannot attach to Alice's post", () =>
    withUser(db, mallory, (tx) =>
      tx.insert(postMedia).values({ postId, storageKey: `posts/${postId}/evil.jpg`, mime: 'image/jpeg' }).returning(),
    ),
  );

  await withUser(db, alice, async (tx) => {
    const row = (
      await tx.insert(winMedia).values({ winId, storageKey: `wins/${winId}/proof.jpg`, mime: 'image/jpeg' }).returning()
    )[0]!;
    check('Alice can attach proof to her own win', Boolean(row.id));
  });

  await refused("Mallory cannot attach proof to Alice's win", () =>
    withUser(db, mallory, (tx) =>
      tx.insert(winMedia).values({ winId, storageKey: `wins/${winId}/evil.jpg`, mime: 'image/jpeg' }).returning(),
    ),
  );

  console.log('\nReading it back');
  // The regression this suite exists for: the feed reported mediaCount 0 for
  // every post no matter what was attached, so an upload could succeed and the
  // photo would still never render.
  const feed = await listPosts(env, alice, undefined);
  const mine = feed.find((p) => p.id === postId);
  check('the post comes back in the feed', Boolean(mine));

  if (haveStorage) {
    check('it reports the photo it has', mine?.mediaCount === 1, `mediaCount=${mine?.mediaCount}`);
    check('and carries a usable url for it', Boolean(mine?.media[0]?.url), mine?.media[0]?.url?.slice(0, 48));
    check('with the dimensions it was saved with', mine?.media[0]?.width === 1600 && mine?.media[0]?.height === 1067);

    // The url has to actually fetch. A signed link that 400s is indistinguishable
    // from a working one on the server's side.
    const shown = await fetch(mine!.media[0]!.url);
    check('and the feed url serves the image', shown.ok, String(shown.status));
  } else {
    console.log('  skip  url checks need storage credentials');
  }
} finally {
  console.log('\nCleanup');
  try {
    if (uploadedKeys.length && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
      await createStorage(env).remove(uploadedKeys);
    }
  } catch {
    // Leaving a one-pixel PNG behind is not worth failing the run over.
  }
  await db.execute(sql`delete from wins where id = ${winId || null}`);
  await db.execute(sql`delete from posts where id = ${postId || null}`);
  await db.execute(sql`delete from auth.users where id in (${alice}, ${mallory})`);
  await db.$client.end({ timeout: 5 });
}

console.log(failures === 0 ? '\nAll media checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
