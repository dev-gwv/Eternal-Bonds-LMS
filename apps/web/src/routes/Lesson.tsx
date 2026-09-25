import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import type { CourseDetail, Lesson } from '@ipc/contracts';
import { api, clock } from '../shared/api.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { VideoPlayer } from '../shared/ui/VideoPlayer.tsx';
import { YouTubePlayer } from '../shared/ui/YouTubePlayer.tsx';
import { Card, Chip, Icon } from '../shared/ui/primitives.tsx';
import { useToast } from '../shared/ui/Toast.tsx';
import { LessonQuiz } from '../shared/ui/LessonQuiz.tsx';

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

  // The module this lesson belongs to, for the drip date.
  const currentModule = course.data?.modules.find((m) => m.lessons.some((l) => l.slug === lessonSlug));

  /**
   * Whether to show the gate instead of the player.
   *
   * The server already refuses playback — this is not the security boundary,
   * and the comment on getPlaybackTicket says so. What this decides is whether
   * the member sees a designed explanation or a red box containing an API
   * error, which is what they got before: the paywall moment had no design at
   * all.
   */
  const locked = Boolean(current?.locked);
  const lockReason: 'drip' | 'tier' = currentModule?.unlocksAt ? 'drip' : 'tier';

  const playback = useQuery({
    queryKey: ['playback', current?.id],
    queryFn: () => api.playback(current!.id),
    // Not requested at all for a locked lesson: a 403 the UI already knows
    // about is a wasted round trip and an error in the console.
    enabled: Boolean(current) && !locked,
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
    /**
     * Only refetch when something visible changed.
     *
     * This used to invalidate the course on every save, and a save happens
     * every fifteen seconds of watching. So a two-hour lesson refetched the
     * whole course about four hundred and eighty times, each refetch
     * re-rendered the page, and the Mark complete button flickered through
     * its pending state the entire way down — which is what "glitching"
     * looked like. It also churned `lastPositionSeconds`, which is what used
     * to rebuild the player.
     *
     * A position tick changes nothing anybody is looking at: the position is
     * already in the player. Only completion changes the page.
     */
    onSuccess: (_data, vars) => {
      // Defined, not truthy. Un-marking a lesson sends `completed: false`, and
      // that changes the page just as much as completing it does — a truthiness
      // check here left the button saying "Completed" after it had been undone.
      if (vars.completed === undefined) return;
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

  /* A save the member asked for, as opposed to the background position tick.
     `saveProgress.variables` is the payload of the mutation currently in
     flight; only a completion carries the `completed` flag. */
  const marking = saveProgress.isPending && saveProgress.variables?.completed !== undefined;

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
          {locked ? (
            <LockedLesson reason={lockReason} unlocksAt={currentModule?.unlocksAt ?? null} />
          ) : (
          <>
          {/* Two players, one progress contract. A YouTube lesson still
              resumes, still reports watch time and still completes — see
              YouTubePlayer for why that is worth the extra component rather
              than dropping in an iframe. */}
          {playback.data?.kind === 'youtube' ? (
            <YouTubePlayer
              videoId={playback.data.url}
              startAt={current.lastPositionSeconds}
              title={current.title}
              onProgress={handleProgress}
              onEnded={handleEnded}
            />
          ) : (
            <VideoPlayer
              src={playback.data?.url ?? null}
              startAt={current.lastPositionSeconds}
              title={current.title}
              onProgress={handleProgress}
              onEnded={handleEnded}
            />
          )}

          {playback.isError && (
            <div className="callout" style={{ background: 'var(--soft)', color: 'var(--red)' }}>
              {playback.error.message}
            </div>
          )}
          </>
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
            {/* Busy only while a *completion* is in flight. `isPending` on its
                own is also true for the position tick the player fires every
                fifteen seconds, so the button greyed itself out and said
                "Saving…" four times a minute for the whole lesson, with
                nothing being saved that anybody had asked for. */}
            <button
              type="button"
              className={current.completed ? 'btn btn-green btn-sq' : 'btn btn-pink btn-sq'}
              style={{ padding: '12px 18px' }}
              disabled={marking}
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
              {marking ? 'Saving…' : current.completed ? 'Completed' : 'Mark complete'}
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

          {/* The end of the course, which until now was silent: the last
              lesson ticked over, "Up next" disappeared, and that was the whole
              acknowledgement of finishing eighteen lectures. The certificate
              endpoint and the list on the member profile both existed; nothing
              ever issued one, so every profile showed an empty shelf. */}
          {/* Under the player and above "up next": the moment a lesson ends is
              the only moment somebody will answer three questions about it. */}
          <LessonQuiz lessonId={current.id} />

          {!next && done === all.length && all.length > 0 && <CourseFinished courseId={course.data!.id} />}

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

/**
 * Finishing the course.
 *
 * The certificate is claimed rather than minted automatically, because issuing
 * one writes a permanent row with a public code and 50 XP, and doing that in
 * the background of a lesson tick makes it something that happened to the
 * member rather than something they did. One press is the difference.
 *
 * The server checks completion too. This component only renders when the
 * course is done, but a client-side condition is a UI affordance, never a
 * guarantee — the endpoint refuses an unfinished course whatever is pressed.
 */
function CourseFinished({ courseId }: { courseId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const certificates = useQuery({ queryKey: ['certificates'], queryFn: api.certificates, retry: false });
  const mine = (certificates.data ?? []).find((c) => c.courseId === courseId);

  const issue = useMutation({
    mutationFn: () => api.issueCertificate(courseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
      toast.show('Certificate issued — it is on your profile');
    },
    onError: toast.error,
  });

  return (
    <Card>
      <span className="section-label">Course finished</span>
      <span style={{ fontSize: 12.5, lineHeight: 1.6 }} className="muted">
        Every lesson done. There is a certificate with your name and a verification code on it.
      </span>
      {issue.isSuccess || mine ? (
        <Link to="/members/me" className="btn btn-soft" style={{ alignSelf: 'flex-start' }}>
          See it on your profile
        </Link>
      ) : (
        <button
          type="button"
          className="btn btn-pink"
          style={{ alignSelf: 'flex-start', color: '#fff' }}
          disabled={issue.isPending}
          onClick={() => issue.mutate()}
        >
          <Icon name="check" size={13} strokeWidth={3} />
          {issue.isPending ? 'Issuing…' : 'Get your certificate'}
        </button>
      )}
    </Card>
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

/**
 * The gate, where there used to be a red box with an API error in it.
 *
 * Two reasons a lesson is shut, and they deserve different sentences. A drip
 * has a date, and saying it turns "you cannot watch this" into "come back on
 * Tuesday" — which is the entire point of a schedule. A tier lock is a sales
 * moment, and the one thing it must not do is make somebody feel they did
 * something wrong.
 */
function LockedLesson({ reason, unlocksAt }: { reason: 'drip' | 'tier'; unlocksAt: string | null }) {
  const opens = unlocksAt ? new Date(unlocksAt) : null;
  const days = opens ? Math.max(0, Math.ceil((opens.getTime() - Date.now()) / 86_400_000)) : null;

  return (
    <div
      style={{
        aspectRatio: '16 / 9',
        borderRadius: 14,
        background: 'linear-gradient(135deg, var(--pink-tint), var(--soft))',
        display: 'grid',
        placeItems: 'center',
        padding: 28,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          textAlign: 'center',
          maxWidth: 420,
        }}
      >
        <span
          style={{
            width: 46,
            height: 46,
            borderRadius: 999,
            display: 'grid',
            placeItems: 'center',
            background: 'var(--panel)',
            boxShadow: 'var(--sh-sm)',
          }}
        >
          <Icon name={reason === 'drip' ? 'clock' : 'courses'} size={20} color="var(--pink-ink)" />
        </span>

        {reason === 'drip' ? (
          <>
            <span style={{ fontSize: 15, fontWeight: 600 }}>
              {days === 0 ? 'This opens later today' : `This opens in ${days} day${days === 1 ? '' : 's'}`}
            </span>
            <span style={{ fontSize: 12.5, lineHeight: 1.6 }} className="muted">
              {opens
                ? `Your group reaches it on ${opens.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}. Everything before it is open now.`
                : 'Your group has not reached this part of the course yet.'}
            </span>
            <Link to="/courses" className="btn btn-soft" style={{ marginTop: 4 }}>
              Back to your courses
            </Link>
          </>
        ) : (
          <>
            <span style={{ fontSize: 15, fontWeight: 600 }}>This course is part of a higher plan</span>
            <span style={{ fontSize: 12.5, lineHeight: 1.6 }} className="muted">
              Your membership does not include this one yet. Everything you already have access to stays
              exactly as it is.
            </span>
            <Link
              to="/settings/membership"
              className="btn btn-pink"
              style={{ color: '#fff', marginTop: 4 }}
            >
              See the plans
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
