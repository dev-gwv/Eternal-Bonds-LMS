import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { Challenge, Tier } from '@ipc/contracts';
import { ChallengeInput } from '@ipc/contracts';
import { adminApi } from '../../shared/admin-api.ts';
import { PageHeader, Page } from '../../shared/layout/AppShell.tsx';
import { Card, Chip, EmptyState, Icon } from '../../shared/ui/primitives.tsx';
import { LoadingLabel, SkeletonCard } from '../../shared/ui/Skeleton.tsx';
import { useToast } from '../../shared/ui/Toast.tsx';
import { ConfirmButton, ErrorNote, Field, Select, Toolbar, slugify } from './studio-ui.tsx';

/**
 * Setting the week's prompt.
 *
 * The one field that matters is the prompt, and the form says so: "One light,
 * one portrait" is something a member can picture doing on Sunday, and
 * "Portrait Photography Challenge" is not. Everything else — dates, tier, a
 * longer brief — is scaffolding around that one line.
 *
 * Opening and closing are handled by the `challenge.lifecycle` job on the
 * dates given, so a challenge created on Tuesday for next Monday opens on
 * Monday without anybody being at a keyboard. That is the difference between
 * a ritual and an intention, and it is the same reason the Think Tank cycle
 * is a cron job.
 */

const TIERS: readonly Tier[] = ['free', 'silver', 'diamond', 'franchisee'] as const;

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function NewChallenge({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [briefMd, setBriefMd] = useState('');
  // A week, starting today — the shape almost every one of these will have.
  const [startsOn, setStartsOn] = useState(today());
  const [endsOn, setEndsOn] = useState(inDays(7));
  const [minTier, setMinTier] = useState<Tier>('free');

  const effectiveSlug = touched ? slug : slugify(title);
  const body = {
    slug: effectiveSlug,
    title: title.trim(),
    prompt: prompt.trim(),
    briefMd: briefMd.trim() || null,
    startsOn,
    endsOn,
    minTier,
    status: 'draft' as const,
  };
  const parsed = ChallengeInput.safeParse(body);
  const errors: Record<string, string> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors[String(issue.path[0] ?? 'form')] ??= issue.message;
  }
  const datesWrong = endsOn < startsOn;

  const create = useMutation({
    mutationFn: () => adminApi.createChallenge(ChallengeInput.parse(body)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'challenges'] });
      toast.show('Challenge drafted — publish it when you are ready');
      onDone();
    },
    onError: toast.error,
  });

  return (
    <Card title="New challenge">
      <ErrorNote error={create.error} />
      <div className="field-row">
        <Field label="Title" error={title.trim() === '' ? null : errors.title}>
          <input value={title} placeholder="One light, one portrait" onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Page address" error={errors.slug}>
          <span className="input-prefixed">
            <span className="input-prefix">/challenges/</span>
            <input
              value={effectiveSlug}
              placeholder="one-light-one-portrait"
              onChange={(e) => {
                setTouched(true);
                setSlug(e.target.value);
              }}
              onBlur={(e) => setSlug(slugify(e.target.value))}
            />
          </span>
        </Field>
      </div>

      <Field
        label="The prompt — one line a member could picture doing"
        error={prompt.trim() === '' ? null : errors.prompt}
      >
        <input
          value={prompt}
          placeholder="Shoot a portrait using one light source. Window counts."
          onChange={(e) => setPrompt(e.target.value)}
        />
      </Field>

      <Field label="Longer brief (optional)">
        <textarea
          rows={3}
          value={briefMd}
          placeholder="What you are looking for, what counts, anything that would otherwise be asked in the comments."
          onChange={(e) => setBriefMd(e.target.value)}
        />
      </Field>

      <div className="field-row">
        <Field label="Opens">
          <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </Field>
        <Field label="Closes" error={datesWrong ? 'A challenge cannot close before it opens' : null}>
          <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </Field>
        <Field label="Open to">
          <Select value={minTier} options={TIERS} onChange={(v) => setMinTier(v as Tier)} />
        </Field>
      </div>

      <Toolbar>
        <button
          type="button"
          className="btn btn-pink"
          disabled={!parsed.success || datesWrong || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? 'Creating…' : 'Create draft'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, textAlign: 'right' }} className="dim">
          {parsed.success && !datesWrong
            ? 'Drafted. It opens on its own, on the date above.'
            : title.trim() === ''
              ? 'Drafted. It opens on its own, on the date above.'
              : `Cannot create yet — ${(datesWrong ? 'a challenge cannot close before it opens' : Object.values(errors)[0] ?? '').toLowerCase()}.`}
        </span>
      </Toolbar>
    </Card>
  );
}

