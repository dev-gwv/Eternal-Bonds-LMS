import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { WorkshopInput, type AdminWorkshop, type Tier } from '@ipc/contracts';
import { CoverPicker } from '../../shared/ui/CoverPicker.tsx';
import { adminApi } from '../../shared/admin-api.ts';
import { dayHeading, timeRange } from '../../shared/api.ts';
import { PageHeader, Page } from '../../shared/layout/AppShell.tsx';
import { Card, Chip, Icon } from '../../shared/ui/primitives.tsx';
import { ConfirmButton, Empty, ErrorNote, Field, Select, Switch, Toolbar } from './studio-ui.tsx';

/**
 * Scheduling workshops.
 *
 * Times are entered and shown in IST, because that is the timezone every
 * member and every host is in, and stored as UTC. `datetime-local` gives the
 * browser's zone, so the conversion is done here rather than hoped for.
 */

const PLATFORMS = ['zoom_webinar', 'zoom_meeting', 'in_person'] as const;
const TIERS: readonly Tier[] = ['free', 'silver', 'diamond', 'franchisee'] as const;

const IST_OFFSET_MINUTES = 5 * 60 + 30;

/** "2026-09-18T19:00" typed as IST → the matching UTC instant. */
function istToIso(local: string): string {
  const [date, time] = local.split('T');
  const [y, m, d] = (date ?? '').split('-').map(Number);
  const [hh, mm] = (time ?? '').split(':').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, hh!, mm! - IST_OFFSET_MINUTES)).toISOString();
}

/** The inverse, for filling the form when editing. */
function isoToIst(iso: string): string {
  const shifted = new Date(Date.parse(iso) + IST_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 16);
}

const blank = () => ({
  title: '',
  startsAtLocal: '',
  endsAtLocal: '',
  platform: 'zoom_webinar' as (typeof PLATFORMS)[number],
  minTier: 'diamond' as Tier,
  joinUrl: '',
  recurring: false,
  capacity: '',
});

type Draft = ReturnType<typeof blank>;

const toInput = (draft: Draft) =>
  WorkshopInput.safeParse({
    title: draft.title.trim(),
    startsAt: draft.startsAtLocal ? istToIso(draft.startsAtLocal) : '',
    endsAt: draft.endsAtLocal ? istToIso(draft.endsAtLocal) : '',
    platform: draft.platform,
    minTier: draft.minTier,
    joinUrl: draft.joinUrl.trim() === '' ? null : draft.joinUrl.trim(),
    recurring: draft.recurring,
    capacity: draft.capacity.trim() === '' ? null : Number(draft.capacity),
  });

function WorkshopForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  pending,
  error,
}: {
  initial: Draft;
  submitLabel: string;
  onSubmit: (input: ReturnType<typeof WorkshopInput.parse>) => void;
  onCancel: () => void;
  pending: boolean;
  error: unknown;
}) {
  const [draft, setDraft] = useState(initial);
  const parsed = toInput(draft);
  const issue = parsed.success ? null : parsed.error.issues[0];

  return (
    <Card title={submitLabel}>
      <ErrorNote error={error} />
      <div className="field-row">
        <Field label="Title">
          <input
            value={draft.title}
            autoFocus
            placeholder="Posing and direction, live"
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </Field>
        <Field label="Platform">
          <Select value={draft.platform} options={PLATFORMS} onChange={(platform) => setDraft({ ...draft, platform })} />
        </Field>
        <Field label="Minimum tier">
          <Select value={draft.minTier} options={TIERS} onChange={(minTier) => setDraft({ ...draft, minTier })} />
        </Field>
      </div>

      <div className="field-row">
        <Field label="Starts (IST)">
          <input
            type="datetime-local"
            value={draft.startsAtLocal}
            onChange={(e) => {
              const startsAtLocal = e.target.value;
              // Most workshops run 90 minutes; filling the end saves a step and
              // is trivially overridden.
              const endsAtLocal =
                draft.endsAtLocal === '' && startsAtLocal
                  ? isoToIst(new Date(Date.parse(istToIso(startsAtLocal)) + 90 * 60_000).toISOString())
                  : draft.endsAtLocal;
              setDraft({ ...draft, startsAtLocal, endsAtLocal });
            }}
          />
        </Field>
        <Field label="Ends (IST)" error={issue?.path[0] === 'endsAt' ? issue.message : null}>
          <input
            type="datetime-local"
            value={draft.endsAtLocal}
            onChange={(e) => setDraft({ ...draft, endsAtLocal: e.target.value })}
          />
        </Field>
        <Field label="Seats">
          <input
            type="number"
            min={1}
            value={draft.capacity}
            placeholder="Unlimited"
            onChange={(e) => setDraft({ ...draft, capacity: e.target.value })}
          />
        </Field>
      </div>

      <Field label="Join link" error={issue?.path[0] === 'joinUrl' ? issue.message : null}>
        <input
          value={draft.joinUrl}
          placeholder="https://zoom.us/j/…  — only registered members ever see this"
          onChange={(e) => setDraft({ ...draft, joinUrl: e.target.value })}
        />
      </Field>

      <Toolbar>
        <button
          type="button"
          className="btn btn-pink"
          disabled={!parsed.success || pending}
          onClick={() => parsed.success && onSubmit(parsed.data)}
        >
          {pending ? 'Saving…' : submitLabel}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        {/* Which field is wrong, rather than a button that will not press. */}
        {!parsed.success && draft.title.trim() !== '' && (
          <span style={{ fontSize: 10.5 }} className="dim">
            {parsed.error.issues[0]?.message}
          </span>
        )}
        <Switch
          label="Part of a recurring series"
          checked={draft.recurring}
          onChange={(recurring) => setDraft({ ...draft, recurring })}
        />
      </Toolbar>
    </Card>
  );
}

