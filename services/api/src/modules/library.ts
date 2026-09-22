import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
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
