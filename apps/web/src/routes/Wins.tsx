import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { SubmitWin, type Win } from '@ipc/contracts';
import { api, relativeTime } from '../shared/api.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { Avatar, Card, Chip, EmptyState, Hero } from '../shared/ui/primitives.tsx';
import { SkeletonCard, LoadingLabel } from '../shared/ui/Skeleton.tsx';
import { Gallery } from '../shared/ui/Gallery.tsx';
import { PickerButton, PickerStrip, usePicker } from '../shared/ui/ImagePicker.tsx';
import { ReportButton } from '../shared/ui/ReportButton.tsx';
import { ShareWin } from '../shared/ui/ShareWin.tsx';
import { uploadAll } from '../shared/media.ts';
import { Select } from '../shared/ui/Select.tsx';

/** One list, used by the board filter and the submit form, so they cannot drift. */
const CATEGORY_OPTIONS = ['general', 'revenue', 'clients', 'mindset', 'gear', 'craft'];

function WinCard({ win }: { win: Win }) {
  const qc = useQueryClient();
  const react = useMutation({
    mutationFn: (r: boolean) => api.reactWin(win.id, r),
    onSettled: () => qc.invalidateQueries({ queryKey: ['wins'] }),
  });
  return (
    <article className="card lift" style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar initials={win.author.initials} size={34} tone="pink" />
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{win.author.name}</span>
          <span style={{ fontSize: 10, marginLeft: 8 }} className="dim">
            {relativeTime(win.createdAt)}
          </span>
        </div>
        <Chip tone="pink">{win.category}</Chip>
      </div>

      <Link to="/wins/$slug" params={{ slug: win.slug }} style={{ color: 'inherit', textDecoration: 'none' }}>
        <h3 style={{ margin: '8px 0 4px', fontSize: 14 }}>{win.title}</h3>
      </Link>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }} className="muted">
        {win.bigIdeaMd.slice(0, 220)}
      </p>

      {/* The proof. A wins board that shows only prose is a claims board. */}
      {win.media.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <Gallery media={win.media} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <button className="btn btn-soft" disabled={react.isPending} onClick={() => react.mutate(!win.reactedByMe)}>
          ♥ {win.reactions}
        </button>
        <Link to="/wins/$slug" params={{ slug: win.slug }} className="btn btn-soft">
          💬 {win.comments}
        </Link>
        <span style={{ flex: 1 }} />
        {win.isMine && <ShareWin slug={win.slug} enabled={win.publicShare} />}
        <ReportButton targetType="win" targetId={win.id} />
      </div>
    </article>
  );
}

export function WinsPage() {
  const [category, setCategory] = useState<string | undefined>(undefined);
  const wins = useQuery({ queryKey: ['wins', category], queryFn: () => api.wins({ category }) });
  return (
    <Page>
      <Hero
        tone="gold"
        eyebrow="Wins Board · Proof of work"
        title="Proof that the work works."
        sub="Structured breakdowns — the big idea and exactly how it happened — so any member can copy the play."
        actions={
          <Link to="/wins/submit" className="btn btn-pink" style={{ color: '#fff' }}>
            Post a win
          </Link>
        }
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {CATEGORY_OPTIONS.map((c) => (
          <button
            key={c}
            className={`btn ${category === c ? 'btn-pink' : 'btn-soft'}`}
            style={category === c ? { color: '#fff' } : undefined}
            onClick={() => setCategory(category === c ? undefined : c)}
          >
            {c}
          </button>
        ))}
      </div>
      <span className="section-label">Latest wins</span>
      {wins.isPending ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : wins.isError ? (
        <LoadingLabel>Something went wrong</LoadingLabel>
      ) : wins.data.items.length === 0 ? (
        <EmptyState title="No wins yet" hint="Post the first one — members copy the shape of what they see." />
      ) : (
        wins.data.items.map((w) => <WinCard key={w.id} win={w} />)
      )}
    </Page>
  );
}

/**
 * Posting a win.
 *
 * The form used to collect three text fields and hardcode the rest: category
 * fixed at "general", no date, no tags, `publicShare` always false — four
 * contract fields the member could never reach. And no photographs at all, on
 * a board whose entire premise is proof.
 *
 * Validation runs the real `SubmitWin` schema rather than a second copy of its
 * rules, so the preview step can refuse before a round trip and the messages
 * match what the API would have said.
 */
