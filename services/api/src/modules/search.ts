import { Hono } from 'hono';
import type { AppEnv } from '../context.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { search } from '../search.ts';

/**
 * Search. Rate-limited because it is the one endpoint a person can fire on
 * every keystroke, and the client debounces but a client is not a guarantee.
 */
export const searchRoutes = new Hono<AppEnv>().get(
  '/',
  rateLimit({ name: 'search', limit: 120, windowSeconds: 60 }),
  async (c) => c.json(await search(c.env, c.get('userId'), c.req.query('q') ?? '')),
);
