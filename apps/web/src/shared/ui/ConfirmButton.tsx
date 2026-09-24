import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

/**
 * A destructive action that asks once, in place.
 *
 * Not `window.confirm`: a native dialog blocks the whole tab, looks nothing
 * like the rest of the application, and on a phone arrives as a system sheet
 * that reads like the browser warning you rather than the app asking. Not a
 * modal either — a modal for "delete this comment" is heavier than the thing
 * being deleted, and a member who has to dismiss one to fix a typo learns to
 * stop tidying up after themselves.
 *
 * So: the button becomes its own confirmation. First press arms it and changes
 * what it says; second press does the thing. Two deliberate presses is the
 * whole safeguard, and it is enough for actions that are annoying rather than
 * catastrophic.
 *
 * It disarms itself after four seconds, which matters more than it sounds. An
 * armed delete sitting on screen is a trap for the next person who scrolls
 * back and clicks what they think is still the button they saw before.
 *
 * This lived in the admin studio and was never available to members, which is
 * why deleting a comment and cancelling an RSVP have always been one
 * unprompted click — the two places where a misclick costs somebody something
 * they wrote or a seat they wanted.
 */
export function ConfirmButton({
  label,
  confirmLabel = 'Really delete',
  onConfirm,
  disabled,
  className = 'btn btn-ghost',
  style,
  icon,
}: {
  label: React.ReactNode;
  confirmLabel?: React.ReactNode;
  onConfirm: () => void;
  disabled?: boolean;
  /** The resting appearance. Armed always becomes `btn btn-danger`. */
  className?: string;
  style?: CSSProperties;
  icon?: React.ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!armed) return;
    timer.current = setTimeout(() => setArmed(false), 4000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [armed]);

  return (
    <button
      type="button"
      className={armed ? 'btn btn-danger' : className}
      // Armed keeps the caller's sizing but drops any colour it set, or a
      // ghost-red Delete stays red text on the red armed background.
      style={armed ? { ...style, color: undefined } : style}
      disabled={disabled}
      // Announced, because the label changing under the pointer is the entire
      // mechanism and a screen reader otherwise hears one word change with no
      // indication that the button now means something else.
      aria-live="polite"
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
      onBlur={() => setArmed(false)}
    >
      {!armed && icon}
      {armed ? confirmLabel : label}
    </button>
  );
}
