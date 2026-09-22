import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { CourseInput, type AdminCourse, type Tier } from '@ipc/contracts';
import { adminApi } from '../../shared/admin-api.ts';
import { durationLabel } from '../../shared/api.ts';
import { PageHeader, Page } from '../../shared/layout/AppShell.tsx';
import { Card, Chip, Icon, StatTile } from '../../shared/ui/primitives.tsx';
import { ConfirmButton, ErrorNote, Empty, Field, Select, Toolbar, slugify } from './studio-ui.tsx';

/**
 * The studio's front door: what exists, and the one button that creates more.
 *
 * Drafts sit alongside published courses rather than behind a filter — a draft
 * that is easy to lose track of is how a course ends up half-finished for a
 * year.
 */

const CATEGORIES = ['business', 'marketing', 'mindset', 'sales', 'operations', 'sessions'] as const;
const LEVELS = ['beginner', 'intermediate', 'advanced', 'all'] as const;
const LANGUAGES = ['hindi', 'english'] as const;
const TIERS: readonly Tier[] = ['free', 'silver', 'diamond', 'franchisee'] as const;

function NewCourseForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [touchedSlug, setTouchedSlug] = useState(false);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('business');
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('beginner');
  const [language, setLanguage] = useState<(typeof LANGUAGES)[number]>('hindi');
  const [minTier, setMinTier] = useState<Tier>('diamond');

  // The slug follows the title until someone edits it, then it stops moving —
  // a URL that keeps changing under an author is worse than one they set once.
  const effectiveSlug = touchedSlug ? slug : slugify(title);

  const create = useMutation({
    mutationFn: () =>
      adminApi.createCourse(
        CourseInput.parse({
          title: title.trim(),
          slug: effectiveSlug,
          category,
          level,
          language,
          minTier,
          summaryMd: null,
          isPublished: false,
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'courses'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] });
      onDone();
    },
  });

  const valid = CourseInput.safeParse({
    title: title.trim(),
    slug: effectiveSlug,
    category,
    level,
    language,
    minTier,
  }).success;

  return (
    <Card title="New course">
      <ErrorNote error={create.error} />
      <div className="field-row">
        <Field label="Title">
          <input
            value={title}
            autoFocus
            placeholder="Lighting for Indian weddings"
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="URL">
          <input
            value={effectiveSlug}
            placeholder="lighting-for-indian-weddings"
            onChange={(e) => {
              setTouchedSlug(true);
              setSlug(e.target.value);
            }}
          />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Category">
          <Select value={category} options={CATEGORIES} onChange={setCategory} />
        </Field>
        <Field label="Level">
          <Select value={level} options={LEVELS} onChange={setLevel} />
        </Field>
        <Field label="Language">
          <Select value={language} options={LANGUAGES} onChange={setLanguage} />
        </Field>
        <Field label="Minimum tier">
          <Select value={minTier} options={TIERS} onChange={setMinTier} />
        </Field>
      </div>
      <Toolbar>
        <button
          type="button"
          className="btn btn-pink"
          disabled={!valid || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? 'Creating…' : 'Create draft'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10 }} className="dim">
          Created as a draft. Nothing is visible to members until you publish it.
        </span>
      </Toolbar>
    </Card>
  );
}

function CourseRow({ course }: { course: AdminCourse }) {
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'courses'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] });
  };

  const publish = useMutation({
    mutationFn: (next: boolean) => adminApi.publishCourse(course.id, next),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: () => adminApi.deleteCourse(course.id), onSuccess: refresh });

  return (
    <div className="card" style={{ gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Link
          to="/admin/courses/$id"
          params={{ id: course.id }}
          style={{ color: 'inherit', flex: 1, minWidth: 0 }}
        >
          <span className="card-title">{course.title}</span>
        </Link>
        {course.isPublished ? <Chip tone="green">Published</Chip> : <Chip tone="yellow">Draft</Chip>}
        <Chip>{course.minTier}</Chip>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11 }} className="muted">
        <span>/{course.slug}</span>
        <span>·</span>
        <span>{course.lessonCount} lessons</span>
        <span>·</span>
        <span>{durationLabel(course.durationMinutes)}</span>
        <span style={{ flex: 1 }} />
        <Link to="/admin/courses/$id" params={{ id: course.id }} className="btn btn-soft">
          <Icon name="edit" size={13} />
          Edit
        </Link>
        <button
          type="button"
          className={course.isPublished ? 'btn btn-soft' : 'btn btn-green'}
          disabled={publish.isPending}
          onClick={() => publish.mutate(!course.isPublished)}
        >
          {course.isPublished ? 'Unpublish' : 'Publish'}
        </button>
        {!course.isPublished && (
          <ConfirmButton label="Delete" onConfirm={() => remove.mutate()} disabled={remove.isPending} />
        )}
      </div>

      <ErrorNote error={publish.error ?? remove.error} />
    </div>
  );
}

export function StudioPage() {
  const [creating, setCreating] = useState(false);

  const overview = useQuery({ queryKey: ['admin', 'overview'], queryFn: adminApi.overview });
  const courses = useQuery({ queryKey: ['admin', 'courses'], queryFn: adminApi.courses });

  return (
    <Page>
      <PageHeader
        title="Studio"
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Studio' }]}
        actions={
          <button type="button" className="btn btn-pink" onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} />
            New course
          </button>
        }
      />

      {overview.data && (
        <div className="grid grid-4">
          <StatTile
            label="Published courses"
            value={String(overview.data.courses.published)}
            tone="green"
            icon={<Icon name="courses" />}
          />
          <StatTile
            label="Drafts"
            value={String(overview.data.courses.draft)}
            tone="yellow"
            icon={<Icon name="edit" />}
          />
          <StatTile
            label="Lessons without video"
            value={String(overview.data.lessons.withoutVideo)}
            tone="pink"
            icon={<Icon name="play" />}
          />
          <StatTile
            label="Upcoming workshops"
            value={String(overview.data.workshops.upcoming)}
            tone="blue"
            icon={<Icon name="workshops" />}
          />
        </div>
      )}

      {creating && <NewCourseForm onDone={() => setCreating(false)} />}

      <Toolbar>
        <span className="section-label">Courses</span>
        <span style={{ flex: 1 }} />
        <Link to="/admin/members" className="btn btn-soft">
          <Icon name="people" size={13} />
          Members
        </Link>
        <Link to="/admin/journeys" className="btn btn-soft">
          <Icon name="chart" size={13} />
          Journeys
        </Link>
        <Link to="/admin/cohorts" className="btn btn-soft">
          <Icon name="calendar" size={13} />
          Cohorts
        </Link>
        <Link to="/admin/workshops" className="btn btn-soft">
          <Icon name="workshops" size={13} />
          Workshops
        </Link>
      </Toolbar>

      <ErrorNote error={courses.error ?? overview.error} />

      {courses.isLoading && <span style={{ fontSize: 12 }} className="muted">Loading…</span>}

      {courses.data?.length === 0 && (
        <Empty>Nothing here yet. Create a course, add a module, then add lessons to it.</Empty>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {courses.data?.map((c) => (
          <CourseRow key={c.id} course={c} />
        ))}
      </div>
    </Page>
  );
}
