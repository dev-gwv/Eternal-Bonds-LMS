import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { Journey, JourneyInput, Tier } from '@ipc/contracts';
import { adminApi } from '../../shared/admin-api.ts';
import { PageHeader, Page } from '../../shared/layout/AppShell.tsx';
import { Card, Chip, EmptyState, Icon } from '../../shared/ui/primitives.tsx';
import { LoadingLabel, Skeleton, SkeletonRow } from '../../shared/ui/Skeleton.tsx';
import { ConfirmButton, ErrorNote, Field, IconButton, Select, Toolbar } from './studio-ui.tsx';

/**
 * Building a journey.
 *
 * The one field that matters is the promise, and the form says so: "Book your
 * first paid wedding" is a thing a member wants, "Photography Fundamentals
 * Track" is a thing a curriculum committee wants. Everything else here is
 * ordering courses, which is deliberately the easy part.
 */

const TIERS: readonly Tier[] = ['free', 'silver', 'diamond', 'franchisee'] as const;

const slugify = (v: string) =>
  v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

function JourneyForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ title: '', slug: '', promise: '', minTier: 'free' as Tier });

  const create = useMutation({
    mutationFn: () =>
      adminApi.createJourney({
        slug: form.slug.trim(),
        title: form.title.trim(),
        promise: form.promise.trim(),
        descriptionMd: null,
        minTier: form.minTier,
        isPublished: false,
      } satisfies JourneyInput),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'journeys'] });
      onDone();
    },
  });

  const ready = form.title.trim().length >= 3 && form.slug.trim().length >= 3 && form.promise.trim().length >= 8;

  return (
    <Card title="New journey">
      <ErrorNote error={create.error} />
      <div className="field-row">
        <Field label="Title">
          <input
            value={form.title}
            placeholder="Zero to your first ₹1L"
            onChange={(e) => {
              const title = e.target.value;
              setForm((f) => ({
                ...f,
                title,
                slug: f.slug === '' || f.slug === slugify(f.title) ? slugify(title) : f.slug,
              }));
            }}
          />
        </Field>
        <Field label="Slug">
          <input value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} />
        </Field>
        <Field label="Minimum tier">
          <Select value={form.minTier} options={TIERS} onChange={(minTier) => setForm((f) => ({ ...f, minTier }))} />
        </Field>
      </div>

      <Field label="The promise — the outcome, in a member's words">
        <input
          value={form.promise}
          placeholder="Book your first paid wedding within three months"
          onChange={(e) => setForm((f) => ({ ...f, promise: e.target.value }))}
        />
      </Field>
      <span style={{ fontSize: 11, lineHeight: 1.55 }} className="muted">
        This is the whole product. Write what the member gets, not what the courses cover — "Book your first
        paid wedding" sells, "Photography Fundamentals Track" does not.
      </span>

      <Toolbar>
        <button type="button" className="btn btn-pink" disabled={!ready || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? 'Creating…' : 'Create journey'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </Toolbar>
    </Card>
  );
}

function JourneyRow({ j }: { j: Journey }) {
  return (
    <Link to="/admin/journeys/$slug" params={{ slug: j.slug }} className="card-row" style={{ color: 'inherit', gap: 12 }}>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{j.title}</span>
          {j.isPublished ? <Chip tone="green">Live</Chip> : <Chip>Draft</Chip>}
          {j.minTier !== 'free' && <Chip tone="pink">{j.minTier}</Chip>}
        </span>
        <span style={{ fontSize: 10.5 }} className="dim">
          {j.promise}
        </span>
      </span>
      <span style={{ width: 90, textAlign: 'right', fontSize: 11 }} className="muted num">
        {j.stepCount} course{j.stepCount === 1 ? '' : 's'}
      </span>
    </Link>
  );
}

