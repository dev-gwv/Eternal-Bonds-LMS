import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  courses as coursesTable,
  lessons,
  modules,
  users,
  withUser,
  workshops as workshopsTable,
  type Db,
} from '@ipc/db';
import type {
  AdminCourse,
  AdminCourseDetail,
  AdminLesson,
  AdminModule,
  AdminOverview,
  AdminWorkshop,
  CourseInput,
  CoursePatch,
  LessonInput,
  LessonPatch,
  ModuleInput,
  Role,
  WorkshopInput,
} from '@ipc/contracts';
import type { Env } from './env.ts';
import { HttpError } from './lib/problem.ts';
import { getDb } from './repo.ts';

/**
 * Authoring reads and writes.
 *
 * Everything here runs through `withUser`, so the database — not this file —
 * is the thing that actually refuses a non-admin. The checks in the route
 * layer exist to return a clean 403 instead of a confusing empty result; if
 * they were ever removed, RLS would still hold the line.
 */

function requireDb(env: Env): Db {
  const db = getDb(env);
  // Authoring writes real rows. Unlike reading, there is no sensible seed-mode
  // answer — pretending a save succeeded would be worse than saying the studio
  // needs a database.
  if (!db) throw new HttpError(503, 'Authoring needs a database', 'Set DATABASE_URL to use the studio.');
  return db;
}

/** Reads the caller's role from their own profile row. */
export async function roleOf(env: Env, userId: string | null): Promise<Role> {
  const db = getDb(env);
  if (!db) return 'admin'; // Seed mode is a local sandbox with no real data to protect.
  if (!userId) return 'member';
  const [row] = await withUser(db, userId, (tx) =>
    tx.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1),
  );
  return ((row?.role as Role) ?? 'member');
}

/* ── Ranking ───────────────────────────────────────────────────────────────
   Ranks are spaced by 1000 so inserting between two siblings is one UPDATE
   rather than a renumber of the whole list. A full reorder renumbers anyway,
   which stops the gaps collapsing over time. */

const RANK_STEP = 1000;

/* ── Courses ───────────────────────────────────────────────────────────────*/

const courseColumns = {
  id: coursesTable.id,
  slug: coursesTable.slug,
  title: coursesTable.title,
  category: coursesTable.category,
  level: coursesTable.level,
  language: coursesTable.language,
  minTier: coursesTable.minTier,
  summaryMd: coursesTable.summaryMd,
  coverKey: coursesTable.coverKey,
  instructorName: coursesTable.instructorName,
  isPublished: coursesTable.isPublished,
  updatedAt: coursesTable.updatedAt,
  // Written with explicit qualified names: Drizzle does not prefix columns it
  // interpolates into a single-table select, and `join modules on id = ...`
  // is ambiguous rather than merely ugly.
  lessonCount: sql<number>`(
    select count(*) from lessons
    join modules on modules.id = lessons.module_id
    where modules.course_id = courses.id
  )`,
  durationSeconds: sql<number>`(
    select coalesce(sum(lessons.duration_seconds), 0) from lessons
    join modules on modules.id = lessons.module_id
    where modules.course_id = courses.id
  )`,
};

type CourseRow = {
  id: string;
  slug: string;
  title: string;
  category: string;
  level: string;
  language: string;
  minTier: AdminCourse['minTier'];
  summaryMd: string | null;
  coverKey: string | null;
  instructorName: string | null;
  isPublished: boolean;
  updatedAt: Date;
  lessonCount: number;
  durationSeconds: number;
};

const toAdminCourse = (r: CourseRow): AdminCourse => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  category: r.category as AdminCourse['category'],
  level: r.level as AdminCourse['level'],
  language: r.language as AdminCourse['language'],
  minTier: r.minTier,
  summaryMd: r.summaryMd ?? null,
  // The studio shows the key rather than a signed link: the cover is uploaded
  // and replaced from here, and a link that expires mid-edit is worse than a
  // name. The member-facing list signs it.
  coverUrl: r.coverKey ?? null,
  instructorName: r.instructorName ?? null,
  isPublished: r.isPublished,
  lessonCount: Number(r.lessonCount) || 0,
  durationMinutes: Math.round((Number(r.durationSeconds) || 0) / 60),
  updatedAt: r.updatedAt.toISOString(),
});

