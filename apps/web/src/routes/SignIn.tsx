import { useState } from 'react';
import { LogoMark } from '../shared/ui/Logo.tsx';
import { useSession } from '../shared/session.tsx';
import {
  MIN_PASSWORD_LENGTH,
  authConfigured,
  devLoginEmail,
  devLoginEnabled,
  sendPasswordReset,
  signInAsTestUser,
  signInWithGoogle,
  signInWithPassword,
  signOut,
  supabase,
  updatePassword,
} from '../shared/supabase.ts';

/**
 * `link` and `password` are the two ways in with an email; `forgot` asks for
 * a reset email; the two `-sent` steps say what to look for in the inbox.
 */
type Step = 'link' | 'password' | 'forgot' | 'link-sent' | 'reset-sent';

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
 * queue, and a wrong password is "Invalid login credentials" — which says
 * nothing to somebody who joined through Google and never had a password.
 */
export function friendlyAuthError(message: string): string {
  const wait = /after (\d+) seconds?/i.exec(message);
  if (wait) return `One email at a time — you can ask for another in ${wait[1]} seconds.`;
  if (/rate limit|too many/i.test(message)) {
    return 'Too many attempts from here. Wait a few minutes, or continue with Google.';
  }
  if (/invalid login credentials/i.test(message)) {
    return "That email and password don't match. Never set a password? Use the email link or Google, then set one in Settings.";
  }
  if (/email not confirmed/i.test(message)) {
    return 'This email has not been confirmed yet. Use the email link instead — it confirms it too.';
  }
  if (/different from the old|same password/i.test(message)) {
    return 'That is already your password. Choose a different one.';
  }
  if (/reauthenticat|recent login/i.test(message)) {
    return 'For your security, sign out and back in, then change your password.';
  }
  if (/weak|pwned|leaked/i.test(message)) {
    return 'That password is too easy to guess, or has appeared in a data breach. Choose another.';
  }
  // Gateway timeouts and server errors arrive as bare "HTTP 504" or "{}" —
  // most often the email provider being slow, which is not the member's fault.
  if (/\b5\d\d\b|gateway|timed? ?out|failed to fetch|network|^\s*\{\s*\}\s*$/i.test(message) || !message.trim()) {
    return 'We could not reach the sign-in service just now. Wait a moment and try again, or continue with Google.';
  }
  return message;
}

/** Shared by every form here: one busy flag, one error, one way of reporting. */
function useAuthAction() {
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
  return { busy, error, setError, run };
}

/** A password box with a show/hide toggle — a typo nobody can see is most failed sign-ins. */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  placeholder,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="password-row">
      <input
        id={id}
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        required
      />
      <button
        type="button"
        className="btn btn-ghost password-toggle"
        aria-pressed={shown}
        aria-label={shown ? 'Hide password' : 'Show password'}
        onClick={() => setShown((v) => !v)}
      >
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

/** What is wrong with a new password, worded for whoever is typing it. */
export function newPasswordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (confirm && confirm !== password) return 'The two passwords do not match.';
  return null;
}

/**
 * Google first, then email — by a sign-in link or a password. Phone codes
 * were dropped.
 *
 * Nothing here handles the token — supabase-js owns the session, and
 * `SessionProvider` reacts to it.
 */
