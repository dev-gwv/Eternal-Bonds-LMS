import { useEffect, useState } from 'react';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { Icon } from '../shared/ui/primitives.tsx';

/**
 * Photolancer.
 *
 * This page used to say the marketplace was "in development". It is not —
 * photolancer.in is a live product with photographers, gigs and messaging on
 * it, and the club's current platform simply embeds it. Building a second
 * marketplace next to a working one would be the expensive way to have two
 * half-populated marketplaces.
 *
 * So it is framed, exactly as the existing platform does it, with an escape
 * hatch. The frame is the risk: a third party can add X-Frame-Options at any
 * time, and the browser gives no usable event when it does — a blocked frame
 * and a slow frame look identical from here. Hence the always-visible "open in
 * a new tab" and the nudge that appears if nothing has painted after a few
 * seconds, so the failure mode is a visible door rather than a white rectangle.
 */

const SRC = 'https://photolancer.in/';

export function PhotolancerPage() {
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);

  // Not an error state — a blocked frame is undetectable from here — just an
  // offer of the other way in once waiting has stopped being reasonable.
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(id);
  }, []);

  return (
    <Page>
      <PageHeader
        title="Photolancer"
        crumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Photolancer' }]}
        actions={
          <a
            href={SRC}
            target="_blank"
            rel="noreferrer noopener"
            className="btn btn-soft"
            style={{ color: 'inherit' }}
          >
            <Icon name="link" size={13} />
            Open in a new tab
          </a>
        }
      />

      {!loaded && slow && (
        <div className="callout">
          Photolancer is taking a while to load here. It sometimes refuses to run inside another site —{' '}
          <a href={SRC} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--pink-ink)' }}>
            open it in a new tab
          </a>{' '}
          instead.
        </div>
      )}

      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 'min(78vh, 900px)',
          borderRadius: 'var(--r-card)',
          overflow: 'hidden',
          border: '1px solid var(--hair)',
          background: 'var(--softer)',
        }}
      >
        {!loaded && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              fontSize: 12,
            }}
            className="dim"
          >
            Loading Photolancer…
          </div>
        )}

        <iframe
          src={SRC}
          title="Photolancer — find photographers and gigs"
          onLoad={() => setLoaded(true)}
          // Deliberately narrow. Photolancer is a third party: it gets to run
          // scripts, submit its own forms and open links, and nothing else.
          // No allow-same-origin, so it cannot reach our storage or cookies.
          sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
          style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
        />
      </div>

      <span style={{ fontSize: 10.5, lineHeight: 1.55 }} className="dim">
        Photolancer is a separate product. Your Eternal Bonds membership and your Photolancer account are
        not linked yet — signing in there is its own login.
      </span>
    </Page>
  );
}
