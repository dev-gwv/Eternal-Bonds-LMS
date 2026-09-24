import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { LessonInput, type AdminCourseDetail, type AdminLesson, type AdminModule, type Tier } from '@ipc/contracts';
import { adminApi, fetchViewer, uploadLessonVideo } from '../../shared/admin-api.ts';
import { QuizEditor } from './QuizEditor.tsx';
import { CoverPicker } from '../../shared/ui/CoverPicker.tsx';
import { clock } from '../../shared/api.ts';
import { PageHeader, Page } from '../../shared/layout/AppShell.tsx';
import { Card, Chip, Icon } from '../../shared/ui/primitives.tsx';
import { ConfirmButton, Empty, ErrorNote, Field, IconButton, InlineAdd, Select, Toolbar, slugify } from './studio-ui.tsx';
import { useToast } from '../../shared/ui/Toast.tsx';

/**
 * Where a course is actually built: metadata, modules, lessons, video.
 *
 * Reordering is up/down buttons rather than drag and drop. Drag is nicer with
 * a mouse and much worse with a keyboard or a trackpad on a long list, and the
 * whole order is sent on every move, so a dropped request cannot leave the
 * course in an order nobody chose.
 */

const CATEGORIES = ['business', 'marketing', 'mindset', 'sales', 'operations', 'sessions'] as const;
const LEVELS = ['beginner', 'intermediate', 'advanced', 'all'] as const;
const LANGUAGES = ['hindi', 'english'] as const;
const TIERS: readonly Tier[] = ['free', 'silver', 'diamond', 'franchisee'] as const;

const moved = <T,>(items: T[], from: number, to: number): T[] => {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
};

/* ── Video ─────────────────────────────────────────────────────────────────*/

function VideoCell({ lesson, courseId }: { lesson: AdminLesson; courseId: string }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [pasting, setPasting] = useState(false);
  const toast = useToast();

  // Which affordance this lesson gets. Asking for a file when the answer is a
  // URL is the kind of wrong affordance somebody fights for ten minutes.
  const viewer = useQuery({ queryKey: ['viewer'], queryFn: fetchViewer, staleTime: 5 * 60_000 });
  const isYouTube = viewer.data?.videoProvider === 'youtube';

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'course', courseId] });

  const upload = async (file: File) => {
    setError(null);
    setProgress(0);
    try {
      await uploadLessonVideo(lesson.id, file, setProgress);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
      if (input.current) input.current.value = ''; // So the same file can be retried.
    }
  };

  const detach = useMutation({
    mutationFn: () => adminApi.detachVideo(lesson.id),
    onSuccess: () => {
      refresh();
      toast.show('Video removed from the lesson');
    },
    onError: toast.error,
  });

  const attachLink = useMutation({
    mutationFn: () => adminApi.attachVideoLink(lesson.id, link.trim()),
    onSuccess: () => {
      setLink('');
      setPasting(false);
      refresh();
      toast.show('Video attached');
    },
    onError: toast.error,
  });

  if (progress !== null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, width: 150 }}>
        <div style={{ flex: 1, height: 4, borderRadius: 999, background: 'var(--track)' }}>
          <div
            style={{
              width: `${Math.round(progress * 100)}%`,
              height: '100%',
              borderRadius: 999,
              background: 'var(--pink)',
              transition: 'width 120ms linear',
            }}
          />
        </div>
        <span style={{ fontSize: 10 }} className="dim">
          {Math.round(progress * 100)}%
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <input
        ref={input}
        type="file"
        accept="video/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {error && (
        <span style={{ fontSize: 10, maxWidth: 180 }} className="field-error">
          {error}
        </span>
      )}
      {lesson.videoStatus === 'ready' ? (
        isYouTube && lesson.videoAssetId ? (
          // The id, linked. An author checking their own course wants to see
          // *which* video is attached, not merely that one is.
          <a
            href={`https://youtu.be/${lesson.videoAssetId}`}
            target="_blank"
            rel="noreferrer"
            title="Open on YouTube"
          >
            <Chip tone="green">
              <Icon name="check" size={10} strokeWidth={3} />
              {lesson.videoAssetId}
            </Chip>
          </a>
        ) : (
          <Chip tone="green">
            <Icon name="check" size={10} strokeWidth={3} />
            Video
          </Chip>
        )
      ) : lesson.videoStatus === 'processing' ? (
        <Chip tone="yellow">Transcoding</Chip>
      ) : lesson.videoStatus === 'uploading' ? (
        <Chip tone="yellow">Uploading</Chip>
      ) : lesson.videoStatus === 'errored' ? (
        // The provider's own words, on hover: "failed" alone is not actionable.
        <span title={lesson.videoError ?? undefined}>
          <Chip tone="pink">Failed</Chip>
        </span>
      ) : (
        <Chip>No video</Chip>
      )}
      {isYouTube ? (
        pasting ? (
          <>
            <input
              autoFocus
              value={link}
              placeholder="Paste the YouTube link"
              aria-label={`YouTube link for ${lesson.title}`}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && link.trim()) attachLink.mutate();
                if (e.key === 'Escape') { setPasting(false); setLink(''); }
              }}
              style={{ width: 260, fontSize: 11.5, padding: '7px 10px' }}
            />
            <button
              type="button"
              className="btn btn-pink"
              disabled={!link.trim() || attachLink.isPending}
              onClick={() => attachLink.mutate()}
            >
              {attachLink.isPending ? 'Saving…' : 'Attach'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => { setPasting(false); setLink(''); }}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-soft" onClick={() => setPasting(true)}>
            <Icon name="link" size={13} />
            {lesson.videoAssetId ? 'Replace link' : 'Add YouTube link'}
          </button>
        )
      ) : (
        <button type="button" className="btn btn-soft" onClick={() => input.current?.click()}>
          {lesson.videoAssetId ? 'Replace' : 'Upload'}
        </button>
      )}
      {lesson.videoAssetId && (
        <IconButton icon="back" label="Remove video" onClick={() => detach.mutate()} />
      )}
    </div>
  );
}

