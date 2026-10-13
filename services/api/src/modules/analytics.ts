import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../context.ts';
import { track } from '../lib/analytics.ts';

/**
 * Analytics proxy: the browser posts here, the server forwards to PostHog.
 * POST /v1/analytics/track. Anonymous is fine — no requireAuth; a valid Bearer
 * (read by the global session middleware) only attaches the user id.
 */
export const analyticsRoutes = new Hono<AppEnv>().post(
  '/track',
  zValidator('json', z.object({ event: z.string().min(1).max(80), properties: z.record(z.string(), z.unknown()).optional() }),
    (r, c) => (!r.success ? c.json({ ok: false }, 422) : undefined)),
  async (c) => {
    const body = c.req.valid('json');
    await track(c.env, {
      userId: c.get('userId') ?? undefined, event: body.event, properties: body.properties,
    });
    return c.json({ ok: true });
  },
);
