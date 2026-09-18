import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env.ts';

/**
 * Service-role client: storage signing, admin reads, anything that must bypass
 * RLS deliberately. Never hand this to a request handler that takes user input
 * without checking authorisation first — it has no row-level protection.
 */
let cached: SupabaseClient | null = null;

export function serviceClient(env: Env): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
  }
  cached ??= createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export const supabaseConfigured = (env: Env) => Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
