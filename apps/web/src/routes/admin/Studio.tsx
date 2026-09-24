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

/** Anything with a scheme or a dotted host — enough to catch a pasted link. */
const looksLikeUrl = (v: string) => /^[a-z]+:\/\//i.test(v) || /^(www\.|[\w-]+\.[a-z]{2,})/i.test(v);

function NewCourseForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [touchedSlug, setTouchedSlug] = useState(false);
  /** Set when somebody pastes a link into the address field — usually the video. */
  const [pastedUrl, setPastedUrl] = useState(false);
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

  /**
   * Why the button is off, field by field.
   *
   * It used to be `valid = safeParse(...).success` and a `disabled` prop, and
   * that is the whole story of this form's worst bug: somebody pasted a
   * YouTube URL into the field labelled "URL", the slug rule rejected it, and
   * the only thing that happened was that Create draft went grey. No message,
   * nothing marked, nothing to read. From the author's side the studio had
   * simply stopped letting them make courses.
   */
  const parsed = CourseInput.safeParse({
    title: title.trim(),
    slug: effectiveSlug,
    category,
    level,
    language,
    minTier,
  });
  const errors: Record<string, string> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      errors[key] ??= issue.message;
    }
  }
  const valid = parsed.success;

  return (
    <Card title="New course">
      <ErrorNote error={create.error} />
      <div className="field-row">
        <Field label="Title" error={title.trim() === '' ? null : errors.title}>
          <input
            value={title}
            autoFocus
            placeholder="Lighting for Indian weddings"
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        {/* Was labelled "URL", which invited exactly one mistake: pasting the
            video. This is the course's own address on the site, so it says so
            and shows the part it is appended to. Video belongs on a lesson —
            there is nowhere on a course to put one. */}
        <Field
          label="Page address"
          error={
            pastedUrl
              ? 'That is a link, not a page address. A video goes on a lesson, inside the course.'
              : errors.slug
          }
        >
          <span className="input-prefixed">
            <span className="input-prefix">/courses/</span>
            <input
              value={effectiveSlug}
              placeholder="lighting-for-indian-weddings"
              onChange={(e) => {
                setTouchedSlug(true);
                setSlug(e.target.value);
              }}
              /* Tidied when they leave the field rather than as they type,
                 which would fight anybody typing a hyphen.

                 A pasted URL is thrown away rather than slugified. Running
                 `slugify` over a YouTube link produces
                 `https-www-youtube-com-watch-v-gmsq0199bw0`, which passes the
                 rule — so the form goes green and the course is created at
                 that address. Silently accepting nonsense is worse than the
                 error was: the author cannot see that anything went wrong
                 until they look at the live URL. So it reverts to the
                 title-derived default and says where the video actually
                 goes. */
              onBlur={(e) => {
                const raw = e.target.value.trim();
                if (looksLikeUrl(raw)) {
                  setTouchedSlug(false);
                  setSlug('');
                  setPastedUrl(true);
                  return;
                }
                setPastedUrl(false);
                setSlug(slugify(raw));
              }}
            />
          </span>
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
        <span style={{ fontSize: 10, textAlign: 'right' }} className="dim">
          {valid || title.trim() === ''
            ? 'Created as a draft. Nothing is visible to members until you publish it.'
            : `Cannot create yet — ${Object.values(errors)[0]?.toLowerCase()}.`}
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
        <Link to="/admin/revenue" className="btn btn-soft">
          <Icon name="chart" size={13} />
          Revenue
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
        <Link to="/admin/library" className="btn btn-soft">
          <Icon name="library" size={13} />
          Library
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
