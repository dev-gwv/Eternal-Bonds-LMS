import { Hono } from 'hono';
import type { AppEnv } from '../context.ts';
import { getCourseDetail } from '../lessons.ts';
import { listCourses } from '../repo.ts';

export const coursesRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const items = await listCourses(c.env, c.get('userId'), c.req.query('status'));
    return c.json({ items });
  })
  .get('/:slug', async (c) => c.json(await getCourseDetail(c.env, c.get('userId'), c.req.param('slug'))));
