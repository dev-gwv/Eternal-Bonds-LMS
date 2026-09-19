/**
 * Proves unread counts are correct, against the real database.
 *
 *   bun run db:test-unread
 *
 * `Channel.unread` was hardcoded to 0 for months while the UI faithfully
 * rendered it, so this suite exists to make the opposite failure loud. The
 * three rules that are obvious only once they are wrong: your own posts are
 * never unread to you, opening a channel clears it, and a post arriving after
 * you read still counts.
 */
import { sql } from 'drizzle-orm';
import { createDb } from '@ipc/db';
import { listChannels } from '../services/api/src/repo.ts';
import { markChannelRead } from '../services/api/src/engagement.ts';
import { EnvSchema } from '../services/api/src/env.ts';

const env = EnvSchema.parse(process.env);
const db = createDb(process.env.DATABASE_URL!, { max: 1 });

const alice = crypto.randomUUID();
const bob = crypto.randomUUID();
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

async function member(id: string, email: string) {
  await db.execute(sql`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    values (${id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${email}, '', now(), now(), now(), '{}'::jsonb, ${JSON.stringify({ full_name: email.split('@')[0] })}::jsonb)
  `);
  await db.execute(sql`insert into public.memberships (user_id, tier, status, source) values (${id}, 'diamond', 'active', 'test')`);
}

const unreadFor = async (id: string, slug: string) =>
  (await listChannels(env, id)).find((c) => c.slug === slug)?.unread ?? -1;

const stamp = Date.now();
const postIds: string[] = [];

try {
  await member(alice, `unread-a-${stamp}@example.test`);
  await member(bob, `unread-b-${stamp}@example.test`);
  const [ch] = await db.execute<{ id: string; slug: string }>(sql`select id, slug from channels limit 1`);

  check('a brand-new member has nothing unread', (await unreadFor(alice, ch!.slug)) === 0);

  const [p1] = await db.execute<{ id: string }>(sql`
    insert into posts (channel_id, author_id, body_md) values (${ch!.id}, ${bob}, 'first') returning id
  `);
  postIds.push(p1!.id);
  check("Bob's post is unread for Alice", (await unreadFor(alice, ch!.slug)) === 1);

  // You have read what you wrote.
  check('but not for Bob himself', (await unreadFor(bob, ch!.slug)) === 0, `saw ${await unreadFor(bob, ch!.slug)}`);

  const [p2] = await db.execute<{ id: string }>(sql`
    insert into posts (channel_id, author_id, body_md) values (${ch!.id}, ${bob}, 'second') returning id
  `);
  postIds.push(p2!.id);
  check('a second post counts', (await unreadFor(alice, ch!.slug)) === 2);

  await markChannelRead(env, alice, ch!.slug);
  check('opening the channel clears it', (await unreadFor(alice, ch!.slug)) === 0);

  const [p3] = await db.execute<{ id: string }>(sql`
    insert into posts (channel_id, author_id, body_md) values (${ch!.id}, ${bob}, 'third') returning id
  `);
  postIds.push(p3!.id);
  check('a post after reading counts again', (await unreadFor(alice, ch!.slug)) === 1);

  // Alice's own post must not make her own badge appear.
  const [p4] = await db.execute<{ id: string }>(sql`
    insert into posts (channel_id, author_id, body_md) values (${ch!.id}, ${alice}, 'mine') returning id
  `);
  postIds.push(p4!.id);
  check('posting does not raise your own badge', (await unreadFor(alice, ch!.slug)) === 1);

  check("Bob's own badge shows Alice's post", (await unreadFor(bob, ch!.slug)) === 1);
} catch (error) {
  console.error('\nThrew:', error instanceof Error ? error.message : error);
  failures += 1;
} finally {
  if (postIds.length) await db.execute(sql`delete from posts where id = any(${sql`array[${sql.join(postIds.map((i) => sql`${i}::uuid`), sql`, `)}]`})`);
  await db.execute(sql`delete from auth.users where id in (${alice}, ${bob})`);
  console.log('\nCleaned up.');
}
console.log(failures === 0 ? 'Unread counts hold.\n' : `${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
