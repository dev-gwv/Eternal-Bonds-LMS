import { useEffect, useRef, useState, type PropsWithChildren, type ReactNode } from 'react';
import { Icon } from '../../shared/ui/primitives.tsx';

/**
 * The studio's small shared parts.
 *
 * They exist so every authoring screen asks for a value the same way — the
 * reader pages have almost no inputs, so there was nothing to reuse.
 */

export function Field({
  label,
  error,
  children,
}: PropsWithChildren<{ label: string; error?: string | null }>) {
  return (
    <label className={error ? 'field is-invalid' : 'field'}>
      <span>{label}</span>
      {children}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="btn-icon" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={14} />
    </button>
  );
}

/** Shows what actually went wrong, using the API's problem detail. */
export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="alert">{error instanceof Error ? error.message : String(error)}</div>;
}

export function Empty({ children }: PropsWithChildren) {
  return <div className="empty">{children}</div>;
}

/**
 * Destructive actions confirm in place rather than through window.confirm —
 * a native dialog blocks the whole tab and looks nothing like the rest of it.
 */
export function ConfirmButton({
  label,
  confirmLabel = 'Really delete',
  onConfirm,
  disabled,
}: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Disarms itself, so a half-pressed delete never sits waiting on the screen.
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
      className={armed ? 'btn btn-danger' : 'btn btn-ghost'}
      disabled={disabled}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{children}</div>;
}

/** A tier, a level, a language — every enum the studio offers picks from one. */
export function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly T[];
  onChange: (next: T) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o} value={o}>
          {o.replace(/_/g, ' ')}
        </option>
      ))}
    </select>
  );
}

/** Turns a title into the URL it will live at, so nobody types a slug by hand. */
export const slugify = (title: string) =>
  title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
