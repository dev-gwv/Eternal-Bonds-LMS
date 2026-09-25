import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AdminLesson } from '@ipc/contracts';
import { adminApi } from '../../shared/admin-api.ts';
import { useToast } from '../../shared/ui/Toast.tsx';
import { ErrorNote, Field, Toolbar, slugify } from './studio-ui.tsx';

/**
 * Everything about a lesson that is not its video.
 *
 * The row in the builder let you rename a lesson and toggle Preview, and that
 * was all — its address, its length and its notes were writable only at the
 * moment it was created and never afterwards. The notes were worse than
 * unreachable: `bodyMd` has always been in `LessonInput`, so the studio could
 * *write* it once and could never read it back, because the admin read never
 * returned the column. Write-only data is data nobody will ever trust.
 *
 * Duration is minutes and seconds rather than a seconds box. Nobody knows what
 * 743 is, everybody knows what 12:23 is, and the API wants seconds — which is
 * a conversion the interface should do, not the person using it.
 */

const mmss = (total: number) => ({
  minutes: Math.floor(total / 60),
  seconds: total % 60,
});

export function LessonEditor({
  lesson,
  courseId,
  onClose,
}: {
  lesson: AdminLesson;
  courseId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const initial = mmss(lesson.durationSeconds);

  const [title, setTitle] = useState(lesson.title);
  const [slug, setSlug] = useState(lesson.slug);
  const [minutes, setMinutes] = useState(String(initial.minutes));
  const [seconds, setSeconds] = useState(String(initial.seconds));
  const [bodyMd, setBodyMd] = useState(lesson.bodyMd ?? '');
  const [isPreview, setIsPreview] = useState(lesson.isPreview);

  const durationSeconds = Math.max(0, (Number(minutes) || 0) * 60 + (Number(seconds) || 0));
  const slugOk = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length >= 3;
  const titleOk = title.trim().length >= 2;

  const save = useMutation({
    mutationFn: () =>
      adminApi.updateLesson(lesson.id, {
        title: title.trim(),
        slug,
        durationSeconds,
        isPreview,
        bodyMd: bodyMd.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'course', courseId] });
      toast.show('Lesson saved');
      onClose();
    },
    onError: toast.error,
  });

  return (
    <div className="card" style={{ gap: 12 }}>
      <span className="section-label">Lesson details</span>
      <ErrorNote error={save.error} />

      <div className="field-row">
        <Field label="Title" error={titleOk || title === '' ? null : 'At least two characters'}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Page address" error={slugOk ? null : 'Lowercase letters, numbers and hyphens only'}>
          <span className="input-prefixed">
            <span className="input-prefix">/learn/…/</span>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              onBlur={(e) => setSlug(slugify(e.target.value))}
            />
          </span>
        </Field>
      </div>

      <div className="field-row">
        {/* Minutes and seconds, because the API wants 743 and nobody thinks in
            743. When a video is attached the provider reports the real length
            and overwrites this; it is here for lessons that are not video. */}
        <Field label="Length">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number"
              min={0}
              max={720}
              value={minutes}
              aria-label="Minutes"
              onChange={(e) => setMinutes(e.target.value)}
              style={{ width: 74 }}
            />
            <span style={{ fontSize: 11 }} className="dim">
              min
            </span>
            <input
              type="number"
              min={0}
              max={59}
              value={seconds}
              aria-label="Seconds"
              onChange={(e) => setSeconds(e.target.value)}
              style={{ width: 74 }}
            />
            <span style={{ fontSize: 11 }} className="dim">
              sec
            </span>
          </span>
        </Field>
        <Field label="Free to watch">
          <label className="switch" title="Preview lessons play for any member, whatever their tier">
            <input type="checkbox" checked={isPreview} onChange={(e) => setIsPreview(e.target.checked)} />
            Preview lesson
          </label>
        </Field>
      </div>

      <Field label="Notes — shown under the video, for links and anything worth writing down">
        <textarea
          rows={5}
          value={bodyMd}
          placeholder="The three numbers from this lesson, the template link, whatever you would otherwise repeat in the comments."
          onChange={(e) => setBodyMd(e.target.value)}
        />
      </Field>

      <Toolbar>
        <button
          type="button"
          className="btn btn-pink"
          disabled={save.isPending || !titleOk || !slugOk}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : 'Save lesson'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10 }} className="dim">
          The video is attached on the row above — this is everything else.
        </span>
      </Toolbar>
    </div>
  );
}
