import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, relativeTime } from '../api.ts';
import { Avatar, Card, Chip } from './primitives.tsx';
import { ConfirmButton } from './ConfirmButton.tsx';
import { useToast } from './Toast.tsx';

/**
 * The conversation under a lesson.
 *
 * Almost all of this already existed in the API and none of it could be
 * reached. The endpoint accepted a `parentId` and nothing could send one, so
 * replies were renderable but unpostable. `/questions/:id/resolve` existed and
 * the interface never called it, so the "Resolved" chip could never appear.
 * `deleted_at` had been on the table from the start with no endpoint to set
 * it. What the member saw was a single-line input and a flat list.
 *
 * It is called Discussion rather than Q&A because it is one box doing both
 * jobs. A club this size cannot fill two text areas under a video, and asking
 * somebody to decide whether they have a "comment" or a "question" before they
 * start typing is how both stay empty. The question-shaped parts stay for the
 * threads that need them: a thread can be marked answered, and — the piece
 * that was actually missing — the asker is told when somebody answers.
 */
export function LessonDiscussion({ lessonId }: { lessonId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');

  const questions = useQuery({ queryKey: ['questions', lessonId], queryFn: () => api.lessonQuestions(lessonId) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['questions', lessonId] });

  const ask = useMutation({
    mutationFn: () => api.askQuestion(lessonId, draft.trim()),
    onSuccess: () => {
      setDraft('');
      refresh();
    },
    onError: toast.error,
  });

  const reply = useMutation({
    mutationFn: (parentId: string) => api.askQuestion(lessonId, replyDraft.trim(), parentId),
    onSuccess: () => {
      setReplyDraft('');
      setReplyTo(null);
      refresh();
      toast.show('Posted');
    },
    onError: toast.error,
  });

  const resolve = useMutation({
    mutationFn: (v: { id: string; resolved: boolean }) => api.resolveQuestion(v.id, v.resolved),
    onSuccess: (r) => {
      refresh();
      toast.show(r.resolved ? 'Marked answered' : 'Reopened');
    },
    onError: toast.error,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteQuestion(id),
    onSuccess: () => {
      refresh();
      toast.show('Deleted');
    },
    onError: toast.error,
  });

  const items = questions.data ?? [];

  return (
    <Card>
      {/* A textarea, not a one-line input. The old placeholder asked people to
          describe their confusion in a box showing forty characters of it. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <textarea
          rows={2}
          value={draft}
          placeholder="Ask at the point of confusion, or say what landed."
          aria-label="Start a discussion"
          onChange={(e) => setDraft(e.target.value)}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-pink"
            disabled={draft.trim().length < 4 || ask.isPending}
            title={draft.trim().length < 4 ? 'A few more words' : undefined}
            onClick={() => ask.mutate()}
          >
            {ask.isPending ? 'Posting…' : 'Post'}
          </button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10.5 }} className="dim">
            {items.length === 0
              ? 'Nobody has said anything yet'
              : `${items.length} thread${items.length === 1 ? '' : 's'}`}
          </span>
        </div>
      </div>

      {items.map((q) => (
        <div key={q.id} style={{ paddingTop: 12, borderTop: '1px solid var(--rule)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Avatar initials={q.author.initials} size={24} />
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{q.author.name}</span>
            <span style={{ fontSize: 10 }} className="dim">
              {relativeTime(q.createdAt)} ago
            </span>
            {q.resolved && <Chip tone="green">Answered</Chip>}
          </div>

          <p style={{ fontSize: 12.5, lineHeight: 1.6, margin: '6px 0 0' }}>{q.bodyMd}</p>

          {q.replies.map((r) => (
            <div
              key={r.id}
              style={{ marginTop: 8, marginLeft: 12, paddingLeft: 10, borderLeft: '2px solid var(--hair)' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11.5, fontWeight: 600 }}>{r.authorName}</span>
                <span style={{ fontSize: 10 }} className="dim">
                  {relativeTime(r.createdAt)} ago
                </span>
                {r.mine && (
                  <ConfirmButton
                    label="Delete"
                    confirmLabel="Delete it"
                    style={{ fontSize: 10, color: 'var(--red)' }}
                    disabled={remove.isPending}
                    onConfirm={() => remove.mutate(r.id)}
                  />
                )}
              </span>
              <p style={{ fontSize: 12, lineHeight: 1.55, margin: '3px 0 0' }} className="muted">
                {r.bodyMd}
              </p>
            </div>
          ))}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 10.5 }}
              onClick={() => {
                setReplyTo(replyTo === q.id ? null : q.id);
                setReplyDraft('');
              }}
            >
              {replyTo === q.id ? 'Cancel' : 'Reply'}
            </button>

            {/* Only the asker closes their own thread. Somebody else deciding
                your question is answered is how a thread dies unanswered. */}
            {q.mine && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 10.5 }}
                disabled={resolve.isPending}
                onClick={() => resolve.mutate({ id: q.id, resolved: !q.resolved })}
              >
                {q.resolved ? 'Reopen' : 'Mark answered'}
              </button>
            )}

            {q.mine && (
              <ConfirmButton
                label="Delete"
                confirmLabel="Delete the thread"
                style={{ fontSize: 10.5, color: 'var(--red)' }}
                disabled={remove.isPending}
                onConfirm={() => remove.mutate(q.id)}
              />
            )}
          </div>

          {replyTo === q.id && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 6 }}>
              <textarea
                rows={2}
                autoFocus
                value={replyDraft}
                placeholder={`Reply to ${q.author.name}…`}
                aria-label="Write a reply"
                onChange={(e) => setReplyDraft(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-soft"
                style={{ alignSelf: 'flex-start' }}
                disabled={replyDraft.trim().length < 2 || reply.isPending}
                onClick={() => reply.mutate(q.id)}
              >
                {reply.isPending ? 'Posting…' : 'Post reply'}
              </button>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}
