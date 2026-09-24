import { useEffect, useRef, useState } from 'react';

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
 * is a synchronous main-thread write per character.
 */
export function useDraft<T extends Record<string, unknown>>(
  key: string,
  initial: T,
  { debounceMs = 600, maxAgeMs = 7 * 86_400_000 } = {},
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const storageKey = `eb-draft-${key}`;

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

  useEffect(() => {
    // Skip the write caused by the initial render, or every visit rewrites the
    // timestamp and a draft never expires.
    if (!dirty.current) {
      dirty.current = true;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ at: Date.now(), data: value }));
      } catch {
        // Quota, private mode, disabled storage. Losing autosave must never
        // stop somebody typing.
      }
    }, debounceMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, storageKey, debounceMs]);

  /** Called on successful submit — the draft has become a real thing. */
  const clear = () => {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // As above.
    }
  };

  return [value, setValue, clear];
}
