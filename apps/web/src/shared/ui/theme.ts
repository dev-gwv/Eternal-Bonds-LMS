/**
 * Light, dark, or whatever the system says.
 *
 * The whole mechanism is one attribute on `<html>`, because the stylesheet
 * does the rest: every surface already reads a token, and dark mode is those
 * tokens re-declared. There is no theme context, no provider and no re-render
 * — changing the attribute restyles the document in one paint.
 *
 * "System" is the default and it is a real option rather than a starting
 * value, which is why the stored value can be absent. Somebody whose laptop
 * switches at sunset should not have to switch the app too.
 */

export type Theme = 'light' | 'dark' | 'system';

const KEY = 'eb-theme';

export function getTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    // Private mode, or storage disabled. Following the system is the right
    // answer when we cannot remember a preference.
    return 'system';
  }
}

export function setTheme(theme: Theme): void {
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Not being able to persist it must not stop it applying for this visit.
  }
  applyTheme(theme);
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  // Removing the attribute rather than setting "system" is what hands control
  // back to the `prefers-color-scheme` rule — the CSS keys off
  // `:root:not([data-theme='light'])`, so any value at all would override it.
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/** What the member is actually looking at right now, system resolved. */
export function resolvedTheme(): 'light' | 'dark' {
  const theme = getTheme();
  if (theme !== 'system') return theme;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
