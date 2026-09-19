import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  activityEvents,
  channels,
  commentLikes,
  notifications,
  postComments,
  postLikes,
  posts,
  users,
  withUser,
} from '@ipc/db';
import type { Comment, CreateComment, LikeState } from '@ipc/contracts';
import type { Env } from './env.ts';
import { HttpError } from './lib/problem.ts';
import { getDb } from './repo.ts';

/**
 * Likes and comments.
 *
 * The counters on `posts` are maintained by database triggers, not from here.
 * Two people liking the same post in the same millisecond is the normal case,
 * and `count + 1` read-modify-written from application code loses one of them.
 * These functions insert and delete rows; Postgres keeps the arithmetic right.
 *
 * Notifications are emitted by triggers on these tables, not from here. The
 * outbox is service-role-only — an insert policy on it would let any member
 * forge a `course.published` through PostgREST and notify the whole club — and
 * a trigger also means the event cannot exist without the change, or the
 * change without the event.
 */

const initials = (name: string) =>
  name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();

function requireDb(env: Env) {
  const db = getDb(env);
  // No seed branch: likes and comments are about other people, and a fake one
  // that only exists in this process's memory would be a lie about a person.
  if (!db) throw new HttpError(503, 'This needs a database', 'Set DATABASE_URL to post and react.');
  return db;
}

/* ── Likes ─────────────────────────────────────────────────────────────────*/

export async function setPostLike(
  env: Env,
  userId: string | null,
  postId: string,
  liked: boolean,
): Promise<LikeState> {
  const db = requireDb(env);
  if (!userId) throw new HttpError(401, 'Not authenticated');

  return withUser(db, userId, async (tx) => {
    if (liked) {
      // A double-tap is one like. The primary key already guarantees it; this
      // turns the second attempt into a no-op instead of a 500.
      //
      // The notification is emitted by a database trigger, not from here —
      // `outbox` is service-role-only, and an insert policy on it would let a
      // member forge events through PostgREST.
      await tx.insert(postLikes).values({ postId, userId }).onConflictDoNothing();
    } else {
      await tx.delete(postLikes).where(and(eq(postLikes.postId, postId), eq(postLikes.userId, userId)));
    }

    const [row] = await tx.select({ likes: posts.likesCount }).from(posts).where(eq(posts.id, postId)).limit(1);
    // RLS hides posts in channels above the member's tier, so a missing row is
    // also the answer for "not allowed" — deliberately indistinguishable.
    if (!row) throw new HttpError(404, 'Post not found');

    return { liked, likes: row.likes };
  });
}

export async function setCommentLike(
  env: Env,
  userId: string | null,
  commentId: string,
  liked: boolean,
): Promise<LikeState> {
  const db = requireDb(env);
  if (!userId) throw new HttpError(401, 'Not authenticated');

  return withUser(db, userId, async (tx) => {
    if (liked) {
      await tx.insert(commentLikes).values({ commentId, userId }).onConflictDoNothing();
    } else {
      await tx
        .delete(commentLikes)
        .where(and(eq(commentLikes.commentId, commentId), eq(commentLikes.userId, userId)));
    }

    const [row] = await tx
      .select({ likes: postComments.likesCount })
      .from(postComments)
      .where(eq(postComments.id, commentId))
      .limit(1);
    if (!row) throw new HttpError(404, 'Comment not found');

    return { liked, likes: row.likes };
  });
}

/* ── Comments ──────────────────────────────────────────────────────────────*/

const DELETED_BODY = '[deleted]';

/**
 * The whole thread for one post, nested one level.
 *
 * Fetched flat and assembled here rather than with a recursive CTE: the depth
 * is fixed at one, so recursion would be machinery for a shape that cannot
 * occur.
 */
