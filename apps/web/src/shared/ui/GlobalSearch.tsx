import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import type { SearchHit } from '@ipc/contracts';
import { api } from '../api.ts';
import { Icon } from './primitives.tsx';

/**
 * The search box in the header, which until now was an input that did nothing.
 *
 * Grouped rather than one ranked list: "which course was that" and "which
 * member was that" are different questions, and a blended list answers neither
 * well.
 *
 * Fully keyboard-driven, because the people who use search most are the ones
 * who never touch the mouse for it — ⌘K / Ctrl+K to focus, arrows to move,
 * Enter to open, Escape to get out.
 */

const GROUP: Record<SearchHit['kind'], { label: string; icon: string }> = {
  course: { label: 'Courses', icon: 'courses' },
  workshop: { label: 'Workshops', icon: 'workshops' },
  library: { label: 'Library', icon: 'library' },
  member: { label: 'Members', icon: 'people' },
  post: { label: 'Community', icon: 'comment' },
};

const ORDER: SearchHit['kind'][] = ['course', 'workshop', 'library', 'post', 'member'];

export function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // Debounced: this fires on every keystroke otherwise, and the endpoint is
  // rate-limited for exactly that reason.
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 220);
    return () => clearTimeout(id);
  }, [query]);

  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.search(debounced),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });

  const hits = results.data?.hits ?? [];

  // Reset the highlight whenever the result set changes, or Enter opens
  // whatever happened to be at that index in the previous search.
  useEffect(() => setActive(0), [debounced]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, []);

  const go = (hit: SearchHit) => {
    setOpen(false);
    setQuery('');
    navigate({ to: hit.href });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      input.current?.blur();
      return;
    }
    if (hits.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter' && hits[active]) {
      e.preventDefault();
      go(hits[active]!);
    }
  };

  // Rebuilt in display order, keeping one flat index so the arrow keys can
  // walk straight through the groups.
  let index = -1;
  const grouped = ORDER.map((kind) => ({ kind, items: hits.filter((h) => h.kind === kind) })).filter(
    (g) => g.items.length > 0,
  );

  return (
    <div className="search" ref={box} style={{ position: 'relative' }}>
      <label htmlFor="global-search" style={srOnly}>
        Search courses, workshops, library and members
      </label>
      <input
        id="global-search"
        ref={input}
        type="text"
        value={query}
        placeholder="Search anything"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls="global-search-results"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <Icon name="search" size={15} strokeWidth={2} color="var(--ink-2)" />

      {open && query.trim().length > 0 && (
        <div
          id="global-search-results"
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 'min(340px, calc(100vw - 28px))',
            maxHeight: 420,
            overflowY: 'auto',
            background: 'var(--panel)',
            border: '1px solid var(--hair)',
            borderRadius: 'var(--r-card)',
            boxShadow: '0 12px 32px rgba(46,46,56,.12)',
            zIndex: 45,
            padding: 6,
          }}
        >
          {query.trim().length < 2 && (
            <div style={{ padding: '12px 10px', fontSize: 11 }} className="dim">
              Keep typing…
            </div>
          )}

          {query.trim().length >= 2 && results.isFetching && hits.length === 0 && (
            <div style={{ padding: '12px 10px', fontSize: 11 }} className="dim">
              Searching…
            </div>
          )}

          {query.trim().length >= 2 && !results.isFetching && hits.length === 0 && (
            <div style={{ padding: '16px 10px', fontSize: 11, textAlign: 'center' }} className="dim">
              Nothing matches “{query.trim()}”.
            </div>
          )}

          {grouped.map((group) => (
            <div key={group.kind}>
              <div className="section-label" style={{ padding: '8px 10px 4px' }}>
                {GROUP[group.kind].label}
              </div>
              {group.items.map((hit) => {
                index += 1;
                const isActive = index === active;
                return (
                  <button
                    key={`${hit.kind}-${hit.id}`}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onMouseEnter={() => setActive(hits.indexOf(hit))}
                    onClick={() => go(hit)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      borderRadius: 9,
                      border: 0,
                      background: isActive ? 'var(--soft)' : 'transparent',
                    }}
                  >
                    <Icon name={GROUP[hit.kind].icon} size={14} color="var(--ink-3)" />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: 'block',
                          fontSize: 11.5,
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {hit.title}
                      </span>
                      {hit.subtitle && (
                        <span style={{ display: 'block', fontSize: 10 }} className="dim">
                          {hit.subtitle}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}

          {results.data?.truncated && (
            <div style={{ padding: '8px 10px', fontSize: 10 }} className="dim">
              More matches exist — try a longer phrase.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const srOnly = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
} as const;
