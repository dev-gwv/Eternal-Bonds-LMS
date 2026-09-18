import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { CreateOrder } from '@ipc/contracts';
import type { AppEnv } from '../context.ts';
import { createOrder, membershipState } from '../billing.ts';
import { problem } from '../lib/problem.ts';
import { requireAuth } from '../middleware/auth.ts';
import { rateLimit } from '../middleware/rateLimit.ts';

/**
 * Membership and checkout.
 *
 * Notice what is missing: there is no endpoint the browser can call to say
 * "that payment worked". The membership is granted by the Razorpay webhook
 * under the service role, and nothing a client sends can shortcut it.
 */
export const billingRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)
  .get('/membership', async (c) => c.json(await membershipState(c.env, c.get('userId'))))
  .post(
    '/orders',
    // Creating orders costs a Razorpay API call each time; a loop here is both
    // a bill and a way to fill our own table with junk.
    rateLimit({ name: 'order', limit: 10, windowSeconds: 3600 }),
    zValidator('json', CreateOrder, (result, c) =>
      result.success ? undefined : problem(c, 422, 'Pick a plan', result.error.issues[0]?.message),
    ),
    async (c) => c.json(await createOrder(c.env, c.get('userId'), c.req.valid('json').planId), 201),
  );
