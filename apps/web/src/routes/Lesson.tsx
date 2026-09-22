import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import type { CourseDetail, Lesson } from '@ipc/contracts';
import { api, clock } from '../shared/api.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { VideoPlayer } from '../shared/ui/VideoPlayer.tsx';
import { Card, Chip, Icon } from '../shared/ui/primitives.tsx';

type Tab = 'notes' | 'files' | 'qa';

/** Flattens the module tree so "next lesson" is a single index step. */
function flatten(course: CourseDetail | undefined) {
  return course?.modules.flatMap((m) => m.lessons.map((l) => ({ ...l, moduleTitle: m.title }))) ?? [];
}

export function LessonPage() {
  const { courseSlug, lessonSlug } = useParams({ from: '/learn/$courseSlug/$lessonSlug' });
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('notes');

  const course = useQuery({ queryKey: ['course', courseSlug], queryFn: () => api.course(courseSlug) });
  const all = useMemo(() => flatten(course.data), [course.data]);
  const current = all.find((l) => l.slug === lessonSlug);
  const index = current ? all.findIndex((l) => l.id === current.id) : -1;
  const next = index >= 0 ? all[index + 1] : undefined;

  const playback = useQuery({
    queryKey: ['playback', current?.id],
    queryFn: () => api.playback(current!.id),
    enabled: Boolean(current),
    // Tickets expire; do not let the cache serve a stale one.
    staleTime: 10 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const saveProgress = useMutation({
    mutationFn: (vars: { lessonId: string; positionSeconds: number; watchedSeconds: number; completed?: boolean }) =>
      api.saveProgress(vars.lessonId, {
        positionSeconds: vars.positionSeconds,
        watchedSeconds: vars.watchedSeconds,
        completed: vars.completed,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['course', courseSlug] });
      void queryClient.invalidateQueries({ queryKey: ['courses'] });
    },
  });

  // Identity is stable so the player's unmount flush does not fire on re-render.
  const handleProgress = useCallback(
    (positionSeconds: number, watchedSeconds: number) => {
      if (!current) return;
      saveProgress.mutate({ lessonId: current.id, positionSeconds, watchedSeconds });
    },
    [current?.id],
  );

  const handleEnded = useCallback(() => {
    if (!current || current.completed) return;
    // Reaching the end counts as done, in addition to the manual toggle.
    saveProgress.mutate({
      lessonId: current.id,
      positionSeconds: current.durationSeconds,
      watchedSeconds: 0,
      completed: true,
    });
  }, [current?.id, current?.completed]);

  if (course.isPending) {
    return (
      <Page>
        <p className="muted" style={{ fontSize: 12 }}>Loading course…</p>
      </Page>
    );
  }

  if (!course.data || !current) {
    return (
      <Page>
        <Card>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Lesson not found</span>
          <Link to="/courses" style={{ fontSize: 12 }}>Back to courses</Link>
        </Card>
      </Page>
    );
  }

  const done = all.filter((l) => l.completed).length;

  return (
    <Page>
      <PageHeader
        title={current.title}
        back="/courses"
        crumbs={[
          { label: 'Courses', to: '/courses' },
          { label: course.data.title },
          { label: current.title },
        ]}
        actions={
          <>
            <span style={{ fontSize: 11 }} className="dim">
              {done} of {all.length} complete
            </span>
            <div style={{ width: 120, height: 6, borderRadius: 999, background: 'var(--track)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${course.data.progress}%`,
                  height: 6,
                  borderRadius: 999,
                  background: 'var(--s1)',
                }}
              />
            </div>
          </>
        }
      />

      <div className="content">
        <div className="col col-main">
          <VideoPlayer
            src={playback.data?.url ?? null}
            startAt={current.lastPositionSeconds}
            title={current.title}
            onProgress={handleProgress}
            onEnded={handleEnded}
          />

          {playback.isError && (
            <div className="callout" style={{ background: '#fdeaea', color: '#8a1f1f' }}>
              {playback.error.message}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18 }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{current.title}</h2>
              <span style={{ fontSize: 11 }} className="dim">
                {current.moduleTitle} · {clock(current.durationSeconds)}
                {current.lastPositionSeconds > 0 && !current.completed && (
                  <> · resuming at {clock(current.lastPositionSeconds)}</>
                )}
              </span>
            </div>
            <button
              type="button"
              className={current.completed ? 'btn btn-green btn-sq' : 'btn btn-pink btn-sq'}
              style={{ padding: '12px 18px' }}
              disabled={saveProgress.isPending}
              onClick={() =>
                saveProgress.mutate({
                  lessonId: current.id,
                  positionSeconds: current.lastPositionSeconds,
                  watchedSeconds: 0,
                  completed: !current.completed,
                })
              }
            >
              <Icon name="check" size={15} strokeWidth={2.6} />
              {current.completed ? 'Completed' : saveProgress.isPending ? 'Saving…' : 'Mark complete'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--rule)' }}>
            {(
              [
                ['notes', 'Notes'],
                ['files', 'Files'],
                ['qa', 'Q&A'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className="btn btn-ghost"
                style={{
                  padding: '8px 12px',
                  borderRadius: 0,
                  borderBottom: tab === key ? '2px solid var(--pink)' : '2px solid transparent',
                  color: tab === key ? 'var(--ink)' : 'var(--ink-2)',
                  fontWeight: tab === key ? 600 : 500,
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'notes' && <LessonNotesPanel lessonId={current.id} />}
          {tab === 'files' && <LessonFilesPanel lessonId={current.id} title={current.title} />}
          {tab === 'qa' && <LessonQaPanel lessonId={current.id} />}
        </div>

        <aside className="col rail">
          <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--rule)' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{course.data.title}</div>
              <div style={{ fontSize: 10, marginTop: 2 }} className="dim">
                {all.length} lessons · {Math.round(course.data.durationMinutes / 60)}h
              </div>
            </div>

            {course.data.modules.map((m) => (
              <div key={m.id}>
                <div
                  style={{
                    padding: '10px 16px',
                    background: 'var(--soft)',
                    fontSize: 10,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-3)',
                    fontWeight: 500,
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ flex: 1 }}>{m.title}</span>
                    {/* A drip should read as a date, not a mystery. A member
                        who can see that Week two opens on Tuesday comes back
                        on Tuesday; one who sees a padlock does not. */}
                    {m.unlocksAt && (
                      <span style={{ textTransform: 'none', letterSpacing: 0, fontSize: 10 }}>
                        Opens{' '}
                        {new Date(m.unlocksAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                  </span>
                </div>
                {m.lessons.map((l) => (
                  <LessonRow key={l.id} lesson={l} courseSlug={courseSlug} active={l.id === current.id} />
                ))}
              </div>
            ))}
          </Card>

          {next && (
            <Card>
              <span className="section-label">Up next</span>
              <Link
                to="/learn/$courseSlug/$lessonSlug"
                params={{ courseSlug, lessonSlug: next.slug }}
                style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}
              >
                {next.title}
              </Link>
              <span style={{ fontSize: 10 }} className="dim">{clock(next.durationSeconds)}</span>
            </Card>
          )}
        </aside>
      </div>
    </Page>
  );
}

function LessonRow({
  lesson,
  courseSlug,
  active,
}: {
  lesson: Lesson;
  courseSlug: string;
  active: boolean;
}) {
  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    padding: '11px 16px',
    borderTop: '1px solid var(--softer)',
    background: active ? 'var(--pink-tint)' : 'transparent',
    color: 'var(--ink)',
    opacity: lesson.locked ? 0.5 : 1,
    cursor: lesson.locked ? 'default' : 'pointer',
  } as const;

  const body = (
    <>
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 999,
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          background: lesson.completed ? 'var(--s1)' : 'transparent',
          border: lesson.completed ? 'none' : `1.5px solid ${active ? 'var(--pink-ink)' : 'var(--hair)'}`,
          color: '#fff',
        }}
      >
        {lesson.completed ? (
          <Icon name="check" size={10} strokeWidth={3.4} color="#fff" />
        ) : active ? (
          <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--pink-ink)' }} />
        ) : null}
      </span>
      <span
        style={{
          flex: 1,
          fontSize: 11.5,
          fontWeight: active ? 600 : 400,
          color: lesson.completed && !active ? 'var(--ink-2)' : 'var(--ink)',
          lineHeight: 1.35,
        }}
      >
        {lesson.title}
      </span>
      {lesson.isPreview && !lesson.completed && <Chip tone="blue">Free</Chip>}
      <span style={{ fontSize: 10 }} className="dim">{clock(lesson.durationSeconds)}</span>
    </>
  );

  // A locked row is a span, not a link. The API refuses playback anyway, but
  // sending somebody to a page that will refuse them is a worse way to say
  // "not yet" than simply not being clickable.
  if (lesson.locked) {
    return (
      <span style={rowStyle} aria-disabled>
        {body}
      </span>
    );
  }

  return (
    <Link to="/learn/$courseSlug/$lessonSlug" params={{ courseSlug, lessonSlug: lesson.slug }} style={rowStyle}>
      {body}
    </Link>
  );
}

/* ── Lesson panels: notes, files, Q&A — backed by /v1/learning ────────── */

function LessonNotesPanel({ lessonId }: { lessonId: string }) {
  const qc = useQueryClient();
  const note = useQuery({ queryKey: ['note', lessonId], queryFn: () => api.lessonNote(lessonId) });
  const [draft, setDraft] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (bodyMd: string) => api.saveNote(lessonId, bodyMd),
    onSuccess: () => { setDraft(null); qc.invalidateQueries({ queryKey: ['note', lessonId] }); },
  });
  return (
    <Card>
      <textarea className="input" rows={5} aria-label="Lesson notes"
        placeholder="Take notes — they stay with this lesson."
        value={draft ?? note.data?.bodyMd ?? ''}
        onChange={(e) => setDraft(e.target.value)} />
      <button className="btn btn-pink" disabled={save.isPending || draft === null}
        onClick={() => draft !== null && save.mutate(draft)}>Save notes</button>
    </Card>
  );
}

function LessonFilesPanel({ lessonId, title }: { lessonId: string; title: string }) {
  const files = useQuery({ queryKey: ['resources', lessonId], queryFn: () => api.lessonResources(lessonId) });
  if (files.isPending) return <Card><span className="muted" style={{ fontSize: 12 }}>Loading files…</span></Card>;
  if (!files.data || files.data.length === 0) return (
    <Card><span className="muted" style={{ fontSize: 12 }}>No files for {title} yet.</span></Card>
  );
  return (
    <Card>
      {files.data.map((f) => (
        <div className="card-row" key={f.id}>
          <Icon name="file" size={16} color="var(--ink-3)" />
          <span style={{ flex: 1, fontSize: 12 }}>{f.title}</span>
          <Chip>{f.mime.split('/')[1]?.toUpperCase() ?? 'FILE'}</Chip>
          <a className="btn btn-blue btn-sq" href={f.url} download>Download</a>
        </div>
      ))}
    </Card>
  );
}

function LessonQaPanel({ lessonId }: { lessonId: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const questions = useQuery({ queryKey: ['questions', lessonId], queryFn: () => api.lessonQuestions(lessonId) });
  const ask = useMutation({
    mutationFn: () => api.askQuestion(lessonId, draft),
    onSuccess: () => { setDraft(''); qc.invalidateQueries({ queryKey: ['questions', lessonId] }); },
  });
  return (
    <Card>
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="input" placeholder="Ask at the point of confusion…" value={draft}
          onChange={(e) => setDraft(e.target.value)} aria-label="Ask a question" />
        <button className="btn btn-pink" disabled={draft.trim().length < 4 || ask.isPending}
          onClick={() => ask.mutate()}>Ask</button>
      </div>
      {questions.data?.map((q) => (
        <div key={q.id} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{q.author.name}</span>
          {q.resolved && <Chip tone="green">Resolved</Chip>}
          <p style={{ fontSize: 12, margin: '4px 0' }}>{q.bodyMd}</p>
          {q.replies.map((r) => (
            <p key={r.id} style={{ fontSize: 11, marginLeft: 16 }} className="muted">
              <strong>{r.authorName}:</strong> {r.bodyMd}
            </p>
          ))}
        </div>
      ))}
    </Card>
  );
}
