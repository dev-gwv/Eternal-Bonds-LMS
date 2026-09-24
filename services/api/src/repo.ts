import { and, asc, count, desc, eq, gte, lt, sql } from 'drizzle-orm';
import {
  channels,
  courses as coursesTable,
  createDb,
  enrollments,
  libraryCategories,
  libraryItems,
  lessonProgress,
  lessons,
  modules,
  postMedia,
  posts,
  users,
  withUser,
  workshopRegistrations,
  workshops as workshopsTable,
  type Db,
} from '@ipc/db';
import type {
  Channel,
  Course,
  LibraryCategory,
  Member,
  Post,
  Workshop,
} from '@ipc/contracts';
import type { Env } from './env.ts';
import { createStorage } from './lib/storage.ts';
import { supabaseConfigured } from './lib/supabase.ts';
import * as seed from './data/seed.ts';

/**
 * The only place that decides where data comes from.
 *
 * With DATABASE_URL set it reads Supabase Postgres through Drizzle, inside a
 * transaction that adopts the caller's identity so RLS applies. Without it the
 * API serves seed content, which is what makes `bun dev` work on a clean
 * checkout with no infrastructure.
 */

/**
 * One connection pool per `env` object, not one per process.
 *
 * This used to be a module-level `let db`, which is right on Bun and illegal on
 * Workers: a socket belongs to the request handler that opened it, and reusing
 * it from the next request throws
 *
 *   Cannot perform I/O on behalf of a different request.
 *
 * It only appears under concurrency, so single requests pass and a burst gives
 * intermittent 500s — the worst shape of bug to find in production.
 *
 * Keying the cache on the `Env` object fixes both runtimes without either one
 * knowing which it is:
 *
 *   - `server.ts` parses the environment once at boot and hands the *same*
 *     object to every request, so the pool lives as long as the process.
 *   - `worker.ts` parses the bindings inside `fetch`, so each request gets a
 *     fresh object, a fresh connection, and no sharing.
 *
 * A WeakMap so a finished request's entry can be collected with its env.
 */
const pools = new WeakMap<Env, Db>();

/**
 * True on Cloudflare Workers. The one runtime check in the codebase, and it
 * decides a pool size rather than a code path: per-request connections want
 * exactly one socket, a long-lived process wants several.
 */
const onWorkers = typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';

export function getDb(env: Env): Db | null {
  if (!env.DATABASE_URL) return null;

  const existing = pools.get(env);
  if (existing) return existing;

  const db = createDb(env.DATABASE_URL, {
    max: onWorkers ? 1 : env.NODE_ENV === 'production' ? 10 : 2,
  });
  pools.set(env, db);
  return db;
}

/**
 * Closes the connection opened for this request, if there was one.
 *
 * Called from the Workers entrypoint inside `waitUntil`. Without it an isolate
 * that serves many requests accumulates sockets until the pooler refuses new
 * ones. On Bun this is never called — the pool is meant to outlive the
 * request, which is the whole point of having one.
 */
export async function releaseDb(env: Env): Promise<void> {
  const db = pools.get(env);
  if (!db) return;
  pools.delete(env);
  // `$client` is the postgres.js handle Drizzle wraps.
  await (db as unknown as { $client: { end: (o?: { timeout?: number }) => Promise<void> } }).$client
    .end({ timeout: 5 })
    .catch(() => {
      /* The socket is going away with the request either way. */
    });
}

export const usingDatabase = (env: Env) => Boolean(env.DATABASE_URL);

const minutes = (seconds: number) => Math.round(seconds / 60);