/* ── Lessons ───────────────────────────────────────────────────────────────*/

function LessonRow({
  lesson,
  courseId,
  index,
  count,
  onMove,
}: {
  lesson: AdminLesson;
  courseId: string;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(lesson.title);
  const [quizOpen, setQuizOpen] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'course', courseId] });

  // The row is the source of truth while it is being edited; once the server
  // answers, the server's value wins again.
  useEffect(() => setTitle(lesson.title), [lesson.title]);

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof adminApi.updateLesson>[1]) => adminApi.updateLesson(lesson.id, patch),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: () => adminApi.deleteLesson(lesson.id), onSuccess: refresh });

  return (
    <div className="builder-lesson">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <IconButton icon="chevron" label="Move up" disabled={index === 0} onClick={() => onMove(index, index - 1)} />
        <IconButton
          icon="chevron"
          label="Move down"
          disabled={index === count - 1}
          onClick={() => onMove(index, index + 1)}
        />
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() !== lesson.title && title.trim().length >= 2 && save.mutate({ title: title.trim() })}
        style={{
          flex: 1,
          minWidth: 0,
          font: 'inherit',
          fontSize: 12,
          fontWeight: 500,
          background: 'transparent',
          border: 0,
          color: 'var(--ink)',
        }}
      />

      <span style={{ fontSize: 10 }} className="dim">
        {lesson.durationSeconds ? clock(lesson.durationSeconds) : '—'}
      </span>

      <label className="switch" title="Preview lessons are playable by any member, whatever their tier">
        <input
          type="checkbox"
          checked={lesson.isPreview}
          onChange={(e) => save.mutate({ isPreview: e.target.checked })}
        />
        Preview
      </label>

      <VideoCell lesson={lesson} courseId={courseId} />

      <button
        type="button"
        className={quizOpen ? 'btn btn-pink' : 'btn btn-ghost'}
        style={quizOpen ? { color: '#fff', fontSize: 10 } : { fontSize: 10 }}
        onClick={() => setQuizOpen((v) => !v)}
      >
        Quiz
      </button>

      <ConfirmButton label="Delete" onConfirm={() => remove.mutate()} disabled={remove.isPending} />

      {/* Full width under the row, and only when asked for. A quiz is three
          questions with four options each; there is no version of that which
          fits in a table cell, and most lessons will never have one. */}
      {quizOpen && (
        <div style={{ gridColumn: '1 / -1', paddingTop: 10 }}>
          <QuizEditor lessonId={lesson.id} />
        </div>
      )}
    </div>
  );
}