export async function listAdminCourses(env: Env, userId: string): Promise<AdminCourse[]> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    // No isPublished filter: the point of the studio is seeing drafts.
    const rows = await tx.select(courseColumns).from(coursesTable).orderBy(asc(coursesTable.rank));
    return rows.map((r) => toAdminCourse(r as CourseRow));
  });
}

export async function getAdminCourse(env: Env, userId: string, id: string): Promise<AdminCourseDetail> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    const [course] = await tx.select(courseColumns).from(coursesTable).where(eq(coursesTable.id, id));
    if (!course) throw new HttpError(404, 'Course not found');

    const rows = await tx
      .select({
        moduleId: modules.id,
        moduleTitle: modules.title,
        moduleRank: modules.rank,
        moduleDripDays: modules.dripDays,
        moduleAvailableFrom: modules.availableFrom,
        lessonId: lessons.id,
        lessonSlug: lessons.slug,
        lessonTitle: lessons.title,
        durationSeconds: lessons.durationSeconds,
        isPreview: lessons.isPreview,
        lessonRank: lessons.rank,
        videoStatus: lessons.videoStatus,
        videoAssetId: lessons.videoAssetId,
        videoError: lessons.videoError,
      })
      .from(modules)
      .leftJoin(lessons, eq(lessons.moduleId, modules.id))
      .where(eq(modules.courseId, id))
      .orderBy(asc(modules.rank), asc(lessons.rank));

    const byModule = new Map<string, AdminModule>();
    for (const r of rows) {
      if (!byModule.has(r.moduleId)) {
        byModule.set(r.moduleId, {
          id: r.moduleId,
          title: r.moduleTitle,
          rank: Number(r.moduleRank),
          dripDays: r.moduleDripDays ?? null,
          availableFrom: r.moduleAvailableFrom ? r.moduleAvailableFrom.toISOString() : null,
          lessons: [],
        });
      }
      if (!r.lessonId) continue;
      byModule.get(r.moduleId)!.lessons.push({
        id: r.lessonId,
        slug: r.lessonSlug ?? '',
        title: r.lessonTitle ?? '',
        durationSeconds: r.durationSeconds ?? 0,
        isPreview: r.isPreview ?? false,
        rank: Number(r.lessonRank ?? 0),
        videoStatus: (r.videoStatus ?? 'none') as AdminLesson['videoStatus'],
        videoAssetId: r.videoAssetId ?? null,
        videoError: r.videoError ?? null,
      });
    }

    return { ...toAdminCourse(course as CourseRow), modules: [...byModule.values()] };
  });
}

export async function createCourse(env: Env, userId: string, input: CourseInput): Promise<AdminCourse> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    const [top] = await tx
      .select({ max: sql<string>`coalesce(max(${coursesTable.rank}), 0)` })
      .from(coursesTable);
    try {
      const [created] = await tx
        .insert(coursesTable)
        .values({
          slug: input.slug,
          title: input.title,
          category: input.category,
          level: input.level,
          language: input.language,
          minTier: input.minTier,
          summaryMd: input.summaryMd,
          instructorName: input.instructorName,
          isPublished: input.isPublished,
          rank: String(Number(top?.max ?? 0) + RANK_STEP),
        })
        .returning({ id: coursesTable.id });
      const [row] = await tx.select(courseColumns).from(coursesTable).where(eq(coursesTable.id, created!.id));
      return toAdminCourse(row as CourseRow);
    } catch (error) {
      throw slugConflict(error, input.slug);
    }
  });
}

