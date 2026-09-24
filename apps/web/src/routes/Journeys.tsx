import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import type { Journey, JourneyStep } from '@ipc/contracts';
import { api } from '../shared/api.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { Card, Chip, EmptyState, Hero, Icon } from '../shared/ui/primitives.tsx';
import { LoadingLabel, SkeletonCard } from '../shared/ui/Skeleton.tsx';
import { useToast } from '../shared/ui/Toast.tsx';

/**
 * "What do I do first?"
 *
 * The courses page is eighteen tiles in a grid, which asks the newest member —
 * the person least able to answer — to design their own syllabus. This page
 * answers it instead: a named outcome, and the courses behind it in order.
 *
 * Nothing here locks. A step the member's tier cannot reach still shows its
 * title and its position, because seeing what Diamond contains is the argument
 * for buying Diamond; and a member already ahead can start at step four, which
 * a sequence that refused them would not allow.
 */

function Ring({ progress, size = 44 }: { progress: number; size?: number }) {
  const r = (size - 5) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={4} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={progress === 100 ? 'var(--green)' : 'var(--pink)'}
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={`${(circumference * progress) / 100} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size / 4}
        fontWeight="600"
        fill="var(--ink-2)"
      >
        {progress}
      </text>
    </svg>
  );
}

/**
 * Picking a path, and stepping off one.
 *
 * "Pick a path" used to navigate and nothing else, which meant the choice left
 * no trace: no way to show a member which of sixteen journeys is theirs, and
 * no moment at which finishing one could be noticed.
 *
 * Unfollowing is offered without a warning because it costs nothing —
 * progress lives on the lessons, so a member who drops a path and picks it up
 * next month finds the same courses ticked. Cheap to leave is what makes it
 * cheap to start.
 */
function FollowButton({ j }: { j: Journey }) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const follow = useMutation({
    mutationFn: () => api.followJourney(j.slug, !j.following),
    onSuccess: (updated) => {
      queryClient.setQueryData(['journey', j.slug], updated);
      queryClient.invalidateQueries({ queryKey: ['journeys'] });
      toast.show(updated.following ? `You are on ${updated.title}` : 'Path dropped — your progress stays');
    },
    onError: toast.error,
  });

  return (
    <button
      type="button"
      className={`btn ${j.following ? 'btn-soft' : 'btn-pink'} above-link`}
      style={j.following ? undefined : { color: '#fff' }}
      disabled={follow.isPending}
      onClick={(e) => {
        // The card behind this is one large link.
        e.preventDefault();
        e.stopPropagation();
        follow.mutate();
      }}
    >
      {j.following ? (
        <>
          <Icon name="check" size={13} strokeWidth={3} />
          On this path
        </>
      ) : (
        'Pick this path'
      )}
    </button>
  );
}

function JourneyCard({ j }: { j: Journey }) {
  const started = j.progress > 0;
  return (
    <div className="card lift card-linked" style={{ padding: '16px 18px', gap: 11 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        {/* The cover replaces the ring when there is one: a photograph says
            more about where a path goes than a percentage does, and the
            percentage is repeated in the line underneath either way. */}
        {j.coverUrl ? (
          <img
            src={j.coverUrl}
            alt=""
            loading="lazy"
            style={{ width: 96, aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
          />
        ) : (
          <Ring progress={j.progress} />
        )}
        <Link
          to="/journeys/$slug"
          params={{ slug: j.slug }}
          className="stretch-link"
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            color: 'inherit',
            textDecoration: 'none',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{j.title}</span>
            {j.minTier !== 'free' && <Chip tone="pink">{j.minTier}</Chip>}
            {j.progress === 100 && <Chip tone="green">Done</Chip>}
          </span>
          {/* The promise, not the title, is the product. */}
          <span style={{ fontSize: 12, lineHeight: 1.55 }} className="muted">
            {j.promise}
          </span>
        </Link>
      </div>

      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, flexWrap: 'wrap' }} className="dim">
        <span className="num">
          {j.stepsDone} of {j.stepCount} course{j.stepCount === 1 ? '' : 's'}
        </span>
        {j.nextCourseTitle && (
          <>
            <span>·</span>
            <span>
              {started ? 'Next' : 'Starts with'}: {j.nextCourseTitle}
            </span>
          </>
        )}
        <span style={{ flex: 1 }} />
        <FollowButton j={j} />
      </span>
    </div>
  );
}

export function JourneysPage() {
  const journeys = useQuery({ queryKey: ['journeys'], queryFn: api.journeys });

  return (
    <Page>
      <Hero
        tone="gold"
        eyebrow="Journeys · Where to start"
        title="One path at a time."
        sub="Eighteen courses is a library. A journey is a route through it — a named outcome, and the courses behind it in the order that works."
      />

      {journeys.isPending && (
        <>
          <LoadingLabel>Loading journeys</LoadingLabel>
          <SkeletonCard />
          <SkeletonCard />
        </>
      )}

      {journeys.data?.length === 0 && (
        <Card>
          <EmptyState
            icon="courses"
            title="No journeys yet"
            hint="Until there are, the courses page has everything — it just does not say where to begin."
          />
          <Link to="/courses" className="btn btn-soft" style={{ alignSelf: 'flex-start' }}>
            Browse courses
          </Link>
        </Card>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {journeys.data?.map((j) => <JourneyCard key={j.id} j={j} />)}
      </div>
    </Page>
  );
}

function StepRow({ step, index, isNext }: { step: JourneyStep; index: number; isNext: boolean }) {
  const body = (
    <>
      <span
        style={{
          width: 30,
          height: 30,
          borderRadius: 999,
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          fontSize: 11,
          fontWeight: 600,
          background: step.completed ? 'var(--green)' : isNext ? 'var(--pink)' : 'var(--soft)',
          color: step.completed || isNext ? '#fff' : 'var(--ink-3)',
        }}
      >
        {step.completed ? <Icon name="check" size={13} strokeWidth={3} color="#fff" /> : index + 1}
      </span>

      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: isNext ? 600 : 500 }}>{step.courseTitle}</span>
          {isNext && <Chip tone="pink">Start here</Chip>}
          {!step.reachable && <Chip>Upgrade to open</Chip>}
        </span>
        {/* The connective tissue: why this course, in this place. */}
        {step.note && (
          <span style={{ fontSize: 11, lineHeight: 1.5 }} className="muted">
            {step.note}
          </span>
        )}
        <span style={{ fontSize: 10 }} className="dim num">
          {step.lessonCount} lessons · {Math.round(step.durationMinutes / 60) || 1}h
          {step.progress > 0 && step.progress < 100 ? ` · ${step.progress}% done` : ''}
        </span>
      </span>

      <span
        className="hide-xs"
        style={{ width: 90, height: 5, borderRadius: 999, background: 'var(--track)', flexShrink: 0 }}
      >
        <span
          style={{
            display: 'block',
            width: `${step.progress}%`,
            height: '100%',
            borderRadius: 999,
            background: step.completed ? 'var(--green)' : 'var(--pink)',
          }}
        />
      </span>
    </>
  );

  const style = {
    display: 'flex',
    alignItems: 'center',
    gap: 13,
    padding: '13px 16px',
    color: 'inherit',
    textDecoration: 'none',
    opacity: step.reachable ? 1 : 0.55,
  } as const;

  // A step above the member's tier is shown but is not a door: opening it
  // would land on a course page that refuses them, which is a worse way to
  // say "upgrade" than the chip already does.
  if (!step.reachable) {
    return (
      <div className="card-row" style={style}>
        {body}
      </div>
    );
  }

  return (
    <Link to="/courses/$slug" params={{ slug: step.courseSlug }} className="card-row lift" style={style}>
      {body}
    </Link>
  );
}

export function JourneyDetailPage() {
  const { slug } = useParams({ from: '/journeys/$slug' });
  const journey = useQuery({ queryKey: ['journey', slug], queryFn: () => api.journey(slug) });

  if (journey.isPending) {
    return (
      <Page>
        <SkeletonCard />
        <SkeletonCard lines={4} />
      </Page>
    );
  }
  if (journey.error || !journey.data) {
    return (
      <Page>
        <Card>
          <EmptyState icon="courses" title="That journey is not here" />
          <Link to="/journeys" className="btn btn-soft" style={{ alignSelf: 'flex-start' }}>
            All journeys
          </Link>
        </Card>
      </Page>
    );
  }

  const j = journey.data;
  const nextSlug = j.nextCourseSlug;

  return (
    <Page>
      <PageHeader
        title={j.title}
        back="/journeys"
        crumbs={[{ label: 'Journeys', to: '/journeys' }, { label: j.title }]}
        actions={
          <>
            <FollowButton j={j} />
            {nextSlug && (
              <Link
                to="/courses/$slug"
                params={{ slug: nextSlug }}
                className="btn btn-pink"
                style={{ color: '#fff' }}
              >
                <Icon name="play" size={13} />
                {j.progress > 0 ? 'Continue' : 'Start'}
              </Link>
            )}
          </>
        }
      />

      {/* The moment. A derived progress number crosses 100% silently in the
          middle of whichever lesson happened to be last, so this is the only
          place the app says the thing the member actually came for. The job
          that sends the notification stamps `completedAt`; this does not wait
          for it, because somebody who just finished is looking at the screen
          now. */}
      {j.progress === 100 && j.following && (
        <div className="callout callout-green">
          <strong>You finished {j.title}.</strong> {j.promise} — that is {j.stepCount} course
          {j.stepCount === 1 ? '' : 's'} done. Worth telling somebody about.
          <Link to="/wins/submit" className="btn btn-soft" style={{ alignSelf: 'flex-start', marginTop: 8 }}>
            Share the win
          </Link>
        </div>
      )}

      {!j.following && j.progress < 100 && (
        <div className="callout">
          You are not on this path yet. Picking it puts it on your dashboard and keeps one route in front of you
          instead of eighteen courses — it locks nothing, and you can drop it whenever.
        </div>
      )}

      {j.coverUrl && (
        <img
          src={j.coverUrl}
          alt=""
          style={{ width: '100%', aspectRatio: '16 / 6', objectFit: 'cover', borderRadius: 'var(--r-card)' }}
        />
      )}

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Ring progress={j.progress} size={62} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{j.promise}</span>
            <span style={{ fontSize: 11 }} className="dim num">
              {j.stepsDone} of {j.stepCount} courses finished
              {j.progress === 100 ? ' · the whole path' : ''}
            </span>
          </div>
        </div>
        {j.descriptionMd && (
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.7 }} className="muted">
            {j.descriptionMd}
          </p>
        )}
      </Card>

      <span className="section-label">The path</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {j.steps.map((s, i) => (
          <StepRow key={s.id} step={s} index={i} isNext={s.courseSlug === nextSlug} />
        ))}
      </div>

      {j.steps.length === 0 && (
        <Card>
          <EmptyState icon="courses" title="No courses on this path yet" />
        </Card>
      )}
    </Page>
  );
}