export function SignInPage() {
  const [step, setStep] = useState<Step>('link');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, setError, run } = useAuthAction();
  const emailOk = email.includes('@');

  const go = (next: Step) => {
    // A failure from the previous form sitting under a fresh one reads as a
    // failure of this one.
    setError(null);
    setStep(next);
  };

  const sendLink = () => {
    const sb = supabase;
    if (!sb) return;
    void run(
      () => sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin } }),
      () => setStep('link-sent'),
    );
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

        {step === 'link' && (
          <form
            className="signin-field"
            onSubmit={(e) => {
              e.preventDefault();
              sendLink();
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
              <button type="submit" className="btn btn-pink" disabled={busy || !authConfigured || !emailOk}>
                {busy ? 'Sending…' : 'Send link'}
              </button>
            </div>
            <span className="signin-hint">We'll email you a sign-in link. No password needed.</span>
            <button type="button" className="btn btn-ghost signin-switch" onClick={() => go('password')}>
              Sign in with a password instead
            </button>
          </form>
        )}

        {step === 'password' && (
          <form
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => signInWithPassword(email, password));
            }}
          >
            <div className="signin-field">
              <label className="signin-label" htmlFor="signin-email">Email</label>
              <input
                id="signin-email"
                className="signin-input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                required
              />
            </div>
            <div className="signin-field">
              <div className="signin-label-row">
                <label className="signin-label" htmlFor="signin-password">Password</label>
                <button type="button" className="btn btn-ghost signin-switch" onClick={() => go('forgot')}>
                  Forgot password?
                </button>
              </div>
              <PasswordInput id="signin-password" value={password} onChange={setPassword} autoComplete="current-password" />
            </div>
            <button
              type="submit"
              className="btn btn-pink signin-cta"
              disabled={busy || !authConfigured || !emailOk || !password}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <button type="button" className="btn btn-ghost signin-switch" onClick={() => go('link')}>
              Email me a sign-in link instead
            </button>
          </form>
        )}

        {step === 'forgot' && (
          <form
            className="signin-field"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => sendPasswordReset(email), () => setStep('reset-sent'));
            }}
          >
            <label className="signin-label" htmlFor="signin-email">Reset your password</label>
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
              <button type="submit" className="btn btn-pink" disabled={busy || !authConfigured || !emailOk}>
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
            </div>
            <span className="signin-hint">
              We'll email you a link to choose a new password. Never had one? This sets your first.
            </span>
            <button type="button" className="btn btn-ghost signin-switch" onClick={() => go('password')}>
              Back to sign in
            </button>
          </form>
        )}

        {(step === 'link-sent' || step === 'reset-sent') && (
          <div className="callout">
            {step === 'link-sent'
              ? `Check ${email} for a sign-in link.`
              : `If ${email} has an account, a password reset link is on its way.`}{' '}
            It can take a minute, and it is worth looking in spam — a first message from a new sender
            often lands there.
            {/* Its own line: inline, it trailed the sentence and read as part of it. */}
            <button
              type="button"
              className="btn btn-ghost"
              style={{ display: 'flex', marginTop: 10, padding: 0 }}
              onClick={() => go(step === 'link-sent' ? 'link' : 'password')}
            >
              {step === 'link-sent' ? 'Use a different email' : 'Back to sign in'}
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

/**
 * Where a "reset your password" link lands.
 *
 * The link has already signed the member in, so this is not a sign-in form:
 * it asks for the new password twice (to catch a typo nobody can see) and then
 * lets them into the app. Skipping is allowed — they are signed in either way,
 * and can set one later in Settings.
 */
export function SetPasswordPage() {
  const { finishRecovery, session, status } = useSession();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAuthAction();
  const problem = newPasswordProblem(password, confirm);

  return (
    <div className="app" style={{ display: 'grid', placeItems: 'center', padding: '24px 16px' }}>
      <div className="panel signin-panel">
        <div className="signin-head">
          <LogoMark size={48} title="Eternal Bonds" />
          <h1 className="signin-brand">Choose a new password</h1>
          <p className="signin-sub">
            {session?.user.email ? `For ${session.user.email}. ` : ''}You'll use it with your email next time you sign in.
          </p>
        </div>

        {status === 'loading' ? (
          <span style={{ fontSize: 12, textAlign: 'center' }} className="muted">Checking your link…</span>
        ) : done ? (
          <>
            <div className="callout">Your password is set. Use it with your email next time you sign in.</div>
            <button type="button" className="btn btn-pink signin-cta" onClick={finishRecovery}>
              Continue to Eternal Bonds
            </button>
          </>
        ) : !session ? (
          <>
            <div className="signin-error" role="alert">
              This reset link has expired or was already used. Ask for a new one from the sign-in page.
            </div>
            <button type="button" className="btn btn-pink signin-cta" onClick={finishRecovery}>
              Back to sign in
            </button>
          </>
        ) : (
          <form
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (problem || confirm !== password) return;
              void run(() => updatePassword(password), () => setDone(true));
            }}
          >
            <div className="signin-field">
              <label className="signin-label" htmlFor="new-password">New password</label>
              <PasswordInput
                id="new-password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                autoFocus
              />
            </div>
            <div className="signin-field">
              <label className="signin-label" htmlFor="confirm-password">Type it again</label>
              <PasswordInput id="confirm-password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
              {password && problem && <span className="signin-hint">{problem}</span>}
            </div>
            <button
              type="submit"
              className="btn btn-pink signin-cta"
              disabled={busy || problem !== null || confirm !== password}
            >
              {busy ? 'Saving…' : 'Save password'}
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={finishRecovery}>
                Skip for now
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ flex: 1 }}
                onClick={() => {
                  finishRecovery();
                  void signOut();
                }}
              >
                Not you? Sign out
              </button>
            </div>
          </form>
        )}

        {error && (
          <div className="signin-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