export async function updateCourse(env: Env, userId: string, id: string, patch: CoursePatch): Promise<AdminCourse> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    if (Object.keys(patch).length > 0) {
      try {
        await tx.update(coursesTable).set(patch).where(eq(coursesTable.id, id));
      } catch (error) {
        throw slugConflict(error, patch.slug ?? '');
      }
    }
    const [row] = await tx.select(courseColumns).from(coursesTable).where(eq(coursesTable.id, id));
    if (!row) throw new HttpError(404, 'Course not found');
    return toAdminCourse(row as CourseRow);
  });
}

/**
 * Publishing is a separate call from editing because it is a different act:
 * saving a typo is routine, making a course visible to paying members is not.
 * It refuses to publish a course members would find broken.
 */
export async function setCoursePublished(
  env: Env,
  userId: string,
  id: string,
  isPublished: boolean,
): Promise<AdminCourse> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    if (isPublished) {
      const [ready] = await tx
        .select({
          lessons: sql<number>`count(${lessons.id})`,
          notReady: sql<number>`count(*) filter (where ${lessons.videoStatus} <> 'ready')`,
        })
        .from(modules)
        .leftJoin(lessons, eq(lessons.moduleId, modules.id))
        .where(eq(modules.courseId, id));

      if (!Number(ready?.lessons)) {
        throw new HttpError(409, 'Nothing to publish', 'Add at least one lesson before publishing this course.');
      }
      if (Number(ready?.notReady) > 0) {
        throw new HttpError(
          409,
          'Some lessons have no video',
          `${ready!.notReady} lesson(s) are not ready to play. Members would reach a dead player.`,
        );
      }
    }
    // The announcement is emitted by a trigger on `courses`, which fires only
    // on the false→true transition — so republishing after a typo fix does not
    // tell the whole club twice.
    await tx.update(coursesTable).set({ isPublished }).where(eq(coursesTable.id, id));

    const [row] = await tx.select(courseColumns).from(coursesTable).where(eq(coursesTable.id, id));
    if (!row) throw new HttpError(404, 'Course not found');
    return toAdminCourse(row as CourseRow);
  });
}

export async function deleteCourse(env: Env, userId: string, id: string): Promise<void> {
  const db = requireDb(env);
  await withUser(db, userId, async (tx) => {
    const [row] = await tx
      .select({ isPublished: coursesTable.isPublished })
      .from(coursesTable)
      .where(eq(coursesTable.id, id));
    if (!row) throw new HttpError(404, 'Course not found');
    // Deleting a published course cascades away every member's progress
    // through it. Unpublish first, deliberately, then delete.
    if (row.isPublished) {
      throw new HttpError(409, 'Course is published', 'Unpublish it first — deleting it removes member progress.');
    }
    await tx.delete(coursesTable).where(eq(coursesTable.id, id));
  });
}

/* ── Modules ───────────────────────────────────────────────────────────────*/

export async function createModule(
  env: Env,
  userId: string,
  courseId: string,
  input: ModuleInput,
): Promise<AdminModule> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    const [top] = await tx
      .select({ max: sql<string>`coalesce(max(${modules.rank}), 0)` })
      .from(modules)
      .where(eq(modules.courseId, courseId));
    const [row] = await tx
      .insert(modules)
      .values({
        courseId,
        title: input.title,
        dripDays: input.dripDays,
        availableFrom: input.availableFrom ? new Date(input.availableFrom) : null,
        rank: String(Number(top?.max ?? 0) + RANK_STEP),
      })
      .returning({
        id: modules.id, title: modules.title, rank: modules.rank,
        dripDays: modules.dripDays, availableFrom: modules.availableFrom,
      });
    return {
      id: row!.id,
      title: row!.title,
      rank: Number(row!.rank),
      dripDays: row!.dripDays ?? null,
      availableFrom: row!.availableFrom ? row!.availableFrom.toISOString() : null,
      lessons: [],
    };
  });
}