export async function listCourses(env: Env, userId: string | null, status?: string): Promise<Course[]> {
  const handle = getDb(env);
  if (!handle) {
    return status && status !== 'all' ? seed.courses.filter((c) => c.status === status) : seed.courses;
  }

  return withUser(handle, userId, async (tx) => {
    const rows = await tx
      .select({
        id: coursesTable.id,
        slug: coursesTable.slug,
        title: coursesTable.title,
        category: coursesTable.category,
        level: coursesTable.level,
        language: coursesTable.language,
        minTier: coursesTable.minTier,
        lessonCount: sql<number>`(
          select count(*) from ${lessons}
          join ${modules} on ${modules.id} = ${lessons.moduleId}
          where ${modules.courseId} = ${coursesTable.id}
        )`,
        durationSeconds: sql<number>`(
          select coalesce(sum(${lessons.durationSeconds}), 0) from ${lessons}
          join ${modules} on ${modules.id} = ${lessons.moduleId}
          where ${modules.courseId} = ${coursesTable.id}
        )`,
        completedLessons: sql<number>`(
          select count(*) from ${lessonProgress}
          join ${lessons} on ${lessons.id} = ${lessonProgress.lessonId}
          join ${modules} on ${modules.id} = ${lessons.moduleId}
          where ${modules.courseId} = ${coursesTable.id}
            and ${lessonProgress.userId} = ${userId ?? null}::uuid
            and ${lessonProgress.isCompleted}
        )`,
        score: enrollments.score,
        certificateKey: enrollments.certificateKey,
        coverKey: coursesTable.coverKey,
        instructorName: coursesTable.instructorName,

      })
      .from(coursesTable)
      .leftJoin(
        enrollments,
        userId
          ? and(eq(enrollments.courseId, coursesTable.id), eq(enrollments.userId, userId))
          : sql`false`,
      )
      .where(eq(coursesTable.isPublished, true))
      .orderBy(asc(coursesTable.rank));

    // A certificate is a private object in storage, so the client cannot be
    // handed the key — it needs a signed URL. Signed only for the rows that
    // actually have one, which in practice is a handful per member.
    const certificates = new Map<string, string>();
    const covers = new Map<string, string>();
    if (supabaseConfigured(env)) {
      const storage = createStorage(env);
      const withCert = rows.filter((r) => r.certificateKey);
      await Promise.all(
        withCert.map(async (r) => {
          try {
            certificates.set(r.id, await storage.signedDownloadUrl(r.certificateKey!, 900));
          } catch {
            // A missing object must not take the whole course list down.
          }
        }),
      );
      // Covers get an hour rather than fifteen minutes: the course list sits
      // open, and a cover that 404s halfway through browsing looks broken in a
      // way a certificate link never does.
      const withCover = rows.filter((r) => r.coverKey);
      await Promise.all(
        withCover.map(async (r) => {
          try {
            covers.set(r.id, await storage.signedDownloadUrl(r.coverKey!, 3600));
          } catch {
            // Same: fall back to the gradient rather than failing the page.
          }
        }),
      );
    }

    const mapped = rows.map((r): Course => {
      const total = Number(r.lessonCount) || 0;
      const done = Number(r.completedLessons) || 0;
      const progress = total === 0 ? 0 : Math.round((done / total) * 100);
      return {
        id: r.id,
        slug: r.slug,
        title: r.title,
        category: r.category as Course['category'],
        level: r.level as Course['level'],
        language: r.language as Course['language'],
        lessonCount: total,
        durationMinutes: minutes(Number(r.durationSeconds) || 0),
        minTier: r.minTier,
        progress,
        status: progress === 100 ? 'completed' : progress > 0 ? 'ongoing' : 'not_started',
        score: r.score ?? null,
        // Was `certificateKey`, while the contract asked for `certificateUrl`.
        // Every course therefore failed validation in the browser and the
        // Courses page retried forever behind its skeletons. The double cast
        // that used to be here is what hid it from the compiler.
        certificateUrl: certificates.get(r.id) ?? null,
        coverUrl: covers.get(r.id) ?? null,
        instructorName: r.instructorName ?? null,
      } satisfies Course;
    });

    return status && status !== 'all' ? mapped.filter((c) => c.status === status) : mapped;
  });
}

