import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './primitives.tsx';

/**
 * A dropdown whose open list is ours.
 *
 * The native `<select>` closed state can be styled — border, radius, a drawn
 * chevron — and that is where most apps stop. The part everybody actually
 * means by "the dropdown looks outdated" is the *open* list, which is an OS
 * popup: system font, system spacing, square corners, a blue highlight that
 * belongs to nothing else on the page. No CSS reaches it.
 *
 * So this is a listbox. Rebuilding a select is a real cost and it is only
 * worth paying if the rebuild is genuinely complete, which means:
 *
 *   - **Keyboard parity.** Up, Down, Home, End, Enter, Space, Escape, Tab,
 *     and type-ahead — typing "di" jumps to Diamond, the way a native select
 *     does. Half these are the ones people skip, and skipping them is what
 *     makes a custom dropdown worse than the thing it replaced.
 *   - **Real ARIA.** `role="listbox"`, `aria-activedescendant` on the trigger
 *     rather than moving DOM focus, `aria-selected` per option. A screen
 *     reader announces this as a dropdown because it is one.
 *   - **It flips when it has to.** A list that opens downward off the bottom
 *     of a phone is worse than the native control by a wide margin.
 *
 * The trigger is a `<button>` carrying the same classes as an input, so it
 * inherits the control baseline and cannot drift from the fields beside it.
 */

export type SelectOption<T extends string> = { value: T; label: string; hint?: string };

export function Select<T extends string>({
  value,
  options,
  onChange,
  placeholder = 'Select…',
  disabled,
  id,
  'aria-label': ariaLabel,
}: {
  value: T | '';
  options: readonly SelectOption<T>[] | readonly T[];
  onChange: (next: T) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}) {
  const items: SelectOption<T>[] = options.map((o) =>
    typeof o === 'string' ? { value: o as T, label: (o as string).replace(/_/g, ' ') } : o,
  );

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, items.findIndex((o) => o.value === value)));
  const [drop, setDrop] = useState<'down' | 'up'>('down');

  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const listId = useId();

  const selected = items.find((o) => o.value === value) ?? null;

  // Decide direction before paint, or the list visibly jumps after opening.
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const box = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - box.bottom;
    const needed = Math.min(items.length * 34 + 12, 280);
    setDrop(below < needed && box.top > below ? 'up' : 'down');
  }, [open, items.length]);

  // Keep the highlighted option in view when arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    // Closing on scroll rather than repositioning: a list anchored to a
    // control that has moved is worse than one that is simply gone.
    const onScroll = (e: Event) => {
      if (!list.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const commit = (index: number) => {
    const item = items[index];
    if (!item) return;
    onChange(item.value);
    setOpen(false);
    trigger.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    // Type-ahead. A native select does this and its absence is the single
    // most-missed thing in a rebuilt one: in a tier list, "d" should reach
    // Diamond without four arrow presses.
    if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now();
      typed.current.text = now - typed.current.at > 700 ? e.key : typed.current.text + e.key;
      typed.current.at = now;
      const hit = items.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text.toLowerCase()));
      if (hit >= 0) {
        setActive(hit);
        if (!open) commit(hit);
      }
      e.preventDefault();
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive((i) => Math.min(items.length - 1, Math.max(0, i + step)));
        return;
      }
      case 'Home':
        if (open) { e.preventDefault(); setActive(0); }
        return;
      case 'End':
        if (open) { e.preventDefault(); setActive(items.length - 1); }
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (open) commit(active);
        else setOpen(true);
        return;
      case 'Escape':
        if (open) { e.preventDefault(); setOpen(false); }
        return;
      case 'Tab':
        // Tab commits nothing and closes — the same as a native select losing
        // focus, and the opposite of trapping somebody in a popup.
        setOpen(false);
        return;
      default:
    }
  };

  return (
    <div className="select" ref={root}>
      <button
        ref={trigger}
        id={id}
        type="button"
        className="select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        onClick={() => {
          setOpen((o) => !o);
          setActive(Math.max(0, items.findIndex((o) => o.value === value)));
        }}
        onKeyDown={onKeyDown}
      >
        <span className={selected ? 'select-value' : 'select-value is-placeholder'}>
          {selected?.label ?? placeholder}
        </span>
        <Icon name="chevron" size={13} strokeWidth={2.2} color="var(--ink-3)" />
      </button>

      {open && (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          tabIndex={-1}
          className={drop === 'up' ? 'select-list is-up' : 'select-list'}
        >
          {items.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === value}
              data-active={i === active}
              className="select-option"
              // mousedown, not click: mousedown fires before the document
              // handler that closes on outside-click, so the option is chosen
              // rather than swallowed by the close.
              onMouseDown={(e) => {
                e.preventDefault();
                commit(i);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block' }}>{o.label}</span>
                {o.hint && (
                  <span style={{ display: 'block', fontSize: 10 }} className="dim">
                    {o.hint}
                  </span>
                )}
              </span>
              {o.value === value && <Icon name="check" size={13} strokeWidth={3} color="var(--pink-ink)" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
