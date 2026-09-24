import { useEffect, useState } from 'react';
import { LogoMark } from '../shared/ui/Logo.tsx';
import {
  authConfigured,
  devLoginEmail,
  devLoginEnabled,
  signInAsTestUser,
  signInWithGoogle,
  supabase,
} from '../shared/supabase.ts';
import { Icon } from '../shared/ui/primitives.tsx';

type Step = 'phone' | 'code' | 'sent';

/**
 * How long a code stays good for, in seconds.
 *
 * This is not something the browser can find out — it lives in the Supabase
 * project's Auth settings — so it is duplicated here and must be kept in step
 * with it. Getting it wrong in one direction shows a countdown that outlives
 * the code; in the other, it tells somebody their code is dead while it still
 * works. Both are better than the previous behaviour, which was to say
 * nothing at all and let "Invalid token" be the first news of an expiry.
 */
const OTP_TTL_SECONDS = Number(import.meta.env.VITE_OTP_TTL_SECONDS ?? 600);

/**
 * How long before "Resend code" is offered.
 *
 * Not a guess at the provider's rate limit — it is the wait that makes the
 * button honest. Offering resend instantly gets it pressed while the first SMS
 * is still in flight, and the provider then refuses the second one with a
 * message about security that reads like the member did something wrong.
 */
const RESEND_AFTER_SECONDS = 45;

/** A second-resolution clock that only runs while something needs it. */
function useCountdown(until: number | null): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (until === null) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [until]);
  if (until === null) return 0;
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * Supabase's own wording, in the member's terms.
 *
 * Its rate-limit error is "For security purposes, you can only request this
 * after 47 seconds", which reads as an accusation for something that is just a
 * queue, and its verification failure is "Token has expired or is invalid" —
 * two quite different problems, one of which the member can fix by looking
 * more carefully and the other of which they cannot.
 */
function friendlyAuthError(message: string): string {
  const wait = /after (\d+) seconds?/i.exec(message);
  if (wait) return `One code at a time — you can ask for another in ${wait[1]} seconds.`;
  if (/rate limit|too many/i.test(message)) {
    return 'Too many attempts from here. Wait a few minutes, or use the email link below.';
  }
  if (/expired/i.test(message)) return 'That code has expired. Send a new one.';
  if (/invalid|incorrect/i.test(message)) return "That code did not match. Check the digits and try again.";
  return message;
}

/**
 * Phone + OTP first: most members join from a phone and will not remember a
 * password. Email magic link and Google sit beside it.
 *
 * Nothing here handles the token — supabase-js owns the session, and
 * `SessionProvider` reacts to it.
 */
export function SignInPage() {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('+91');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** When the code in the member's hand was sent. Drives both countdowns. */
  const [sentAt, setSentAt] = useState<number | null>(null);

  const expiresIn = useCountdown(sentAt === null ? null : sentAt + OTP_TTL_SECONDS * 1000);
  const resendIn = useCountdown(sentAt === null ? null : sentAt + RESEND_AFTER_SECONDS * 1000);
  const expired = sentAt !== null && expiresIn === 0;

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

  const sendCode = () => {
    const sb = supabase;
    if (!sb) return;
    void run(
      () => sb.auth.signInWithOtp({ phone }),
      () => {
        setCode('');
        setSentAt(Date.now());
        setStep('code');
      },
    );
  };

  return (
    <div className="app" style={{ display: 'grid', placeItems: 'center' }}>
      <div className="panel signin-panel" style={{ maxWidth: 430, minHeight: 0, padding: 30, gap: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <LogoMark size={52} title="Eternal Bonds" />
          <div style={{ textAlign: 'center' }}>
            <div className="signin-brand">Eternal Bonds</div>
            <div style={{ fontSize: 12 }} className="muted">The club for photographers who want more</div>
          </div>
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

        {step === 'phone' && (
          <form
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              sendCode();
            }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 500 }}>Phone number</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98220 41552"
                style={inputStyle}
                required
              />
            </label>
            <button type="submit" className="btn btn-pink" disabled={busy || !authConfigured} style={{ padding: 12 }}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </form>
        )}

        {step === 'code' && (
          <form
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              const sb = supabase;
              if (!sb) return;
              void run(() => sb.auth.verifyOtp({ phone, token: code, type: 'sms' }));
            }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 500 }}>Code sent to {phone}</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                // Digits only, so a pasted "123 456" or a stray space does not
                // fail verification for a code that was in fact correct.
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6-digit code"
                style={{ ...inputStyle, letterSpacing: '0.3em', textAlign: 'center' }}
                disabled={expired}
                required
                autoFocus
              />
            </label>

            {/* What is actually happening to the code they are holding.
                Previously nothing was said, and an expiry announced itself as
                "Token has expired or is invalid" after a failed attempt. */}
            {expired ? (
              <div className="callout">That code has expired. Send a new one and it will arrive in a moment.</div>
            ) : (
              <span style={{ fontSize: 10.5 }} className="dim">
                Expires in {mmss(expiresIn)}. It can take a few seconds to arrive.
              </span>
            )}

            <button type="submit" className="btn btn-pink" disabled={busy || expired || code.length < 6} style={{ padding: 12 }}>
              {busy ? 'Verifying…' : 'Verify'}
            </button>

            <div style={{ display: 'flex', gap: 8 }}>
              {/* Disabled with the remaining seconds on it rather than hidden:
                  somebody whose SMS has not arrived needs to see that resending
                  is coming, or they go back and start over — which is the one
                  action guaranteed to hit the provider's rate limit. */}
              <button
                type="button"
                className="btn btn-soft"
                style={{ flex: 1 }}
                disabled={busy || resendIn > 0}
                onClick={sendCode}
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ flex: 1 }}
                onClick={() => {
                  // Clear the error too. A failure from the previous number
                  // sitting under a fresh form reads as a failure of this one.
                  setError(null);
                  setSentAt(null);
                  setCode('');
                  setStep('phone');
                }}
              >
                Different number
              </button>
            </div>
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
                setStep('phone');
              }}
            >
              Use a phone number instead
            </button>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1, height: 1, background: 'var(--rule)' }} />
          <span style={{ fontSize: 10 }} className="dim">or</span>
          <span style={{ flex: 1, height: 1, background: 'var(--rule)' }} />
        </div>

        <button
          type="button"
          className="btn btn-soft btn-sq"
          style={{ padding: 12 }}
          disabled={busy || !authConfigured}
          onClick={() => void signInWithGoogle()}
        >
          Continue with Google
        </button>

        <form
          style={{ display: 'flex', gap: 8 }}
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
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            style={{ ...inputStyle, flex: 1 }}
            required
          />
          <button type="submit" className="btn btn-blue btn-sq" disabled={busy || !authConfigured}>
            Email link
          </button>
        </form>

        {error && (
          <div style={{ fontSize: 11, color: 'var(--red)', display: 'flex', gap: 7, alignItems: 'center' }}>
            <Icon name="bell" size={13} color="var(--red)" />
            {error}
          </div>
        )}

        <p style={{ margin: 0, fontSize: 10, lineHeight: 1.5 }} className="dim">
          By continuing you agree to the club's terms and privacy policy. Your number is used to
          sign you in and to send session reminders.
        </p>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: 14,
  color: 'var(--ink)',
  background: 'var(--soft)',
  border: '1px solid var(--hair)',
  borderRadius: 'var(--r-ctl)',
  padding: '12px 14px',
  outline: 'none',
};
