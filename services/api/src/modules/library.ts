import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { activityEvents, libraryItems, withUser } from '@ipc/db';
import type { AppEnv } from '../context.ts';
import { HttpError } from '../lib/problem.ts';
import { requireAuth } from '../middleware/auth.ts';
import { getDb } from '../repo.ts';
import { listLibraryCategories } from '../repo.ts';

function needDb(env: any) {
  const db = getDb(env);
  if (!db) throw new HttpError(503, 'Needs a database', 'Set DATABASE_URL.');
  return db;
}

export const libraryRoutes = new Hono<AppEnv>()
  .get('/categories', async (c) => c.json({ items: await listLibraryCategories(c.env, c.get('userId')) }))
  // The library showed categories and had no way to list what is in one, so
  // every card linked to an anchor that went nowhere. RLS filters by tier, so
  // an item above the member is absent rather than refused.
  .get('/items', async (c) => {
    const db = getDb(c.env);
    if (!db) return c.json({ items: [] });
    const category = c.req.query('category');
    return withUser(db, c.get('userId'), async (tx) => {
      const rows = await tx.execute<{
        id: string; category_slug: string; title: string; storage_key: string | null;
        external_url: string | null; mime: string | null; min_tier: string; created_at: string;
      }>(sql`
        select i.id, c.slug as category_slug, i.title, i.storage_key, i.external_url,
               i.mime, i.min_tier, i.created_at
        from library_items i
        join library_categories c on c.id = i.category_id
        ${category ? sql`where c.slug = ${category}` : sql``}
        order by i.created_at desc
        limit 200
      `);

      const { createStorage } = await import('../lib/storage.ts');
      const storage = createStorage(c.env);

      return c.json({
        items: await Promise.all(
          rows.map(async (r) => ({
            id: r.id,
            categorySlug: r.category_slug,
            title: r.title,
            kind: r.storage_key ? ('file' as const) : ('link' as const),
            // Signed per request. A stored library file is behind the same
            // private bucket as everything else.
            url: r.storage_key
              ? await storage.signedDownloadUrl(r.storage_key, 900).catch(() => null)
              : r.external_url,
            mime: r.mime,
            minTier: r.min_tier as 'free' | 'silver' | 'diamond' | 'franchisee',
            createdAt: new Date(r.created_at).toISOString(),
          })),
        ),
      });
    });
  })
  // Opening an item is the event the activity chart reads. Listing categories
  // is not — counting a browse as learning would inflate every number downstream.
  .post('/items/:id/open', requireAuth, async (c) => {
    const db = needDb(c.env);
    const userId = c.get('userId')!;
    return withUser(db, userId, async (tx) => {
      const [item] = await tx.select({ id: libraryItems.id }).from(libraryItems)
        .where(eq(libraryItems.id, c.req.param('id'))).limit(1);
      if (!item) throw new HttpError(404, 'Item not found');
      await tx.insert(activityEvents).values({
        userId, kind: 'library.opened', payload: { itemId: item.id }, xp: 5, minutes: 5,
      });
      return c.json({ ok: true });
    });
  });