export function AdminJourneysPage() {
  const [creating, setCreating] = useState(false);
  const journeys = useQuery({ queryKey: ['admin', 'journeys'], queryFn: adminApi.journeys });

  return (
    <Page>
      <PageHeader
        title="Journeys"
        back="/admin"
        crumbs={[{ label: 'Studio', to: '/admin' }, { label: 'Journeys' }]}
        actions={
          <button type="button" className="btn btn-pink" onClick={() => setCreating((c) => !c)}>
            <Icon name="plus" size={14} strokeWidth={2.4} />
            New journey
          </button>
        }
      />

      <ErrorNote error={journeys.error} />
      {creating && <JourneyForm onDone={() => setCreating(false)} />}

      {journeys.isPending && (
        <>
          <LoadingLabel>Loading journeys</LoadingLabel>
          {Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)}
        </>
      )}

      {journeys.data?.length === 0 && !creating && (
        <Card>
          <EmptyState
            icon="chart"
            title="No journeys yet"
            hint="Eighteen courses in a grid asks the newest member to design their own syllabus. A journey answers it for them."
          />
        </Card>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {journeys.data?.map((j) => <JourneyRow key={j.id} j={j} />)}
      </div>
    </Page>
  );
}

export function AdminJourneyBuilderPage() {
  const { slug } = useParams({ from: '/admin/journeys/$slug' });
  const queryClient = useQueryClient();

  const journey = useQuery({ queryKey: ['admin', 'journey', slug], queryFn: () => adminApi.journey(slug) });
  const courses = useQuery({ queryKey: ['admin', 'courses'], queryFn: adminApi.courses });

  const [draft, setDraft] = useState<JourneyInput | null>(null);
  const [pick, setPick] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!journey.data) return;
    setDraft({
      slug: journey.data.slug,
      title: journey.data.title,
      promise: journey.data.promise,
      descriptionMd: journey.data.descriptionMd,
      minTier: journey.data.minTier,
      isPublished: journey.data.isPublished,
    });
  }, [journey.data]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'journey', slug] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'journeys'] });
  };

  const save = useMutation({
    mutationFn: (next: JourneyInput) => adminApi.updateJourney(journey.data!.id, next),
    onSuccess: refresh,
  });
  const addStep = useMutation({
    mutationFn: () => adminApi.addJourneyStep(journey.data!.id, { courseId: pick, note: note.trim() || null }),
    onSuccess: () => {
      setPick('');
      setNote('');
      refresh();
    },
  });
  const removeStep = useMutation({ mutationFn: adminApi.removeJourneyStep, onSuccess: refresh });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => adminApi.reorderJourneySteps(journey.data!.id, ids),
    onSuccess: refresh,
  });

  if (journey.isPending || !draft) {
    return (
      <Page>
        <Skeleton width={240} height={22} />
        <Skeleton height={160} radius={14} />
      </Page>
    );
  }
  if (journey.error || !journey.data) {
    return (
      <Page>
        <ErrorNote error={journey.error ?? new Error('Journey not found')} />
      </Page>
    );
  }

  const j = journey.data;
  const used = new Set(j.steps.map((s) => s.courseId));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= j.steps.length) return;
    const ids = j.steps.map((s) => s.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved!);
    reorder.mutate(ids);
  };

  return (
    <Page>
      <PageHeader
        title={j.title}
        back="/admin/journeys"
        crumbs={[{ label: 'Studio', to: '/admin' }, { label: 'Journeys', to: '/admin/journeys' }, { label: j.title }]}
        actions={
          <Toolbar>
            <button
              type="button"
              className={j.isPublished ? 'btn btn-soft' : 'btn btn-pink'}
              disabled={save.isPending || j.steps.length === 0}
              title={j.steps.length === 0 ? 'A journey with no courses has nothing to publish' : undefined}
              onClick={() => save.mutate({ ...draft, isPublished: !j.isPublished })}
            >
              {j.isPublished ? 'Unpublish' : 'Publish'}
            </button>
          </Toolbar>
        }
      />

      <ErrorNote error={save.error ?? addStep.error ?? removeStep.error ?? reorder.error} />

      <div className="content">
        <div className="col col-main">
          <Card title="The promise">
            <Field label="Title">
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </Field>
            <Field label="The outcome, in a member's words">
              <input value={draft.promise} onChange={(e) => setDraft({ ...draft, promise: e.target.value })} />
            </Field>
            <Field label="Longer description (optional)">
              <textarea
                rows={3}
                value={draft.descriptionMd ?? ''}
                onChange={(e) => setDraft({ ...draft, descriptionMd: e.target.value || null })}
              />
            </Field>
            <div className="field-row">
              <Field label="Minimum tier">
                <Select value={draft.minTier} options={TIERS} onChange={(minTier) => setDraft({ ...draft, minTier })} />
              </Field>
              <Field label="Slug">
                <input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
              </Field>
            </div>
            <Toolbar>
              <button
                type="button"
                className="btn btn-pink"
                disabled={save.isPending}
                onClick={() => save.mutate(draft)}
              >
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
            </Toolbar>
          </Card>

          <span className="section-label">The path</span>
          {j.steps.length === 0 ? (
            <Card>
              <EmptyState icon="courses" title="No courses on this path yet" hint="Add the first one from the right." />
            </Card>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {j.steps.map((s, i) => (
                <div key={s.id} className="card-row" style={{ gap: 11 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <IconButton icon="chevron" label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)} />
                    <IconButton
                      icon="chevron"
                      label="Move down"
                      disabled={i === j.steps.length - 1}
                      onClick={() => move(i, i + 1)}
                    />
                  </div>
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 999,
                      display: 'grid',
                      placeItems: 'center',
                      background: 'var(--soft)',
                      fontSize: 11,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 12, fontWeight: 500 }}>{s.courseTitle}</span>
                    <span style={{ fontSize: 10 }} className="dim">
                      {s.note ?? 'No note — members see nothing about why this course is here'}
                    </span>
                  </span>
                  <span style={{ fontSize: 10 }} className="dim num">
                    {s.lessonCount} lessons
                  </span>
                  <ConfirmButton label="Remove" onConfirm={() => removeStep.mutate(s.id)} disabled={removeStep.isPending} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="col rail">
          <Card title="Add a course">
            <Field label="Course">
              <select value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Pick a course…</option>
                {courses.data
                  ?.filter((c) => !used.has(c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Why this course, here">
              <input
                value={note}
                placeholder="Pricing comes before marketing — you cannot sell what you cannot quote."
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <button
              type="button"
              className="btn btn-pink"
              disabled={!pick || addStep.isPending}
              onClick={() => addStep.mutate()}
            >
              {addStep.isPending ? 'Adding…' : 'Add to path'}
            </button>
            <span style={{ fontSize: 10.5, lineHeight: 1.5 }} className="dim">
              The note is the connective tissue. Without it a journey is a list of courses; with it, it is a
              path somebody can follow.
            </span>
          </Card>
        </div>
      </div>
    </Page>
  );
}
