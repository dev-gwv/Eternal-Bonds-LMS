import { and, eq, sql } from 'drizzle-orm';
import {
  activityEvents,
  channels,
  enrollments,
  lessonProgress,
  lessons,
  modules,
  posts,
  users,
  withUser,
  workshopRegistrations,
} from '@ipc/db';
import type { CreatePost, DeletionState, Post, ProgressUpdate } from '@ipc/contracts';
import type { Env } from './env.ts';
import { HttpError } from './lib/problem.ts';
import { saveSeedProgress } from './lessons.ts';
import { getDb } from './repo.ts';
import * as seed from './data/seed.ts';

/**
 * Mutations. Each one either writes to Supabase Postgres under RLS, or mutates
 * the in-memory seed so the UI is exercisable end to end without a database.
 *
 * The seed branch is development scaffolding, not a second implementation of
 * the rules — `/health` reports which branch is live.
 */

const initials = (name: string) =>
  name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();

export async function createPost(env: Env, userId: string | null, input: CreatePost): Promise<Post> {
  const db = getDb(env);

  if (!db) {
    const post: Post = {
      id: crypto.randomUUID(),
      channelSlug: input.channelSlug,
      author: { name: seed.member.fullName, initials: seed.member.initials, tier: seed.member.tier },
      bodyMd: input.bodyMd,
      mediaCount: 0,
      likes: 0,
      likedByMe: false,
      comments: 0,
      views: 0,
      createdAt: new Date().toISOString(),
      teamReply: null,
    };
    seed.posts.unshift(post);
    return post;
  }

  if (!userId) throw new HttpError(401, 'Not authenticated');

  return withUser(db, userId, async (tx) => {
    const [channel] = await tx
      .select({ id: channels.id, slug: channels.slug })
      .from(channels)
      .where(eq(channels.slug, input.channelSlug))
      .limit(1);
    // RLS hides channels above the member's tier, so "not found" is also the
    // answer for "not allowed" — deliberately indistinguishable.
    if (!channel) throw new HttpError(404, 'Channel not found');

    const [row] = await tx
      .insert(posts)
      .values({ channelId: channel.id, authorId: userId, bodyMd: input.bodyMd })
      .returning();
    if (!row) throw new HttpError(500, 'Could not create post');

    const [author] = await tx
      .select({ fullName: users.fullName, tier: sql<string>`public.current_tier(${users.id})` })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    // The XP event is the member's own row, so it is written here. The outbox
    // entry is emitted by a trigger on `posts` — that table is service-role
    // only, and this transaction runs as the member.
    await tx.insert(activityEvents).values({
      userId,
      kind: 'post.created',
      payload: { postId: row.id, channel: channel.slug },
      xp: 25,
    });

    return {
      id: row.id,
      channelSlug: channel.slug,
      author: {
        name: author?.fullName ?? 'Member',
        initials: initials(author?.fullName ?? 'Member'),
        tier: (author?.tier ?? 'free') as Post['author']['tier'],
      },
      bodyMd: row.bodyMd,
      mediaCount: 0,
      likes: row.likesCount,
      likedByMe: false,
      comments: row.commentsCount,
      views: row.viewsCount,
      createdAt: row.createdAt.toISOString(),
      teamReply: null,
    } satisfies Post;
  });
}

export async function setWorkshopRegistration(
  env: Env,
  userId: string | null,
  workshopId: string,
  registered: boolean,
): Promise<{ registered: boolean }> {
  const db = getDb(env);

  if (!db) {
    const workshop = seed.workshops.find((w) => w.id === workshopId);
    if (!workshop) throw new HttpError(404, 'Workshop not found');
    workshop.registered = registered;
    workshop.joinUrl = registered ? (workshop.joinUrl ?? 'https://zoom.example/ipc-session') : null;
    return { registered };
  }

  if (!userId) throw new HttpError(401, 'Not authenticated');

  return withUser(db, userId, async (tx) => {
    if (registered) {
      await tx
        .insert(workshopRegistrations)
        .values({ workshopId, userId })
        .onConflictDoNothing();
      await tx.insert(activityEvents).values({
        userId,
        kind: 'workshop.registered',
        payload: { workshopId },
        xp: 10,
      });
    } else {
      await tx
        .delete(workshopRegistrations)
        .where(and(eq(workshopRegistrations.workshopId, workshopId), eq(workshopRegistrations.userId, userId)));
    }
    return { registered };
  });
}

