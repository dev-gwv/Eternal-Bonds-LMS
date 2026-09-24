import { sql } from 'drizzle-orm';
import { withUser } from '@ipc/db';
import type { MyCohort, MySubmission, PublicMember } from '@ipc/contracts';
import type { Env } from './env.ts';
import { HttpError } from './lib/problem.ts';
import { createStorage } from './lib/storage.ts';
import { getDb } from './repo.ts';

/**
 * The three member-facing views that existed as data and not as pages.
 *
 * Each is the same shape of gap: something the application already knows, and
 * has been acting on, with no way for the member it concerns to see it.
 * Cohorts gated their drip and sent them unlock notices; wins went into review
 * and vanished; every search result for a person opened your own profile.
 */

const requireDb = (env: Env) => {
  const db = getDb(env);
  if (!db) throw new HttpError(503, 'Needs a database');
  return db;
};

const initialsOf = (name: string) =>
  name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();

/**
 * Another member's profile.
 *
 * Only members who opted into the directory are visible. That is the consent
 * they actually gave — "list me in the member directory" — and it would be a
 * bait-and-switch to honour it on one page and not another. Somebody who has
 * not opted in is indistinguishable from somebody who does not exist.
 */
export async function getPublicMember(
  env: Env,
  viewerId: string | null,
  memberId: string,
): Promise<PublicMember> {
  const db = requireDb(env);
  if (!viewerId) throw new HttpError(401, 'Not authenticated');

  return withUser(db, viewerId, async (tx) => {
    const [row] = await tx.execute<{
      id: string; full_name: string; city: string | null; avatar_key: string | null;
      created_at: string; tier: string; bio_md: string | null; expertise: string[] | null;
      listed: boolean | null;
    }>(sql`
      select
        u.id, u.full_name, u.city, u.avatar_url as avatar_key, u.created_at,
        public.current_tier(u.id)::text as tier,
        p.bio_md, p.expertise, p.show_in_directory as listed
      from users u
      left join member_profiles p on p.user_id = u.id
      where u.id = ${memberId}::uuid and not u.is_suspended
    `);

    // Not listed, suspended, or not real — all the same answer, so the page
    // cannot be used to confirm that an account exists.
    if (!row || (!row.listed && row.id !== viewerId)) throw new HttpError(404, 'Member not found');

    const wins = await tx.execute<{ slug: string; title: string; created_at: string }>(sql`
      select slug, title, created_at from wins
      where author_id = ${memberId}::uuid and status = 'published'
      order by created_at desc limit 10
    `);

    let avatarUrl: string | null = null;
    if (row.avatar_key) {
      try {
        avatarUrl = await createStorage(env).signedDownloadUrl(row.avatar_key, 6 * 3600);
      } catch {
        avatarUrl = null;
      }
    }

    return {
      id: row.id,
      fullName: row.full_name,
      initials: initialsOf(row.full_name),
      avatarUrl,
      tier: (row.tier ?? 'free') as PublicMember['tier'],
      city: row.city,
      bioMd: row.bio_md,
      expertise: row.expertise ?? [],
      joinedAt: new Date(row.created_at).toISOString(),
      wins: wins.map((w) => ({
        slug: w.slug,
        title: w.title,
        createdAt: new Date(w.created_at).toISOString(),
      })),
      isMe: row.id === viewerId,
    };
  });
}

/**
 * The cohorts this member is in, with the timetable the whole group shares.
 *
 * The schedule is the cohort's, not the member's: everybody in a January group
 * reaches week three on the same day, and showing each person a personalised
 * date would undo the one thing a cohort is for.
 */
export async function getMyCohorts(env: Env, userId: string | null): Promise<MyCohort[]> {
  const db = getDb(env);
  if (!db || !userId) return [];

  return withUser(db, userId, async (tx) => {
    const rows = await tx.execute<{
      id: string; name: string; course_id: string; course_slug: string; course_title: string;
      starts_on: string; ends_on: string | null; member_count: number;
      done: number; total: number;
    }>(sql`
      select
        co.id, co.name, co.course_id, c.slug as course_slug, c.title as course_title,
        co.starts_on, co.ends_on,
        (select count(*)::int from cohort_members m where m.cohort_id = co.id) as member_count,
        t.done, t.total
      from cohort_members cm
      join cohorts co on co.id = cm.cohort_id
      join courses c on c.id = co.course_id
      cross join lateral (
        select
          count(*) filter (where lp.is_completed)::int as done,
          count(*)::int as total
        from lessons l
        join modules m on m.id = l.module_id
        left join lesson_progress lp on lp.lesson_id = l.id and lp.user_id = ${userId}::uuid
        where m.course_id = co.course_id
      ) t
      where cm.user_id = ${userId}::uuid
      order by co.starts_on desc
    `);

    return Promise.all(
      rows.map(async (r): Promise<MyCohort> => {
        const schedule = await tx.execute<{
          title: string; opens_on: string | null; lesson_count: number;
        }>(sql`
          select
            m.title,
            case
              when m.drip_days is null and m.available_from is null then null
              else greatest(
                coalesce(m.available_from, '-infinity'::timestamptz),
                ${r.starts_on}::date::timestamptz + (coalesce(m.drip_days, 0) || ' days')::interval
              )
            end as opens_on,
            (select count(*)::int from lessons l where l.module_id = m.id) as lesson_count
          from modules m
          where m.course_id = ${r.course_id}::uuid
          order by m.rank asc
        `);

        const start = new Date(String(r.starts_on).slice(0, 10));
        const total = Number(r.total) || 0;
        const done = Number(r.done) || 0;

        return {
          id: r.id,
          name: r.name,
          courseSlug: r.course_slug,
          courseTitle: r.course_title,
          startsOn: String(r.starts_on).slice(0, 10),
          endsOn: r.ends_on ? String(r.ends_on).slice(0, 10) : null,
          // Day 1 is the start date, not the day after it.
          dayNumber: Math.floor((Date.now() - start.getTime()) / 86_400_000) + 1,
          memberCount: Number(r.member_count) || 0,
          progress: total === 0 ? 0 : Math.round((done / total) * 100),
          lessonsDone: done,
          lessonsTotal: total,
          schedule: schedule.map((s) => ({
            title: s.title,
            opensOn: s.opens_on ? String(s.opens_on).slice(0, 10) : null,
            lessonCount: Number(s.lesson_count) || 0,
            open: !s.opens_on || new Date(String(s.opens_on)).getTime() <= Date.now(),
          })),
        };
      }),
    );
  });
}

/**
 * Wins this member has submitted, including the ones still in review.
 *
 * A first win goes to moderation and then, from the member's side, nothing
 * happens — the board does not show it and no page lists it, so the only way
 * to know it survived is to notice it appear one day. Somebody who writes six
 * paragraphs about how they doubled their close rate deserves better than
 * silence.
 */
export async function getMySubmissions(env: Env, userId: string | null): Promise<MySubmission[]> {
  const db = getDb(env);
  if (!db || !userId) return [];

  return withUser(db, userId, async (tx) => {
    const rows = await tx.execute<{
      id: string; slug: string; title: string; status: string; created_at: string;
    }>(sql`
      select id, slug, title, status::text, created_at
      from wins where author_id = ${userId}::uuid
      order by created_at desc limit 50
    `);
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      status: r.status as MySubmission['status'],
      createdAt: new Date(r.created_at).toISOString(),
    }));
  });
}
