import { z } from 'zod';

/**
 * Config is parsed once, at the edge of the process, and passed in.
 * Bad config fails at boot — loudly — instead of at 3am in a handler.
 */
export const EnvSchema = z.object({
  PORT: z.coerce.number().default(8080),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Supabase Postgres, session-pooler URL in production. Empty = serve seed data. */
  DATABASE_URL: z.string().default(''),

  /** Supabase project. The service role key never leaves this process. */
  SUPABASE_URL: z.string().default(''),
  SUPABASE_ANON_KEY: z.string().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(''),

  /**
   * Web origins. Native apps send no Origin header at all, so allowing the
   * web origins here does not lock mobile out — see lib/cors.ts.
   */
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),

  STORAGE_BUCKET: z.string().default('ipc-media'),

  /* Video. `none` keeps the file in Supabase Storage and serves a signed
     progressive MP4 — fine to develop against, not adaptive bitrate. The
     other two are real providers; see docs/video.md. */
  VIDEO_PROVIDER: z.enum(['cloudflare', 'bunny', 'none']).default('none'),
  VIDEO_API_TOKEN: z.string().default(''),
  /** Cloudflare account id. */
  VIDEO_ACCOUNT_ID: z.string().default(''),
  /** Bunny library id. */
  VIDEO_LIBRARY_ID: z.string().default(''),
  /** Cloudflare: customer-<code>.cloudflarestream.com. Bunny: the pull zone. */
  VIDEO_DELIVERY_HOST: z.string().default(''),
  /** Cloudflare signing key id; unused by Bunny. */
  VIDEO_SIGNING_KEY_ID: z.string().default(''),
  /** Cloudflare: a PKCS#8 private key. Bunny: the token authentication key. */
  VIDEO_SIGNING_KEY_PEM: z.string().default(''),
  VIDEO_WEBHOOK_SECRET: z.string().default(''),
  /** Refuses an upload longer than this before it starts. 4 hours. */
  VIDEO_MAX_SECONDS: z.coerce.number().default(14400),

  /* Payments. Razorpay is web-only by design — see PLAN §7 for why the store
     builds ship with BILLING_MODE=web_only. */
  BILLING_MODE: z.enum(['web_only', 'razorpay']).default('web_only'),
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),

  /* Outbound mail. Without a provider the worker logs what it would have sent,
     which is the right behaviour on a laptop and visible in production. */
  EMAIL_PROVIDER: z.enum(['resend', 'console']).default('console'),
  EMAIL_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default('India Photographers Club <no-reply@example.com>'),
  EMAIL_REPLY_TO: z.string().default(''),

  /* Push. FCM HTTP v1 needs a service account; APNs rides on FCM. */
  PUSH_PROVIDER: z.enum(['fcm', 'console']).default('console'),
  FCM_PROJECT_ID: z.string().default(''),
  FCM_CLIENT_EMAIL: z.string().default(''),
  FCM_PRIVATE_KEY: z.string().default(''),

  /** Where links in emails and push notifications point. */
  APP_URL: z.string().default('http://localhost:5173'),

  CRON_SECRET: z.string().default('dev-cron-secret'),
});

export type Env = z.infer<typeof EnvSchema>;
