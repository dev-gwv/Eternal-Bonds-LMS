import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '@ipc/db';

/**
 * Bringing stalled learners back, without anybody having to remember to.
 *
 * The members console can already point Abdullah at the twenty people worth a
 * message. This job is the half that scales: with one author and hundreds of
 * members, the messages that get sent are the ones nobody has to write.
 *
 * The hard part is not finding stalled learners — that is one query. The hard
 * part is not becoming spam, because a reminder that arrives too often gets
 * the whole app muted, and a muted app cannot send the one message that would
 * have worked. Three limits do that work, and all three live in the schema
 * rather than in this file, so a bug here cannot double-send:
 *
 *   - one row per (member, course, stage), unique-indexed
 *   - four stages and then silence, forever, for that course
 *   - a five-day floor per member across every course they have abandoned
 *
 * Each stage is a single insert..select, so a run is atomic and cheap: no
 * loop, no read-then-write race between two workers.
 */

type Stage = {
  stage: number;
  /** How long quiet before this one fires. */
  quietDays: number;
  /** Stage 0 is "enrolled and never pressed play" — a different problem. */
  neverStarted: boolean;
  /** Composed in SQL so the course and lesson names come straight from the row. */
  title: SQL;
  body: SQL;
};

const COURSE = sql`cand.course_title`;
const LESSON = sql`coalesce(cand.last_lesson_title, 'where you left off')`;

const STAGES: Stage[] = [
  {
    stage: 0,
    quietDays: 7,
    neverStarted: true,
    title: sql`'You have not started ' || ${COURSE} || ' yet'`,
    body: sql`'The first lesson is the hardest one to press play on. It is about eight minutes.'`,
  },
  {
    stage: 1,
    quietDays: 7,
    neverStarted: false,
    title: sql`'Pick ' || ${COURSE} || ' back up?'`,
    body: sql`'You stopped on ' || ${LESSON} || '. It is still there.'`,
  },
  {
    stage: 2,
    quietDays: 21,
    neverStarted: false,
    title: sql`${COURSE} || ' is still waiting'`,
    body: sql`'Three weeks since ' || ${LESSON} || '. Twenty minutes would get you moving again.'`,
  },
  {
    stage: 3,
    quietDays: 45,
    neverStarted: false,
    title: sql`'Last nudge about ' || ${COURSE}`,
    body: sql`'We will stop mentioning it after this. The course is not going anywhere.'`,
  },
];

/** Nobody gets nudged about anything twice inside this window. */
const FLOOR_DAYS = 5;

