import { Hono } from 'hono';
import type { AppEnv } from '../context.ts';
import { applyRazorpayWebhook } from '../billing.ts';
import { applyVideoWebhook } from '../video.ts';

/**
 * Webhooks: the endpoints that are not authenticated by a session.
 *
 * Mounted **outside** `/v1`, because a webhook is not part of the client API
 * and must never be versioned alongside it — a provider cannot be asked to
 * migrate when we bump a version.
 *
 * Three rules hold for every handler here:
 *
 *   1. **Verify the signature against the raw body**, before parsing it. A
 *      re-serialised object is a different string, and the signature will not
 *      match — or worse, will match something the provider did not send.
 *   2. **Answer 200 for anything already handled.** Providers retry for days;
 *      a non-2xx on a duplicate delivery produces an escalating retry storm.
 *   3. **Never leak why something was rejected.** A bad signature gets the
 *      same flat answer as a malformed body — an attacker probing the endpoint
 *      learns nothing about which part they got wrong.
 */
export const webhookRoutes = new Hono<AppEnv>()
  .post('/video', async (c) => {
    const raw = await c.req.text();
    const outcome = await applyVideoWebhook(c.env, raw, c.req.raw.headers);
    // 'ignored' means the signature did not verify. 202 rather than 401: a
    // provider retrying a request we will never accept helps nobody, and the
    // status code is the only thing it reads.
    return c.json({ ok: outcome === 'ok' }, 202);
  })
  .post('/razorpay', async (c) => {
    const raw = await c.req.text();
    const outcome = await applyRazorpayWebhook(c.env, raw, c.req.raw.headers);
    return c.json({ ok: outcome === 'ok' }, 202);
  });
