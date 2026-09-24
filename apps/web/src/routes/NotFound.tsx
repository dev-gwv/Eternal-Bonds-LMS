import { Link } from '@tanstack/react-router';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { Card, EmptyState } from '../shared/ui/primitives.tsx';

/**
 * A path that does not exist.
 *
 * There was no notFound component at all, and the edge serves the SPA shell
 * for every path — so a typo, a stale bookmark or a dead notification link
 * rendered full navigation above an empty white column. Nothing said anything
 * was wrong, which reads as the app being broken rather than the address being
 * wrong.
 *
 * The four links are the four places somebody who is lost actually wants: it
 * is more useful than a back button, which they already have.
 */
export function NotFoundPage() {
  return (
    <Page>
      <PageHeader title="Not found" crumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Not found' }]} />
      <Card>
        <EmptyState
          icon="search"
          title="There is nothing at this address"
          hint="The link may be out of date, or the page may have moved. Nothing has gone wrong with your account."
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link to="/" className="btn btn-pink" style={{ color: '#fff' }}>
            Dashboard
          </Link>
          <Link to="/courses" className="btn btn-soft">
            Courses
          </Link>
          <Link to="/community" className="btn btn-soft">
            Community
          </Link>
          <Link to="/settings" className="btn btn-soft">
            Settings
          </Link>
        </div>
      </Card>
    </Page>
  );
}
