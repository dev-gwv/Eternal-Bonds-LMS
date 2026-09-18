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

/* ── Test sign-in ──────────────────────────────────────────────────────────
   A shortcut for clicking around a deployed build without waiting for an OTP.

   It is **not** an auth bypass, and that is the whole design. It signs in to a
   real Supabase account and gets a real session, so RLS decides what that
   account can see exactly as it would for any member. If the build ever ships
   with this enabled, the worst case is a stranger seeing what one ordinary
   test member sees — not a hole in the access model.

   Both variables are build-time. A normal build has neither, so none of this
   reaches the bundle.

   Written so the constant folds. Vite inlines `import.meta.env.VITE_*` as a
   literal, so with the variables unset these become `''`, `DEV_LOGIN` becomes
   a literal `false`, and the minifier deletes the button, its warning banner
   and this function from the bundle entirely — verified by grepping dist. A
   guard that also tested `supabase` at runtime would leave the whole branch
   sitting in the output for anyone to read. */

const devEmail = import.meta.env.VITE_DEV_LOGIN_EMAIL || '';
const devPassword = import.meta.env.VITE_DEV_LOGIN_PASSWORD || '';

/** Injected by vite.config.ts as a literal `true` or `false`. */
declare const __DEV_LOGIN__: boolean;

/**
 * A compile-time literal, so the button is dead code in a normal build and the
 * bundler deletes it.
 *
 * Deliberately does **not** also test `supabase`: one runtime value in here
 * makes the export non-literal, folding stops across module boundaries, and
 * the markup survives into the output for anyone to read. The `supabase` check
 * lives in `signInAsTestUser`, where it is needed anyway.
 */
export const devLoginEnabled = __DEV_LOGIN__;

export async function signInAsTestUser() {
  if (!devLoginEnabled || !supabase) {
    throw new Error('No test account is configured for this build.');
  }
  return supabase.auth.signInWithPassword({ email: devEmail, password: devPassword });
}

/** Shown on the button so nobody has to guess which account it uses. */
export const devLoginEmail = devEmail;
