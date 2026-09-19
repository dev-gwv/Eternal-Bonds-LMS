import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { CreateComment, CreatePost } from '@ipc/contracts';
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
  deleteComment,
  editComment,
  listComments,
  setCommentLike,
  setPostLike,
} from '../engagement.ts';

export const communityRoutes = new Hono<AppEnv>()
  .get('/channels', async (c) => c.json({ items: await listChannels(c.env, c.get('userId')) }))
  // Opening a channel is what marks it read. A separate "mark as read" button
  // would be one more thing to click for something the member already did.
  .post('/channels/:slug/read', requireAuth, async (c) => {
    await markChannelRead(c.env, c.get('userId'), c.req.param('slug'));
    return c.body(null, 204);
  })
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
  .get('/leaderboard', async (c) => c.json({ items: await getLeaderboard(c.env, c.get('userId')) }));