export async function sendLearningNudges(db: Db) {
  let sent = 0;

  for (const s of STAGES) {
    const rows = await db.execute<{ id: string }>(sql`
      with candidate as (
        -- At most one course per member per run. Whoever has been quiet
        -- longest gets the slot; the rest wait for the next pass.
        select distinct on (e.user_id)
          e.user_id,
          e.course_id,
          c.title as course_title,
          c.slug  as course_slug,
          l.title as last_lesson_title,
          coalesce(act.last_at, e.enrolled_at) as quiet_since
        from enrollments e
        join courses c on c.id = e.course_id and c.is_published
        join users u on u.id = e.user_id
        left join lessons l on l.id = e.last_lesson_id
        left join lateral (
          select max(lp.updated_at) as last_at
          from lesson_progress lp
          join lessons ll on ll.id = lp.lesson_id
          join modules mm on mm.id = ll.module_id
          where lp.user_id = e.user_id and mm.course_id = e.course_id
        ) act on true
        where e.completed_at is null
          and not u.is_suspended
          and ${s.neverStarted ? sql`act.last_at is null` : sql`act.last_at is not null`}
          and coalesce(act.last_at, e.enrolled_at) < now() - ${`${s.quietDays} days`}::interval
          and not exists (
            select 1 from learning_nudges n
            where n.user_id = e.user_id and n.course_id = e.course_id and n.stage = ${s.stage}
          )
          and not exists (
            select 1 from learning_nudges n
            where n.user_id = e.user_id and n.sent_at > now() - ${`${FLOOR_DAYS} days`}::interval
          )
          -- The in-app switch is honoured here rather than at delivery: an
          -- unwanted nudge should not exist, not merely go unsent.
          and coalesce((select p.in_app from notification_prefs p where p.user_id = e.user_id), true)
        order by e.user_id, coalesce(act.last_at, e.enrolled_at) asc
      ),
      logged as (
        -- The ledger row is written first. If the notification insert then
        -- fails, the member misses one message; the alternative order would
        -- send it again on every run forever.
        insert into learning_nudges (user_id, course_id, stage)
        select user_id, course_id, ${s.stage} from candidate
        on conflict (user_id, course_id, stage) do nothing
        returning user_id, course_id
      )
      insert into notifications (user_id, kind, title, body, link, subject_type, subject_id)
      select
        cand.user_id,
        'learning.nudge',
        ${s.title},
        ${s.body},
        -- /courses/:slug, not /learn/:slug — the former resolves to the first
        -- unfinished lesson, and the latter is not a route at all. A nudge
        -- that lands on a 404 is worse than no nudge.
        '/courses/' || cand.course_slug,
        'course',
        cand.course_id
      from candidate cand
      join logged on logged.user_id = cand.user_id and logged.course_id = cand.course_id
      -- The dedupe index is on (user, kind, subject) and has no stage in it, so
      -- stage 2 for a course already nudged at stage 1 collides. Bump the
      -- earlier one out of the way by letting the newest text win.
      on conflict (user_id, kind, subject_type, subject_id) where subject_id is not null
      do update set
        title = excluded.title,
        body = excluded.body,
        created_at = now(),
        read_at = null,
        email_sent_at = null,
        push_sent_at = null
      returning id
    `);
    sent += rows.length;
  }

  return { sent };
}

/**
 * Telling a cohort that the next module has opened.
 *
 * This is most of what makes a cohort work. A drip that nobody announces is
 * just a lock: the member who was going to come back on Tuesday does not know
 * Tuesday has arrived, and the schedule that was supposed to create rhythm
 * instead creates a wall. One message per module per member, ever.
 *
 * It fires for evergreen learners too, because the drip mechanism does not
 * care whether the clock came from a cohort start or an enrolment date — and
 * a solo member hitting day 7 deserves the same nudge as a group does.
 */
export async function announceUnlocks(db: Db) {
  const rows = await db.execute<{ id: string }>(sql`
    with opened as (
      select
        e.user_id,
        m.id as module_id,
        m.title as module_title,
        c.id as course_id,
        c.title as course_title,
        c.slug as course_slug,
        public.module_unlock_at(m.id, e.user_id) as unlocked_at
      from enrollments e
      join courses c on c.id = e.course_id and c.is_published
      join modules m on m.course_id = c.id
      join users u on u.id = e.user_id
      where e.completed_at is null
        and not u.is_suspended
        and m.drip_days is not null
        and coalesce((select p.in_app from notification_prefs p where p.user_id = e.user_id), true)
    ),
    due as (
      select * from opened
      where unlocked_at is not null
        and unlocked_at <= now()
        -- A window, not "any time in the past". Without it, switching a live
        -- course to a drip would announce every already-open module at once.
        and unlocked_at > now() - interval '2 days'
        and not exists (
          select 1 from module_unlock_notices n
          where n.user_id = opened.user_id and n.module_id = opened.module_id
        )
    ),
    logged as (
      insert into module_unlock_notices (user_id, module_id)
      select user_id, module_id from due
      on conflict (user_id, module_id) do nothing
      returning user_id, module_id
    )
    insert into notifications (user_id, kind, title, body, link, subject_type, subject_id)
    select
      due.user_id,
      'learning.unlocked',
      due.module_title || ' is open',
      'The next part of ' || due.course_title || ' is ready for you.',
      '/courses/' || due.course_slug,
      'module',
      due.module_id
    from due
    join logged on logged.user_id = due.user_id and logged.module_id = due.module_id
    on conflict do nothing
    returning id
  `);

  return { announced: rows.length };
}

/**
 * Warning a cohort that its end date is coming and their work is not done.
 *
 * Sent once, a week out, and only to people actually behind — a deadline
 * warning to somebody who has finished is noise that teaches them to ignore
 * the next one. "Behind" here means the schedule has opened materially more
 * than they have completed, the same test the roster uses.
 */
