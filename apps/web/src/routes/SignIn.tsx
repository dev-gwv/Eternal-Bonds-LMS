import { useState } from 'react';
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

  const run = async (fn: () => Promise<{ error: { message: string } | null }>, onDone?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      const { error } = await fn();
      if (error) setError(error.message);
      else onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app" style={{ display: 'grid', placeItems: 'center' }}>
      <div className="panel signin-panel" style={{ maxWidth: 430, minHeight: 0, padding: 30, gap: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <span className="wordmark-dot" style={{ width: 44, height: 44, borderRadius: 14 }} />
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
              const sb = supabase;
              if (!sb) return;
              void run(() => sb.auth.signInWithOtp({ phone }), () => setStep('code'));
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
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="6-digit code"
                style={{ ...inputStyle, letterSpacing: '0.3em', textAlign: 'center' }}
                required
              />
            </label>
            <button type="submit" className="btn btn-pink" disabled={busy} style={{ padding: 12 }}>
              {busy ? 'Verifying…' : 'Verify'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setStep('phone')}>
              Use a different number
            </button>
          </form>
        )}

        {step === 'sent' && (
          <div className="callout">Check {email} for a sign-in link.</div>
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
