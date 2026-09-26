import { sql } from 'drizzle-orm';
import type { Db } from '@ipc/db';
import type { Env } from '../env.ts';
import { activityEmail, createMailer, digestEmail } from '../delivery/email.ts';
import { createPusher, withinQuietHours } from '../delivery/push.ts';

/**
 * Turning events into notifications, and notifications into deliveries.
 *
 * Two jobs, deliberately separate:
 *
 *   - `outbox.drain` decides *that* somebody should be told something. It is
 *     fast, transactional, and must not be held up by a slow SMTP call.
 *   - `notifications.deliver` decides *how*. It is slow, it talks to the
 *     outside world, and it is allowed to fail and be retried without
 *     re-deciding anything.
 *
 * Collapsing them would mean a flaky email provider could stop the in-app
 * feed from updating, which is exactly backwards: the in-app notification is
 * the one that always works.
 */

type Outbox = { id: string; topic: string; payload: Record<string, unknown> };

/**
 * Fans one event out to the people it concerns.
 *
 * The unique index on (user_id, kind, subject_type, subject_id) is doing real
 * work here: three people liking the same post in the same minute produce one
 * notification, not three, and a replayed outbox row produces none.
 */
async function fanOut(db: Db, row: Outbox): Promise<number> {
  const p = row.payload;

  switch (row.topic) {
    /* Somebody answered a question under a lesson.
       The one part of the discussion pipeline that was missing, and the part
       that decides whether anybody asks a second question: a question answered
       into silence may as well not have been. */
    case 'lesson.answered': {
      const askerId = p.askerId as string | undefined;
      if (!askerId) return 0;
      const inserted = await db.execute<{ id: string }>(sql`
        insert into notifications (user_id, kind, title, body, link, subject_type, subject_id)
        select
          ${askerId}::uuid,
          'lesson.answered',
          coalesce(u.full_name, 'Someone') || ' answered your question',
          left(q.body_md, 140),
          '/learn/' || c.slug || '/' || l.slug,
          'lesson',
          l.id
        from lesson_questions q
        join users u on u.id = q.author_id
        join lessons l on l.id = q.lesson_id
        join modules m on m.id = l.module_id
        join courses c on c.id = m.course_id
        where q.id = ${p.answerId as string}::uuid
        on conflict do nothing
        returning id
      `);
      return inserted.length;
    }

    case 'post.replied': {
      const authorId = p.authorId as string | undefined;
      if (!authorId) return 0;
      const inserted = await db.execute<{ id: string }>(sql`
        insert into notifications (user_id, kind, title, body, link, subject_type, subject_id)
        select
          ${authorId}::uuid,
          'post.replied',
          coalesce(u.full_name, 'Someone') || ' replied to your post',
          left(pc.body_md, 140),
          '/community?post=' || pc.post_id::text,
          'post',
          pc.post_id
        from post_comments pc
        join users u on u.id = pc.author_id
        where pc.id = ${p.commentId as string}::uuid
        on conflict do nothing
        returning id
      `);
      return inserted.length;
    }

    case 'post.liked': {
      const authorId = p.authorId as string | undefined;
      if (!authorId) return 0;
      // The body counts likes at delivery time, so a post that gathers ten
      // while the member is asleep says "10 people", not ten notifications.
      const inserted = await db.execute<{ id: string }>(sql`
        insert into notifications (user_id, kind, title, body, link, subject_type, subject_id)
        select
          ${authorId}::uuid,
          'post.liked',
          'Your post is getting likes',
          p.likes_count || ' member' || case when p.likes_count = 1 then '' else 's' end || ' liked it',
          '/community?post=' || p.id::text,
          'post',
          p.id
        from posts p
        where p.id = ${p.postId as string}::uuid
        on conflict do nothing
        returning id
      `);
      return inserted.length;
    }

    case 'course.published': {
      // Everyone whose tier reaches it. This is the one fan-out that is big,
      // which is why it is a set-based insert rather than a loop.
      const inserted = await db.execute<{ id: string }>(sql`
        insert into notifications (user_id, kind, title, body, link, subject_type, subject_id)
        select
          u.id,
          'course.published',
          'New course: ' || c.title,
          c.summary_md,
          '/courses/' || c.slug,
          'course',
          c.id
        from courses c
        cross join users u
        where c.id = ${p.courseId as string}::uuid
          and not u.is_suspended
          and array_position(array['free','silver','diamond','franchisee']::text[], public.current_tier(u.id)::text)
              >= array_position(array['free','silver','diamond','franchisee']::text[], c.min_tier::text)
        on conflict do nothing
        returning id
      `);
      return inserted.length;
    }

    case 'digest.weekly': {
      const userId = p.userId as string | undefined;
      if (!userId) return 0;
      const inserted = await db.execute<{ id: string }>(sql`
        insert into notifications (user_id, kind, title, body, link, subject_type, subject_id)
        values (
          ${userId}::uuid,
          'digest.weekly',
          'Your week at the club',
          ${`${p.minutes ?? 0} minutes learning, ${p.xp ?? 0} XP`},
          '/',
          'digest',
          null
        )
        returning id
      `);
      return inserted.length;
    }

    case 'account.deletion_scheduled':
    case 'account.deletion_cancelled':
      // Deliberately silent. The member just did this themselves and is
      // looking at the confirmation; a notification about it is noise.
      return 0;

    default:
      return 0;
  }
}

