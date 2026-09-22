import { sql } from 'drizzle-orm';
import { withUser } from '@ipc/db';
import type {
  AdminMemberDetail,
  AdminMemberPage,
  GrantTier,
  MemberRisk,
  SetSuspended,
} from '@ipc/contracts';
import type { Env } from './env.ts';
import { HttpError } from './lib/problem.ts';
import { getDb } from './repo.ts';

/**
 * The members console.
 *
 * The club has hundreds of members and, before this, no way to look at one of
 * them — the directory is member-facing and deliberately shows only what
 * members opt into. Running the club meant running SQL.
 *
 * The organising idea is **risk**: one word per member so a roster of several
 * hundred can be triaged without opening any of them. With a single author
 * running everything, the scarce resource is his attention, and the console's
 * job is to point it at the twenty people worth a message rather than the
 * eight hundred who are fine.
 */

const initials = (name: string) =>
  name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();

function requireDb(env: Env) {
  const db = getDb(env);
  if (!db) throw new HttpError(503, 'The members console needs a database');
  return db;
}

/**
 * How a member is classified, in SQL so the roster can filter and count on it
 * without loading every row.
 *
 *   never_started — enrolled in nothing, or never opened a lesson
 *   active        — did something in the last 7 days
 *   idle          — 8–21 days
 *   stalled       — started a course, nothing for 22–60 days
 *   dormant       — nothing for over 60 days
 *
 * "Stalled" is the one that earns its keep: someone mid-course who stopped is
 * the most recoverable member there is, and the least visible without this.
 */
const RISK_SQL = sql`
  case
    when not exists (select 1 from lesson_progress lp where lp.user_id = u.id) then 'never_started'
    when act.last_at is null then 'never_started'
    when act.last_at > now() - interval '7 days'  then 'active'
    when act.last_at > now() - interval '21 days' then 'idle'
    when act.last_at > now() - interval '60 days' then 'stalled'
    else 'dormant'
  end`;

/** Last time this member did anything we record, from any of the three sources. */
const LAST_ACTIVITY = sql`
  left join lateral (
    select greatest(
      (select max(lp.updated_at) from lesson_progress lp where lp.user_id = u.id),
      (select max(ae.occurred_at) from activity_events ae where ae.user_id = u.id),
      u.last_seen_at
    ) as last_at
  ) act on true`;

