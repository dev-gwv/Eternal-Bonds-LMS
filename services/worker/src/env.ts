import { z } from 'zod';

/**
 * The worker's configuration.
 *
 * It overlaps the API's on purpose — both need to know how to send an email —
 * but they stay separate schemas. Merging them would mean the API had to be
 * given FCM credentials it never uses, and the worker a Razorpay key it has no
 * business holding.
 */
export const EnvSchema = z.object({
  DATABASE_URL: z.string().default(''),
  /** How often the loop wakes. Scheduled jobs decide their own cadence. */
  TICK_SECONDS: z.coerce.number().default(30),
  WORKER_ID: z.string().default(`worker-${Math.random().toString(36).slice(2, 8)}`),

  /* Outbound mail. `console` logs what it would have sent, which is the right
     behaviour on a laptop and visible in production logs if it is ever wrong. */
  EMAIL_PROVIDER: z.enum(['resend', 'console']).default('console'),
  EMAIL_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default('India Photographers Club <no-reply@example.com>'),
  EMAIL_REPLY_TO: z.string().default(''),

  /* Push. FCM HTTP v1; iOS rides on FCM rather than talking to APNs directly,
     so there is one code path instead of two. */
  PUSH_PROVIDER: z.enum(['fcm', 'console']).default('console'),
  FCM_PROJECT_ID: z.string().default(''),
  FCM_CLIENT_EMAIL: z.string().default(''),
  /** PKCS#8, newlines either real or escaped — both are accepted. */
  FCM_PRIVATE_KEY: z.string().default(''),

  /** Where links in emails and notifications point. */
  APP_URL: z.string().default('http://localhost:5173'),

  /* Video, for the poller that catches a webhook that never arrived. */
  VIDEO_PROVIDER: z.enum(['cloudflare', 'bunny', 'none']).default('none'),
  VIDEO_API_TOKEN: z.string().default(''),
  VIDEO_ACCOUNT_ID: z.string().default(''),
  VIDEO_LIBRARY_ID: z.string().default(''),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Parses whatever this runtime offers.
 *
 * On Bun that is `process.env`. Under a Workers Cron Trigger there is no
 * `process`, and the caller passes the bindings in instead — which is why this
 * takes an argument at all.
 */
export function readEnv(source?: Record<string, unknown>): Env {
  return EnvSchema.parse(source ?? (typeof process === 'undefined' ? {} : process.env));
}
