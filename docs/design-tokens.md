# Ink & Ember — design tokens

The canvas is the visual source of truth: **https://claude.ai/artifact/3kiC3yRRhL9ej72aHWJhNe**
This file is the same system in code. Tailwind 4 reads it via `@theme`, so the artboards and the app
share one set of values. Changing a colour here changes it everywhere.

## Principles

1. **Hairlines, not shadows.** Structure is carried by 1px borders. Shadow is reserved for things
   that genuinely float: dialogs, sheets, menus, toasts.
2. **One primary action per surface.** Everything else is outline or text.
3. **Colour means something or it isn't used.** Ember = act. Category hues appear only as 8px dots
   and tinted pills — never as filled cards or decorative washes.
4. **Serif for voice, sans for interface.** Newsreader on win headlines, lesson titles and pull
   quotes; Instrument Sans for all UI chrome.
5. **Reading measure capped at ~68 characters**, whatever the viewport.
6. **44px minimum touch target** — on desktop too.

## Type

- Display: **Newsreader** (variable, 300–700 + italic) — 24px and up only.
- Interface: **Instrument Sans** (variable, 400–700).
- Numerals in counts, durations and progress use `font-variant-numeric: tabular-nums`.

| Role | Size / line | Face |
|---|---|---|
| display | 46–52 / 1.12 | Newsreader 400, `-0.02em` |
| title | 34–36 / 1.2 | Newsreader 400 |
| heading-serif | 20–26 / 1.28 | Newsreader 500 |
| heading-ui | 20 / 1.4 | Instrument Sans 600 |
| body | 16 / 1.65 | Instrument Sans 400 |
| secondary | 14 / 1.6 | Instrument Sans 400 |
| caption | 12 / 1.5 | Instrument Sans 400 |
| overline | 11 / 1.4, `0.14em`, uppercase | Instrument Sans 600 |

## Tokens

```css
:root {
  --eb-canvas: #FAF8F5;
  --eb-surface: #FFFFFF;
  --eb-sunken: #F4F1EC;
  --eb-border: #E5E0D8;
  --eb-border-strong: #D4CDC2;
  --eb-ink: #1C1A17;
  --eb-ink-2: #56514A;
  --eb-ink-3: #756E65;      /* 4.6:1 on canvas — the lightest text allowed */
  --eb-ink-disabled: #A8A29A;

  --eb-ember: #B4501E;      /* primary action; carries white text at 5.3:1 */
  --eb-ember-hover: #974014;
  --eb-ember-tint: #FBEFE7;
  --eb-ember-tint-border: #F0D9C9;

  --eb-income: #8A6514;  --eb-income-tint: #F7F0DC;  --eb-income-tint-border: #E8DCBC;
  --eb-influence: #3F5688; --eb-influence-tint: #EAEEF7; --eb-influence-tint-border: #D3DCEE;
  --eb-impact: #3F6B4F;  --eb-impact-tint: #E7F1E9;  --eb-impact-tint-border: #CDE2D3;

  --eb-domain-ops: #B4501E;
  --eb-domain-delivery: #3F6B4F;
  --eb-domain-sales: #8A6514;
  --eb-domain-community: #3F5688;
  --eb-domain-content: #6B4370;
  --eb-domain-traffic: #2F6B6B;

  --eb-radius-control: 6px;
  --eb-radius-card: 10px;
  --eb-radius-sheet: 18px;
  --eb-shadow-overlay: 0 8px 24px rgba(28, 26, 23, 0.10);
  --eb-measure: 68ch;
  --eb-duration: 150ms;
  --eb-duration-sheet: 250ms;
  --eb-ease: cubic-bezier(0.2, 0, 0, 1);
}

:root:not([data-theme="light"]) { /* under @media (prefers-color-scheme: dark) */
  --eb-canvas: #141311;
  --eb-surface: #1C1A18;
  --eb-sunken: #100F0E;
  --eb-border: #2E2B27;
  --eb-border-strong: #3D3933;
  --eb-ink: #F2EFEA;
  --eb-ink-2: #B5AEA4;
  --eb-ink-3: #8A8279;
  --eb-ember: #E8834A;       /* lifted, not reused — #B4501E fails on ink */
  --eb-ember-hover: #F0A278;
  --eb-ember-tint: #2A1B12;
  --eb-ember-tint-border: #3D2A1D;
  --eb-income: #DDB35C;  --eb-influence: #92A8DB;  --eb-impact: #86BE99;
}
```

Spacing is the 4pt scale: `4 8 12 16 24 32 48 64`. Nothing in between.

## Contrast, checked as drawn

- `--eb-ink-3` on `--eb-canvas`: 4.6:1 — this is the floor for text. Never go lighter.
- White on `--eb-ember`: 5.3:1.
- Dark mode lifts ember rather than reusing the light value; a single shared accent would fail.
- Category tints are backgrounds only — the text on them is the darkened variant, not the hue itself.
