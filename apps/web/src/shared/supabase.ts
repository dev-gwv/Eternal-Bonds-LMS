import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase owns the session. The client is optional: without the env vars the
 * app still runs against the API's seed data, which keeps a clean checkout
 * working with no project set up.
 *
 * Tokens are held by supabase-js (localStorage on web, and the same library
 * works in a Capacitor WebView later with a storage adapter) and sent to our
 * API as a Bearer header — never assumed to be a cookie.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;

export const authConfigured = supabase !== null;

export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function signInWithOtp(phone: string) {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase.auth.signInWithOtp({ phone });
}

export async function signInWithGoogle() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/` },
  });
}

export async function signOut() {
  await supabase?.auth.signOut();
}
