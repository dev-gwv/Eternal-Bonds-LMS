import { sql } from 'drizzle-orm';
import { withUser } from '@ipc/db';
import type {
  GrantPackageInput,
  Package,
  PackageDetail,
  PackageGrant,
  PackageInput,
} from '@ipc/contracts';
import type { Env } from './env.ts';
import { HttpError } from './lib/problem.ts';
import { getDb } from './repo.ts';

/**
 * Packages: a bundle of courses bought on its own.
 *
 * Access is not decided here. A grant row is what `public.course_allowed()`
 * reads, so once a member holds one the course, its lessons, its quiz and its
 * playback ticket all open through the same RLS as tier — there is no second
 * code path to forget. This module only shows packages and writes grants.
 */

const requireDb = (env: Env) => {
  const db = getDb(env);
  if (!db) throw new HttpError(503, 'Needs a database');
  return db;
};

type Row = {
  id: string; slug: string; title: string; summary_md: string | null; cover_key: string | null;
  price_paise: number; currency: string; access_days: number | null; is_published: boolean;
  course_count: number; lesson_count: number; seconds: number;
  owned_until: string | null; owned: boolean;
};

/** Counts through the catalogue function, so locked courses still count. */
const SELECT = (userId: string) => sql`
  select
    p.id, p.slug, p.title, p.summary_md, p.cover_key, p.price_paise, p.currency, p.access_days, p.is_published,
    coalesce(agg.course_count, 0) as course_count,
    coalesce(agg.lesson_count, 0) as lesson_count,
    coalesce(agg.seconds, 0) as seconds,
    g.expires_at as owned_until,
    (g.id is not null) as owned
  from packages p
  left join lateral (
    select count(*)::int as course_count, sum(cat.lesson_count)::int as lesson_count, sum(cat.seconds)::int as seconds
    from public.package_catalogue(p.id) cat
  ) agg on true
  left join package_grants g
    on g.package_id = p.id and g.user_id = ${userId}::uuid and g.revoked_at is null
   and (g.expires_at is null or g.expires_at > now())
`;

const toPackage = (r: Row, coverUrl: string | null): Package => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  summaryMd: r.summary_md,
  coverUrl,
  pricePaise: Number(r.price_paise) || 0,
  currency: r.currency,
  accessDays: r.access_days === null ? null : Number(r.access_days),
  isPublished: r.is_published,
  courseCount: Number(r.course_count) || 0,
  lessonCount: Number(r.lesson_count) || 0,
  durationMinutes: Math.round((Number(r.seconds) || 0) / 60),
  owned: Boolean(r.owned),
  ownedUntil: r.owned && r.owned_until ? new Date(r.owned_until).toISOString() : null,
});

async function signed(env: Env, keys: (string | null)[]) {
  const { signCovers } = await import('./covers.ts');
  return signCovers(env, keys).catch(() => keys.map(() => null));
}

/** Members see published packages; admins (RLS) also see drafts. */
export async function listPackages(env: Env, userId: string | null): Promise<Package[]> {
  const db = getDb(env);
  if (!db || !userId) return [];
  return withUser(db, userId, async (tx) => {
    const rows = await tx.execute<Row>(sql`${SELECT(userId)} order by p.rank asc, p.created_at asc`);
    const covers = await signed(env, rows.map((r) => r.cover_key));
    return rows.map((r, i) => toPackage(r, covers[i] ?? null));
  });
}

export async function getPackage(env: Env, userId: string | null, slugOrId: string): Promise<PackageDetail> {
  const db = requireDb(env);
  if (!userId) throw new HttpError(401, 'Not authenticated');
  const isId = /^[0-9a-f-]{36}$/i.test(slugOrId);
  return withUser(db, userId, async (tx) => {
    const [head] = await tx.execute<Row>(sql`
      ${SELECT(userId)} where ${isId ? sql`p.id = ${slugOrId}::uuid` : sql`p.slug = ${slugOrId}`}
    `);
    if (!head) throw new HttpError(404, 'Package not found');

    const courses = await tx.execute<{
      course_id: string; course_slug: string; course_title: string; cover_key: string | null;
      instructor: string | null; lesson_count: number; seconds: number;
    }>(sql`select * from public.package_catalogue(${head.id}::uuid)`);

    const covers = await signed(env, [head.cover_key, ...courses.map((c) => c.cover_key)]);
    return {
      ...toPackage(head, covers[0] ?? null),
      courses: courses.map((c, i) => ({
        courseId: c.course_id,
        slug: c.course_slug,
        title: c.course_title,
        coverUrl: covers[i + 1] ?? null,
        instructorName: c.instructor,
        lessonCount: Number(c.lesson_count) || 0,
        durationMinutes: Math.round((Number(c.seconds) || 0) / 60),
      })),
      canBuyOnline: env.BILLING_MODE === 'razorpay' && Boolean(env.RAZORPAY_KEY_ID) && Number(head.price_paise) > 0,
    };
  });
}

/** Which packages open a course — for "Included in …" on a locked course. */
export async function packagesForCourse(env: Env, userId: string, courseSlug: string) {
  const db = getDb(env);
  if (!db) return [];
  return withUser(db, userId, (tx) =>
    tx.execute<{ slug: string; title: string; price_paise: number }>(sql`
      select p.slug, p.title, p.price_paise
      from packages p
      where p.is_published and exists (
        select 1 from public.package_catalogue(p.id) cat where cat.course_slug = ${courseSlug}
      )
      order by p.rank asc
    `),
  );
}

/* ── Authoring ─────────────────────────────────────────────────────────── */

const slugTaken = (error: unknown, slug: string) => {
  const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
  return code === '23505' ? new HttpError(409, 'That address is taken', `Another package already uses “${slug}”.`) : error;
};

