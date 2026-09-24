import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { QuizResult } from '@ipc/contracts';
import { api } from '../api.ts';
import { Card, Chip, Icon } from './primitives.tsx';
import { useToast } from './Toast.tsx';

/**
 * Three questions, and the reason each answer is what it is.
 *
 * Not an exam. Nothing is gated behind a pass, retaking costs nothing, and the
 * score is only there to make somebody read the explanation — which is the
 * part that teaches. A course that locks lesson nine until you score 80% on
 * lesson eight teaches people to look up the answers.
 *
 * Marking happens on the server, and it has to: the browser is never told
 * which option is correct until after it has committed to one. That is not
 * politeness in this handler — the column is not granted to a member's
 * database role, so an answer key cannot reach here even by accident.
 */
export function LessonQuiz({ lessonId }: { lessonId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizResult | null>(null);

  const quiz = useQuery({
    queryKey: ['quiz', lessonId],
    queryFn: () => api.quiz(lessonId),
    staleTime: 5 * 60_000,
  });

  const submit = useMutation({
    mutationFn: () =>
      api.submitQuiz(lessonId, {
        answers: quiz.data!.questions.map((q) => ({ questionId: q.id, optionId: chosen[q.id] ?? null })),
      }),
    onSuccess: (r) => {
      setResult(r);
      queryClient.invalidateQueries({ queryKey: ['quiz', lessonId] });
      // The stats tiles count XP, and a clean sweep pays.
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: toast.error,
  });

  // A lesson with no quiz is the common case, and it renders nothing at all
  // rather than an empty card explaining that there is nothing here.
  if (!quiz.data || quiz.data.questions.length === 0) return null;

  const q = quiz.data;
  const answeredAll = q.questions.every((question) => chosen[question.id]);
  const markOf = (questionId: string) => result?.marks.find((m) => m.questionId === questionId);

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="section-label" style={{ flex: 1, minWidth: 0 }}>
          Did it land?
        </span>
        {result ? (
          <Chip tone={result.score === result.total ? 'green' : 'yellow'}>
            {result.score} of {result.total}
          </Chip>
        ) : q.everPerfect ? (
          <Chip tone="green">
            <Icon name="check" size={11} strokeWidth={3} />
            Done
          </Chip>
        ) : q.lastAttempt ? (
          <Chip tone="yellow">
            Last time: {q.lastAttempt.score} of {q.lastAttempt.total}
          </Chip>
        ) : (
          <Chip>
            {q.questions.length} question{q.questions.length === 1 ? '' : 's'}
          </Chip>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {q.questions.map((question, i) => {
          const mark = markOf(question.id);
          return (
            <div key={question.id} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.5 }}>
                {i + 1}. {question.prompt}
              </span>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {question.options.map((o) => {
                  const picked = chosen[question.id] === o.id;
                  // After marking, the right answer is shown whether or not it
                  // was picked — being told you were wrong without being told
                  // what was right is the most annoying possible outcome.
                  const isRight = mark ? mark.correctOptionId === o.id : false;
                  const isWrongPick = mark ? mark.chosenOptionId === o.id && !mark.wasRight : false;

                  return (
                    <label
                      key={o.id}
                      className="quiz-option"
                      data-state={isRight ? 'right' : isWrongPick ? 'wrong' : picked ? 'picked' : undefined}
                    >
                      <input
                        type="radio"
                        name={question.id}
                        checked={picked}
                        disabled={Boolean(result)}
                        onChange={() => setChosen((c) => ({ ...c, [question.id]: o.id }))}
                      />
                      <span style={{ flex: 1, minWidth: 0 }}>{o.label}</span>
                      {isRight && <Icon name="check" size={13} strokeWidth={3} color="var(--green-ink)" />}
                    </label>
                  );
                })}
              </div>

              {/* The whole reason a quiz exists. */}
              {mark?.explanation && (
                <span style={{ fontSize: 11.5, lineHeight: 1.6 }} className="muted">
                  {mark.explanation}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {result ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-soft"
            onClick={() => {
              setResult(null);
              setChosen({});
            }}
          >
            Try again
          </button>
          <span style={{ fontSize: 11 }} className="dim">
            {result.score === result.total
              ? 'All of them. Nothing here is graded — this was only to check.'
              : 'Nothing is graded and nothing is locked. The explanations are the point.'}
          </span>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-pink"
          style={{ alignSelf: 'flex-start', color: '#fff' }}
          disabled={!answeredAll || submit.isPending}
          title={answeredAll ? undefined : 'Pick an answer for each one'}
          onClick={() => submit.mutate()}
        >
          {submit.isPending ? 'Checking…' : 'Check my answers'}
        </button>
      )}
    </Card>
  );
}
