import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { AttachMedia, CreateComment, CreatePost } from '@ipc/contracts';
import type { AppEnv } from '../context.ts';
import { getLeaderboard } from '../rollups.ts';
import { problem } from '../lib/problem.ts';
import { requireAuth } from '../middleware/auth.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { listChannels, listPosts } from '../repo.ts';
import { createPost } from '../writes.ts';
import {
  createComment,
  markChannelRead,
  recordPostViews,
  deleteComment,
  editComment,
  listComments,
  setCommentLike,
  setPostLike,
} from '../engagement.ts';

/** Shared by both media routes: what we accept, and how it is named on disk. */
const MediaMime = z.enum(['image/jpeg', 'image/png', 'image/webp']);
const EXT: Record<z.infer<typeof MediaMime>, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const communityRoutes = new Hono<AppEnv>()
  .get('/channels', async (c) => c.json({ items: await listChannels(c.env, c.get('userId')) }))
  // Opening a channel is what marks it read. A separate "mark as read" button
  // would be one more thing to click for something the member already did.
  .post('/channels/:slug/read', requireAuth, async (c) => {
    await markChannelRead(c.env, c.get('userId'), c.req.param('slug'));
    return c.body(null, 204);
  })
  // Reported in batches as posts scroll into view. Fire-and-forget by design:
  // a failed view count must never surface as an error over the feed.
  .post(
    '/posts/views',
    requireAuth,
    zValidator('json', z.object({ postIds: z.array(z.uuid()).min(1).max(50) }), (result, c) =>
      result.success ? undefined : problem(c, 422, 'Invalid post ids'),
    ),
    async (c) => {
      await recordPostViews(c.env, c.get('userId'), c.req.valid('json').postIds);
      return c.body(null, 204);
    },
  )
  .get('/posts', async (c) => {
    const items = await listPosts(c.env, c.get('userId'), c.req.query('channel'));
    return c.json({ items });
  })
  .post(
    '/posts',
    requireAuth,
    rateLimit({ name: 'post', limit: 10, windowSeconds: 300 }),
    zValidator('json', CreatePost, (result, c) =>
      result.success
        ? undefined
        : problem(c, 422, 'Invalid post', result.error.issues[0]?.message, {
            errors: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          }),
    ),
    async (c) => {
      const post = await createPost(c.env, c.get('userId'), c.req.valid('json'));
      return c.json(post, 201);
    },
  )
  /* ── Likes ────────────────────────────────────────────────────────────────
     POST to like, DELETE to unlike. Both are idempotent: a double-tap or a
     retried request lands on the same state rather than toggling twice. */
  .post('/posts/:id/like', requireAuth, async (c) =>
    c.json(await setPostLike(c.env, c.get('userId'), c.req.param('id'), true)),
  )
  .delete('/posts/:id/like', requireAuth, async (c) =>
    c.json(await setPostLike(c.env, c.get('userId'), c.req.param('id'), false)),
  )
  .post('/comments/:id/like', requireAuth, async (c) =>
    c.json(await setCommentLike(c.env, c.get('userId'), c.req.param('id'), true)),
  )
  .delete('/comments/:id/like', requireAuth, async (c) =>
    c.json(await setCommentLike(c.env, c.get('userId'), c.req.param('id'), false)),
  )

  /* ── Comments ─────────────────────────────────────────────────────────── */
  .get('/posts/:id/comments', async (c) =>
    c.json({ items: await listComments(c.env, c.get('userId'), c.req.param('id')) }),
  )
  .post(
    '/posts/:id/comments',
    requireAuth,
    rateLimit({ name: 'comment', limit: 30, windowSeconds: 300 }),
    zValidator('json', CreateComment, (result, c) =>
      result.success ? undefined : problem(c, 422, 'Invalid comment', result.error.issues[0]?.message),
    ),
    async (c) => c.json(await createComment(c.env, c.get('userId'), c.req.param('id'), c.req.valid('json')), 201),
  )
  .patch(
    '/comments/:id',
    requireAuth,
    zValidator('json', z.object({ bodyMd: z.string().trim().min(1).max(2000) }), (result, c) =>
      result.success ? undefined : problem(c, 422, 'Invalid comment', result.error.issues[0]?.message),
    ),
    async (c) => c.json(await editComment(c.env, c.get('userId'), c.req.param('id'), c.req.valid('json').bodyMd)),
  )
  .delete('/comments/:id', requireAuth, async (c) => {
    await deleteComment(c.env, c.get('userId'), c.req.param('id'));
    return c.body(null, 204);
  })

  // XP totals come from member_stats, which the worker rebuilds from
  // activity_events. Without a database this falls back to seed content.
  .get('/leaderboard', async (c) => c.json({ items: await getLeaderboard(c.env, c.get('userId')) }))
  /* ── Post media ───────────────────────────────────────────────────────────
     The browser uploads straight at storage and only then tells us the key.
     Two rules make that safe: the ticket is minted per post, and RLS on
     post_media rejects the insert unless the caller owns the post — so a
     stolen key still cannot be attached to somebody else's photo. */
  .post(
    '/posts/:id/media-ticket',
    requireAuth,
    rateLimit({ name: 'media', limit: 60, windowSeconds: 3600 }),
    zValidator('json', z.object({ mime: MediaMime }), (result, c) =>
      result.success ? undefined : problem(c, 422, 'Only JPEG, PNG or WebP images'),
    ),
    async (c) => {
      const { createStorage } = await import('../lib/storage.ts');
      // Extension follows the declared type. Storing a PNG under .jpg works
      // but makes every downloaded file lie about itself.
      const ext = EXT[c.req.valid('json').mime];
      const key = `posts/${c.req.param('id')}/${crypto.randomUUID()}.${ext}`;
      const { url, token } = await createStorage(c.env).signedUploadUrl(key);
      return c.json({ key, url, token, method: 'PUT' as const });
    },
  )
  .post(
    '/posts/:id/media',
    requireAuth,
    zValidator('json', AttachMedia, (result, c) =>
      result.success ? undefined : problem(c, 422, 'Invalid image', result.error.issues[0]?.message),
    ),
    async (c) => {
      const { postMedia, withUser } = await import('@ipc/db');
      const { getDb } = await import('../repo.ts');
      const { HttpError } = await import('../lib/problem.ts');
      const db = getDb(c.env);
      if (!db) throw new HttpError(503, 'Needs a database');
      const postId = c.req.param('id');
      const body = c.req.valid('json');
      // The key must sit under this post's prefix. Without the check a member
      // could attach any object in the bucket — including another member's.
      if (!body.key.startsWith(`posts/${postId}/`)) {
        throw new HttpError(422, 'That file does not belong to this post');
      }
      return withUser(db, c.get('userId'), async (tx) => {
        const row = (
          await tx
            .insert(postMedia)
            .values({
              postId,
              storageKey: body.key,
              mime: body.mime,
              width: body.width,
              height: body.height,
            })
            .returning()
        )[0]!;
        const { createStorage } = await import('../lib/storage.ts');
        return c.json(
          {
            id: row.id,
            url: await createStorage(c.env).signedDownloadUrl(row.storageKey, 3600),
            mime: row.mime,
            width: row.width ?? null,
            height: row.height ?? null,
          },
          201,
        );
      });
    },
  );
