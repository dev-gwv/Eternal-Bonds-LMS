import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useParams } from '@tanstack/react-router';
import { api } from '../shared/api.ts';
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
