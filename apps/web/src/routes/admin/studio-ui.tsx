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
      {error && (
        <span className="field-error" role="alert">
          <Icon name="bell" size={11} strokeWidth={2.6} />
          {error}
        </span>
      )}
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
 * Re-exported from the shared component.
 *
 * It started here and members never had it, which is how deleting a comment
 * and cancelling an RSVP stayed one unprompted click while unpublishing a
 * course took two.
 */
export { ConfirmButton } from '../../shared/ui/ConfirmButton.tsx';

/**
 * "Type a name, press the button" — as one control instead of two hopeful ones.
 *
 * Adding a module was an unbordered grey box floated to the far right of the
 * Curriculum heading, fifteen hundred pixels from it on a wide screen, beside
 * a greyed-out button. The box read as a label rather than a field, and the
 * button was disabled because the box was empty and said nothing about why. So
 * you pressed Add module, nothing happened, and the honest conclusion was that
 * the studio could not add modules. It could; it just never said what it
 * wanted first.
 *
 * Three things fix it and all three are small: the field looks like a field,
 * the pair is visibly one unit, and the button explains its own disabled
 * state rather than leaving you to guess.
 */
export function InlineAdd({
  value,
  onChange,
  onSubmit,
  placeholder,
  label,
  valid,
  busy,
  hint = 'Type a name first',
  grow,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  label: string;
  valid: boolean;
  busy?: boolean;
  /** Shown on the disabled button, and under the field while it is empty. */
  hint?: string;
  grow?: boolean;
}) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: grow ? 1 : undefined, minWidth: 0 }}>
      <span className="inline-add">
        <input
          value={value}
          placeholder={placeholder}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
          // Enter submits, because typing a name and reaching for the mouse is
          // the slow way to add eleven modules.
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid && !busy) onSubmit();
          }}
        />
        <button
          type="button"
          className="btn btn-soft"
          disabled={!valid || busy}
          title={valid ? undefined : hint}
          onClick={onSubmit}
        >
          <Icon name="plus" size={13} />
          {busy ? 'Adding…' : label}
        </button>
      </span>
      {/* Only once they have started typing something too short — a hint under
          an untouched empty field is noise on every page load. */}
      {value.trim().length > 0 && !valid && (
        <span style={{ fontSize: 10 }} className="dim">
          {hint}
        </span>
      )}
    </span>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{children}</div>;
}

/** A tier, a level, a language — every enum the studio offers picks from one. */
/**
 * Re-exported from the shared listbox.
 *
 * This used to render a native `<select>`. Its closed state was styled, but
 * the open list was an OS popup — system font, square corners, a blue
 * highlight belonging to nothing else on the page — and no CSS reaches that.
 * The signature is unchanged, so every call site gained the new list without
 * being touched.
 */
export { Select } from '../../shared/ui/Select.tsx';

/** Turns a title into the URL it will live at, so nobody types a slug by hand. */
export const slugify = (title: string) =>
  title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

/**
 * Puts a validation error next to the field it is about.
 *
 * `ErrorNote` shows one message at the top of the card, which is fine for "the
 * server is down" and useless for "slug: too short" on an eight-field cohort
 * form — the member reads a field name and then goes hunting for it.
 *
 * The API's validator answers 422 with `detail` shaped as `path: message`
 * (see the `invalid` handler each module shares), so the field name is already
 * on the wire; nothing had been reading it. `CreatePost` additionally returns
 * an `errors` array, which is handled first when present.
 *
 * Returns a lookup plus whatever could not be attributed to a field, so the
 * caller can still show that at the top rather than swallowing it.
 */
export function fieldErrors(error: unknown): { of: (field: string) => string | null; rest: string | null } {
  const empty = { of: () => null, rest: null };
  if (!error) return empty;

  const message = error instanceof Error ? error.message : String(error);

  // `path: message`, where the path may be nested (`steps.0.title`). Only the
  // last segment is a field name the form knows about.
  const match = /^([A-Za-z0-9_.[\]]+):\s*(.+)$/.exec(message.trim());
  if (!match) return { of: () => null, rest: message };

  const path = match[1]!;
  const detail = match[2]!;
  const leaf = path.split('.').pop() ?? path;

  return {
    of: (field) => (field === path || field === leaf ? detail : null),
    rest: null,
  };
}