export async function warnCohortDeadlines(db: Db) {
  const rows = await db.execute<{ id: string }>(sql`
    with standing as (
      select
        cm.user_id,
        co.id as cohort_id,
        co.ends_on,
        c.title as course_title,
        c.slug  as course_slug,
        t.done,
        (
          select count(*)::int
          from lessons l
          join modules m on m.id = l.module_id
          where m.course_id = co.course_id
            and coalesce(public.module_unlock_at(m.id, cm.user_id), now()) <= now()
        ) as expected
      from cohort_members cm
      join cohorts co on co.id = cm.cohort_id
      join courses c on c.id = co.course_id
      join users u on u.id = cm.user_id
      cross join lateral (
        select count(*) filter (where lp.is_completed)::int as done
        from lessons l
        join modules m on m.id = l.module_id
        left join lesson_progress lp on lp.lesson_id = l.id and lp.user_id = cm.user_id
        where m.course_id = co.course_id
      ) t
      where co.ends_on is not null
        and co.ends_on between current_date and current_date + 7
        and not u.is_suspended
        and not exists (
          select 1 from enrollments e
          where e.user_id = cm.user_id and e.course_id = co.course_id and e.completed_at is not null
        )
        and coalesce((select p.in_app from notification_prefs p where p.user_id = cm.user_id), true)
    ),
    due as (
      select * from standing
      where expected - done > greatest(2, round(expected * 0.15))
        and not exists (
          select 1 from cohort_deadline_notices n
          where n.user_id = standing.user_id and n.cohort_id = standing.cohort_id
        )
    ),
    logged as (
      insert into cohort_deadline_notices (user_id, cohort_id)
      select user_id, cohort_id from due
      on conflict (user_id, cohort_id) do nothing
      returning user_id, cohort_id
    )
    insert into notifications (user_id, kind, title, body, link, subject_type, subject_id)
    select
      due.user_id,
      'cohort.deadline',
      due.course_title || ' wraps up on ' || to_char(due.ends_on, 'DD Mon'),
      (due.expected - due.done) || ' lessons left of what is open. There is still time.',
      '/courses/' || due.course_slug,
      'cohort',
      due.cohort_id
    from due
    join logged on logged.user_id = due.user_id and logged.cohort_id = due.cohort_id
    on conflict do nothing
    returning id
  `);

  return { warned: rows.length };
}

/**
 * Two messages to a member who joined and then stopped.
 *
 * Day two and day seven, and then never again. Somebody who has not posted an
 * introduction after a fortnight has decided; a third reminder does not change
 * that, it only spends the goodwill needed for the messages that would have
 * worked.
 *
 * The condition is the same set of derived facts the checklist uses — no
 * profile, no introduction, no lesson — so what the member is told and what
 * the card shows them cannot disagree.
 */
export async function nudgeOnboarding(db: Db) {
  const STAGES = [
    { stage: 1, afterDays: 2, title: 'One thing to get started', body: 'Introduce yourself in the community. Two lines about where you shoot is enough — members reply to introductions more than to anything else.' },
    { stage: 2, afterDays: 7, title: 'Still worth five minutes', body: 'Your first week checklist is on the dashboard. The first lesson is the only hard one.' },
  ];

  let sent = 0;

  for (const s of STAGES) {
    const rows = await db.execute<{ id: string }>(sql`
      with candidate as (
        select u.id as user_id
        from users u
        where u.onboarding_completed_at is null
          and not u.is_suspended
          and u.created_at < now() - ${`${s.afterDays} days`}::interval
          -- Somebody who joined last year is not in their first week. Without
          -- this, switching the job on would mail the entire back catalogue.
          and u.created_at > now() - interval '30 days'
          -- The same derived facts the checklist uses, so the message and the
          -- card cannot disagree about what is left to do.
          and not exists (
            select 1 from posts p
            join channels c on c.id = p.channel_id
            where p.author_id = u.id and c.slug = 'introductions'
          )
          and not exists (select 1 from lesson_progress lp where lp.user_id = u.id)
          and not exists (
            select 1 from onboarding_notices n where n.user_id = u.id and n.stage = ${s.stage}
          )
          and coalesce((select p.in_app from notification_prefs p where p.user_id = u.id), true)
      ),
      logged as (
        insert into onboarding_notices (user_id, stage)
        select user_id, ${s.stage} from candidate
        on conflict (user_id, stage) do nothing
        returning user_id
      )
      insert into notifications (user_id, kind, title, body, link, subject_type, subject_id)
      select cand.user_id, 'onboarding.nudge', ${s.title}, ${s.body}, '/', 'onboarding', cand.user_id
      from candidate cand
      join logged on logged.user_id = cand.user_id
      on conflict (user_id, kind, subject_type, subject_id) where subject_id is not null
      do update set title = excluded.title, body = excluded.body, created_at = now(), read_at = null
      returning id
    `);
    sent += rows.length;
  }

  return { sent };
}