function AddLesson({ moduleId, courseId }: { moduleId: string; courseId: string }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');

  const create = useMutation({
    mutationFn: () =>
      adminApi.createLesson(
        moduleId,
        LessonInput.parse({ title: title.trim(), slug: slugify(title), durationSeconds: 0, isPreview: false }),
      ),
    onSuccess: () => {
      setTitle('');
      queryClient.invalidateQueries({ queryKey: ['admin', 'course', courseId] });
    },
  });

  const valid = title.trim().length >= 2 && slugify(title).length >= 3;

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <InlineAdd
        value={title}
        onChange={setTitle}
        onSubmit={() => create.mutate()}
        placeholder="Add a lesson…"
        label="Add"
        hint="A lesson needs a name of two characters or more"
        valid={valid}
        busy={create.isPending}
        grow
      />
      <ErrorNote error={create.error} />
    </div>
  );
}

/* ── Modules ───────────────────────────────────────────────────────────────*/

function ModuleCard({
  module,
  courseId,
  index,
  count,
  onMove,
}: {
  module: AdminModule;
  courseId: string;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(module.title);
  const [order, setOrder] = useState(module.lessons);

  useEffect(() => setTitle(module.title), [module.title]);
  useEffect(() => setOrder(module.lessons), [module.lessons]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'course', courseId] });

  const [drip, setDrip] = useState(module.dripDays === null ? '' : String(module.dripDays));
  useEffect(() => setDrip(module.dripDays === null ? '' : String(module.dripDays)), [module.dripDays]);

  // Title and schedule save through the same call, because they are one row
  // and a partial update here would clear whichever field was not sent.
  const rename = useMutation({
    mutationFn: (next: { title?: string; dripDays?: number | null }) =>
      adminApi.updateModule(module.id, {
        title: next.title ?? title,
        dripDays: next.dripDays !== undefined ? next.dripDays : module.dripDays,
        availableFrom: module.availableFrom,
      }),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: () => adminApi.deleteModule(module.id), onSuccess: refresh });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => adminApi.reorderLessons(module.id, ids),
    onSuccess: refresh,
    // The list snaps back if the server refuses, rather than lying about it.
    onError: () => setOrder(module.lessons),
  });

  const move = (from: number, to: number) => {
    const next = moved(order, from, to);
    setOrder(next); // Optimistic: the row moves under the cursor immediately.
    reorder.mutate(next.map((l) => l.id));
  };

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <IconButton icon="chevron" label="Move module up" disabled={index === 0} onClick={() => onMove(index, index - 1)} />
          <IconButton
            icon="chevron"
            label="Move module down"
            disabled={index === count - 1}
            onClick={() => onMove(index, index + 1)}
          />
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() =>
            title.trim() !== module.title && title.trim().length >= 2 && rename.mutate({ title: title.trim() })
          }
          style={{
            flex: 1,
            font: 'inherit',
            fontSize: 13,
            fontWeight: 600,
            background: 'transparent',
            border: 0,
            color: 'var(--ink)',
          }}
        />
        {/* The drip, in the one place an author is already thinking about this
            module. A cohort's whole schedule is these numbers in a column. */}
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10 }}
          className="dim"
          title="Days after the member's cohort start (or enrolment) before this module opens. Blank opens it immediately."
        >
          Opens day
          <input
            type="number"
            min={0}
            max={365}
            value={drip}
            placeholder="—"
            aria-label={`Drip day for ${module.title}`}
            onChange={(e) => setDrip(e.target.value)}
            onBlur={() => {
              const next = drip.trim() === '' ? null : Math.max(0, Math.min(365, Number(drip)));
              if (next !== module.dripDays && !Number.isNaN(next)) rename.mutate({ dripDays: next });
            }}
            style={{
              width: 52,
              font: 'inherit',
              fontSize: 11,
              textAlign: 'center',
              background: 'var(--soft)',
              border: '1px solid transparent',
              borderRadius: 'var(--r-ctl)',
              padding: '4px 6px',
              color: 'var(--ink)',
            }}
          />
        </label>
        <span style={{ fontSize: 10 }} className="dim">
          {module.lessons.length} lesson{module.lessons.length === 1 ? '' : 's'}
        </span>
        <ConfirmButton
          label="Delete module"
          onConfirm={() => remove.mutate()}
          disabled={remove.isPending || module.lessons.length > 0}
        />
      </div>

      <ErrorNote error={rename.error ?? remove.error ?? reorder.error} />

      {order.length === 0 ? (
        <Empty>No lessons in this module yet.</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {order.map((lesson, i) => (
            <LessonRow
              key={lesson.id}
              lesson={lesson}
              courseId={courseId}
              index={i}
              count={order.length}
              onMove={move}
            />
          ))}
        </div>
      )}

      <AddLesson moduleId={module.id} courseId={courseId} />
    </Card>
  );
}

