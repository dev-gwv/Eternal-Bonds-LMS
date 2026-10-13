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
 * The country code is its own control.
 *
 * It used to be "+91" pre-typed into the number box, which a member could
 * backspace away, type twice ("+91 +91 98…") or paste a full number over —
 * and every one of those sent a malformed number to the SMS provider. A
 * picker cannot be half-deleted. India first: it is where the club is.
 */
const COUNTRIES = [
  { code: '+91', name: 'India', digits: 10 },
  { code: '+971', name: 'UAE', digits: 9 },
  { code: '+977', name: 'Nepal', digits: 10 },
  { code: '+880', name: 'Bangladesh', digits: 10 },
  { code: '+94', name: 'Sri Lanka', digits: 9 },
  { code: '+65', name: 'Singapore', digits: 8 },
  { code: '+44', name: 'UK', digits: 10 },
  { code: '+1', name: 'US / Canada', digits: 10 },
  { code: '+61', name: 'Australia', digits: 9 },
] as const;

/** Digits only, and no trunk zero: "098220 41552" is dialled as 98220 41552. */
const nationalDigits = (raw: string) => raw.replace(/\D/g, '').replace(/^0+/, '');

/** 98220 41552 for a ten-digit Indian number; anything else as typed. */
const prettyNumber = (country: string, digits: string) =>
  country === '+91' && digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;

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
  const [country, setCountry] = useState<string>('+91');
  const [localNumber, setLocalNumber] = useState('');
  const digits = nationalDigits(localNumber);
  const expectedDigits = COUNTRIES.find((c) => c.code === country)?.digits ?? 10;
  const phoneValid = digits.length === expectedDigits;
  /** E.164, which is what the SMS provider wants: +919822041552. */
  const phone = `${country}${digits}`;
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
    if (!phoneValid) {
      setError(`Enter the ${expectedDigits}-digit mobile number, without the country code.`);
      return;
    }
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
    <div className="app" style={{ display: 'grid', placeItems: 'center', padding: '24px 16px' }}>
      <div className="panel signin-panel">
        <div className="signin-head">
          <LogoMark size={48} title="Eternal Bonds" />
          <h1 className="signin-brand">Welcome to Eternal Bonds</h1>
          <p className="signin-sub">Sign in or join with your mobile number. New here? The same steps create your account.</p>
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
            <div className="signin-field">
              <label className="signin-label" htmlFor="signin-phone">Mobile number</label>
              <div className="phone-row">
                <select
                  aria-label="Country code"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="phone-country"
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} {c.name}
                    </option>
                  ))}
                </select>
                <input
                  id="signin-phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  value={localNumber}
                  onChange={(e) => {
                    const raw = e.target.value;
                    // A pasted full number ("+91 98220 41552") moves its code
                    // into the picker instead of doubling it up.
                    if (raw.trim().startsWith('+')) {
                      const compact = raw.replace(/[^\d+]/g, '');
                      const match = [...COUNTRIES]
                        .sort((a, b) => b.code.length - a.code.length)
                        .find((c) => compact.startsWith(c.code));
                      if (match) {
                        setCountry(match.code);
                        setLocalNumber(compact.slice(match.code.length));
                        return;
                      }
                    }
                    setLocalNumber(raw.replace(/[^\d\s-]/g, '').slice(0, 16));
                  }}
                  placeholder={country === '+91' ? '98220 41552' : 'Mobile number'}
                  aria-describedby="signin-phone-hint"
                  required
                />
              </div>
              <span id="signin-phone-hint" className="signin-hint">
                We'll text you a 6-digit code. No password needed.
              </span>
            </div>
            <button type="submit" className="btn btn-pink signin-cta" disabled={busy || !authConfigured || !phoneValid}>
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
              <span className="signin-label">
                Code sent to {country} {prettyNumber(country, digits)}
              </span>
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

        {/* Right under the form that caused it, not at the foot of the card
            where it read as a problem with the email box. */}
        {error && (
          <div className="signin-error" role="alert">
            {error}
          </div>
        )}

        <div className="signin-or">
          <span />
          <span>or continue with</span>
          <span />
        </div>

        <button
          type="button"
          className="btn btn-soft signin-google"
          disabled={busy || !authConfigured}
          onClick={() => void signInWithGoogle()}
        >
          <GoogleMark />
          Continue with Google
        </button>

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
          <label className="signin-label" htmlFor="signin-email">Email instead</label>
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
            <button type="submit" className="btn btn-soft" disabled={busy || !authConfigured || !email.includes('@')}>
              Send link
            </button>
          </div>
        </form>

        <p className="signin-terms">
          By continuing you agree to the club's terms and privacy policy. Your number is only used
          to sign you in and to send session reminders.
        </p>
      </div>
    </div>
  );
}

/** The code box; everything else uses the app's input baseline. */
const inputStyle: React.CSSProperties = {
  fontSize: 18,
  minHeight: 48,
};
