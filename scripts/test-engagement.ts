/**
 * Proves likes, comments, notifications and membership grants actually work,
 * under RLS, against the real database.
 *
 *   bun run db:test-engagement
 *
 * These are the paths where a missing policy or a missing trigger produces a
 * number that is quietly wrong rather than an error — which is the worst kind
 * of bug to find in production. Two throwaway members are created and removed
 * again, including on failure.
 */
import { sql } from 'drizzle-orm';
import { createDb } from '@ipc/db';
import { runJob } from '@ipc/worker';
import { readEnv } from '@ipc/worker';
import * as engagement from '../services/api/src/engagement.ts';
import * as prefs from '../services/api/src/prefs.ts';
import { EnvSchema } from '../services/api/src/env.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const env = EnvSchema.parse({ DATABASE_URL: url });
const workerEnv = readEnv({ DATABASE_URL: url });
const db = createDb(url, { max: 1 });

const alice = crypto.randomUUID();
const bob = crypto.randomUUID();
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
  // Diamond, so the tier-gated channel policies let them in at all.
  await db.execute(sql`
    insert into public.memberships (user_id, tier, status, source) values (${id}, 'diamond', 'active', 'test')
  `);
}

let postId = '';

try {
  console.log('\nSetup');
  await createMember(alice, `eng-alice-${stamp}@example.test`);
  await createMember(bob, `eng-bob-${stamp}@example.test`);

  const [prefsRow] = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from notification_prefs where user_id in (${alice}, ${bob})`,
  );
  check('the trigger gave both a preferences row', Number(prefsRow?.n) === 2, `${prefsRow?.n} of 2`);

  const [channel] = await db.execute<{ id: string }>(sql`select id from channels limit 1`);
  const [post] = await db.execute<{ id: string }>(sql`
    insert into posts (channel_id, author_id, body_md)
    values (${channel!.id}, ${alice}, 'Test post for the engagement suite')
    returning id
  `);
  postId = post!.id;
  check('a post exists to react to', Boolean(postId));

  console.log('\nLikes');
  const liked = await engagement.setPostLike(env, bob, postId, true);
  check('Bob can like it', liked.liked && liked.likes === 1, `likes=${liked.likes}`);

  // The primary key already guarantees this; what is being checked is that the
  // second attempt is a no-op rather than a 500 or a double count.
  const again = await engagement.setPostLike(env, bob, postId, true);
  check('liking twice still counts once', again.likes === 1, `likes=${again.likes}`);

  const unliked = await engagement.setPostLike(env, bob, postId, false);
  check('unliking takes it back off', unliked.likes === 0, `likes=${unliked.likes}`);

  await engagement.setPostLike(env, bob, postId, true);
  const seenByBob = await engagement.likedPostIds(env, bob, [postId]);
  const seenByAlice = await engagement.likedPostIds(env, alice, [postId]);
  check('Bob sees his own like', seenByBob.has(postId));
  check('Alice does not see it as hers', !seenByAlice.has(postId));

  console.log('\nComments');
  const comment = await engagement.createComment(env, bob, postId, {
    bodyMd: 'Great light in the third frame.',
    parentId: null,
  });
  check('Bob can comment', Boolean(comment.id));

  const reply = await engagement.createComment(env, alice, postId, {
    bodyMd: 'Thanks — 5pm, window left.',
    parentId: comment.id,
  });
  check('Alice can reply to it', reply.parentId === comment.id);

  // A reply to a reply has to flatten, or the thread grows a third column.
  const nested = await engagement.createComment(env, bob, postId, {
    bodyMd: 'Noted.',
    parentId: reply.id,
  });
  check('a reply to a reply attaches to the root', nested.parentId === comment.id, `parent=${nested.parentId}`);

  const [counts] = await db.execute<{ likes: number; comments: number }>(
    sql`select likes_count as likes, comments_count as comments from posts where id = ${postId}`,
  );
  check(
    'the triggers kept the post counters right',
    Number(counts?.likes) === 1 && Number(counts?.comments) === 3,
    `likes=${counts?.likes} comments=${counts?.comments}`,
  );

  const thread = await engagement.listComments(env, alice, postId);
  check('the thread nests one level', thread.length === 1 && thread[0]!.replies.length === 2, `roots=${thread.length}`);

  await engagement.setCommentLike(env, alice, comment.id, true);
  const afterLike = await engagement.listComments(env, alice, postId);
  check('a comment like is counted and attributed', afterLike[0]!.likes === 1 && afterLike[0]!.likedByMe);

  console.log('\nOwnership');
  await refused("Bob cannot edit Alice's reply", () => engagement.editComment(env, bob, reply.id, 'hijacked'));
  const [untouched] = await db.execute<{ body: string }>(
    sql`select body_md as body from post_comments where id = ${reply.id}`,
  );
  check('the reply kept its text', untouched?.body === 'Thanks — 5pm, window left.');

  console.log('\nSoft delete');
  await engagement.deleteComment(env, bob, nested.id);
  const [afterDelete] = await db.execute<{ comments: number }>(
    sql`select comments_count as comments from posts where id = ${postId}`,
  );
  check('deleting decrements the counter', Number(afterDelete?.comments) === 2, `comments=${afterDelete?.comments}`);

  const stillThere = await engagement.listComments(env, alice, postId);
  const deleted = stillThere[0]!.replies.find((r) => r.id === nested.id);
  // The row has to survive, or a reply would lose the comment it answered.
  check('the row survives so replies keep a parent', Boolean(deleted) && deleted!.deleted === true);
  check('its text is withheld', deleted?.bodyMd === '[deleted]');

  console.log('\nNotifications');
  const drained = await runJob(db, 'outbox.drain', workerEnv);
  check('the outbox drains', drained.ok, JSON.stringify(drained.result));

  const feed = await engagement.listNotifications(env, alice);
  check('Alice was told about the reply', feed.items.some((n) => n.kind === 'post.replied'), `${feed.items.length} items`);
  check('it starts unread', feed.unread > 0, `unread=${feed.unread}`);

  const bobFeed = await engagement.listNotifications(env, bob);
  check("Bob cannot see Alice's notifications", bobFeed.items.length === 0, `${bobFeed.items.length} items`);

  const read = await engagement.markNotificationsRead(env, alice, null);
  check('marking all read clears the count', read.unread === 0, `unread=${read.unread}`);

  console.log('\nPreferences and devices');
  const updated = await prefs.updatePrefs(env, alice, { emailActivity: true, quietFrom: '23:00' });
  check('preferences save', updated.emailActivity && updated.quietFrom === '23:00', updated.quietFrom);

  await prefs.registerPushToken(env, alice, { token: `test-token-${stamp}`, platform: 'android' });
  check('registering a device turns push on', (await prefs.getPrefs(env, alice)).push);

  // The same token twice must not become two rows, or one notification buzzes
  // the phone twice.
  await prefs.registerPushToken(env, alice, { token: `test-token-${stamp}`, platform: 'android' });
  check('registering the same device twice keeps one row', (await prefs.deviceCount(env, alice)) === 1);

  console.log('\nMembership grants');
  const [plan] = await db.execute<{ id: string; duration_days: number }>(
    sql`select id, duration_days from plans where tier = 'silver' limit 1`,
  );
  await db.execute(sql`delete from memberships where user_id = ${bob}`);
  await db.execute(sql`select public.grant_membership(${bob}::uuid, ${plan!.id}, 'test')`);

  const [tier] = await db.execute<{ tier: string }>(sql`select public.current_tier(${bob}::uuid)::text as tier`);
  check('granting a plan sets the tier', tier?.tier === 'silver', tier?.tier);

  const [first] = await db.execute<{ expires_at: string }>(
    sql`select max(expires_at)::text as expires_at from memberships where user_id = ${bob}`,
  );
  await db.execute(sql`select public.grant_membership(${bob}::uuid, ${plan!.id}, 'test')`);
  const [second] = await db.execute<{ expires_at: string }>(
    sql`select max(expires_at)::text as expires_at from memberships where user_id = ${bob}`,
  );
  // Renewing early must add time rather than restart the clock, or the members
  // most willing to pay early are the ones quietly robbed.
  const added = (Date.parse(second!.expires_at) - Date.parse(first!.expires_at)) / 86_400_000;
  check('renewing extends rather than replaces', Math.round(added) === plan!.duration_days, `+${Math.round(added)} days`);

  const [grantNotice] = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from notifications where user_id = ${bob} and kind = 'membership.activated'`,
  );
  check('the member is told', Number(grantNotice?.n) >= 1);

  console.log('\nReconciliation');
  // Break a counter by hand, then prove the job notices. This is the check
  // that the safety net is a net and not decoration.
  await db.execute(sql`update posts set likes_count = 99 where id = ${postId}`);
  const reconciled = await runJob(db, 'counters.reconcile', workerEnv);
  const [fixed] = await db.execute<{ likes: number }>(sql`select likes_count as likes from posts where id = ${postId}`);
  check('drift is corrected', Number(fixed?.likes) === 1, `likes=${fixed?.likes}`);
  check('and reported', Number((reconciled.result as { fixed?: number })?.fixed) > 0);
} catch (error) {
  console.error('\nThrew:', error instanceof Error ? error.message : error);
  failures += 1;
} finally {
  if (postId) await db.execute(sql`delete from posts where id = ${postId}`);
  await db.execute(sql`delete from auth.users where id in (${alice}, ${bob})`);
  console.log('\nCleaned up both test members.');
}

console.log(failures === 0 ? '\nEngagement holds.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