function WorkshopRow({ workshop }: { workshop: AdminWorkshop }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'workshops'] });

  const update = useMutation({
    mutationFn: (input: ReturnType<typeof WorkshopInput.parse>) => adminApi.updateWorkshop(workshop.id, input),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: () => adminApi.deleteWorkshop(workshop.id), onSuccess: refresh });

  if (editing) {
    return (
      <WorkshopForm
        submitLabel="Save workshop"
        pending={update.isPending}
        error={update.error}
        onCancel={() => setEditing(false)}
        onSubmit={(input) => update.mutate(input)}
        initial={{
          title: workshop.title,
          startsAtLocal: isoToIst(workshop.startsAt),
          endsAtLocal: isoToIst(workshop.endsAt),
          platform: workshop.platform as (typeof PLATFORMS)[number],
          minTier: workshop.minTier,
          joinUrl: workshop.joinUrl ?? '',
          recurring: workshop.recurring,
          capacity: workshop.capacity === null ? '' : String(workshop.capacity),
        }}
      />
    );
  }

  const past = Date.parse(workshop.endsAt) < Date.now();

  return (
    <div className="card" style={{ gap: 8, opacity: past ? 0.65 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="card-title" style={{ flex: 1 }}>{workshop.title}</span>
        {past && <Chip>Finished</Chip>}
        <Chip tone="blue">{workshop.platform.replace(/_/g, ' ')}</Chip>
        <Chip>{workshop.minTier}</Chip>
      </div>
      <CoverPicker
        kind="workshop"
        id={workshop.id}
        coverUrl={workshop.coverUrl}
        hint="16:9. Shown on the workshops page, which is otherwise a list of dates."
        invalidate={[['admin', 'workshops'], ['workshops']]}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11 }} className="muted">
        <span>{dayHeading(workshop.startsAt)}</span>
        <span>·</span>
        <span>{timeRange(workshop.startsAt, workshop.endsAt)}</span>
        <span>·</span>
        <span>
          {workshop.registrationCount} registered
          {workshop.capacity !== null ? ` of ${workshop.capacity}` : ''}
        </span>
        {!workshop.joinUrl && (
          <>
            <span>·</span>
            <span style={{ color: 'var(--yellow-ink)' }}>No join link yet</span>
          </>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-soft" onClick={() => setEditing(true)}>
          <Icon name="edit" size={13} />
          Edit
        </button>
        {workshop.registrationCount === 0 && (
          <ConfirmButton label="Delete" onConfirm={() => remove.mutate()} disabled={remove.isPending} />
        )}
      </div>
      <ErrorNote error={remove.error} />
    </div>
  );
}

export function WorkshopStudioPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const workshops = useQuery({ queryKey: ['admin', 'workshops'], queryFn: adminApi.workshops });

  const create = useMutation({
    mutationFn: (input: ReturnType<typeof WorkshopInput.parse>) => adminApi.createWorkshop(input),
    onSuccess: () => {
      setCreating(false);
      queryClient.invalidateQueries({ queryKey: ['admin', 'workshops'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] });
    },
  });

  const upcoming = workshops.data?.filter((w) => Date.parse(w.endsAt) >= Date.now()) ?? [];
  const past = workshops.data?.filter((w) => Date.parse(w.endsAt) < Date.now()) ?? [];

  return (
    <Page>
      <PageHeader
        title="Workshops"
        back="/admin"
        crumbs={[{ label: 'Studio', to: '/admin' }, { label: 'Workshops' }]}
        actions={
          <button type="button" className="btn btn-pink" onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} />
            Schedule workshop
          </button>
        }
      />

      {creating && (
        <WorkshopForm
          initial={blank()}
          submitLabel="Schedule workshop"
          pending={create.isPending}
          error={create.error}
          onCancel={() => setCreating(false)}
          onSubmit={(input) => create.mutate(input)}
        />
      )}

      <ErrorNote error={workshops.error} />
      {workshops.isLoading && <span style={{ fontSize: 12 }} className="muted">Loading…</span>}

      <span className="section-label">Upcoming</span>
      {upcoming.length === 0 ? (
        <Empty>Nothing scheduled. Members see an empty Workshops page until something is.</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {upcoming.map((w) => (
            <WorkshopRow key={w.id} workshop={w} />
          ))}
        </div>
      )}

      {past.length > 0 && (
        <>
          <span className="section-label">Finished</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {past.map((w) => (
              <WorkshopRow key={w.id} workshop={w} />
            ))}
          </div>
        </>
      )}
    </Page>
  );
}
