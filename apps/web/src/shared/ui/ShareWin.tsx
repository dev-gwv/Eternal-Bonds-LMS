import { useState } from 'react';
import { Icon } from './primitives.tsx';

/**
 * The public link for a win, and the reason it exists.
 *
 * `publicShare` has been collected since the wins board was built and read by
 * nothing, which made it a checkbox that did not do anything — the worst kind
 * of consent, because the member believed they had shared something.
 *
 * Deliberately only shown on a member's *own* win. A share button on somebody
 * else's story invites the reading that the club distributes members' work,
 * and the checkbox they ticked said the club may share it, not that every
 * other member may.
 */
export function ShareWin({ slug, enabled }: { slug: string; enabled: boolean }) {
  const [copied, setCopied] = useState(false);

  if (!enabled) {
    return (
      <span style={{ fontSize: 10.5 }} className="dim">
        Not shared publicly
      </span>
    );
  }

  const url = `${window.location.origin}/w/${slug}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is refused in some browsers without a user gesture
      // chain, and over plain http. Selecting the text still works.
      window.prompt('Copy this link', url);
    }
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <a
        href={`/w/${slug}`}
        target="_blank"
        rel="noreferrer"
        className="btn btn-ghost"
        style={{ fontSize: 10.5 }}
      >
        <Icon name="link" size={12} />
        Public page
      </a>
      <button type="button" className="btn btn-ghost" style={{ fontSize: 10.5 }} onClick={copy}>
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </span>
  );
}
