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
