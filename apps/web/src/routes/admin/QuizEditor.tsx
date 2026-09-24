import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { QuizQuestionInput } from '@ipc/contracts';
import { adminApi } from '../../shared/admin-api.ts';
import { Icon } from '../../shared/ui/primitives.tsx';
import { useToast } from '../../shared/ui/Toast.tsx';
import { ConfirmButton, Field, Toolbar } from './studio-ui.tsx';

/**
 * Writing the questions for a lesson.
 *
 * This is the only place in the application that shows which option is
 * correct, and it reads through a definer function that checks `is_admin()` —
 * `quiz_options.is_correct` is not granted to `authenticated`, which is the
 * role an admin connects as too. An author cannot see the answer by accident
 * any more than a member can; they see it because this asked, as an admin.
 *
 * One correct option per question, enforced by the contract and by the form:
 * ticking a second answer moves the tick rather than adding one. "Select all
 * that apply" is a different kind of question, and pretending one form can do
 * both produces quizzes nobody can score.
 */
export function QuizEditor({ lessonId }: { lessonId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [prompt, setPrompt] = useState('');
  const [explanation, setExplanation] = useState('');
  const [options, setOptions] = useState([
    { label: '', isCorrect: true },
    { label: '', isCorrect: false },
  ]);

  const questions = useQuery({
    queryKey: ['admin', 'quiz', lessonId],
    queryFn: () => adminApi.lessonQuiz(lessonId),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'quiz', lessonId] });

  const body = {
    prompt: prompt.trim(),
    explanation: explanation.trim() || null,
    options: options
      .filter((o) => o.label.trim() !== '')
      .map((o) => ({ label: o.label.trim(), isCorrect: o.isCorrect })),
  };
  const parsed = QuizQuestionInput.safeParse(body);

  const add = useMutation({
    mutationFn: () => adminApi.addQuizQuestion(lessonId, QuizQuestionInput.parse(body)),
    onSuccess: () => {
      setPrompt('');
      setExplanation('');
      setOptions([
        { label: '', isCorrect: true },
        { label: '', isCorrect: false },
      ]);
      refresh();
      toast.show('Question added');
    },
    onError: toast.error,
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminApi.deleteQuizQuestion(id),
    onSuccess: () => {
      refresh();
      toast.show('Question removed — past attempts are kept');
    },
    onError: toast.error,
  });

  return (
    <div className="card" style={{ gap: 12 }}>
      <span className="section-label">Quiz</span>

      {(questions.data ?? []).length === 0 ? (
        <span style={{ fontSize: 11.5, lineHeight: 1.6 }} className="muted">
          No questions yet. Two or three is plenty — this is a lesson asking whether it landed, not an exam. Nothing
          is gated behind it and a wrong answer costs nothing but the explanation.
        </span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {questions.data!.map((q, i) => (
            <div key={q.id} className="card-row" style={{ gap: 9, alignItems: 'flex-start' }}>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 500 }}>
                  {i + 1}. {q.prompt}
                </span>
                <span style={{ fontSize: 10.5, lineHeight: 1.6 }} className="dim">
                  {q.options.map((o) => (o.isCorrect ? `[correct] ${o.label}` : o.label)).join(' · ')}
                </span>
                {q.explanation && (
                  <span style={{ fontSize: 10.5, lineHeight: 1.5 }} className="muted">
                    {q.explanation}
                  </span>
                )}
              </span>
              <ConfirmButton
                label="Delete"
                confirmLabel="Delete it"
                style={{ fontSize: 10, color: 'var(--red)' }}
                disabled={remove.isPending}
                onConfirm={() => remove.mutate(q.id)}
              />
            </div>
          ))}
        </div>
      )}

      <Field label="Question">
        <input
          value={prompt}
          placeholder="What is the cheapest light in a room?"
          onChange={(e) => setPrompt(e.target.value)}
        />
      </Field>

      <Field label="Answers — tick the right one">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {options.map((o, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="radio"
                name={`correct-${lessonId}`}
                checked={o.isCorrect}
                aria-label={`Option ${i + 1} is the right one`}
                onChange={() => setOptions((os) => os.map((x, j) => ({ ...x, isCorrect: i === j })))}
                style={{ accentColor: 'var(--pink-ink)', flexShrink: 0 }}
              />
              <input
                value={o.label}
                placeholder={i === 0 ? 'A window' : 'Another option'}
                onChange={(e) =>
                  setOptions((os) => os.map((x, j) => (i === j ? { ...x, label: e.target.value } : x)))
                }
                style={{ flex: 1, minWidth: 0 }}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: 10, color: 'var(--red)' }}
                  onClick={() =>
                    setOptions((os) => {
                      const next = os.filter((_, j) => j !== i);
                      // Removing the ticked one has to leave a tick somewhere,
                      // or the form becomes unsubmittable with nothing on
                      // screen saying why.
                      if (!next.some((x) => x.isCorrect) && next[0]) next[0] = { ...next[0], isCorrect: true };
                      return next;
                    })
                  }
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {options.length < 6 && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ alignSelf: 'flex-start', fontSize: 10 }}
              onClick={() => setOptions((os) => [...os, { label: '', isCorrect: false }])}
            >
              <Icon name="plus" size={12} />
              Another option
            </button>
          )}
        </div>
      </Field>

      <Field label="Why — shown after they answer, right or wrong">
        <input
          value={explanation}
          placeholder="A window. It is free and it is already there."
          onChange={(e) => setExplanation(e.target.value)}
        />
      </Field>

      <Toolbar>
        <button
          type="button"
          className="btn btn-pink"
          disabled={!parsed.success || add.isPending}
          onClick={() => add.mutate()}
        >
          {add.isPending ? 'Adding…' : 'Add question'}
        </button>
        <span style={{ flex: 1 }} />
        {/* Never a silently grey button. */}
        {!parsed.success && prompt.trim() !== '' && (
          <span style={{ fontSize: 10, textAlign: 'right' }} className="dim">
            {parsed.error.issues[0]?.message}
          </span>
        )}
      </Toolbar>
    </div>
  );
}
