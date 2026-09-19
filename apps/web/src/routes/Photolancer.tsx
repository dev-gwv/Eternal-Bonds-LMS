import { Link } from '@tanstack/react-router';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { Card, Icon } from '../shared/ui/primitives.tsx';

/**
 * Photolancer, before it exists.
 *
 * The nav item is staying because this is a real planned module — it was a
 * section in the club's previous app — but the page behind it read "The
 * marketplace module is not part of this scaffold yet", which is a developer's
 * sentence shown to a member.
 *
 * So: say plainly what it will be, say plainly that it is not here, and point
 * at the place where the work *is* already happening. A page that admits it is
 * empty and gives somewhere useful to go is not a dead end; one that apologises
 * in engineering vocabulary is.
 */

const PLANNED = [
  {
    icon: 'megaphone',
    title: 'Briefs from clients',
    body: 'Shoots posted with the date, the city, the budget and what is actually wanted.',
  },
  {
    icon: 'people',
    title: 'Apply as a member',
    body: 'Your profile, your tier and your finished courses travel with the application.',
  },
  {
    icon: 'file',
    title: 'Agreed terms up front',
    body: 'Scope, deliverables and payment written down before anyone picks up a camera.',
  },
  {
    icon: 'chart',
    title: 'A track record that counts',
    body: 'Completed jobs build a history inside the club rather than on a stranger’s platform.',
  },
];

export function PhotolancerPage() {
  return (
    <Page>
      <PageHeader
        title="Photolancer"
        crumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Photolancer' }]}
      />

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            background: 'linear-gradient(135deg, #fdecf5 0%, #fbe3ee 45%, #eaf1fc 100%)',
            padding: '34px 30px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            textAlign: 'center',
          }}
        >
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--pink-strong)',
              background: '#fff',
              borderRadius: 999,
              padding: '5px 12px',
            }}
          >
            In development
          </span>
          <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: '0.01em' }}>
            Paid work, inside the club
          </span>
          <span style={{ fontSize: 12.5, lineHeight: 1.65, maxWidth: 440 }} className="muted">
            Photolancer will connect members to real shoots — clients posting briefs, members
            applying, terms agreed before anyone commits. It is not open yet, and there is nothing
            here to sign up for.
          </span>
        </div>
      </Card>

      <span className="section-label">What it will do</span>

      <div className="grid grid-2">
        {PLANNED.map((item) => (
          <Card key={item.title} style={{ flexDirection: 'row', gap: 13, alignItems: 'flex-start' }}>
            <span
              style={{
                width: 34,
                height: 34,
                borderRadius: 11,
                background: 'var(--soft)',
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
              }}
            >
              <Icon name={item.icon} size={16} color="var(--ink-2)" />
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{item.title}</span>
              <span style={{ fontSize: 11.5, lineHeight: 1.6 }} className="muted">
                {item.body}
              </span>
            </span>
          </Card>
        ))}
      </div>

      {/* No "notify me" button. It would need somewhere to send the answer, and
          a button that quietly discards what someone typed is the exact thing
          this page exists to stop doing. The community is real and already
          open, so that is where this points. */}
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ flex: 1, minWidth: 220 }}>
          <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600 }}>
            Looking for work in the meantime?
          </span>
          <span style={{ display: 'block', fontSize: 11.5, lineHeight: 1.6, marginTop: 3 }} className="muted">
            Members pass briefs to each other in the community every week. Post what you shoot and
            where you are based.
          </span>
        </span>
        <Link to="/community" className="btn btn-pink" style={{ color: '#fff' }}>
          Open the community
        </Link>
      </Card>
    </Page>
  );
}
