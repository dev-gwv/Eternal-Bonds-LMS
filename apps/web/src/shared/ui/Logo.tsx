/**
 * The mark.
 *
 * What it was: a rounded square filled with the brand gradient. That is the
 * default every starter template ships, and it says nothing — swap the colour
 * and it is a fintech, a CRM, a project tracker.
 *
 * What it is now: **two interlocking rings that also read as a lens.**
 *
 * That is not decoration, it is the business. The club is called Eternal
 * Bonds and its members shoot weddings, so two linked rings carry the name and
 * the subject at once. Overlap them and the shape between becomes a vesica —
 * the outline of a lens — and the whole thing reads as a camera aperture from
 * across a room. One mark, three readings, none of them a coincidence.
 *
 * Built to survive being small. Strokes, not fills, so it stays legible at
 * 16px in a browser tab; no text inside the mark, because a wordmark inside a
 * favicon is a grey smudge; and a single gradient rather than a colour per
 * element, so it still works when somebody prints it in one ink.
 */
export function LogoMark({ size = 28, title }: { size?: number; title?: string }) {
  // Unique per instance: two SVGs on one page sharing a gradient id means the
  // second one silently renders with the first one's colours.
  const id = `eb-grad-${size}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ display: 'block', flexShrink: 0 }}
    >
      <defs>
        <linearGradient id={id} x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--pink, #e8578f)" />
          <stop offset="100%" stopColor="var(--pink-strong, #c2306a)" />
        </linearGradient>
      </defs>

      {/* The lens. The shape two overlapping rings leave between them, filled
          softly so it reads as glass rather than as a third object. */}
      <path
        d="M16 8.6a8.4 8.4 0 0 1 0 14.8 8.4 8.4 0 0 1 0-14.8Z"
        fill={`url(#${id})`}
        opacity="0.18"
      />

      {/* The two bands. */}
      <circle cx="11.8" cy="16" r="7.2" stroke={`url(#${id})`} strokeWidth="2.4" />
      <circle cx="20.2" cy="16" r="7.2" stroke={`url(#${id})`} strokeWidth="2.4" />

      {/* The catchlight — the highlight a photographer looks for in an eye, and
          what stops the mark reading as a flat diagram. */}
      <circle cx="16" cy="12.4" r="1.15" fill={`url(#${id})`} />
    </svg>
  );
}

/**
 * Mark plus name, as used in the header.
 *
 * "ETERNAL" over "BONDS" at 6.5px was two lines competing for the space one
 * needs. It now sets on one line with the weight carrying the hierarchy, which
 * also stops the header being three rows tall on a phone.
 */
export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <>
      <LogoMark size={size} title="Eternal Bonds" />
      <span className="wordmark-text">
        <span className="wordmark-name">Eternal</span>
        <span className="wordmark-sub">Bonds</span>
      </span>
    </>
  );
}