export async function updateModule(
  env: Env,
  userId: string,
  id: string,
  input: ModuleInput,
): Promise<AdminModule> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    const [row] = await tx
      .update(modules)
      .set({
        title: input.title,
        dripDays: input.dripDays,
        availableFrom: input.availableFrom ? new Date(input.availableFrom) : null,
      })
      .where(eq(modules.id, id))
      .returning({
        id: modules.id, title: modules.title, rank: modules.rank,
        dripDays: modules.dripDays, availableFrom: modules.availableFrom,
      });
    if (!row) throw new HttpError(404, 'Module not found');
    return {
      id: row.id,
      title: row.title,
      rank: Number(row.rank),
      dripDays: row.dripDays ?? null,
      availableFrom: row.availableFrom ? row.availableFrom.toISOString() : null,
      lessons: [],
    };
  });
}

export async function deleteModule(env: Env, userId: string, id: string): Promise<void> {
  const db = requireDb(env);
  await withUser(db, userId, async (tx) => {
    const [count] = await tx
      .select({ n: sql<number>`count(*)` })
      .from(lessons)
      .where(eq(lessons.moduleId, id));
    if (Number(count?.n) > 0) {
      throw new HttpError(409, 'Module is not empty', 'Move or delete its lessons first.');
    }
    await tx.delete(modules).where(eq(modules.id, id));
  });
}

/* ── Lessons ───────────────────────────────────────────────────────────────*/

const toAdminLesson = (row: typeof lessons.$inferSelect): AdminLesson => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  durationSeconds: row.durationSeconds,
  isPreview: row.isPreview,
  rank: Number(row.rank),
  videoStatus: row.videoStatus,
  videoAssetId: row.videoAssetId,
  videoError: row.videoError,
});

export async function createLesson(
  env: Env,
  userId: string,
  moduleId: string,
  input: LessonInput,
): Promise<AdminLesson> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    const [top] = await tx
      .select({ max: sql<string>`coalesce(max(${lessons.rank}), 0)` })
      .from(lessons)
      .where(eq(lessons.moduleId, moduleId));
    try {
      const [row] = await tx
        .insert(lessons)
        .values({
          moduleId,
          slug: input.slug,
          title: input.title,
          durationSeconds: input.durationSeconds,
          isPreview: input.isPreview,
          summaryMd: input.bodyMd,
          rank: String(Number(top?.max ?? 0) + RANK_STEP),
        })
        .returning();
      return toAdminLesson(row!);
    } catch (error) {
      throw slugConflict(error, input.slug);
    }
  });
}

export async function updateLesson(
  env: Env,
  userId: string,
  id: string,
  patch: LessonPatch,
): Promise<AdminLesson> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    const { bodyMd, ...rest } = patch;
    const values = { ...rest, ...(bodyMd === undefined ? {} : { summaryMd: bodyMd }) };
    try {
      const [row] = await tx.update(lessons).set(values).where(eq(lessons.id, id)).returning();
      if (!row) throw new HttpError(404, 'Lesson not found');
      return toAdminLesson(row);
    } catch (error) {
      throw slugConflict(error, patch.slug ?? '');
    }
  });
}

export async function deleteLesson(env: Env, userId: string, id: string): Promise<void> {
  const db = requireDb(env);
  await withUser(db, userId, async (tx) => {
    await tx.delete(lessons).where(eq(lessons.id, id));
  });
}

/* ── Reordering ────────────────────────────────────────────────────────────*/

/**
 * Renumbers the given ids to 1000, 2000, 3000… in one statement.
 *
 * The whole list is sent rather than a pair of indices, so a lost request is
 * harmless and two editors cannot interleave into an order neither chose. The
 * ownership check matters: without it a caller could pass ids from another
 * course and silently reshuffle it.
 */
