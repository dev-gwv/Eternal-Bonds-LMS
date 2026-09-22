import { and, asc, eq, sql } from 'drizzle-orm';
import { courses as coursesTable, lessonProgress, lessons, modules, withUser } from '@ipc/db';
import type { CourseDetail, CourseModule, Lesson, PlaybackTicket } from '@ipc/contracts';
import type { Env } from './env.ts';
import { HttpError } from './lib/problem.ts';
import { supabaseConfigured } from './lib/supabase.ts';
import { playbackFor } from './video.ts';
import { getDb, listCourses } from './repo.ts';
import * as seed from './data/seed.ts';

/**
 * Course detail and playback.
 *
 * Access is decided here, not in the UI: a member who is not entitled gets a
 * 403 from `/playback`, whatever the client renders. Hiding the player in React
 * is not access control.
 */

const TICKET_TTL_SECONDS = 900;

export async function getCourseDetail(env: Env, userId: string | null, slug: string): Promise<CourseDetail> {
  const db = getDb(env);

  if (!db) {
    const course = seed.courses.find((c) => c.slug === slug);
    if (!course) throw new HttpError(404, 'Course not found');

    const modules: CourseModule[] = seed.modulesFor(slug).map(([title, rows]) => ({
      id: rows[0]!.moduleId,
      title,
      unlocksAt: null,
      lessons: rows.map((l): Lesson => {
        const p = seed.progress.get(l.id);
        return {
          id: l.id,
          slug: l.slug,
          title: l.title,
          durationSeconds: l.durationSeconds,
          isPreview: l.isPreview,
          locked: false,
          completed: p?.completed ?? false,
          lastPositionSeconds: p?.positionSeconds ?? 0,
        };
      }),
    }));

    const all = modules.flatMap((m) => m.lessons);
    const done = all.filter((l) => l.completed).length;
    const progress = all.length === 0 ? 0 : Math.round((done / all.length) * 100);

    return {
      ...course,
      lessonCount: all.length,
      durationMinutes: Math.round(all.reduce((s, l) => s + l.durationSeconds, 0) / 60),
      progress,
      status: progress === 100 ? 'completed' : progress > 0 ? 'ongoing' : 'not_started',
      summaryMd: null,
      modules,
    };
  }

  const [summary] = await listCourses(env, userId).then((rows) => rows.filter((c) => c.slug === slug));
  if (!summary) throw new HttpError(404, 'Course not found');

  return withUser(db, userId, async (tx) => {
    const rows = await tx
      .select({
        moduleId: modules.id,
        moduleTitle: modules.title,
        moduleRank: modules.rank,
        // Drip is decided in the database, by the same function the playback
        // gate calls — so the syllabus and the player can never disagree.
        unlocksAt: userId
          ? sql<string | null>`public.module_unlock_at(${modules.id}, ${userId}::uuid)`
          : sql<string | null>`null`,
        lessonId: lessons.id,
        lessonSlug: lessons.slug,
        lessonTitle: lessons.title,
        durationSeconds: lessons.durationSeconds,
        isPreview: lessons.isPreview,
        lessonRank: lessons.rank,
        completed: lessonProgress.isCompleted,
        lastPositionSeconds: lessonProgress.lastPositionSeconds,
      })
      .from(modules)
      .innerJoin(coursesTable, eq(coursesTable.id, modules.courseId))
      .leftJoin(lessons, eq(lessons.moduleId, modules.id))
      .leftJoin(
        lessonProgress,
        userId
          ? and(eq(lessonProgress.lessonId, lessons.id), eq(lessonProgress.userId, userId))
          : sql`false`,
      )
      .where(eq(coursesTable.slug, slug))
      .orderBy(asc(modules.rank), asc(lessons.rank));

    const now = Date.now();
    const byModule = new Map<string, CourseModule>();
    for (const r of rows) {
      const unlocksAt = r.unlocksAt ? new Date(r.unlocksAt) : null;
      // A future unlock is shown, not hidden: "opens Tuesday" is the whole
      // point of a drip, and a module that simply vanishes teaches nothing.
      const pending = unlocksAt !== null && unlocksAt.getTime() > now;

      if (!byModule.has(r.moduleId)) {
        byModule.set(r.moduleId, {
          id: r.moduleId,
          title: r.moduleTitle,
          unlocksAt: pending ? unlocksAt.toISOString() : null,
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
        // RLS already withheld anything above this member's tier; what is left
        // to decide is whether their drip has reached it. A preview lesson
        // stays open, which is how a member sees what a course is before the
        // schedule starts.
        locked: pending && !(r.isPreview ?? false),
        completed: r.completed ?? false,
        lastPositionSeconds: r.lastPositionSeconds ?? 0,
      });
    }

    return { ...summary, summaryMd: null, modules: [...byModule.values()] };
  });
}

export async function getPlaybackTicket(env: Env, userId: string | null, lessonId: string): Promise<PlaybackTicket> {
  const expiresAt = new Date(Date.now() + TICKET_TTL_SECONDS * 1000).toISOString();
  const db = getDb(env);

  if (!db) {
    const lesson = seed.lessons.find((l) => l.id === lessonId);
    if (!lesson) throw new HttpError(404, 'Lesson not found');
    return { lessonId, url: seed.DEMO_HLS, kind: 'hls', expiresAt };
  }
  if (!userId) throw new HttpError(401, 'Not authenticated');

  return withUser(db, userId, async (tx) => {
    const [row] = await tx
      .select({
        id: lessons.id,
        isPreview: lessons.isPreview,
        videoProvider: lessons.videoProvider,
        videoAssetId: lessons.videoAssetId,
        videoStatus: lessons.videoStatus,
        unlocksAt: sql<string | null>`public.module_unlock_at(${lessons.moduleId}, ${userId}::uuid)`,
      })
      .from(lessons)
      .where(eq(lessons.id, lessonId))
      .limit(1);

    // RLS hides lessons above the member's tier, so "not found" is also the
    // answer for "not entitled" — deliberately indistinguishable.
    if (!row) throw new HttpError(404, 'Lesson not found');

    // The drip gate. This, not the syllabus rendering, is what actually holds:
    // the course page marks a lesson locked, and a member who guesses the URL
    // or calls the API directly gets refused here. A 403 rather than a 404,
    // because unlike tier the existence of the lesson is not a secret — the
    // member can see it in their own syllabus with the date on it.
    if (row.unlocksAt && !row.isPreview && new Date(row.unlocksAt).getTime() > Date.now()) {
      throw new HttpError(
        403,
        'This lesson has not opened yet',
        `It unlocks on ${new Date(row.unlocksAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}.`,
      );
    }
    if (row.videoStatus !== 'ready') throw new HttpError(409, 'Video is not ready', `Status: ${row.videoStatus}`);
    if (!row.videoAssetId) throw new HttpError(409, 'Lesson has no video');

    // With no provider and no storage there is nothing to sign, so a local
    // checkout falls back to a public test stream rather than erroring.
    if (env.VIDEO_PROVIDER === 'none' && !supabaseConfigured(env)) {
      return { lessonId, url: seed.DEMO_HLS, kind: 'hls' as const, expiresAt };
    }

    // Each provider signs its own short-lived URL behind the same interface,
    // which is what keeps the choice a pricing decision (PLAN §2).
    const source = await playbackFor(env, row.videoAssetId, TICKET_TTL_SECONDS);
    return { lessonId, ...source, expiresAt };
  });
}

/** Seed-mode progress so Mark complete and resume work without a database. */
export function saveSeedProgress(lessonId: string, positionSeconds: number, completed?: boolean) {
  const lesson = seed.lessons.find((l) => l.id === lessonId);
  if (!lesson) throw new HttpError(404, 'Lesson not found');

  const current = seed.progress.get(lessonId) ?? { completed: false, positionSeconds: 0 };
  seed.progress.set(lessonId, {
    completed: completed ?? current.completed,
    positionSeconds,
  });

  const siblings = seed.lessons.filter((l) => l.courseSlug === lesson.courseSlug);
  const done = siblings.filter((l) => seed.progress.get(l.id)?.completed).length;
  return {
    lessonId,
    completed: seed.progress.get(lessonId)!.completed,
    courseProgress: Math.round((done / siblings.length) * 100),
  };
}