function ChallengeRow({ c }: { c: Challenge }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'challenges'] });

  const detail = useQuery({
    queryKey: ['admin', 'challenge', c.slug],
    queryFn: () => adminApi.challenge(c.slug),
    // Only when there is something to judge. Loading every entry list to draw
    // a table of five challenges is five galleries nobody asked for.
    enabled: c.entryCount > 0,
  });

  const save = useMutation({
    mutationFn: (status: Challenge['status']) =>
      adminApi.updateChallenge(c.id, {
        slug: c.slug,
        title: c.title,
        prompt: c.prompt,
        briefMd: c.briefMd,
        startsOn: c.startsOn,
        endsOn: c.endsOn,
        minTier: c.minTier,
        status,
      }),
    onSuccess: (next) => {
      refresh();
      toast.show(next.status === 'open' ? 'Open — everybody has been told' : 'Saved');
    },
    onError: toast.error,
  });

  const winner = useMutation({
    mutationFn: (winSlug: string | null) => adminApi.pickChallengeWinner(c.id, winSlug),
    onSuccess: (next) => {
      refresh();
      toast.show(next.winner ? `${next.winner.authorName} wins — they have been told` : 'Winner cleared');
    },
    onError: toast.error,
  });

  const remove = useMutation({
    mutationFn: () => adminApi.deleteChallenge(c.id),
    onSuccess: () => {
      refresh();
      toast.show('Challenge deleted — the entries stay on the wins board');
    },
    onError: toast.error,
  });

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <Link
          to="/challenges/$slug"
          params={{ slug: c.slug }}
          style={{ flex: 1, minWidth: 180, fontSize: 13, fontWeight: 600, color: 'inherit' }}
        >
          {c.title}
        </Link>
        {c.status === 'open' ? (
          <Chip tone="green">Open</Chip>
        ) : c.status === 'draft' ? (
          <Chip tone="yellow">Draft</Chip>
        ) : (
          <Chip>Closed</Chip>
        )}
        {c.minTier !== 'free' && <Chip tone="pink">{c.minTier}</Chip>}
        <Chip>{c.entryCount} in</Chip>
      </div>

      <span style={{ fontSize: 11.5, lineHeight: 1.5 }} className="muted">
        {c.prompt}
      </span>
      <span style={{ fontSize: 10 }} className="dim num">
        {c.startsOn} — {c.endsOn}
        {c.winner ? ` · won by ${c.winner.authorName}` : ''}
      </span>

      <Toolbar>
        {c.status === 'draft' && (
          <button className="btn btn-pink" disabled={save.isPending} onClick={() => save.mutate('open')}>
            Open it now
          </button>
        )}
        {c.status === 'open' && (
          <button className="btn btn-soft" disabled={save.isPending} onClick={() => save.mutate('closed')}>
            Close early
          </button>
        )}
        {c.status === 'closed' && (
          <button className="btn btn-soft" disabled={save.isPending} onClick={() => save.mutate('open')}>
            Reopen
          </button>
        )}
        <span style={{ flex: 1 }} />
        <ConfirmButton
          label="Delete"
          confirmLabel="Delete the prompt"
          style={{ fontSize: 10, color: 'var(--red)' }}
          disabled={remove.isPending}
          onConfirm={() => remove.mutate()}
        />
      </Toolbar>

      {/* Judging. Only once there is something to judge, and only as a list of
          names — an admin picking a winner has already looked at the gallery
          on the challenge page, and rebuilding it here would be a second place
          for the two to disagree. */}
      {c.entryCount > 0 && (
        <>
          <span className="section-label">Pick a winner</span>
          {detail.isPending ? (
            <LoadingLabel>Loading entries</LoadingLabel>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(detail.data?.entries ?? []).map((e) => (
                <div key={e.winSlug} className="card-row" style={{ gap: 9, alignItems: 'center' }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                    {e.title}
                    <span className="dim" style={{ marginLeft: 8, fontSize: 10.5 }}>
                      {e.authorName} · {e.reactions} likes
                    </span>
                  </span>
                  {e.isWinner ? (
                    <>
                      <Chip tone="green">Winner</Chip>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 10 }}
                        disabled={winner.isPending}
                        onClick={() => winner.mutate(null)}
                      >
                        Undo
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn-soft"
                      style={{ fontSize: 10 }}
                      disabled={winner.isPending}
                      onClick={() => winner.mutate(e.winSlug)}
                    >
                      This one
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export function AdminChallengesPage() {
  const [adding, setAdding] = useState(false);
  const challenges = useQuery({ queryKey: ['admin', 'challenges'], queryFn: adminApi.challenges });
  const items = challenges.data ?? [];

  return (
    <Page>
      <PageHeader
        title="Challenges"
        back="/admin"
        crumbs={[{ label: 'Studio', to: '/admin' }, { label: 'Challenges' }]}
        actions={
          <button type="button" className="btn btn-pink" onClick={() => setAdding(true)}>
            <Icon name="plus" size={13} />
            New challenge
          </button>
        }
      />

      {adding && <NewChallenge onDone={() => setAdding(false)} />}

      {challenges.isPending ? (
        <>
          <LoadingLabel>Loading challenges</LoadingLabel>
          <SkeletonCard />
        </>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon="heart"
            title="No challenges yet"
            hint="One prompt, one week. It is the cheapest thing in this studio and the one most likely to get somebody posting."
          />
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((c) => (
            <ChallengeRow key={c.id} c={c} />
          ))}
        </div>
      )}
    </Page>
  );
}
