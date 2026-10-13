import { createContext, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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

/**
 * Whose drafts may be written right now. useDraft flushes on unmount, and a
 * sign-out unmounts the page — without this check the flush would put the
 * draft straight back after `clearDrafts` removed it.
 */
let owner: string | null = null;
export const draftOwner = () => owner;

/** Unsent drafts (see useDraft) are personal; they do not outlive a sign-out. */
function clearDrafts() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('eb-draft-')) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    // Storage blocked: nothing was saved there either.
  }
}

export function SessionProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  /* Whose data is in the query cache. Undefined until the first session is
     known; null once known to be nobody. Every query key is per-endpoint, not
     per-user, so without this the next person to sign in on the same tab saw
     the previous member's dashboard, notes and notifications until each query
     happened to refetch. */
  const cachedFor = useRef<string | null | undefined>(undefined);
  const [state, setState] = useState<SessionState>(() =>
    authConfigured
      ? { status: 'loading', session: null, demo: false }
      : { status: 'signed-in', session: null, demo: true },
  );

  useEffect(() => {
    if (!supabase) return;

    const adopt = (session: Session | null) => {
      const userId = session?.user.id ?? null;
      const previous = cachedFor.current;
      if (previous !== undefined && previous !== userId) {
        // Signed out, or a different person signed in: nothing cached for
        // the previous user may be shown to the next.
        queryClient.cancelQueries();
        queryClient.clear();
        if (previous !== null) clearDrafts();
      }
      cachedFor.current = userId;
      owner = userId;
    };

    supabase.auth.getSession().then(({ data }) => {
      adopt(data.session);
      setState({
        status: data.session ? 'signed-in' : 'signed-out',
        session: data.session,
        demo: false,
      });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        queryClient.cancelQueries();
        queryClient.clear();
        owner = null;
        clearDrafts();
        cachedFor.current = null;
      } else {
        adopt(session);
      }
      setState({ status: session ? 'signed-in' : 'signed-out', session, demo: false });
    });

    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  const value = useMemo(() => state, [state]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