/* ── Course settings ───────────────────────────────────────────────────────*/

function Settings({ course }: { course: AdminCourseDetail }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({
    title: course.title,
    slug: course.slug,
    category: course.category,
    level: course.level,
    language: course.language,
    minTier: course.minTier,
    summaryMd: course.summaryMd ?? '',
    instructorName: course.instructorName ?? '',
  });

  useEffect(() => {
    setDraft({
      title: course.title,
      slug: course.slug,
      category: course.category,
      level: course.level,
      language: course.language,
      minTier: course.minTier,
      summaryMd: course.summaryMd ?? '',
      instructorName: course.instructorName ?? '',
    });
  }, [course]);

  const save = useMutation({
    mutationFn: () =>
      adminApi.updateCourse(course.id, {
        ...draft,
        summaryMd: draft.summaryMd.trim() === '' ? null : draft.summaryMd,
        instructorName: draft.instructorName.trim() === '' ? null : draft.instructorName.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'course', course.id] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'courses'] });
    },
  });

  const dirty =
    draft.title !== course.title ||
    draft.slug !== course.slug ||
    draft.category !== course.category ||
    draft.level !== course.level ||
    draft.language !== course.language ||
    draft.minTier !== course.minTier ||
    draft.summaryMd !== (course.summaryMd ?? '') ||
    draft.instructorName !== (course.instructorName ?? '');

  return (
    <Card title="Course settings">
      <ErrorNote error={save.error} />
      <div className="field-row">
        <Field label="Title">
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </Field>
        <Field label="URL">
          <input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Category">
          <Select value={draft.category} options={CATEGORIES} onChange={(category) => setDraft({ ...draft, category })} />
        </Field>
        <Field label="Level">
          <Select value={draft.level} options={LEVELS} onChange={(level) => setDraft({ ...draft, level })} />
        </Field>
        <Field label="Language">
          <Select value={draft.language} options={LANGUAGES} onChange={(language) => setDraft({ ...draft, language })} />
        </Field>
        <Field label="Minimum tier">
          <Select value={draft.minTier} options={TIERS} onChange={(minTier) => setDraft({ ...draft, minTier })} />
        </Field>
      </div>
      <CoverPicker
        kind="course"
        id={course.id}
        coverUrl={course.coverUrl}
        invalidate={[['admin', 'course', course.id], ['admin', 'courses'], ['courses']]}
      />

      <Field label="Taught by">
        <input
          value={draft.instructorName}
          placeholder="Abdullah"
          onChange={(e) => setDraft({ ...draft, instructorName: e.target.value })}
        />
      </Field>

      <Field label="Summary">
        <textarea
          value={draft.summaryMd}
          placeholder="What a member will be able to do after finishing this course."
          onChange={(e) => setDraft({ ...draft, summaryMd: e.target.value })}
        />
      </Field>
      <Toolbar>
        <button type="button" className="btn btn-pink" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
        {dirty && (
          <span style={{ fontSize: 10 }} className="dim">
            Unsaved changes
          </span>
        )}
      </Toolbar>
    </Card>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────────*/

export function CourseBuilderPage() {
  const { id } = useParams({ from: '/admin/courses/$id' });
  const queryClient = useQueryClient();
  const [newModule, setNewModule] = useState('');
  const [order, setOrder] = useState<AdminModule[]>([]);

  const course = useQuery({
    queryKey: ['admin', 'course', id],
    queryFn: () => adminApi.course(id),
    // A transcode finishes on the provider's schedule and tells the API by
    // webhook. Polling while anything is in flight is what turns that into a
    // badge that changes by itself; it stops the moment nothing is pending.
    refetchInterval: (query) =>
      query.state.data?.modules.some((m) =>
        m.lessons.some((l) => l.videoStatus === 'processing' || l.videoStatus === 'uploading'),
      )
        ? 8000
        : false,
  });

  useEffect(() => {
    if (course.data) setOrder(course.data.modules);
  }, [course.data]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'course', id] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'courses'] });
  };

  const addModule = useMutation({
    mutationFn: () =>
      adminApi.createModule(id, { title: newModule.trim(), dripDays: null, availableFrom: null }),
    onSuccess: () => {
      setNewModule('');
      refresh();
    },
  });
  const publish = useMutation({
    mutationFn: (next: boolean) => adminApi.publishCourse(id, next),
    onSuccess: refresh,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => adminApi.reorderModules(id, ids),
    onSuccess: refresh,
    onError: () => course.data && setOrder(course.data.modules),
  });

  const moveModule = (from: number, to: number) => {
    const next = moved(order, from, to);
    setOrder(next);
    reorder.mutate(next.map((m) => m.id));
  };

  if (course.isLoading) {
    return (
      <Page>
        <span style={{ fontSize: 12 }} className="muted">Loading the course…</span>
      </Page>
    );
  }
  if (course.error || !course.data) {
    return (
      <Page>
        <ErrorNote error={course.error ?? new Error('Course not found')} />
      </Page>
    );
  }

  const data = course.data;

  return (
    <Page>
      <PageHeader
        title={data.title}
        back="/admin"
        crumbs={[{ label: 'Studio', to: '/admin' }, { label: data.title }]}
        actions={
          <Toolbar>
            {data.isPublished ? <Chip tone="green">Published</Chip> : <Chip tone="yellow">Draft</Chip>}
            <button
              type="button"
              className={data.isPublished ? 'btn btn-soft' : 'btn btn-green'}
              disabled={publish.isPending}
              onClick={() => publish.mutate(!data.isPublished)}
            >
              {data.isPublished ? 'Unpublish' : 'Publish'}
            </button>
          </Toolbar>
        }
      />

      {/* Publishing is refused server-side when lessons have no video; saying so
          here means the author is not surprised by a 409. */}
      <ErrorNote error={publish.error ?? reorder.error} />

      <Settings course={data} />

      <Toolbar>
        <span className="section-label">Curriculum</span>
        <span style={{ flex: 1 }} />
        <span style={{ width: 'min(340px, 100%)' }}>
          <InlineAdd
            value={newModule}
            onChange={setNewModule}
            onSubmit={() => addModule.mutate()}
            placeholder="Week one, Getting started…"
            label="Add module"
            hint="Give the module a name — two characters or more"
            valid={newModule.trim().length >= 2}
            busy={addModule.isPending}
            grow
          />
        </span>
      </Toolbar>

      <ErrorNote error={addModule.error} />

      {order.length === 0 ? (
        <Empty>A course is a list of modules, and a module is a list of lessons. Add the first module above.</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {order.map((m, i) => (
            <ModuleCard key={m.id} module={m} courseId={id} index={i} count={order.length} onMove={moveModule} />
          ))}
        </div>
      )}
    </Page>
  );
}
