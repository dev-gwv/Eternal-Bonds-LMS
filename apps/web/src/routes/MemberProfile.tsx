import { useQuery } from '@tanstack/react-query';
import { Link, getRouteApi } from '@tanstack/react-router';
import { api, relativeTime } from '../shared/api.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { Avatar, Card, Chip, EmptyState, Icon } from '../shared/ui/primitives.tsx';
import { ReportButton } from '../shared/ui/ReportButton.tsx';
import { SkeletonCard } from '../shared/ui/Skeleton.tsx';

/**
 * Another member.
 *
 * Every search result for a person linked `/members/me`, so looking somebody
 * up opened your own profile — a dead end that looked like a bug in search.
 * The directory listed people it could not take you to.
 *
 * Deliberately thin. No email, no phone, no member code, no XP and no risk
 * band: the first three are contact details nobody consented to publish, and
 * the last two would turn a directory into a leaderboard of who is falling
 * behind. What is here is what the member chose to put in their profile, plus
 * the wins they published — which is the part they are proud of.
 */

const route = getRouteApi('/members/$id');

export function MemberProfilePage() {
  const { id } = route.useParams();
  const member = useQuery({ queryKey: ['member', id], queryFn: () => api.publicMember(id) });

  if (member.isPending) {
    return (
      <Page>
        <SkeletonCard />
      </Page>
    );
  }

  if (member.error || !member.data) {
    return (
      <Page>
        <PageHeader title="Member" back="/members" crumbs={[{ label: 'Members', to: '/members' }, { label: 'Not found' }]} />
        <Card>
          {/* Not listed and not real give the same answer, so this page cannot
              be used to confirm that an account exists. */}
          <EmptyState
            icon="people"
            title="This member is not in the directory"
            hint="They may not have chosen to be listed. Members appear here once they turn it on in their settings."
          />
          <Link to="/members" className="btn btn-soft" style={{ alignSelf: 'flex-start' }}>
            Browse the directory
          </Link>
        </Card>
      </Page>
    );
  }

  const m = member.data;

  return (
    <Page>
      <PageHeader
        title={m.fullName}
        back="/members"
        crumbs={[{ label: 'Members', to: '/members' }, { label: m.fullName }]}
        actions={
          m.isMe ? (
            <Link to="/settings" className="btn btn-soft">
              <Icon name="edit" size={13} />
              Edit my profile
            </Link>
          ) : (
            <ReportButton targetType="member" targetId={m.id} />
          )
        }
      />

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <Avatar initials={m.initials} src={m.avatarUrl} size={64} ring />
          <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 17, fontWeight: 600 }}>{m.fullName}</span>
              <Chip tone="pink">{m.tier}</Chip>
            </span>
            <span style={{ fontSize: 11.5 }} className="muted">
              {[m.city, `member for ${relativeTime(m.joinedAt)}`].filter(Boolean).join(' · ')}
            </span>
          </div>
        </div>

        {m.bioMd && (
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}>{m.bioMd}</p>
        )}

        {m.expertise.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {m.expertise.map((e) => (
              <Chip key={e}>{e}</Chip>
            ))}
          </div>
        )}
      </Card>

      <span className="section-label">Wins they have shared</span>
      {m.wins.length === 0 ? (
        <Card>
          <EmptyState
            icon="heart"
            title={m.isMe ? 'You have not posted a win yet' : 'No wins posted yet'}
            hint={
              m.isMe
                ? 'A win is the big idea and exactly how it happened, so another member can copy it.'
                : 'Members post the work that actually paid off here.'
            }
            action={
              m.isMe ? (
                <Link to="/wins/submit" className="btn btn-pink" style={{ color: '#fff' }}>
                  Post a win
                </Link>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {m.wins.map((w) => (
            <Link
              key={w.slug}
              to="/wins/$slug"
              params={{ slug: w.slug }}
              className="card-row lift"
              style={{ color: 'inherit' }}
            >
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500 }}>{w.title}</span>
              <span style={{ fontSize: 10 }} className="dim">
                {relativeTime(w.createdAt)} ago
              </span>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}
