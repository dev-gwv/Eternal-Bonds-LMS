import { describe, expect, test } from 'bun:test';
import { ConfigError, EnvSchema, parseEnv } from '../services/api/src/env.ts';
import { allowedOrigins } from '../services/api/src/lib/cors.ts';
import worker from '../services/api/src/worker.ts';

/**
 * Production fails closed: the defaults that let a clean checkout run on seed
 * data (no database, no Supabase, a known cron secret) are boot errors there.
 */

const prod = {
  NODE_ENV: 'production',
  CRON_SECRET: 'a-real-secret-from-the-secret-store',
  SUPABASE_URL: 'https://example.supabase.co',
  DATABASE_URL: 'postgres://user:pass@db.example:5432/postgres',
};

describe('env: production refinement', () => {
  test('production with the default CRON_SECRET fails', () => {
    const { CRON_SECRET: _, ...rest } = prod;
    expect(EnvSchema.safeParse(rest).success).toBe(false);
    expect(EnvSchema.safeParse({ ...prod, CRON_SECRET: 'dev-cron-secret' }).success).toBe(false);
  });

  test('production without SUPABASE_URL or DATABASE_URL fails', () => {
    expect(EnvSchema.safeParse({ ...prod, SUPABASE_URL: '' }).success).toBe(false);
    expect(EnvSchema.safeParse({ ...prod, DATABASE_URL: '  ' }).success).toBe(false);
  });

  test('a complete production config passes', () => {
    expect(EnvSchema.safeParse(prod).success).toBe(true);
  });

  test('development and test with empty values pass (seed mode)', () => {
    expect(EnvSchema.safeParse({}).success).toBe(true);
    expect(EnvSchema.safeParse({ NODE_ENV: 'development' }).success).toBe(true);
    expect(EnvSchema.safeParse({ NODE_ENV: 'test', CRON_SECRET: 'dev-cron-secret' }).success).toBe(true);
  });

  test('parseEnv names the keys, never the values', () => {
    try {
      parseEnv({ ...prod, CRON_SECRET: 'dev-cron-secret', DATABASE_URL: '' });
      throw new Error('expected a ConfigError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as ConfigError).message;
      expect(message).toContain('CRON_SECRET');
      expect(message).toContain('DATABASE_URL');
      expect(message).not.toContain(prod.SUPABASE_URL);
    }
    // An invalid value is reported by key; Zod v4 does not echo the input.
    try {
      parseEnv({ ...prod, VIDEO_PROVIDER: 'leaky-sentinel-value' });
      throw new Error('expected a ConfigError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).message).toContain('VIDEO_PROVIDER');
      expect((error as ConfigError).message).not.toContain('leaky-sentinel-value');
    }
  });

  test('POSTHOG_* survive parsing (the schema strips unknown keys)', () => {
    const env = EnvSchema.parse({ POSTHOG_KEY: 'phc_x', POSTHOG_HOST: 'https://eu.posthog.com' });
    expect(env.POSTHOG_KEY).toBe('phc_x');
    expect(env.POSTHOG_HOST).toBe('https://eu.posthog.com');
  });
});

describe('worker: misconfigured production answers 503, not a bare 500', () => {
  test('problem+json with CORS for the calling origin', async () => {
    const original = console.error;
    console.error = () => {};
    try {
      const res = await worker.fetch(
        new Request('https://api.example/v1/me', { headers: { origin: 'https://app.example' } }),
        { NODE_ENV: 'production' },
        { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
      );
      expect(res.status).toBe(503);
      expect(res.headers.get('content-type')).toBe('application/problem+json');
      expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example');
      expect(((await res.json()) as { title: string }).title).toBe('Service misconfigured');
    } finally {
      console.error = original;
    }
  });
});

describe('cors: native origins', () => {
  test('Capacitor origins always; plain http://localhost only outside production', () => {
    const dev = allowedOrigins(EnvSchema.parse({}));
    const live = allowedOrigins(EnvSchema.parse({ ...prod, ALLOWED_ORIGINS: 'https://app.example' }));
    for (const o of ['https://localhost', 'capacitor://localhost', 'ionic://localhost']) {
      expect(dev.has(o)).toBe(true);
      expect(live.has(o)).toBe(true);
    }
    expect(dev.has('http://localhost')).toBe(true);
    expect(live.has('http://localhost')).toBe(false);
  });
});