export async function reorder(
  env: Env,
  userId: string,
  kind: 'modules' | 'lessons',
  parentId: string,
  ids: string[],
): Promise<void> {
  const db = requireDb(env);
  await withUser(db, userId, async (tx) => {
    const table = kind === 'modules' ? modules : lessons;
    const parentColumn = kind === 'modules' ? modules.courseId : lessons.moduleId;

    const owned = await tx
      .select({ id: table.id })
      .from(table)
      .where(and(eq(parentColumn, parentId), inArray(table.id, ids)));
    if (owned.length !== ids.length) {
      throw new HttpError(
        400,
        'Reorder does not match',
        'Every id has to belong to this parent. Reload the page and try again.',
      );
    }

    const whens = sql.join(
      ids.map((id, i) => sql`when ${id}::uuid then ${String((i + 1) * RANK_STEP)}::numeric`),
      sql` `,
    );
    const idList = sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    await tx.execute(sql`update ${table} set rank = case id ${whens} end where id in (${idList})`);
  });
}

/* ── Workshops ─────────────────────────────────────────────────────────────*/

const workshopColumns = {
  id: workshopsTable.id,
  title: workshopsTable.title,
  startsAt: workshopsTable.startsAt,
  endsAt: workshopsTable.endsAt,
  platform: workshopsTable.platform,
  minTier: workshopsTable.minTier,
  joinUrl: workshopsTable.joinUrl,
  recurring: workshopsTable.recurring,
  capacity: workshopsTable.capacity,
  coverKey: workshopsTable.coverKey,
  registrationCount: sql<number>`(
    select count(*) from workshop_registrations
    where workshop_registrations.workshop_id = workshops.id
  )`,
};

type WorkshopRow = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  platform: string;
  minTier: AdminWorkshop['minTier'];
  joinUrl: string | null;
  recurring: boolean;
  capacity: number | null;
  registrationCount: number;
};

const toAdminWorkshop = (r: WorkshopRow, coverUrl: string | null = null): AdminWorkshop => ({
  coverUrl,
  id: r.id,
  title: r.title,
  startsAt: r.startsAt.toISOString(),
  endsAt: r.endsAt.toISOString(),
  platform: r.platform as AdminWorkshop['platform'],
  minTier: r.minTier,
  joinUrl: r.joinUrl ?? null,
  recurring: r.recurring,
  capacity: r.capacity ?? null,
  registrationCount: Number(r.registrationCount) || 0,
});

/** Added to the column set so the studio can show what it uploaded. */

export async function listAdminWorkshops(env: Env, userId: string): Promise<AdminWorkshop[]> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    const rows = await tx.select(workshopColumns).from(workshopsTable).orderBy(asc(workshopsTable.startsAt));
    const { signCovers } = await import('./covers.ts');
    const covers = await signCovers(env, rows.map((r) => (r as { coverKey?: string | null }).coverKey ?? null));
    return rows.map((r, i) => toAdminWorkshop(r as WorkshopRow, covers[i] ?? null));
  });
}

const workshopValues = (input: WorkshopInput) => ({
  title: input.title,
  startsAt: new Date(input.startsAt),
  endsAt: new Date(input.endsAt),
  platform: input.platform,
  minTier: input.minTier,
  joinUrl: input.joinUrl,
  recurring: input.recurring,
  capacity: input.capacity,
});

export async function createWorkshop(env: Env, userId: string, input: WorkshopInput): Promise<AdminWorkshop> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    const [created] = await tx
      .insert(workshopsTable)
      .values(workshopValues(input))
      .returning({ id: workshopsTable.id });
    const [row] = await tx.select(workshopColumns).from(workshopsTable).where(eq(workshopsTable.id, created!.id));
    return toAdminWorkshop(row as WorkshopRow);
  });
}

export async function updateWorkshop(
  env: Env,
  userId: string,
  id: string,
  input: WorkshopInput,
): Promise<AdminWorkshop> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    await tx.update(workshopsTable).set(workshopValues(input)).where(eq(workshopsTable.id, id));
    const [row] = await tx.select(workshopColumns).from(workshopsTable).where(eq(workshopsTable.id, id));
    if (!row) throw new HttpError(404, 'Workshop not found');
    return toAdminWorkshop(row as WorkshopRow);
  });
}