export async function createPackage(env: Env, userId: string, input: PackageInput): Promise<PackageDetail> {
  const db = requireDb(env);
  let id: string;
  try {
    id = await withUser(db, userId, async (tx) => {
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into packages (slug, title, summary_md, price_paise, access_days, is_published, rank)
        values (${input.slug}, ${input.title}, ${input.summaryMd}, ${input.pricePaise}, ${input.accessDays},
                ${input.isPublished}, coalesce((select max(rank) from packages), 0) + 1000)
        returning id
      `);
      if (!row) throw new HttpError(403, 'Only an admin can create packages');
      return row.id;
    });
  } catch (error) {
    throw slugTaken(error, input.slug);
  }
  return getPackage(env, userId, id);
}

export async function updatePackage(env: Env, userId: string, id: string, input: PackageInput): Promise<PackageDetail> {
  const db = requireDb(env);
  try {
    await withUser(db, userId, async (tx) => {
      const rows = await tx.execute<{ id: string }>(sql`
        update packages set
          slug = ${input.slug}, title = ${input.title}, summary_md = ${input.summaryMd},
          price_paise = ${input.pricePaise}, access_days = ${input.accessDays}, is_published = ${input.isPublished}
        where id = ${id}::uuid
        returning id
      `);
      if (rows.length === 0) throw new HttpError(404, 'Package not found');
    });
  } catch (error) {
    throw slugTaken(error, input.slug);
  }
  return getPackage(env, userId, id);
}

export async function deletePackage(env: Env, userId: string, id: string): Promise<void> {
  const db = requireDb(env);
  await withUser(db, userId, async (tx) => {
    // Refused while anyone holds it: deleting would silently take away
    // something a member paid for. Unpublish it instead.
    const [live] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from package_grants
      where package_id = ${id}::uuid and revoked_at is null and (expires_at is null or expires_at > now())
    `);
    if (Number(live?.n) > 0) {
      throw new HttpError(409, 'Members own this package', 'Unpublish it instead, so nobody new can buy it and nobody loses access.');
    }
    await tx.execute(sql`delete from packages where id = ${id}::uuid`);
  });
}

/** The whole list in order; replaces what was there. */
export async function setPackageCourses(env: Env, userId: string, id: string, courseIds: string[]): Promise<PackageDetail> {
  const db = requireDb(env);
  const unique = [...new Set(courseIds)];
  await withUser(db, userId, async (tx) => {
    await tx.execute(sql`delete from package_courses where package_id = ${id}::uuid`);
    for (const [i, courseId] of unique.entries()) {
      await tx.execute(sql`
        insert into package_courses (package_id, course_id, rank)
        values (${id}::uuid, ${courseId}::uuid, ${(i + 1) * 1000})
      `);
    }
  });
  return getPackage(env, userId, id);
}

/* ── Grants ────────────────────────────────────────────────────────────── */

type GrantRow = {
  id: string; package_id: string; package_title: string; user_id: string; member_name: string | null;
  member_email: string | null; source: 'manual' | 'razorpay'; note: string | null;
  granted_at: string; expires_at: string | null; revoked_at: string | null;
};

const toGrant = (r: GrantRow): PackageGrant => ({
  id: r.id,
  packageId: r.package_id,
  packageTitle: r.package_title,
  userId: r.user_id,
  memberName: r.member_name ?? r.member_email ?? 'Member',
  memberEmail: r.member_email,
  source: r.source,
  note: r.note,
  grantedAt: new Date(r.granted_at).toISOString(),
  expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
  revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
});

const GRANTS = sql`
  select g.id, g.package_id, p.title as package_title, g.user_id, u.full_name as member_name, u.email as member_email,
         g.source, g.note, g.granted_at, g.expires_at, g.revoked_at
  from package_grants g
  join packages p on p.id = g.package_id
  join users u on u.id = g.user_id
`;

export async function listGrants(
  env: Env,
  userId: string,
  filter: { packageId?: string; memberId?: string },
): Promise<PackageGrant[]> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    const where = filter.packageId
      ? sql`where g.package_id = ${filter.packageId}::uuid`
      : filter.memberId
        ? sql`where g.user_id = ${filter.memberId}::uuid`
        : sql``;
    const rows = await tx.execute<GrantRow>(sql`${GRANTS} ${where} order by g.revoked_at nulls first, g.granted_at desc limit 500`);
    return rows.map(toGrant);
  });
}

/** Gives a package by hand — a UPI transfer, cash at an event, a gift. */
export async function grantPackage(env: Env, userId: string, packageId: string, input: GrantPackageInput): Promise<PackageGrant> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    const member = input.member.trim();
    const isId = /^[0-9a-f-]{36}$/i.test(member);
    const [target] = await tx.execute<{ id: string }>(sql`
      select id from users where ${isId ? sql`id = ${member}::uuid` : sql`lower(email) = lower(${member})`} limit 1
    `);
    if (!target) throw new HttpError(404, 'No member with that email', 'They need an account first — create one, then give the package.');

    const [granted] = await tx.execute<{ id: string }>(sql`
      select public.grant_package(${target.id}::uuid, ${packageId}::uuid, 'manual', null, ${userId}::uuid, ${input.note}) as id
    `);
    if (!granted?.id) throw new HttpError(500, 'The package was not given');
    const [row] = await tx.execute<GrantRow>(sql`${GRANTS} where g.id = ${granted.id}::uuid`);
    return toGrant(row!);
  });
}

export async function revokeGrant(env: Env, userId: string, grantId: string): Promise<void> {
  const db = requireDb(env);
  await withUser(db, userId, async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      update package_grants set revoked_at = now() where id = ${grantId}::uuid and revoked_at is null returning id
    `);
    if (rows.length === 0) throw new HttpError(404, 'That access was already removed');
  });
}