export function SubmitWinPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    title: '',
    bigIdeaMd: '',
    howItHappenedMd: '',
    category: 'general',
    occurredOn: '',
    tagsText: '',
    publicShare: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const picker = usePicker();

  const set = (k: keyof typeof form) => (e: any) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  /** Comma-separated in, array out — cheaper for the member than a tag widget. */
  const tags = form.tagsText
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);

  const check = SubmitWin.safeParse({
    title: form.title,
    bigIdeaMd: form.bigIdeaMd,
    howItHappenedMd: form.howItHappenedMd,
    category: form.category,
    occurredOn: form.occurredOn || null,
    tags,
    publicShare: form.publicShare,
  });

  const submit = async () => {
    setError(null);
    if (!check.success) {
      const first = check.error.issues[0];
      setError(first ? `${first.path.join('.') || 'Something'}: ${first.message}` : 'Check the fields');
      setStep(1);
      return;
    }
    setBusy(true);
    try {
      const r = await api.submitWin(check.data);
      // Photos go up after the win exists — a media ticket needs its id. A
      // failure here keeps the win and says which images did not make it.
      if (picker.items.length > 0) {
        await uploadAll({ kind: 'win', id: r.id }, picker.items, picker.patch);
      }
      setDone(r.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit');
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <Page>
        <PageHeader title="In review" crumbs={[{ label: 'Wins', to: '/wins' }, { label: 'Submitted' }]} />
        <Card>
          <p style={{ fontSize: 12, lineHeight: 1.7 }}>
            First wins go through moderation, then auto-approve once trusted. We will notify you.
          </p>
          <Link to="/wins" className="btn btn-pink" style={{ alignSelf: 'flex-start', color: '#fff' }}>
            Back to board
          </Link>
        </Card>
      </Page>
    );

  return (
    <Page>
      <PageHeader
        title="Post a win"
        crumbs={[{ label: 'Wins', to: '/wins' }, { label: step === 1 ? 'Write' : 'Preview' }]}
      />
      {step === 1 ? (
        <Card>
          <label style={{ fontSize: 12 }}>
            Title
            <input
              className="input"
              value={form.title}
              onChange={set('title')}
              placeholder="Booked a 1.2L wedding from one Instagram reel"
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 12 }}>
              Category
              <Select
                value={form.category}
                options={CATEGORY_OPTIONS}
                onChange={(category) => setForm((f) => ({ ...f, category }))}
              />
            </label>
            <label style={{ fontSize: 12 }}>
              When did it happen
              <input className="input" type="date" value={form.occurredOn} onChange={set('occurredOn')} />
            </label>
          </div>

          <label style={{ fontSize: 12 }}>
            The big idea — what another member should copy
            <textarea className="input" rows={4} value={form.bigIdeaMd} onChange={set('bigIdeaMd')} />
            <span style={{ fontSize: 10 }} className="dim">
              {form.bigIdeaMd.trim().length} characters, 40 minimum
            </span>
          </label>

          <label style={{ fontSize: 12 }}>
            How it happened — the actual steps, in order
            <textarea className="input" rows={4} value={form.howItHappenedMd} onChange={set('howItHappenedMd')} />
            <span style={{ fontSize: 10 }} className="dim">
              {form.howItHappenedMd.trim().length} characters, 40 minimum
            </span>
          </label>

          <label style={{ fontSize: 12 }}>
            Tags, separated by commas
            <input
              className="input"
              value={form.tagsText}
              onChange={set('tagsText')}
              placeholder="wedding, instagram, pricing"
            />
          </label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12 }}>Proof photos</span>
            <PickerStrip items={picker.items} onRemove={picker.remove} />
            <PickerButton onPick={picker.add} count={picker.items.length} disabled={busy} />
            <span style={{ fontSize: 10 }} className="dim">
              The frame, the invoice, the message — whatever makes it real. Location data is removed before upload.
            </span>
          </div>

          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={form.publicShare} onChange={set('publicShare')} />
            Allow the club to share this outside the platform
          </label>

          {error && (
            <p role="alert" style={{ color: 'var(--red)', fontSize: 12 }}>
              {error}
            </p>
          )}
          <button className="btn btn-pink" style={{ alignSelf: 'flex-start' }} onClick={() => setStep(2)}>
            Preview
          </button>
        </Card>
      ) : (
        <Card>
          <h3 style={{ marginTop: 0 }}>{form.title || '(untitled)'}</h3>
          <p style={{ fontSize: 11 }} className="dim">
            {form.category}
            {form.occurredOn ? ` · ${form.occurredOn}` : ''}
            {tags.length > 0 ? ` · ${tags.join(', ')}` : ''}
          </p>
          <h4 style={{ margin: '4px 0' }}>The big idea</h4>
          <p style={{ fontSize: 12, lineHeight: 1.7 }}>{form.bigIdeaMd}</p>
          <h4 style={{ margin: '4px 0' }}>How it happened</h4>
          <p style={{ fontSize: 12, lineHeight: 1.7 }} className="muted">
            {form.howItHappenedMd}
          </p>
          <PickerStrip items={picker.items} onRemove={picker.remove} />

          {!check.success && (
            <p role="alert" style={{ color: 'var(--red)', fontSize: 12 }}>
              {check.error.issues[0]?.path.join('.')}: {check.error.issues[0]?.message}
            </p>
          )}
          {error && (
            <p role="alert" style={{ color: 'var(--red)', fontSize: 12 }}>
              {error}
            </p>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-soft" disabled={busy} onClick={() => setStep(1)}>
              Edit
            </button>
            <button className="btn btn-pink" disabled={busy || !check.success} onClick={submit}>
              {busy ? (picker.items.length > 0 ? 'Uploading…' : 'Submitting…') : 'Submit for review'}
            </button>
          </div>
        </Card>
      )}
    </Page>
  );
}
