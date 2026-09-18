import { Hono } from 'hono';
import type { AppEnv } from '../context.ts';
import { requireAuth } from '../middleware/auth.ts';
import { listWorkshops } from '../repo.ts';
import { setWorkshopRegistration } from '../writes.ts';

export const workshopsRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const scope = c.req.query('scope') === 'completed' ? 'completed' : 'upcoming';
    return c.json({ items: await listWorkshops(c.env, c.get('userId'), scope) });
  })
  .post('/:id/registration', requireAuth, async (c) =>
    c.json(await setWorkshopRegistration(c.env, c.get('userId'), c.req.param('id'), true)),
  )
  .delete('/:id/registration', requireAuth, async (c) =>
    c.json(await setWorkshopRegistration(c.env, c.get('userId'), c.req.param('id'), false)),
  );
