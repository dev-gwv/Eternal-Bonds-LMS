import { sql } from 'drizzle-orm';
import type { Db } from '@ipc/db';

/**
 * The weekly Think Tank ritual, run by the scheduler instead of by a person.
 *
 * The loop is: members post insights → the club votes → voting closes → the
 * winner is featured → a live session is held on it → the recording becomes a
 * lesson. Every table for that already existed — `vote_cycles` with a status,
 * `insights.featured_at`, `events.is_featured_session`, a promote-recording
 * endpoint — and nothing ever opened a cycle, closed one, or picked a winner.
 * The ritual was a schema with no clock.
 *
 * That matters more here than anywhere else in the app, because a ritual is
 * defined by happening *on time*. A weekly event that happens when somebody
 * remembers is not weekly, and a vote with no closing date is a suggestion
 * box. With one author, "remembers every Monday for a year" is not a plan.
 *
 * What stays human: the session itself. The job creates the event as a draft
 * with no join link, because a Google Meet URL is not something a cron job
 * should invent, and an event announced with a dead link is worse than one
 * announced late.
 */

/** Cycles run Monday to Sunday. One week is short enough to stay a habit. */
const CYCLE_DAYS = 7;
/** How long after voting closes the session is pencilled in. */
const SESSION_LEAD_DAYS = 3;

/**
 * Opens next week's cycle if the current one has run out.
 *
 * Idempotent by construction: it inserts only when no cycle covers today, so
 * running it hourly forever produces exactly one cycle per week.
 */
export async function openVoteCycle(db: Db) {
  const rows = await db.execute<{ id: string }>(sql`
    insert into vote_cycles (starts_on, ends_on, status)
    select
      current_date,
      current_date + ${CYCLE_DAYS - 1}::int,
      'open'
    where not exists (
      select 1 from vote_cycles
      where status = 'open' and ends_on >= current_date
    )
    returning id
  `);

  // New insights posted before a cycle existed have a null cycle. Adopting
  // them into the one now open is better than leaving them unvotable forever,
  // which is what an unassigned insight is.
  if (rows.length > 0) {
    await db.execute(sql`
      update insights set vote_cycle_id = ${rows[0]!.id}::uuid
      where vote_cycle_id is null and status = 'published'
    `);
  }

  return { opened: rows.length };
}

/**
 * Closes any cycle past its end date, features the winner, and pencils in the
 * session.
 *
 * Ties are broken by whichever insight was posted first. Arbitrary, but it is
 * *stable* — the same cycle closed twice picks the same winner — and a rule
 * nobody can game beats a rule that feels fairer and moves.
 */
export async function closeVoteCycle(db: Db) {
  const due = await db.execute<{ id: string; ends_on: string }>(sql`
    select id, ends_on from vote_cycles
    where status = 'open' and ends_on < current_date
    order by ends_on asc
  `);

  let closed = 0;
  let featured = 0;
  let announced = 0;

  for (const cycle of due) {
    const [winner] = await db.execute<{ id: string; slug: string; title: string; author_id: string; votes: number }>(
      sql`
        select i.id, i.slug, i.title, i.author_id, i.votes_count as votes
        from insights i
        where i.vote_cycle_id = ${cycle.id}::uuid
          and i.status = 'published'
          and i.votes_count > 0
        order by i.votes_count desc, i.created_at asc
        limit 1
      `,
    );

    // A week with no votes closes quietly. Featuring a zero-vote insight would
    // teach members that voting does not matter, which is the one lesson this
    // whole mechanism exists to avoid.
    await db.execute(sql`update vote_cycles set status = 'closed' where id = ${cycle.id}::uuid`);
    closed += 1;
    if (!winner) continue;

    await db.execute(sql`
      update insights set featured_at = now() where id = ${winner.id}::uuid and featured_at is null
    `);
    featured += 1;

    // The session, as a draft. No join_url: a cron job must not invent a
    // meeting link, and an event announced with a dead one is worse than an
    // event announced late.
    const slug = `think-tank-${String(cycle.ends_on).slice(0, 10)}`;
    await db.execute(sql`
      insert into events (slug, title, description_md, starts_at, ends_at, is_featured_session, min_tier)
      values (
        ${slug},
        ${`Think Tank: ${winner.title}`},
        ${`This week's most-voted insight, worked through live. Posted by a member and voted up by ${winner.votes} of you.`},
        (current_date + ${SESSION_LEAD_DAYS}::int)::timestamptz + interval '19 hours',
        (current_date + ${SESSION_LEAD_DAYS}::int)::timestamptz + interval '20 hours',
        true,
        'free'
      )
      on conflict (slug) do nothing
    `);

    // The author first, by name. Being told your idea won is the single
    // strongest reason anybody posts a second one.
    await db.execute(sql`
      insert into notifications (user_id, kind, title, body, link, subject_type, subject_id)
      values (
        ${winner.author_id}::uuid,
        'thinktank.featured',
        'Your insight won this week',
        ${`"${winner.title}" got the most votes. It is this week's featured session.`},
        ${`/think-tank/${winner.slug}`},
        'insight',
        ${winner.id}::uuid
      )
      on conflict do nothing
    `);

    // Then everybody else. Set-based rather than a loop: this is the one
    // fan-out in the ritual that is the size of the whole club.
    const told = await db.execute<{ id: string }>(sql`
      insert into notifications (user_id, kind, title, body, link, subject_type, subject_id)
      select
        u.id,
        'thinktank.featured',
        ${`This week's Think Tank: ${winner.title}`},
        'Voting closed. This is what the club chose to work through.',
        ${`/think-tank/${winner.slug}`},
        'insight',
        ${winner.id}::uuid
      from users u
      where u.id <> ${winner.author_id}::uuid
        and not u.is_suspended
        and coalesce((select p.in_app from notification_prefs p where p.user_id = u.id), true)
      on conflict do nothing
      returning id
    `);
    announced += told.length;
  }

  return { closed, featured, announced };
}