/**
 * Noticing that somebody finished a path, and saying so.
 *
 * Journey progress is derived — counted from `lesson_progress` across the
 * courses on the path — which means it crosses 100% silently, in the middle of
 * whichever lesson happened to be last. There is no moment. A member finishes
 * six courses aimed at one named outcome and the application's entire response
 * is a progress ring that stops moving.
 *
 * This is that moment. It runs on a schedule rather than at the point of
 * completion because the completing event is a lesson tick that knows nothing
 * about journeys, and threading journey awareness through the lesson write
 * path would make the hot query pay for a feature it does not use.
 *
 * Every step counts, including ones above the member's tier. Completing the
 * path means completing the path; a free member on a path with a Diamond
 * course simply does not finish it, which is both honest and the clearest
 * upgrade argument the app has.
 *
 * `completed_at` is the dedupe. One stamp, one congratulation, and the update
 * and the insert are a single statement so a second worker cannot get between
 * them.
 */
export async function celebrateJourneys(db: Db) {
  const rows = await db.execute<{ id: string }>(sql`
    with progress as (
      select
        jm.user_id,
        jm.journey_id,
        j.slug,
        j.title,
        j.promise,
        count(*)::int as steps,
        coalesce(sum(cat.lesson_count), 0)::int as lessons_total,
        coalesce(sum(cat.done), 0)::int as lessons_done
      from journey_members jm
      join journeys j on j.id = jm.journey_id
      join users u on u.id = jm.user_id
      join lateral (
        select
          (select count(*)::int
             from lessons l join modules m on m.id = l.module_id
            where m.course_id = js.course_id) as lesson_count,
          (select count(*)::int
             from lessons l
             join modules m on m.id = l.module_id
             join lesson_progress lp on lp.lesson_id = l.id and lp.user_id = jm.user_id
            where m.course_id = js.course_id and lp.is_completed) as done
        from journey_steps js
        where js.journey_id = jm.journey_id
      ) cat on true
      where jm.completed_at is null
        and not u.is_suspended
      group by jm.user_id, jm.journey_id, j.slug, j.title, j.promise
    ),
    -- An empty path is not a finished path. Without this an admin creating a
    -- journey with no steps yet would congratulate everybody following it.
    done as (
      select * from progress
      where steps > 0 and lessons_total > 0 and lessons_done >= lessons_total
    ),
    stamped as (
      update journey_members jm
      set completed_at = now()
      from done
      where jm.user_id = done.user_id
        and jm.journey_id = done.journey_id
        and jm.completed_at is null
      returning jm.user_id, jm.journey_id
    )
    insert into notifications (user_id, kind, title, body, link, subject_type, subject_id)
    select
      done.user_id,
      'journey.complete',
      'You finished ' || done.title,
      -- The promise back in their own hands. It is what they signed up for and
      -- the only sentence here worth reading twice.
      done.promise || ' — that is ' || done.steps || ' course' ||
        (case when done.steps = 1 then '' else 's' end) || ' done. Worth telling somebody about.',
      '/journeys/' || done.slug,
      'journey',
      done.journey_id
    from done
    join stamped on stamped.user_id = done.user_id and stamped.journey_id = done.journey_id
    on conflict do nothing
    returning id
  `);

  return { celebrated: rows.length };
}
