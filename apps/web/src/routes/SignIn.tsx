import { useState } from 'react';
import { LogoMark } from '../shared/ui/Logo.tsx';
import {
  authConfigured,
  devLoginEmail,
  devLoginEnabled,
  signInAsTestUser,
  signInWithGoogle,
  supabase,
} from '../shared/supabase.ts';

type Step = 'email' | 'sent';

/** Google's mark, for the one button members recognise by it. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/**
 * Supabase's own wording, in the member's terms.
 *
 * Its rate-limit error is "For security purposes, you can only request this
 * after 47 seconds", which reads as an accusation for something that is just a
 * queue.
 */
function friendlyAuthError(message: string): string {
  const wait = /after (\d+) seconds?/i.exec(message);
  if (wait) return `One link at a time — you can ask for another in ${wait[1]} seconds.`;
  if (/rate limit|too many/i.test(message)) {
    return 'Too many attempts from here. Wait a few minutes, or continue with Google.';
  }
  return message;
}

/**
 * Google first, email link second. Phone codes were dropped: members sign in
 * with an account they already have, and there is no SMS bill or delivery
 * delay to explain.
 *
 * Nothing here handles the token — supabase-js owns the session, and
 * `SessionProvider` reacts to it.
 */
export function SignInPage() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<{ error: { message: string } | null }>, onDone?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      const { error } = await fn();
      if (error) setError(friendlyAuthError(error.message));
      else onDone?.();
    } catch (e) {
      setError(e instanceof Error ? friendlyAuthError(e.message) : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app" style={{ display: 'grid', placeItems: 'center', padding: '24px 16px' }}>
      <div className="panel signin-panel">
        <div className="signin-head">
          <LogoMark size={48} title="Eternal Bonds" />
          <h1 className="signin-brand">Welcome to Eternal Bonds</h1>
          <p className="signin-sub">Sign in or join with Google or your email. New here? The same steps create your account.</p>
        </div>

        {!authConfigured && (
          <div className="callout">
            Supabase is not configured, so the app is running on seed data. Add
            <code> VITE_SUPABASE_URL</code> and <code> VITE_SUPABASE_ANON_KEY</code> to sign in for real.
          </div>
        )}

        {devLoginEnabled && (
          <div
            style={{
              border: '1px dashed var(--red)',
              borderRadius: 'var(--r-ctl)',
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--red)' }}>
              TEST BUILD — REMOVE BEFORE LAUNCH
            </span>
            <button
              type="button"
              className="btn btn-soft btn-sq"
              style={{ padding: 11 }}
              disabled={busy}
              onClick={() => void run(() => signInAsTestUser())}
            >
              {busy ? 'Signing in…' : `Skip login (${devLoginEmail})`}
            </button>
            <span style={{ fontSize: 10, lineHeight: 1.5 }} className="dim">
              Signs in as a real account, so it sees exactly what that member sees. Anyone who opens
              this page can click it.
            </span>
          </div>
        )}

        <button
          type="button"
          className="btn btn-soft signin-google"
          disabled={busy || !authConfigured}
          onClick={() => void signInWithGoogle()}
        >
          <GoogleMark />
          Continue with Google
        </button>

        <div className="signin-or">
          <span />
          <span>or use your email</span>
          <span />
        </div>

        {step === 'email' && (
          <form
            className="signin-field"
            onSubmit={(e) => {
              e.preventDefault();
              const sb = supabase;
              if (!sb) return;
              void run(
                () => sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } }),
                () => setStep('sent'),
              );
            }}
          >
            <label className="signin-label" htmlFor="signin-email">Email</label>
            <div className="email-row">
              <input
                id="signin-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                required
              />
              <button type="submit" className="btn btn-pink" disabled={busy || !authConfigured || !email.includes('@')}>
                {busy ? 'Sending…' : 'Send link'}
              </button>
            </div>
            <span className="signin-hint">We'll email you a sign-in link. No password needed.</span>
          </form>
        )}

        {step === 'sent' && (
          <div className="callout">
            Check {email} for a sign-in link. It can take a minute, and it is worth looking in spam —
            a first message from a new sender often lands there.
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginTop: 6, padding: 0 }}
              onClick={() => {
                setError(null);
                setStep('email');
              }}
            >
              Use a different email
            </button>
          </div>
        )}

        {/* Right under the form that caused it. */}
        {error && (
          <div className="signin-error" role="alert">
            {error}
          </div>
        )}

        <p className="signin-terms">
          By continuing you agree to the club's terms and privacy policy. Your email is only used
          to sign you in and to send session reminders.
        </p>
      </div>
    </div>
  );
}