export async function deleteWorkshop(env: Env, userId: string, id: string): Promise<void> {
  const db = requireDb(env);
  await withUser(db, userId, async (tx) => {
    const [row] = await tx.select(workshopColumns).from(workshopsTable).where(eq(workshopsTable.id, id));
    if (!row) throw new HttpError(404, 'Workshop not found');
    if (Number(row.registrationCount) > 0) {
      // People have it in their calendar. Cancelling is a message, not a DELETE.
      throw new HttpError(
        409,
        'Members have registered',
        `${row.registrationCount} member(s) are registered. Reschedule it rather than deleting it.`,
      );
    }
    await tx.delete(workshopsTable).where(eq(workshopsTable.id, id));
  });
}

/* ── Overview ──────────────────────────────────────────────────────────────*/

export async function overview(env: Env, userId: string): Promise<AdminOverview> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    const [courseCounts] = await tx
      .select({
        published: sql<number>`count(*) filter (where ${coursesTable.isPublished})`,
        draft: sql<number>`count(*) filter (where not ${coursesTable.isPublished})`,
      })
      .from(coursesTable);

    const [lessonCounts] = await tx
      .select({
        total: sql<number>`count(*)`,
        withoutVideo: sql<number>`count(*) filter (where ${lessons.videoStatus} <> 'ready')`,
      })
      .from(lessons);

    const [upcoming] = await tx
      .select({ n: sql<number>`count(*)` })
      .from(workshopsTable)
      .where(gte(workshopsTable.endsAt, new Date()));

    const [memberCounts] = await tx
      .select({
        total: sql<number>`count(*)`,
        paid: sql<number>`count(*) filter (where public.current_tier(${users.id}) <> 'free')`,
      })
      .from(users);

    return {
      courses: { published: Number(courseCounts?.published) || 0, draft: Number(courseCounts?.draft) || 0 },
      lessons: { total: Number(lessonCounts?.total) || 0, withoutVideo: Number(lessonCounts?.withoutVideo) || 0 },
      workshops: { upcoming: Number(upcoming?.n) || 0 },
      members: { total: Number(memberCounts?.total) || 0, paid: Number(memberCounts?.paid) || 0 },
    };
  });
}

/** Postgres 23505 is the only error here a human can actually act on. */
function slugConflict(error: unknown, slug: string): unknown {
  const code = (error as { code?: string } | null)?.code;
  if (code === '23505') {
    return new HttpError(409, 'That URL is taken', `Another item already uses "${slug}".`);
  }
  return error;
}

/**
 * Sets or clears a course cover.
 *
 * The key is checked against the course's own prefix for the same reason post
 * media is: it arrives from the browser, and without the check an admin could
 * point one course at another's object — or at any file in the bucket.
 *
 * Replacing removes the previous image rather than orphaning it. Covers get
 * changed more than anything else in the studio, and each abandoned one is a
 * file somebody pays to store forever.
 */
export async function setCourseCover(
  env: Env,
  userId: string,
  id: string,
  key: string | null,
): Promise<AdminCourse> {
  const db = requireDb(env);
  const { createStorage } = await import('./lib/storage.ts');

  if (key && !key.startsWith(`covers/${id}/`)) {
    throw new HttpError(422, 'That file does not belong to this course');
  }

  return withUser(db, userId, async (tx) => {
    const [before] = await tx
      .select({ coverKey: coursesTable.coverKey })
      .from(coursesTable)
      .where(eq(coursesTable.id, id));
    if (!before) throw new HttpError(404, 'Course not found');

    await tx.update(coursesTable).set({ coverKey: key }).where(eq(coursesTable.id, id));

    if (before.coverKey && before.coverKey !== key) {
      try {
        await createStorage(env).remove([before.coverKey]);
      } catch {
        // A leftover file is not worth failing the save over.
      }
    }

    const [row] = await tx.select(courseColumns).from(coursesTable).where(eq(coursesTable.id, id));
    return toAdminCourse(row as CourseRow);
  });
}
