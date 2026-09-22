import { sql } from 'drizzle-orm';
import type { Db } from '@ipc/db';

/**
 * Account lifecycle and housekeeping.
 *
 * The outbox drain used to live here; it moved to jobs/notify.ts once draining
 * meant "turn this into a notification" rather than "mark it done".
 */

/**
 * Purges accounts whose 30-day grace period has expired.
 *
 * Authored posts are anonymised rather than deleted: erasure is about the
 * person, and cascade-deleting their posts would tear holes in conversations
 * other members rely on. The auth row goes, which is what actually ends the
 * ability to sign in.
 */
export async function purgeDeletedAccounts(db: Db) {
  const due = await db.execute<{ user_id: string }>(sql`
    select distinct (payload ->> 'userId')::uuid as user_id
    from activity_events
    where kind = 'account.deletion_scheduled'
      and (payload ->> 'purgeAt')::timestamptz <= now()
      and not exists (
        select 1 from activity_events later
        where later.user_id = activity_events.user_id
          and later.kind = 'account.deletion_cancelled'
          and later.occurred_at > activity_events.occurred_at
      )
  `);

  let purged = 0;
  for (const row of due) {
    if (!row.user_id) continue;

    await db.execute(sql`
      update posts
      set body_md = '[removed at the author''s request]'
      where author_id = ${row.user_id}
    `);

    await db.execute(sql`
      update users set
        full_name  = 'Former member',
        handle     = 'former-' || substr(id::text, 1, 8),
        email      = null,
        phone      = null,
        avatar_url = null,
        city       = null,
        is_suspended = true
      where id = ${row.user_id}
    `);

    // Removing the auth row is what ends sign-in; the profile FK cascades.
    await db.execute(sql`delete from auth.users where id = ${row.user_id}`);
    purged += 1;
  }

  return { purged };
}

/**
 * Weekly digest. Composes per-member summaries from the rollups.
 *
 * Sending is not wired: an email provider with SPF/DKIM/DMARC is a prerequisite
 * (PLAN §5.1), and sending from an unverified domain would land the club in
 * spam on the first send. This computes the payload and enqueues it.
 */
export async function buildWeeklyDigest(db: Db) {
  const rows = await db.execute<{ user_id: string; minutes: number; xp: number }>(sql`
    select
      user_id,
      sum(courses_minutes + workshops_minutes + library_minutes)::int as minutes,
      sum(xp)::int as xp
    from daily_activity
    where day >= (now() at time zone 'Asia/Kolkata')::date - 7
    group by user_id
    having sum(courses_minutes + workshops_minutes + library_minutes) > 0
  `);

  for (const row of rows) {
    await db.execute(sql`
      insert into outbox (topic, payload)
      values ('digest.weekly', ${JSON.stringify({ userId: row.user_id, minutes: row.minutes, xp: row.xp })}::jsonb)
    `);
  }

  return { queued: rows.length };
}

/**
 * Credits workshop attendance after the fact.
 *
 * There is no attendance tracking on the call itself, so "registered when it
 * ended" is the honest proxy — and it beats the alternative, which is the
 * `workshops_attended` rollup reading a kind nothing ever emits. The NOT
 * EXISTS guard makes it idempotent: run hourly, credit once. An "I was there"
 * button can replace the proxy later without changing the event shape.
 */
export async function creditWorkshopAttendance(db: Db) {
  const result = await db.execute<{ count: number }>(sql`
    with credited as (
      insert into activity_events (user_id, kind, payload, xp, minutes)
      select
        r.user_id,
        'workshop.attended',
        jsonb_build_object('workshopId', r.workshop_id),
        60, 60
      from workshop_registrations r
      join workshops w on w.id = r.workshop_id
      where w.ends_at < now() - interval '1 hour'
        and not exists (
          select 1 from activity_events a
          where a.user_id = r.user_id
            and a.kind = 'workshop.attended'
            and a.payload ->> 'workshopId' = r.workshop_id::text
        )
      returning 1
    )
    select count(*)::int as count from credited
  `);
  return { credited: result[0]?.count ?? 0 };
}

/**
 * Deletes rows whose only job was to remember something for a short while.
 *
 * Idempotency records past their 24-hour replay window and rate-limit windows
 * that have already rolled over. Neither table is read after that point, and
 * neither has a natural upper bound, so something has to collect them.
 */
export async function sweepExpired(db: Db) {
  const [idem] = await db.execute<{ n: number }>(sql`
    with deleted as (
      delete from idempotency_keys where created_at < now() - interval '24 hours' returning 1
    ) select count(*)::int as n from deleted
  `);
  const [limits] = await db.execute<{ n: number }>(sql`
    with deleted as (
      delete from rate_limits where reset_at < now() - interval '1 hour' returning 1
    ) select count(*)::int as n from deleted
  `);
  return { idempotencyKeys: Number(idem?.n ?? 0), rateLimits: Number(limits?.n ?? 0) };
}
