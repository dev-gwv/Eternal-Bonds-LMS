import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './primitives.tsx';
import { AnimatePresence, m } from './motion.tsx';

/**
 * One place for "that worked", "that did not", and "undo".
 *
 * Before this, every mutation in the app reported success by silence. Three
 * components had each invented their own answer — ShareWin held a `copied`
 * flag, PublicProfileCard held a `saved` flag, ReportButton swapped itself for
 * a confirmation line — and everything else said nothing at all. A member
 * clicked Save and the only evidence was that the button stopped saying
 * "Saving…".
 *
 * **Undo is the reason this is worth building rather than a one-line alert.**
 * A confirm dialog asks somebody to be certain *before* they act, which they
 * cannot be, and a two-tap confirm is a dialog with extra steps. An undo asks
 * nothing and is there when they are wrong, which is the only moment the
 * question actually matters. Where a destructive action can be deferred by a
 * few seconds, it should be — and where it truly cannot, it keeps the confirm.
 *
 * Deliberately not a dependency. A toast is a list, a timeout and a fixed
 * position; the libraries that do it also bring a portal, an animation engine
 * and a theme system, none of which this needs.
 */

export type ToastTone = 'success' | 'error' | 'info';

type Toast = {
  id: number;
  tone: ToastTone;
  message: string;
  /** When present the toast shows an Undo button and defers the real work. */
  undo?: () => void;
  durationMs: number;
};

type ToastApi = {
  show: (message: string, opts?: { tone?: ToastTone; durationMs?: number }) => void;
  error: (error: unknown) => void;
  /**
   * Runs `commit` after the toast expires, unless the member presses Undo.
   * The caller updates the interface immediately and hands us the rollback.
   */
  withUndo: (message: string, commit: () => void, rollback: () => void) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/** Long enough to read a sentence; long enough to reach the Undo button. */
const DEFAULT_MS = 4000;
const UNDO_MS = 6500;

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // A no-op rather than a throw. A toast that cannot be shown must never be
    // the reason a save fails — the interesting work already happened.
    return {
      show: () => {},
      error: () => {},
      withUndo: (_m, commit) => commit(),
    };
  }
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  // Deferred commits, so dismissing a toast early still runs the work.
  const pending = useRef(new Map<number, () => void>());

  const dismiss = useCallback((id: number, runCommit: boolean) => {
    const commit = pending.current.get(id);
    pending.current.delete(id);
    if (runCommit && commit) commit();
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-3), { ...toast, id }]);
    return id;
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show: (message, opts) =>
        void push({
          message,
          tone: opts?.tone ?? 'success',
          durationMs: opts?.durationMs ?? DEFAULT_MS,
        }),

      error: (error) =>
        void push({
          message: error instanceof Error ? error.message : 'Something went wrong',
          tone: 'error',
          // Errors stay longer: they are the ones somebody needs to read twice,
          // and often to copy.
          durationMs: 7000,
        }),

      withUndo: (message, commit, rollback) => {
        const id = push({ message, tone: 'success', durationMs: UNDO_MS, undo: rollback });
        pending.current.set(id, commit);
      },
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="region" aria-label="Notifications">
        {/* AnimatePresence is the reason this is not pure CSS: a toast that is
            being removed has already left the tree, so there is nothing left
            to transition. It also animates the remaining toasts into the gap. */}
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <m.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.14 } }}
              style={{ width: '100%', display: 'flex', justifyContent: 'inherit' }}
            >
              <ToastRow toast={t} onDone={dismiss} />
            </m.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

function ToastRow({ toast, onDone }: { toast: Toast; onDone: (id: number, commit: boolean) => void }) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => onDone(toast.id, true), toast.durationMs);
    return () => clearTimeout(timer);
  }, [toast.id, toast.durationMs, paused, onDone]);

  const icon = toast.tone === 'error' ? 'bell' : toast.tone === 'info' ? 'bulb' : 'check';

  return (
    <div
      className={`toast toast-${toast.tone}`}
      // Errors are announced immediately; a success does not interrupt.
      role={toast.tone === 'error' ? 'alert' : 'status'}
      // Hovering pauses the countdown. Somebody who has moved the mouse towards
      // the Undo button should not lose the race to a timer.
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon name={icon} size={14} strokeWidth={2.4} />
      <span style={{ flex: 1, minWidth: 0 }}>{toast.message}</span>

      {toast.undo && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.undo?.();
            onDone(toast.id, false);
          }}
        >
          Undo
        </button>
      )}

      <button
        type="button"
        className="toast-close"
        aria-label="Dismiss"
        onClick={() => onDone(toast.id, true)}
      >
        ×
      </button>
    </div>
  );
}
