# Graphite & Signal — design tokens (theme 02)

Canvas: **https://claude.ai/artifact/7JYhLunrnjH7vpNtSuJ18h**
The alternative to [Ink & Ember](design-tokens.md). Same eight screens, different structure and
temperature, so the two can be compared like for like. Only one ships.

## Principles

1. **Icon rail + command bar, not a labelled sidebar.** Search (⌘K) is the primary navigation; the
   rail is 64px and iconic. Screens get their width back.
2. **Dense rows and dividers, not cards.** A card is reserved for something you can act on on its
   own. Lists are rows with hairline separators.
3. **The accent swaps by theme.** Graphite acts on light, lime acts on dark. **Lime always means
   live** — a call in progress, a vote closing, the lesson you are on.
4. **Mono carries every fact.** Counts, durations, progress, IDs, timestamps, lesson numbers. The
   grotesk does everything else.
5. **Radius 4, tighter padding, more per screen.** This system is denser than Ember by design.
6. **Both themes are authored, not generated** — see the contrast note below.

## Type

- Display and interface: **Space Grotesk** (300–700). Headings tighten to `-0.03em`.
- Facts: **IBM Plex Mono** (400/500/600). Overlines are mono, uppercase, `0.12em`.
- No serif anywhere.

| Role | Size / line | Face |
|---|---|---|
| display | 38–46 / 1.08, `-0.03em` | Space Grotesk 500 |
| title | 30–32 / 1.18, `-0.025em` | Space Grotesk 500 |
| heading | 18–24 / 1.3, `-0.02em` | Space Grotesk 500 |
| body | 16 / 1.65 | Space Grotesk 400 |
| secondary | 13–14 / 1.6 | Space Grotesk 400 |
| mono-data | 11–15 | IBM Plex Mono 400–600 |
| overline | 10–11, `0.12em`, uppercase | IBM Plex Mono 500 |

## Tokens

```css
:root {                       /* light */
  --gs-base: #F7F8F9;
  --gs-surface: #FFFFFF;
  --gs-sunken: #EEF0F2;
  --gs-border: #E1E4E8;
  --gs-border-strong: #CBD1D8;
  --gs-text: #14171A;
  --gs-text-2: #4B535C;
  --gs-text-3: #6C757F;        /* 4.6:1 on base — the floor */
  --gs-action: #14171A;        /* graphite acts */
  --gs-on-action: #FFFFFF;
  --gs-live: #C6F24E;          /* lime = live, never the default action here */
  --gs-on-live: #14171A;
  --gs-info: #2C63C4;

  --gs-income: #8A5A0B;
  --gs-influence: #2C63C4;
  --gs-impact: #12736B;
  --gs-domain-ops: #2C63C4;
  --gs-domain-delivery: #12736B;
  --gs-domain-sales: #8A5A0B;
  --gs-domain-community: #5B48C4;
  --gs-domain-content: #B33F63;
  --gs-domain-traffic: #2E7D4F;
}

:root:not([data-theme="light"]) {  /* under @media (prefers-color-scheme: dark) */
  --gs-base: #0B0C0E;
  --gs-surface: #131519;
  --gs-raised: #1A1D22;
  --gs-border: #24282E;
  --gs-border-strong: #333941;
  --gs-text: #EDEFF2;
  --gs-text-2: #A0A7B0;
  --gs-text-3: #737B86;
  --gs-action: #C6F24E;        /* lime acts */
  --gs-on-action: #0B0C0E;
  --gs-live: #C6F24E;
  --gs-info: #5B9BFF;

  --gs-income: #E8A33D;
  --gs-influence: #5B9BFF;
  --gs-impact: #3FD3C6;
  --gs-domain-ops: #5B9BFF;
  --gs-domain-delivery: #3FD3C6;
  --gs-domain-sales: #E8A33D;
  --gs-domain-community: #8B7BF7;
  --gs-domain-content: #F2789A;
  --gs-domain-traffic: #6FD08C;
}

:root {
  --gs-radius: 4px;
  --gs-radius-chip: 2px;
  --gs-focus: 2px solid #C6F24E;   /* offset 2px, both themes */
  --gs-measure: 68ch;
  --gs-duration: 120ms;
  --gs-ease: cubic-bezier(0.2, 0, 0, 1);
}
```

Spacing: `4 8 12 16 20 24 32 44 56`. Row padding is 12–16px, card padding 14–18px.

## Contrast, checked as drawn

- `--gs-text-3` clears 4.5:1 on its own base in **both** themes.
- **Category hues darken on light** — `#E8A33D` becomes `#8A5A0B`, `#3FD3C6` becomes `#12736B` —
  because the dark values fail on white. A generated inversion would have shipped unreadable badges.
  This is why both themes are hand-authored.
- Lime never carries white text. It always pairs with `#14171A`/`#0B0C0E`.
- The focus ring is the same lime in both themes, at 2px with 2px offset.