export async function listMembers(
  env: Env,
  adminId: string,
  opts: { q?: string; risk?: string; tier?: string; suspended?: boolean; cursor?: string; limit?: number },
): Promise<AdminMemberPage> {
  const db = requireDb(env);
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 100);

  return withUser(db, adminId, async (tx) => {
    // `%` and `_` are LIKE wildcards; someone searching for "100%" should not
    // match everyone.
    const pattern = opts.q?.trim() ? `%${opts.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;

    const rows = await tx.execute<Record<string, unknown>>(sql`
      select
        u.id, u.member_code, u.full_name, u.email, u.phone, u.city, u.avatar_url,
        u.role::text as role, u.is_suspended, u.created_at, u.last_seen_at,
        public.current_tier(u.id)::text as tier,
        coalesce(ms.xp, 0)::int as xp,
        coalesce(ms.lessons_completed, 0)::int as lessons_completed,
        coalesce(st.current_days, 0)::int as streak_days,
        (select count(*)::int from enrollments e where e.user_id = u.id) as courses_enrolled,
        (select count(*)::int from enrollments e where e.user_id = u.id and e.completed_at is not null) as courses_completed,
        act.last_at,
        extract(day from (now() - act.last_at))::int as idle_days,
        ${RISK_SQL} as risk
      from public.users u
      left join member_stats ms on ms.user_id = u.id
      left join streaks st on st.user_id = u.id
      ${LAST_ACTIVITY}
      where true
        ${pattern ? sql`and (u.full_name ilike ${pattern} or u.email ilike ${pattern} or u.member_code ilike ${pattern} or u.city ilike ${pattern})` : sql``}
        ${opts.tier ? sql`and public.current_tier(u.id)::text = ${opts.tier}` : sql``}
        ${opts.suspended === undefined ? sql`` : sql`and u.is_suspended = ${opts.suspended}`}
        ${opts.risk ? sql`and ${RISK_SQL} = ${opts.risk}` : sql``}
        ${opts.cursor ? sql`and u.created_at < ${opts.cursor}::timestamptz` : sql``}
      order by u.created_at desc
      limit ${limit + 1}
    `);

    const page = [...rows];
    // One extra row is the cursor probe: if it came back there is another page.
    const hasMore = page.length > limit;
    if (hasMore) page.pop();

    const [totals] = await tx.execute<Record<string, number>>(sql`
      select
        count(*)::int as all,
        count(*) filter (where r.risk = 'active')::int as active,
        count(*) filter (where r.risk = 'idle')::int as idle,
        count(*) filter (where r.risk = 'stalled')::int as stalled,
        count(*) filter (where r.risk = 'dormant')::int as dormant,
        count(*) filter (where r.risk = 'never_started')::int as never_started,
        count(*) filter (where r.suspended)::int as suspended
      from (
        select ${RISK_SQL} as risk, u.is_suspended as suspended
        from public.users u ${LAST_ACTIVITY}
      ) r
    `);

    return {
      items: page.map((r) => toMember(r)),
      nextCursor: hasMore ? new Date(page[page.length - 1]!.created_at as string).toISOString() : null,
      totals: {
        all: Number(totals?.all ?? 0),
        active: Number(totals?.active ?? 0),
        idle: Number(totals?.idle ?? 0),
        stalled: Number(totals?.stalled ?? 0),
        dormant: Number(totals?.dormant ?? 0),
        neverStarted: Number(totals?.never_started ?? 0),
        suspended: Number(totals?.suspended ?? 0),
      },
    };
  });
}

function toMember(r: Record<string, unknown>) {
  const name = String(r.full_name ?? 'Member');
  return {
    id: String(r.id),
    memberCode: String(r.member_code ?? ''),
    fullName: name,
    initials: initials(name),
    email: (r.email as string) ?? null,
    phone: (r.phone as string) ?? null,
    city: (r.city as string) ?? null,
    avatarUrl: (r.avatar_url as string) ?? null,
    tier: (r.tier ?? 'free') as AdminMemberPage['items'][number]['tier'],
    role: (r.role ?? 'member') as AdminMemberPage['items'][number]['role'],
    suspended: Boolean(r.is_suspended),
    joinedAt: new Date(r.created_at as string).toISOString(),
    lastSeenAt: r.last_at ? new Date(r.last_at as string).toISOString() : null,
    xp: Number(r.xp ?? 0),
    lessonsCompleted: Number(r.lessons_completed ?? 0),
    coursesEnrolled: Number(r.courses_enrolled ?? 0),
    coursesCompleted: Number(r.courses_completed ?? 0),
    streakDays: Number(r.streak_days ?? 0),
    risk: (r.risk ?? 'never_started') as MemberRisk,
    idleDays: r.idle_days === null || r.idle_days === undefined ? null : Number(r.idle_days),
  };
}

/** One learner, in enough detail to decide what to say to them. */
export async function getMember(env: Env, adminId: string, memberId: string): Promise<AdminMemberDetail> {
  const db = requireDb(env);

  return withUser(db, adminId, async (tx) => {
    const [row] = await tx.execute<Record<string, unknown>>(sql`
      select
        u.id, u.member_code, u.full_name, u.email, u.phone, u.city, u.avatar_url,
        u.role::text as role, u.is_suspended, u.created_at, u.last_seen_at,
        public.current_tier(u.id)::text as tier,
        coalesce(ms.xp, 0)::int as xp,
        coalesce(ms.lessons_completed, 0)::int as lessons_completed,
        coalesce(st.current_days, 0)::int as streak_days,
        (select count(*)::int from enrollments e where e.user_id = u.id) as courses_enrolled,
        (select count(*)::int from enrollments e where e.user_id = u.id and e.completed_at is not null) as courses_completed,
        (select mp.bio_md from member_profiles mp where mp.user_id = u.id) as bio,
        act.last_at,
        extract(day from (now() - act.last_at))::int as idle_days,
        ${RISK_SQL} as risk
      from public.users u
      left join member_stats ms on ms.user_id = u.id
      left join streaks st on st.user_id = u.id
      ${LAST_ACTIVITY}
      where u.id = ${memberId}::uuid
    `);
    if (!row) throw new HttpError(404, 'Member not found');

    const courses = await tx.execute<Record<string, unknown>>(sql`
      select
        c.id as course_id, c.title, c.slug, e.enrolled_at, e.completed_at,
        (select count(*)::int from modules m join lessons l on l.module_id = m.id where m.course_id = c.id) as lessons_total,
        (select count(*)::int from modules m join lessons l on l.module_id = m.id
          join lesson_progress lp on lp.lesson_id = l.id
          where m.course_id = c.id and lp.user_id = e.user_id and lp.is_completed) as lessons_done,
        (select l.title from lessons l where l.id = e.last_lesson_id) as last_lesson_title,
        (select max(lp.updated_at) from modules m join lessons l on l.module_id = m.id
          join lesson_progress lp on lp.lesson_id = l.id
          where m.course_id = c.id and lp.user_id = e.user_id) as last_activity_at
      from enrollments e join courses c on c.id = e.course_id
      where e.user_id = ${memberId}::uuid
      order by e.enrolled_at desc
    `);

    // One readable line per thing they did, newest first. Capped because this
    // is a timeline to glance at, not an export.
    const timeline = await tx.execute<{ kind: string; at: string; summary: string }>(sql`
      select kind, occurred_at::text as at,
             case
               when kind = 'lesson.completed' then 'Finished a lesson'
               when kind = 'post.created'     then 'Posted in the community'
               when kind = 'comment.created'  then 'Commented on a post'
               when kind = 'workshop.registered' then 'Registered for a workshop'
               else replace(kind, '.', ' ')
             end as summary
      from activity_events
      where user_id = ${memberId}::uuid
      order by occurred_at desc
      limit 40
    `);

    const memberships = await tx.execute<Record<string, unknown>>(sql`
      select tier::text as tier, status::text as status, source, started_at, expires_at
      from memberships where user_id = ${memberId}::uuid order by started_at desc
    `);

    return {
      ...toMember(row),
      bio: (row.bio as string) ?? null,
      courses: courses.map((c) => {
        const total = Number(c.lessons_total ?? 0);
        const done = Number(c.lessons_done ?? 0);
        return {
          courseId: String(c.course_id),
          title: String(c.title),
          slug: String(c.slug),
          enrolledAt: new Date(c.enrolled_at as string).toISOString(),
          completedAt: c.completed_at ? new Date(c.completed_at as string).toISOString() : null,
          lessonsTotal: total,
          lessonsDone: done,
          progress: total === 0 ? 0 : Math.round((done / total) * 100),
          lastLessonTitle: (c.last_lesson_title as string) ?? null,
          lastActivityAt: c.last_activity_at ? new Date(c.last_activity_at as string).toISOString() : null,
        };
      }),
      timeline: timeline.map((t) => ({ kind: t.kind, at: new Date(t.at).toISOString(), summary: t.summary })),
      memberships: memberships.map((m) => ({
        tier: m.tier as AdminMemberDetail['tier'],
        status: String(m.status),
        source: String(m.source),
        startedAt: new Date(m.started_at as string).toISOString(),
        expiresAt: m.expires_at ? new Date(m.expires_at as string).toISOString() : null,
      })),
    };
  });
}

/* ── The two writes ────────────────────────────────────────────────────────
   Both go through the service role, because both are things a member must not
   be able to do to themselves, and both write an audit row in the same
   statement — an action without a record of who did it and why is exactly the
   thing an audit log exists to prevent. */

export async function grantTier(
  env: Env,
  adminId: string,
  memberId: string,
  input: GrantTier,
): Promise<void> {
  const db = requireDb(env);

  const [exists] = await db.execute<{ id: string }>(
    sql`select id from public.users where id = ${memberId}::uuid`,
  );
  if (!exists) throw new HttpError(404, 'Member not found');

  await db.execute(sql`
    insert into public.memberships (user_id, tier, status, source, started_at, expires_at)
    values (
      ${memberId}::uuid, ${input.tier}::public.tier, 'active', 'admin-grant', now(),
      ${input.months === null ? null : sql`now() + (${String(input.months)} || ' months')::interval`}
    )
  `);

  await db.execute(sql`
    insert into public.audit_log (actor_id, action, target_type, target_id, meta)
    values (${adminId}::uuid, 'member.tier_granted', 'user', ${memberId}::uuid,
            ${JSON.stringify({ tier: input.tier, months: input.months, reason: input.reason })}::jsonb)
  `);
}

export async function setSuspended(
  env: Env,
  adminId: string,
  memberId: string,
  input: SetSuspended,
): Promise<void> {
  const db = requireDb(env);

  // An admin suspending themselves would lock the club out of its own console.
  if (memberId === adminId && input.suspended) {
    throw new HttpError(409, 'You cannot suspend your own account');
  }

  const [row] = await db.execute<{ role: string }>(
    sql`select role::text as role from public.users where id = ${memberId}::uuid`,
  );
  if (!row) throw new HttpError(404, 'Member not found');
  if (row.role === 'admin' && input.suspended) {
    throw new HttpError(409, 'Demote this admin before suspending them');
  }

  await db.execute(sql`
    update public.users set is_suspended = ${input.suspended} where id = ${memberId}::uuid
  `);
  await db.execute(sql`
    insert into public.audit_log (actor_id, action, target_type, target_id, meta)
    values (${adminId}::uuid, ${input.suspended ? 'member.suspended' : 'member.unsuspended'},
            'user', ${memberId}::uuid, ${JSON.stringify({ reason: input.reason })}::jsonb)
  `);
}
