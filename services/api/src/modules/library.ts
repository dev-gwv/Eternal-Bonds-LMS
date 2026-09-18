import { Hono } from 'hono';
import type { AppEnv } from '../context.ts';
import { listLibraryCategories } from '../repo.ts';

export const libraryRoutes = new Hono<AppEnv>().get('/categories', async (c) =>
  c.json({ items: await listLibraryCategories(c.env, c.get('userId')) }),
);