export async function listComments(env: Env, userId: string | null, postId: string): Promise<Comment[]> {
  const db = requireDb(env);

  return withUser(db, userId, async (tx) => {
    const rows = await tx
      .select({
        id: postComments.id,
        postId: postComments.postId,
        parentId: postComments.parentId,
        bodyMd: postComments.bodyMd,
        likes: postComments.likesCount,
        deletedAt: postComments.deletedAt,
        createdAt: postComments.createdAt,
        editedAt: postComments.editedAt,
        authorId: users.id,
        authorName: users.fullName,
        authorTier: sql<string>`public.current_tier(${users.id})`,
        likedByMe: userId
          ? sql<boolean>`exists (
              select 1 from comment_likes cl
              where cl.comment_id = post_comments.id and cl.user_id = ${userId}::uuid
            )`
          : sql<boolean>`false`,
      })
      .from(postComments)
      .innerJoin(users, eq(users.id, postComments.authorId))
      .where(eq(postComments.postId, postId))
      .orderBy(asc(postComments.createdAt));

    const toComment = (r: (typeof rows)[number]): Comment => ({
      id: r.id,
      postId: r.postId,
      parentId: r.parentId,
      author: {
        id: r.authorId,
        name: r.authorName,
        initials: initials(r.authorName),
        tier: (r.authorTier ?? 'free') as Comment['author']['tier'],
      },
      // The body is replaced on read, not destroyed on write: the row has to
      // stay so replies keep the comment they were answering.
      bodyMd: r.deletedAt ? DELETED_BODY : r.bodyMd,
      likes: r.likes,
      likedByMe: Boolean(r.likedByMe),
      deleted: Boolean(r.deletedAt),
      mine: r.authorId === userId,
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt?.toISOString() ?? null,
      replies: [],
    });

    const byId = new Map<string, Comment>();
    const roots: Comment[] = [];
    for (const r of rows) byId.set(r.id, toComment(r));
    for (const comment of byId.values()) {
      const parent = comment.parentId ? byId.get(comment.parentId) : undefined;
      // A reply whose parent is invisible would otherwise vanish entirely;
      // promoting it to a root is better than losing it.
      if (parent) parent.replies.push(comment);
      else roots.push(comment);
    }
    return roots;
  });
}

export async function createComment(
  env: Env,
  userId: string | null,
  postId: string,
  input: CreateComment,
): Promise<Comment> {
  const db = requireDb(env);
  if (!userId) throw new HttpError(401, 'Not authenticated');

  return withUser(db, userId, async (tx) => {
    const [post] = await tx
      .select({ id: posts.id, authorId: posts.authorId, channelSlug: channels.slug })
      .from(posts)
      .innerJoin(channels, eq(channels.id, posts.channelId))
      .where(eq(posts.id, postId))
      .limit(1);
    if (!post) throw new HttpError(404, 'Post not found');

    let parentId = input.parentId;
    if (parentId) {
      const [parent] = await tx
        .select({ id: postComments.id, parentId: postComments.parentId, authorId: postComments.authorId })
        .from(postComments)
        .where(and(eq(postComments.id, parentId), eq(postComments.postId, postId)))
        .limit(1);
      if (!parent) throw new HttpError(404, 'That comment is not on this post');
      // One level only: a reply to a reply attaches to the same root, so the
      // thread cannot grow a third column nobody can read on a phone.
      parentId = parent.parentId ?? parent.id;
    }

    const [row] = await tx
      .insert(postComments)
      .values({ postId, authorId: userId, parentId, bodyMd: input.bodyMd })
      .returning();
    if (!row) throw new HttpError(500, 'Could not save the comment');

    const [author] = await tx
      .select({ fullName: users.fullName, tier: sql<string>`public.current_tier(${users.id})` })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    // Same transaction as the comment: the XP and the event cannot drift from
    // the thing they describe.
    await tx.insert(activityEvents).values({
      userId,
      kind: 'comment.created',
      payload: { postId, commentId: row.id, channel: post.channelSlug },
      xp: 10,
    });

    // The reply notification comes from a trigger on post_comments, for the
    // same reason the like one does.

    return {
      id: row.id,
      postId: row.postId,
      parentId: row.parentId,
      author: {
        id: userId,
        name: author?.fullName ?? 'Member',
        initials: initials(author?.fullName ?? 'Member'),
        tier: (author?.tier ?? 'free') as Comment['author']['tier'],
      },
      bodyMd: row.bodyMd,
      likes: 0,
      likedByMe: false,
      deleted: false,
      mine: true,
      createdAt: row.createdAt.toISOString(),
      editedAt: null,
      replies: [],
    };
  });
}

export async function editComment(
  env: Env,
  userId: string | null,
  commentId: string,
  bodyMd: string,
): Promise<{ id: string; bodyMd: string; editedAt: string }> {
  const db = requireDb(env);
  if (!userId) throw new HttpError(401, 'Not authenticated');

  return withUser(db, userId, async (tx) => {
    const [row] = await tx
      .update(postComments)
      .set({ bodyMd, editedAt: new Date() })
      // RLS already restricts this to the author or an admin; the extra
      // predicate stops an admin silently editing words into someone's mouth.
      .where(and(eq(postComments.id, commentId), eq(postComments.authorId, userId)))
      .returning();
    if (!row) throw new HttpError(404, 'Comment not found');
    return { id: row.id, bodyMd: row.bodyMd, editedAt: row.editedAt!.toISOString() };
  });
}

