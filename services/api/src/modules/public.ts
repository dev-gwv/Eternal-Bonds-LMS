import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { withUser } from '@ipc/db';
import type { AppEnv } from '../context.ts';
import { HttpError } from '../lib/problem.ts';
import { createStorage } from '../lib/storage.ts';
import { getDb } from '../repo.ts';

/**
 * Everything a stranger may read. Mounted at /v1/public, outside every auth
 * middleware in the app.
 *
 * Two rules hold this surface together:
 *
 * **It runs as `anon`, always.** `withUser(db, null)` drops the transaction to
 * the anon role, so what comes back is whatever the anon policies allow and
 * nothing else. There is no code path here that can accidentally read as an
 * authenticated user, because no user id is ever available to pass.
 *
 * **The filtering is in the policy, not here.** This file contains no
 * `status = 'published'` and no `public_share = true`. That is on purpose: a
 * condition written in a handler is one typo away from serving drafts to the
 * open internet, and the typo compiles. The policy fails closed and covers
 * queries nobody has written yet.
 */
export const publicRoutes = new Hono<AppEnv>()
  .get('/wins/:slug', async (c) => {
    const db = getDb(c.env);
    if (!db) throw new HttpError(503, 'Needs a database');

    return withUser(db, null, async (tx) => {
      const [win] = await tx.execute<{
        id: string; slug: string; title: string; big_idea_md: string;
        how_it_happened_md: string; category: string; occurred_on: string | null;
        tags: string[] | null; created_at: string; author_name: string | null;
      }>(sql`
        select
          w.id, w.slug, w.title, w.big_idea_md, w.how_it_happened_md,
          w.category, w.occurred_on, w.tags, w.created_at,
          -- A function rather than a join: the users table carries email,
          -- phone and member code, so anon gets one string instead of a row.
          public.public_win_author(w.id) as author_name
        from wins w
        where w.slug = ${c.req.param('slug')}
      `);

      // A win that exists but is not shared is indistinguishable from one that
      // does not exist. Anything else confirms the URL to somebody guessing.
      if (!win) throw new HttpError(404, 'Not found');

      const media = await tx.execute<{ id: string; storage_key: string; mime: string }>(sql`
        select id, storage_key, mime from win_media where win_id = ${win.id}::uuid order by id
      `);

      const storage = createStorage(c.env);
      const images = await Promise.all(
        media.map(async (m) => {
          try {
            return {
              id: m.id,
              // Longer than the in-app 1 hour: a shared link gets opened days
              // later, and this is the page where a broken image costs most.
              url: await storage.signedDownloadUrl(m.storage_key, 6 * 3600),
              mime: m.mime,
              width: null,
              height: null,
            };
          } catch {
            return null;
          }
        }),
      );

      // Cacheable at the edge. This page is identical for everybody who opens
      // it, and it is the one page that might get a spike from social.
      c.header('cache-control', 'public, max-age=300, s-maxage=900');

      return c.json({
        slug: win.slug,
        title: win.title,
        bigIdeaMd: win.big_idea_md,
        howItHappenedMd: win.how_it_happened_md,
        category: win.category,
        occurredOn: win.occurred_on ? String(win.occurred_on).slice(0, 10) : null,
        tags: win.tags ?? [],
        authorName: win.author_name ?? 'A member',
        media: images.filter((m): m is NonNullable<typeof m> => m !== null),
        createdAt: new Date(win.created_at).toISOString(),
      });
    });
  });
