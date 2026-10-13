import { useEffect, useRef, useState } from 'react';
import { draftOwner, useSession } from '../session.tsx';

/**
 * A form that survives the phone ringing.
 *
 * The long-form pages in this app — share an insight, post a win — ask for
 * several paragraphs of real thought, and until now every one of them lived
 * only in React state. A tab closed, a phone call, an accidental back
 * navigation, and it was gone. People do not write it again; they conclude the
 * app ate their work and stop using that feature.
 *
 * `localStorage` rather than the server on purpose. A draft is not content:
 * saving it server-side means a row, a policy, a cleanup job and a question
 * about whether a half-written insight counts as posted. A key in the
 * browser costs none of that and solves the case that actually happens, which
 * is the same person on the same device coming back within the hour.
 *
 * Debounced, because writing on every keystroke of an eight-hundred-word form
 * is a synchronous main-thread write per character. The pending write is
 * flushed, not dropped, on unmount — otherwise the last half-second of typing
 * before a navigation was lost.
 *
 * Keyed by the signed-in user, so on a shared device one member never opens
 * another's half-written insight. Sign-out removes every draft (session.tsx).
 */
export function useDraft<T extends Record<string, unknown>>(
  key: string,
  initial: T,
  { debounceMs = 600, maxAgeMs = 7 * 86_400_000 } = {},
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const { session, demo } = useSession();
  const userId = session?.user.id ?? (demo ? 'demo' : 'anon');
  const storageKey = `eb-draft-${userId}-${key}`;

  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return initial;
      const saved = JSON.parse(raw) as { at: number; data: T };
      // A month-old draft is not a draft, it is a surprise. Restoring one is
      // worse than losing it: the member does not remember writing it and now
      // has to work out whether to keep it.
      if (!saved?.at || Date.now() - saved.at > maxAgeMs) {
        localStorage.removeItem(storageKey);
        return initial;
      }
      // Merged over `initial`, so a field added since the draft was written
      // arrives with its default rather than as undefined.
      return { ...initial, ...saved.data };
    } catch {
      return initial;
    }
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  // The value and key a pending write will store, for the unmount flush.
  const pending = useRef<{ key: string; data: T } | null>(null);

  const write = (target: { key: string; data: T }) => {
    // Only for the person signed in now (or a session with no user at all):
    // a flush that lands after sign-out must not resurrect the draft.
    const keyOwner = target.key.slice('eb-draft-'.length).split('-')[0];
    const now = draftOwner();
    if (now !== null && !target.key.startsWith(`eb-draft-${now}-`)) return;
    if (now === null && keyOwner !== 'anon' && keyOwner !== 'demo') return;
    try {
      localStorage.setItem(target.key, JSON.stringify({ at: Date.now(), data: target.data }));
    } catch {
      // Quota, private mode, disabled storage. Losing autosave must never
      // stop somebody typing.
    }
  };

  useEffect(() => {
    // Skip the write caused by the initial render, or every visit rewrites the
    // timestamp and a draft never expires.
    if (!dirty.current) {
      dirty.current = true;
      return;
    }
    pending.current = { key: storageKey, data: value };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (pending.current) write(pending.current);
      pending.current = null;
    }, debounceMs);
  }, [value, storageKey, debounceMs]);

  // On unmount, write what is pending now instead of cancelling it.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (pending.current) write(pending.current);
      pending.current = null;
    },
    [],
  );

  /** Called on successful submit — the draft has become a real thing. */
  const clear = () => {
    // A write still waiting would otherwise put it straight back.
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // As above.
    }
  };

  return [value, setValue, clear];
}