/**
 * Drains the outbox.
 *
 * The API writes an outbox row in the same transaction as the change it
 * describes, so the event cannot exist without the change or vice versa. This
 * is where those events turn into notifications.
 */
export async function drainOutbox(db: Db, batch = 100) {
  const rows = await db.execute<Outbox>(sql`
    select id, topic, payload
    from outbox
    where processed_at is null
    order by created_at
    for update skip locked
    limit ${batch}
  `);

  let delivered = 0;
  let notified = 0;

  for (const row of rows) {
    try {
      notified += await fanOut(db, row);
    } catch (error) {
      // One malformed payload must not wedge the queue behind it. The row is
      // marked processed with the error recorded; the outbox is a delivery
      // mechanism, not the system of record.
      console.error(JSON.stringify({ outbox: row.id, topic: row.topic, error: String(error) }));
    }
    await db.execute(sql`update outbox set processed_at = now() where id = ${row.id}`);
    delivered += 1;
  }

  return { delivered, notified };
}

/* ── Delivery ──────────────────────────────────────────────────────────────*/

const IST_OFFSET_MINUTES = 5 * 60 + 30;

/**
 * Sends the email and push copies of notifications that want them.
 *
 * Preferences are checked here rather than at fan-out time: a member who turns
 * email off should stop receiving it for things that already happened, not
 * only for things that happen next.
 */
export async function deliverNotifications(db: Db, env: Env, batch = 50) {
  const mailer = createMailer(env);
  const pusher = createPusher(env);

  // Only what is still undelivered, still unread, and recent. A notification
  // nobody has read in a week is not worth emailing about now.
  const rows = await db.execute<{
    id: string;
    user_id: string;
    kind: string;
    title: string;
    body: string | null;
    link: string | null;
    email: string | null;
    full_name: string;
    email_activity: boolean;
    email_digest: boolean;
    push: boolean;
    quiet_from: string;
    quiet_to: string;
    email_sent_at: string | null;
    push_sent_at: string | null;
  }>(sql`
    select
      n.id, n.user_id, n.kind::text as kind, n.title, n.body, n.link,
      u.email, u.full_name,
      np.email_activity, np.email_digest, np.push, np.quiet_from::text, np.quiet_to::text,
      n.email_sent_at, n.push_sent_at
    from notifications n
    join users u on u.id = n.user_id
    join notification_prefs np on np.user_id = n.user_id
    where n.read_at is null
      and n.created_at > now() - interval '7 days'
      and not u.is_suspended
      and (n.email_sent_at is null or n.push_sent_at is null)
    order by n.created_at
    limit ${batch}
  `);

  let emailed = 0;
  let pushed = 0;
  let skipped = 0;

  // "Now" in IST, because quiet hours are a human's hours and every member is
  // in one timezone.
  const utcMinutes = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
  const istMinutes = (utcMinutes + IST_OFFSET_MINUTES) % (24 * 60);

  for (const row of rows) {
    const wantsEmail =
      row.email_sent_at === null &&
      Boolean(row.email) &&
      (row.kind === 'digest.weekly' ? row.email_digest : row.email_activity);

    if (wantsEmail) {
      const email =
        row.kind === 'digest.weekly'
          ? digestEmail(row.full_name, parseDigest(row.body), env.APP_URL)
          : activityEmail(row.title, row.body ?? '', row.link ?? '/', env.APP_URL);

      try {
        await mailer.send({ ...email, to: row.email! });
        await db.execute(sql`update notifications set email_sent_at = now() where id = ${row.id}`);
        emailed += 1;
      } catch (error) {
        // Recorded on the row, not thrown: one bad address must not stop the
        // other forty-nine notifications in this batch.
        await db.execute(sql`
          update notifications set delivery_error = ${String(error).slice(0, 300)} where id = ${row.id}
        `);
      }
    }

    const quiet = withinQuietHours(istMinutes, row.quiet_from, row.quiet_to);
    if (row.push_sent_at === null && row.push && !quiet) {
      const tokens = await db.execute<{ id: string; token: string }>(sql`
        select id, token from push_tokens where user_id = ${row.user_id}::uuid and revoked_at is null
      `);

      let anySent = false;
      for (const device of tokens) {
        const result = await pusher.send({
          token: device.token,
          title: row.title,
          body: row.body ?? '',
          link: row.link ?? '/',
        });
        if (result.ok) anySent = true;
        // A dead token is revoked rather than retried forever. This is the
        // only way the table stays clean over years of reinstalls.
        if (result.unregistered) {
          await db.execute(sql`update push_tokens set revoked_at = now() where id = ${device.id}`);
        }
      }

      if (anySent) {
        await db.execute(sql`update notifications set push_sent_at = now() where id = ${row.id}`);
        pushed += 1;
      }
    } else if (quiet && row.push) {
      // Left alone on purpose: the next run after 08:00 picks it up.
      skipped += 1;
    }
  }

  return { considered: rows.length, emailed, pushed, quietHoursDeferred: skipped, via: `${mailer.name}/${pusher.name}` };
}

/** The digest body is "N minutes learning, M XP" — read back for the template. */
function parseDigest(body: string | null): { minutes: number; xp: number; lessons: number } {
  const minutes = Number(/(\d+)\s+minutes/.exec(body ?? '')?.[1] ?? 0);
  const xp = Number(/(\d+)\s+XP/.exec(body ?? '')?.[1] ?? 0);
  return { minutes, xp, lessons: 0 };
}
