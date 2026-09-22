import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { Cohort, CohortInput } from '@ipc/contracts';
import { adminApi } from '../../shared/admin-api.ts';
import { PageHeader, Page } from '../../shared/layout/AppShell.tsx';
import { Card, Chip, EmptyState, Icon } from '../../shared/ui/primitives.tsx';
import { LoadingLabel, SkeletonRow } from '../../shared/ui/Skeleton.tsx';
import { ErrorNote, Field, Toolbar, fieldErrors } from './studio-ui.tsx';
import { Select } from '../../shared/ui/Select.tsx';

/**
 * Cohorts: the highest-leverage thing one author can run.
 *
 * Abdullah sets a start date. From it the app derives which module opens on
 * which day, who is behind, and when to warn them — twelve weeks of structure
 * out of one field. Everything else in this console is about content or
 * people; this is the one about *when*, which is what actually gets a course
 * finished.
 */

const today = () => new Date().toISOString().slice(0, 10);

function CohortForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const courses = useQuery({ queryKey: ['admin', 'courses'], queryFn: adminApi.courses });

  const [form, setForm] = useState({
    courseId: '',
    slug: '',
    name: '',
    startsOn: today(),
    endsOn: '',
    capacity: '',
  });

  const create = useMutation({
    mutationFn: () => {
      const body: CohortInput = {
        courseId: form.courseId,
        slug: form.slug.trim(),
        name: form.name.trim(),
        startsOn: form.startsOn,
        endsOn: form.endsOn || null,
        capacity: form.capacity.trim() === '' ? null : Number(form.capacity),
        isOpen: true,
      };
      return adminApi.createCohort(body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'cohorts'] });
      onDone();
    },
  });

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({
      ...f,
      [k]: e.target.value,
      // The slug is derived from the name until somebody edits it by hand, so
      // the common case is one field rather than two.
      ...(k === 'name' && !f.slug
        ? {}
        : {}),
    }));

  const ready = form.courseId && form.name.trim().length >= 3 && form.slug.trim().length >= 3;
  // Anything the server could attribute to a field goes next to that field;
  // only what is left over goes to the top of the card.
  const errors = fieldErrors(create.error);

  return (
    <Card title="New cohort">
      {errors.rest && <ErrorNote error={new Error(errors.rest)} />}
      <div className="field-row">
        <Field label="Course" error={errors.of('courseId')}>
          <Select
            value={form.courseId}
            placeholder="Pick a course…"
            options={(courses.data ?? []).map((c) => ({ value: c.id, label: c.title }))}
            onChange={(courseId) => setForm((f) => ({ ...f, courseId }))}
          />
        </Field>
        <Field label="Name" error={errors.of('name')}>
          <input
            value={form.name}
            placeholder="January group"
            onChange={(e) => {
              const name = e.target.value;
              setForm((f) => ({
                ...f,
                name,
                // Auto-slug while the member has not typed one themselves.
                slug:
                  f.slug === '' || f.slug === slugify(f.name)
                    ? slugify(name)
                    : f.slug,
              }));
            }}
          />
        </Field>
      </div>

      <div className="field-row">
        <Field label="Starts on" error={errors.of('startsOn')}>
          <input type="date" value={form.startsOn} onChange={set('startsOn')} />
        </Field>
        <Field label="Should finish by (optional)" error={errors.of('endsOn')}>
          <input type="date" value={form.endsOn} onChange={set('endsOn')} />
        </Field>
        <Field label="Capacity (blank for no limit)" error={errors.of('capacity')}>
          <input type="number" min={1} value={form.capacity} placeholder="—" onChange={set('capacity')} />
        </Field>
      </div>

      <Field label="Slug" error={errors.of('slug')}>
        <input value={form.slug} onChange={set('slug')} />
      </Field>

      <span style={{ fontSize: 11, lineHeight: 1.55 }} className="muted">
        The start date drives the drip: a module set to open on day 7 opens a week after this date, for
        everybody in the group at once. Set those days on the course itself, in the builder.
      </span>

      <Toolbar>
        <button type="button" className="btn btn-pink" disabled={!ready || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? 'Creating…' : 'Create cohort'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </Toolbar>
    </Card>
  );
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function CohortRow({ c }: { c: Cohort }) {
  const start = new Date(c.startsOn);
  const running = start.getTime() <= Date.now();
  const days = Math.round((Date.now() - start.getTime()) / 86_400_000);

  return (
    <Link
      to="/admin/cohorts/$id"
      params={{ id: c.id }}
      className="card-row"
      style={{ color: 'inherit', gap: 12 }}
    >
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{c.name}</span>
          {!c.isOpen && <Chip>Closed</Chip>}
          {running ? <Chip tone="green">Day {days}</Chip> : <Chip tone="blue">Starts {c.startsOn}</Chip>}
        </span>
        <span style={{ fontSize: 10 }} className="dim">
          {c.courseTitle}
          {c.endsOn ? ` · ends ${c.endsOn}` : ''}
        </span>
      </span>

      <span style={{ width: 110, textAlign: 'right', fontSize: 11 }} className="muted num hide-sm">
        {c.memberCount}
        {c.capacity !== null ? ` / ${c.capacity}` : ''} member{c.memberCount === 1 ? '' : 's'}
      </span>

      <span style={{ width: 140, maxWidth: '40vw', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, height: 5, borderRadius: 999, background: 'var(--track)' }}>
          <span
            style={{
              display: 'block',
              width: `${c.averageProgress}%`,
              height: '100%',
              borderRadius: 999,
              background: 'var(--pink)',
            }}
          />
        </span>
        <span style={{ fontSize: 10, width: 30, textAlign: 'right' }} className="num dim">
          {c.averageProgress}%
        </span>
      </span>
    </Link>
  );
}

export function CohortsPage() {
  const [creating, setCreating] = useState(false);
  const cohorts = useQuery({ queryKey: ['admin', 'cohorts'], queryFn: adminApi.cohorts });

  return (
    <Page>
      <PageHeader
        title="Cohorts"
        back="/admin"
        crumbs={[{ label: 'Studio', to: '/admin' }, { label: 'Cohorts' }]}
        actions={
          <button type="button" className="btn btn-pink" onClick={() => setCreating((c) => !c)}>
            <Icon name="plus" size={14} strokeWidth={2.4} />
            New cohort
          </button>
        }
      />

      <ErrorNote error={cohorts.error} />
      {creating && <CohortForm onDone={() => setCreating(false)} />}

      {cohorts.isPending && (
        <>
          <LoadingLabel>Loading cohorts</LoadingLabel>
          {Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)}
        </>
      )}

      {cohorts.data?.length === 0 && !creating && (
        <Card>
          <EmptyState
            icon="calendar"
            title="No cohorts yet"
            hint="A cohort is one start date shared by a group. Set drip days on a course's modules, then start a group on them — the unlock notices and deadline warnings run themselves."
          />
        </Card>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {cohorts.data?.map((c) => <CohortRow key={c.id} c={c} />)}
      </div>
    </Page>
  );
}
