import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { api } from '../shared/api.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { Card } from '../shared/ui/primitives.tsx';

const VERSION = 'v1-2026-09-20';

export function LegalPage() {
  const [accepted, setAccepted] = useState(false);
  return (
    <Page>
      <PageHeader title="Privacy & Terms" crumbs={[{ label: 'Account', to: '/account' }, { label: 'Legal' }]} />
      <Card>
        <h3 style={{ marginTop: 0 }}>Privacy policy (summary)</h3>
        <p style={{ fontSize: 12, lineHeight: 1.7 }} className="muted">
          We store your profile, course progress, posts and messages to run the club.
          Videos stream from our provider; payments go through Razorpay, Google Play or the
          App Store — we keep the entitlement (which tier, until when), never card numbers.
          You can export everything (<Link to="/account">Account → Export</Link>) and delete
          your account in-app at any time; authored posts are anonymised, not erased, so
          threads others replied to keep making sense.
        </p>
        <h3>Terms (summary)</h3>
        <p style={{ fontSize: 12, lineHeight: 1.7 }} className="muted">
          Memberships are personal — sharing logins violates the code of conduct and triggers
          device limits. Course videos are for members; re-uploads carry your visible
          watermark. The full documents live on the marketing site; this page records
          that you accepted {VERSION}.
        </p>
        {accepted ? <p style={{ fontSize: 12 }}>✓ Accepted {VERSION}.</p> : (
          <button className="btn btn-pink" onClick={() => api.acceptTerms(VERSION).then(() => setAccepted(true))}>
            Accept {VERSION}
          </button>
        )}
      </Card>
    </Page>
  );
}