export async function listWorkshops(env: Env, userId: string | null, scope: 'upcoming' | 'completed'): Promise<Workshop[]> {
  const handle = getDb(env);
  const now = new Date();

  if (!handle) {
    return seed.workshops
      .filter((w) => (scope === 'completed' ? new Date(w.endsAt) < now : new Date(w.endsAt) >= now))
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  }

  return withUser(handle, userId, async (tx) => {
    const rows = await tx
      .select({
        id: workshopsTable.id,
        title: workshopsTable.title,
        startsAt: workshopsTable.startsAt,
        endsAt: workshopsTable.endsAt,
        platform: workshopsTable.platform,
        recurring: workshopsTable.recurring,
        occurrenceIndex: workshopsTable.occurrenceIndex,
        occurrenceTotal: workshopsTable.occurrenceTotal,
        joinUrl: workshopsTable.joinUrl,
        registrationId: workshopRegistrations.id,
      })
      .from(workshopsTable)
      .leftJoin(
        workshopRegistrations,
        userId
          ? and(
              eq(workshopRegistrations.workshopId, workshopsTable.id),
              eq(workshopRegistrations.userId, userId),
            )
          : sql`false`,
      )
      .where(scope === 'completed' ? lt(workshopsTable.endsAt, now) : gte(workshopsTable.endsAt, now))
      .orderBy(scope === 'completed' ? desc(workshopsTable.startsAt) : asc(workshopsTable.startsAt));

    return rows.map((r): Workshop => ({
      id: r.id,
      title: r.title,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      platform: r.platform as Workshop['platform'],
      recurring: r.recurring,
      occurrence:
        r.occurrenceIndex && r.occurrenceTotal
          ? { index: r.occurrenceIndex, total: r.occurrenceTotal }
          : null,
      registered: Boolean(r.registrationId),
      // Only a registered member gets the join link.
      joinUrl: r.registrationId ? r.joinUrl : null,
    }));
  });
}

export async function listChannels(env: Env, userId: string | null): Promise<Channel[]> {
  const handle = getDb(env);
  if (!handle) return seed.channels;

  return withUser(handle, userId, async (tx) => {
    const rows = await tx
      .select({
        id: channels.id,
        slug: channels.slug,
        name: channels.name,
        // Derived per channel rather than stored: a counter column would need
        // incrementing for every member on every post, and would drift the
        // first time anything went wrong.
        unread: userId
          ? sql<number>`public.unread_count(${userId}::uuid, ${channels.id})`
          : sql<number>`0`,
      })
      .from(channels)
      .where(eq(channels.isArchived, false));
    return rows.map((r) => ({ ...r, unread: Number(r.unread) || 0 }));
  });
}

export async function listPosts(env: Env, userId: string | null, channelSlug?: string): Promise<Post[]> {
  const handle = getDb(env);
  if (!handle) return channelSlug ? seed.posts.filter((p) => p.channelSlug === channelSlug) : seed.posts;

  return withUser(handle, userId, async (tx) => {
    const rows = await tx
      .select({
        id: posts.id,
        bodyMd: posts.bodyMd,
        likesCount: posts.likesCount,
        commentsCount: posts.commentsCount,
        viewsCount: posts.viewsCount,
        createdAt: posts.createdAt,
        channelSlug: channels.slug,
        authorName: users.fullName,
        authorTier: sql<string>`public.current_tier(${posts.authorId})`,
        // Asked once for the whole page rather than per post: a correlated
        // exists() here is one query, a per-post check is one plus N.
        likedByMe: userId
          ? sql<boolean>`exists (
              select 1 from post_likes pl where pl.post_id = posts.id and pl.user_id = ${userId}::uuid
            )`
          : sql<boolean>`false`,
      })
      .from(posts)
      .innerJoin(channels, eq(channels.id, posts.channelId))
      .innerJoin(users, eq(users.id, posts.authorId))
      .where(channelSlug ? eq(channels.slug, channelSlug) : undefined)
      .orderBy(desc(posts.createdAt))
      .limit(50);

    // One query for the whole page's attachments, then one signing round per
    // image. `mediaCount` used to be hardcoded to zero, which meant a member
    // could upload a photo and nobody — including them — would ever see it.
    const media = rows.length
      ? await tx
          .select()
          .from(postMedia)
          .where(sql`${postMedia.postId} in (${sql.join(rows.map((r) => sql`${r.id}::uuid`), sql`, `)})`)
          .orderBy(asc(postMedia.rank), asc(postMedia.id))
      : [];

    const storage = createStorage(env);
    // Signed for an hour rather than the 15-minute default: a feed sits open
    // on a phone, and a link that expires mid-scroll shows a broken image.
    const signed = new Map<string, string>();
    await Promise.all(
      media.map(async (m) => {
        try {
          signed.set(m.id, await storage.signedDownloadUrl(m.storageKey, 3600));
        } catch {
          // A missing object must not take the whole feed down with it.
        }
      }),
    );

    return rows.map((r): Post => {
      const mine = media.filter((m) => m.postId === r.id && signed.has(m.id));
      return {
      id: r.id,
      channelSlug: r.channelSlug,
      author: {
        name: r.authorName,
        initials: r.authorName.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase(),
        tier: (r.authorTier ?? 'free') as Post['author']['tier'],
      },
      bodyMd: r.bodyMd,
      mediaCount: mine.length,
      media: mine.map((m) => ({
        id: m.id,
        url: signed.get(m.id)!,
        mime: m.mime,
        width: m.width ?? null,
        height: m.height ?? null,
      })),
      likes: r.likesCount,
      likedByMe: Boolean(r.likedByMe),
      comments: r.commentsCount,
      views: r.viewsCount,
      createdAt: r.createdAt.toISOString(),
      teamReply: null,
      };
    });
  });
}

