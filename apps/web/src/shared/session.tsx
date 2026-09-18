import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import type { Session } from '@supabase/supabase-js';
import { authConfigured, supabase } from './supabase.ts';

/**
 * One source of truth for "is someone signed in".
 *
 * When Supabase is not configured the app runs in **demo mode**: the API is
 * serving seed data and there is no session to have, so the gate opens and a
 * banner says so. The moment credentials exist, the real gate applies — no
 * code changes, no forgotten `if (dev)` branch left in a route.
 */
type SessionState = {
  status: 'loading' | 'signed-in' | 'signed-out';
  session: Session | null;
  demo: boolean;
};

const SessionContext = createContext<SessionState>({ status: 'loading', session: null, demo: true });

export function SessionProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<SessionState>(() =>
    authConfigured
      ? { status: 'loading', session: null, demo: false }
      : { status: 'signed-in', session: null, demo: true },
  );

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      setState({
        status: data.session ? 'signed-in' : 'signed-out',
        session: data.session,
        demo: false,
      });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ status: session ? 'signed-in' : 'signed-out', session, demo: false });
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo(() => state, [state]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
