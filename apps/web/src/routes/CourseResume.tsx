import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useParams } from '@tanstack/react-router';
import { api } from '../shared/api.ts';
import { ErrorState, isNotFound } from '../shared/ui/ErrorState.tsx';
import { Page } from '../shared/layout/AppShell.tsx';
import { Card } from '../shared/ui/primitives.tsx';

/**
 * Opening a course means continuing it. This resolves the syllabus and sends
 * the member to the first lesson they have not finished — or the first lesson
 * if the course is done — rather than making them hunt for their place.
 */
export function CourseResumePage() {
  const { slug } = useParams({ from: '/courses/$slug' });
  const course = useQuery({ queryKey: ['course', slug], queryFn: () => api.course(slug) });

  if (course.isPending) {
    return (
      <Page>
        <p className="muted" style={{ fontSize: 12 }}>Opening course…</p>
      </Page>
    );
  }

  // A failed request is not an empty course. Only a real 404 falls through.
  if (course.isError && !isNotFound(course.error)) {
    return (
      <Page>
        <ErrorState onRetry={course.refetch} retrying={course.isFetching} />
      </Page>
    );
  }

  if (course.isError) return <LockedOrMissing slug={slug} />;

  const lessons = course.data?.modules.flatMap((m) => m.lessons) ?? [];
  const target = lessons.find((l) => !l.completed) ?? lessons[0];

  if (!course.data || !target) {
    return (
      <Page>
        <Card>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Nothing to play yet</span>
          <span style={{ fontSize: 12 }} className="muted">
            This course has no published lessons.
          </span>
          <Link to="/courses" style={{ fontSize: 12 }}>Back to courses</Link>
        </Card>
      </Page>
    );
  }

  return (
    <Navigate
      to="/learn/$courseSlug/$lessonSlug"
      params={{ courseSlug: slug, lessonSlug: target.slug }}
      replace
    />
  );
}

/**
 * A course this member cannot open reads as not found — RLS hides it, on
 * purpose. If a package includes it, though, that is the useful answer: say
 * which, and link to it.
 */
function LockedOrMissing({ slug }: { slug: string }) {
  const offers = useQuery({ queryKey: ['packages', 'for-course', slug], queryFn: () => api.packagesForCourse(slug) });
  const first = offers.data?.[0];
  return (
    <Page>
      <Card>
        {first ? (
          <>
            <span style={{ fontSize: 13, fontWeight: 600 }}>This course is part of a package</span>
            <span style={{ fontSize: 12 }} className="muted">
              It opens for members who have {offers.data!.length > 1 ? 'one of these packages' : 'this package'}:
            </span>
            {offers.data!.map((p) => (
              <Link key={p.slug} to="/packages/$slug" params={{ slug: p.slug }} className="btn btn-pink" style={{ alignSelf: 'flex-start' }}>
                {p.title}
              </Link>
            ))}
          </>
        ) : (
          <span style={{ fontSize: 13, fontWeight: 600 }}>{offers.isPending ? 'Checking…' : 'Course not found'}</span>
        )}
        <Link to="/courses" style={{ fontSize: 12 }}>Back to courses</Link>
      </Card>
    </Page>
  );
}