/**
 * Soft delete.
 *
 * A hard delete would cascade away the replies, which belong to other people.
 * The row stays, the body stops being shown, and the trigger decrements the
 * post's counter so it matches what is actually visible.
 */
export async function deleteComment(env: Env, userId: string | null, commentId: string): Promise<void> {
  const db = requireDb(env);
  if (!userId) throw new HttpError(401, 'Not authenticated');

  await withUser(db, userId, async (tx) => {
    const [row] = await tx
      .update(postComments)
      .set({ deletedAt: new Date() })
      .where(and(eq(postComments.id, commentId), sql`${postComments.deletedAt} is null`))
      .returning({ id: postComments.id });
    if (!row) throw new HttpError(404, 'Comment not found');
  });
}

/* ── Which posts has this member liked? ────────────────────────────────────
   Asked once for a page of posts rather than per post, so the feed is one
   query and not one plus N. */

export async function likedPostIds(env: Env, userId: string | null, ids: string[]): Promise<Set<string>> {
  if (!userId || ids.length === 0) return new Set();
  const db = getDb(env);
  if (!db) return new Set();

  const rows = await withUser(db, userId, (tx) =>
    tx
      .select({ postId: postLikes.postId })
      .from(postLikes)
      // inArray rather than `= any($1::uuid[])`: Drizzle binds a JS array as
      // a single parameter, which Postgres reads as a malformed literal.
      .where(and(eq(postLikes.userId, userId), inArray(postLikes.postId, ids))),
  );
  return new Set(rows.map((r) => r.postId));
}

/**
 * Marks a channel read, up to this instant.
 *
 * Goes through the SQL function so the timestamp is the database's clock. A
 * client with a skewed clock could otherwise mark a channel read into the
 * future and never see a badge again — a bug that would look like the feature
 * simply not working, and would be almost impossible to reproduce.
 */
export async function markChannelRead(env: Env, userId: string | null, slug: string): Promise<void> {
  const db = requireDb(env);
  if (!userId) throw new HttpError(401, 'Not authenticated');

  await withUser(db, userId, async (tx) => {
    const [channel] = await tx
      .select({ id: channels.id })
      .from(channels)
      .where(eq(channels.slug, slug))
      .limit(1);
    // RLS hides channels above the member's tier, so a missing row is also the
    // answer for "not allowed".
    if (!channel) throw new HttpError(404, 'Channel not found');
    await tx.execute(sql`select public.mark_channel_read(${channel.id}::uuid)`);
  });
}

/* ── Notifications ─────────────────────────────────────────────────────────*/

export async function listNotifications(env: Env, userId: string | null, limit = 30) {
  const db = requireDb(env);
  if (!userId) throw new HttpError(401, 'Not authenticated');

  return withUser(db, userId, async (tx) => {
    const rows = await tx
      .select({
        id: notifications.id,
        kind: notifications.kind,
        title: notifications.title,
        body: notifications.body,
        link: notifications.link,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(sql`${notifications.createdAt} desc`)
      .limit(limit);

    const [unread] = await tx
      .select({ n: sql<number>`count(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), sql`${notifications.readAt} is null`));

    return {
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        body: r.body,
        link: r.link,
        read: r.readAt !== null,
        createdAt: r.createdAt.toISOString(),
      })),
      unread: Number(unread?.n ?? 0),
    };
  });
}

/** Marks one, or all of them. Marking an already-read one is a no-op. */
export async function markNotificationsRead(
  env: Env,
  userId: string | null,
  id: string | null,
): Promise<{ unread: number }> {
  const db = requireDb(env);
  if (!userId) throw new HttpError(401, 'Not authenticated');

  return withUser(db, userId, async (tx) => {
    await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, userId),
          sql`${notifications.readAt} is null`,
          id ? eq(notifications.id, id) : sql`true`,
        ),
      );

    const [unread] = await tx
      .select({ n: sql<number>`count(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), sql`${notifications.readAt} is null`));
    return { unread: Number(unread?.n ?? 0) };
  });
}