export async function saveProgress(
  env: Env,
  userId: string | null,
  lessonId: string,
  input: ProgressUpdate,
): Promise<{ lessonId: string; completed: boolean; courseProgress: number }> {
  const db = getDb(env);

  if (!db) return saveSeedProgress(lessonId, input.positionSeconds, input.completed);
  if (!userId) throw new HttpError(401, 'Not authenticated');

  return withUser(db, userId, async (tx) => {
    const now = new Date();
    await tx
      .insert(lessonProgress)
      .values({
        userId,
        lessonId,
        lastPositionSeconds: input.positionSeconds,
        watchSeconds: input.watchedSeconds,
        isCompleted: input.completed ?? false,
        firstStartedAt: now,
        completedAt: input.completed ? now : null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [lessonProgress.userId, lessonProgress.lessonId],
        set: {
          lastPositionSeconds: input.positionSeconds,
          watchSeconds: sql`${lessonProgress.watchSeconds} + ${input.watchedSeconds}`,
          isCompleted: sql`${lessonProgress.isCompleted} or ${input.completed ?? false}`,
          completedAt: input.completed ? now : sql`${lessonProgress.completedAt}`,
          updatedAt: now,
        },
      });

    const [course] = await tx
      .select({ courseId: modules.courseId })
      .from(lessons)
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .where(eq(lessons.id, lessonId))
      .limit(1);
    if (!course) throw new HttpError(404, 'Lesson not found');

    const [totals] = await tx
      .select({
        total: sql<number>`count(*)`,
        done: sql<number>`count(*) filter (where ${lessonProgress.isCompleted})`,
      })
      .from(lessons)
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .leftJoin(
        lessonProgress,
        and(eq(lessonProgress.lessonId, lessons.id), eq(lessonProgress.userId, userId)),
      )
      .where(eq(modules.courseId, course.courseId));

    const total = Number(totals?.total ?? 0);
    const done = Number(totals?.done ?? 0);
    const courseProgress = total === 0 ? 0 : Math.round((done / total) * 100);

    await tx
      .insert(enrollments)
      .values({
        userId,
        courseId: course.courseId,
        lastLessonId: lessonId,
        completedAt: courseProgress === 100 ? now : null,
      })
      .onConflictDoUpdate({
        target: [enrollments.userId, enrollments.courseId],
        set: { lastLessonId: lessonId, completedAt: courseProgress === 100 ? now : null },
      });

    if (input.completed) {
      await tx.insert(activityEvents).values({
        userId,
        kind: 'lesson.completed',
        payload: { lessonId, courseId: course.courseId },
        xp: 50,
        minutes: Math.round(input.watchedSeconds / 60),
      });
    } else if (input.watchedSeconds > 0) {
      // Heartbeat, not just finish line: the chart, the 30-day headline and
      // the streak all read `minutes` from activity_events, and a member who
      // watches 40 minutes without completing would otherwise record zero.
      // Writes already arrive debounced (~15s), so this is ~4 rows/minute per
      // active viewer — trivial for an append-only table.
      await tx.insert(activityEvents).values({
        userId,
        kind: 'lesson.progress',
        payload: { lessonId, courseId: course.courseId },
        xp: 0,
        minutes: Math.max(1, Math.round(input.watchedSeconds / 60)),
      });
    }

    return { lessonId, completed: input.completed ?? false, courseProgress };
  });
}

/* ── Account deletion ──────────────────────────────────────────────────────
   Apple 5.1.1(v) requires an in-app path; DPDP requires erasure. Neither
   requires destroying the community's threads, so this soft-deletes with a
   30-day grace period and the purge job anonymises authored content. */

const GRACE_DAYS = 30;
const seedDeletion: { purgeAt: string | null } = { purgeAt: null };

export async function scheduleDeletion(env: Env, userId: string | null, reason?: string): Promise<DeletionState> {
  const purgeAt = new Date(Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const db = getDb(env);

  if (!db) {
    seedDeletion.purgeAt = purgeAt;
    return { scheduled: true, purgeAt };
  }
  if (!userId) throw new HttpError(401, 'Not authenticated');

  return withUser(db, userId, async (tx) => {
    await tx.update(users).set({ isSuspended: true }).where(eq(users.id, userId));
    await tx.insert(activityEvents).values({
      userId,
      kind: 'account.deletion_scheduled',
      payload: { purgeAt, reason: reason ?? null },
    });
    // The worker performs the purge; doing it here would block the request and
    // leave no window to cancel.
    return { scheduled: true, purgeAt };
  });
}

export async function cancelDeletion(env: Env, userId: string | null): Promise<DeletionState> {
  const db = getDb(env);

  if (!db) {
    seedDeletion.purgeAt = null;
    return { scheduled: false, purgeAt: null };
  }
  if (!userId) throw new HttpError(401, 'Not authenticated');

  return withUser(db, userId, async (tx) => {
    await tx.update(users).set({ isSuspended: false }).where(eq(users.id, userId));
    return { scheduled: false, purgeAt: null };
  });
}

export function deletionState(env: Env): DeletionState {
  if (!getDb(env)) return { scheduled: Boolean(seedDeletion.purgeAt), purgeAt: seedDeletion.purgeAt };
  // With a database the state lives on the user row; read it in the route.
  return { scheduled: false, purgeAt: null };
}

/** Everything the member has given us, as one JSON document. DPDP portability. */
export async function exportAccount(env: Env, userId: string | null) {
  const db = getDb(env);
  const generatedAt = new Date().toISOString();

  if (!db) {
    return {
      generatedAt,
      profile: seed.member,
      posts: seed.posts.filter((p) => p.author.name === seed.member.fullName),
      courses: seed.courses,
      workshops: seed.workshops.filter((w) => w.registered),
    };
  }
  if (!userId) throw new HttpError(401, 'Not authenticated');

  return withUser(db, userId, async (tx) => {
    const [profile] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    const authored = await tx.select().from(posts).where(eq(posts.authorId, userId));
    const progress = await tx.select().from(lessonProgress).where(eq(lessonProgress.userId, userId));
    const registrations = await tx
      .select()
      .from(workshopRegistrations)
      .where(eq(workshopRegistrations.userId, userId));
    const events = await tx.select().from(activityEvents).where(eq(activityEvents.userId, userId));
    return { generatedAt, profile, posts: authored, progress, registrations, events };
  });
}