export async function listLibraryCategories(env: Env, userId: string | null): Promise<LibraryCategory[]> {
  const handle = getDb(env);
  if (!handle) return seed.libraryCategories;

  return withUser(handle, userId, async (tx) => {
    const rows = await tx
      .select({
        id: libraryCategories.id,
        slug: libraryCategories.slug,
        name: libraryCategories.name,
        blurb: libraryCategories.blurb,
        unit: libraryCategories.unit,
        itemCount: sql<number>`(select count(*) from ${libraryItems} where ${libraryItems.categoryId} = ${libraryCategories.id})`,
      })
      .from(libraryCategories)
      .orderBy(asc(libraryCategories.rank));

    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      blurb: r.blurb ?? '',
      itemCount: Number(r.itemCount) || 0,
      unit: r.unit as LibraryCategory['unit'],
    }));
  });
}

export async function getMember(env: Env, userId: string | null): Promise<Member | null> {
  const handle = getDb(env);
  if (!handle) return seed.member;
  if (!userId) return null;

  return withUser(handle, userId, async (tx) => {
    const [row] = await tx
      .select({
        id: users.id,
        memberCode: users.memberCode,
        fullName: users.fullName,
        email: users.email,
        phone: users.phone,
        city: users.city,
        isSuspended: users.isSuspended,
        createdAt: users.createdAt,
        avatarKey: users.avatarUrl,
        tier: sql<string>`public.current_tier(${users.id})`,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) return null;

    // The column holds a storage key, not a URL — the bucket is private, so
    // the link is minted per request like every other file in the app. A
    // missing object must not take the profile down with it.
    let avatarUrl: string | null = null;
    if (row.avatarKey) {
      try {
        avatarUrl = await createStorage(env).signedDownloadUrl(row.avatarKey, 6 * 3600);
      } catch {
        avatarUrl = null;
      }
    }

    return {
      id: row.id,
      memberCode: row.memberCode,
      fullName: row.fullName,
      avatarUrl,
      initialsOnly: !avatarUrl,
      initials: row.fullName.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase(),
      tier: (row.tier ?? 'free') as Member['tier'],
      active: !row.isSuspended,
      joinedAt: row.createdAt.toISOString(),
      email: row.email ?? '',
      phone: row.phone ?? '',
      city: row.city ?? '',
      socials: [],
    } satisfies Member;
  });
}

export async function countRows(env: Env): Promise<{ courses: number } | null> {
  const handle = getDb(env);
  if (!handle) return null;
  const [row] = await handle.select({ value: count() }).from(coursesTable);
  return { courses: Number(row?.value ?? 0) };
}
