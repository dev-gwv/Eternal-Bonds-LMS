import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { PackageDetail, PackageInput } from '@ipc/contracts';
import { adminApi } from '../../shared/admin-api.ts';
import { durationLabel } from '../../shared/api.ts';
import { Page, PageHeader } from '../../shared/layout/AppShell.tsx';
import { CoverPicker } from '../../shared/ui/CoverPicker.tsx';
import { Card, Chip, Icon } from '../../shared/ui/primitives.tsx';
import { SkeletonCard } from '../../shared/ui/Skeleton.tsx';
import { useToast } from '../../shared/ui/Toast.tsx';
import { rupees } from '../Membership.tsx';
import { ConfirmButton, Empty, ErrorNote, Field, IconButton, Toolbar, fieldErrors } from './studio-ui.tsx';

/**
 * Packages in Studio: bundles of courses sold on their own.
 *
 * Three things on the editor, in the order an admin does them: what it is
 * (title, price, how long it lasts), what is in it (courses, in order), and
 * who has it (give it to a member who paid by UPI, or take it back).
 */

const slugify = (v: string) =>
  v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

const ACCESS_OPTIONS = [
  { value: '', label: 'Lifetime' },
  { value: '90', label: '3 months' },
  { value: '180', label: '6 months' },
  { value: '365', label: '1 year' },
  { value: '730', label: '2 years' },
];

/* ── List ──────────────────────────────────────────────────────────────── */

function NewPackage({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const create = useMutation({
    mutationFn: () =>
      adminApi.createPackage({
        title: title.trim(),
        slug: slugify(title),
        summaryMd: null,
        pricePaise: 0,
        accessDays: null,
        isPublished: false,
      }),
    onSuccess: (pkg) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'packages'] });
      onDone();
      void navigate({ to: '/admin/packages/$id', params: { id: pkg.id } });
    },
  });
  return (
    <Card title="New package">
      <ErrorNote error={create.error} />
      <Field label="Name">
        <input
          autoFocus
          value={title}
          placeholder="Wedding Business Masterclass"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && title.trim().length >= 3 && create.mutate()}
        />
      </Field>
      <Toolbar>
        <button
          type="button"
          className="btn btn-pink"
          disabled={title.trim().length < 3 || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? 'Creating…' : 'Create and add courses'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </Toolbar>
    </Card>
  );
}

export function AdminPackagesPage() {
  const packages = useQuery({ queryKey: ['admin', 'packages'], queryFn: adminApi.packages });
  const [creating, setCreating] = useState(false);

  return (
    <Page>
      <PageHeader
        title="Packages"
        back="/admin"
        crumbs={[{ label: 'Studio', to: '/admin' }, { label: 'Packages' }]}
        actions={
          !creating && (
            <button type="button" className="btn btn-pink" onClick={() => setCreating(true)}>
              <Icon name="plus" size={13} />
              New package
            </button>
          )
        }
      />
      <p className="muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.55, maxWidth: 680 }}>
        A package is a bundle of courses a member buys on its own, whatever their membership tier. Members who own a
        package get every course in it. To keep a course out of the tiers entirely, tick “Only through packages” in
        that course's settings.
      </p>
      {creating && <NewPackage onDone={() => setCreating(false)} />}
      <ErrorNote error={packages.error} />
      {packages.isPending && <SkeletonCard height={80} lines={2} />}
      {packages.data?.length === 0 && !creating && <Empty>No packages yet. Create one to bundle courses together.</Empty>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {packages.data?.map((p) => (
          <Link key={p.id} to="/admin/packages/$id" params={{ id: p.id }} className="card" style={{ color: 'inherit', padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{p.title}</div>
                <div className="dim" style={{ fontSize: 11.5 }}>
                  {p.courseCount} course{p.courseCount === 1 ? '' : 's'} · {p.lessonCount} lessons ·{' '}
                  {durationLabel(p.durationMinutes)}
                </div>
              </div>
              <span className="num" style={{ fontWeight: 700 }}>
                {p.pricePaise > 0 ? rupees(p.pricePaise) : 'No price'}
              </span>
              {p.isPublished ? <Chip tone="green">Published</Chip> : <Chip tone="yellow">Draft</Chip>}
            </div>
          </Link>
        ))}
      </div>
    </Page>
  );
}

/* ── Editor ────────────────────────────────────────────────────────────── */

type Draft = { title: string; slug: string; summaryMd: string; price: string; accessDays: string; isPublished: boolean };

const draftOf = (p: PackageDetail): Draft => ({
  title: p.title,
  slug: p.slug,
  summaryMd: p.summaryMd ?? '',
  price: p.pricePaise > 0 ? String(p.pricePaise / 100) : '',
  accessDays: p.accessDays === null ? '' : String(p.accessDays),
  isPublished: p.isPublished,
});

function Details({ pkg }: { pkg: PackageDetail }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => draftOf(pkg));
  useEffect(() => setDraft(draftOf(pkg)), [pkg]);

  const rupeesValue = Number(draft.price || '0');
  const priceProblem =
    draft.price.trim() !== '' && (!Number.isFinite(rupeesValue) || rupeesValue < 0) ? 'Enter the price in rupees, like 4999' : null;

  const input = (publish = draft.isPublished): PackageInput => ({
    title: draft.title.trim(),
    slug: draft.slug.trim(),
    summaryMd: draft.summaryMd.trim() === '' ? null : draft.summaryMd,
    pricePaise: Math.round(rupeesValue * 100),
    accessDays: draft.accessDays === '' ? null : Number(draft.accessDays),
    isPublished: publish,
  });

  const save = useMutation({
    mutationFn: (publish?: boolean) => adminApi.updatePackage(pkg.id, input(publish)),
    onSuccess: (next) => {
      queryClient.setQueryData(['admin', 'package', pkg.id], next);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'packages'] });
      void queryClient.invalidateQueries({ queryKey: ['packages'] });
      toast.show(next.isPublished === pkg.isPublished ? 'Saved' : next.isPublished ? 'Published' : 'Unpublished');
    },
  });

  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(pkg));
  const errors = fieldErrors(save.error);

  return (
    <Card
      title="Package"
      action={pkg.isPublished ? <Chip tone="green">Published</Chip> : <Chip tone="yellow">Draft</Chip>}
    >
      {errors.rest && <ErrorNote error={new Error(errors.rest)} />}
      <div className="field-row">
        <Field label="Name" error={errors.of('title')}>
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </Field>
        <Field label="URL" error={errors.of('slug')}>
          <input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Price (₹)" error={priceProblem ?? errors.of('pricePaise')}>
          <input
            inputMode="decimal"
            value={draft.price}
            placeholder="4999"
            onChange={(e) => setDraft({ ...draft, price: e.target.value.replace(/[^\d.]/g, '') })}
          />
        </Field>
        <Field label="Access lasts">
          <select value={draft.accessDays} onChange={(e) => setDraft({ ...draft, accessDays: e.target.value })}>
            {ACCESS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <CoverPicker
        kind="package"
        id={pkg.id}
        coverUrl={pkg.coverUrl}
        invalidate={[['admin', 'package', pkg.id], ['admin', 'packages'], ['packages']]}
      />
      <Field label="Description">
        <textarea
          value={draft.summaryMd}
          placeholder="What a member gets, and who it is for."
          onChange={(e) => setDraft({ ...draft, summaryMd: e.target.value })}
        />
      </Field>
      <Toolbar>
        <button
          type="button"
          className="btn btn-pink"
          disabled={!dirty || Boolean(priceProblem) || save.isPending}
          onClick={() => save.mutate(undefined)}
        >
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          className={pkg.isPublished ? 'btn btn-soft' : 'btn btn-green'}
          disabled={save.isPending || Boolean(priceProblem) || (!pkg.isPublished && pkg.courses.length === 0)}
          title={!pkg.isPublished && pkg.courses.length === 0 ? 'Add at least one course first' : undefined}
          onClick={() => save.mutate(!pkg.isPublished)}
        >
          {pkg.isPublished ? 'Unpublish' : 'Publish'}
        </button>
        <span style={{ fontSize: 11 }} className={dirty ? 'unsaved' : 'dim'}>
          {dirty ? 'Unsaved changes' : 'Everything saved'}
        </span>
      </Toolbar>
    </Card>
  );
}

function Courses({ pkg }: { pkg: PackageDetail }) {
  const queryClient = useQueryClient();
  const courses = useQuery({ queryKey: ['admin', 'courses'], queryFn: adminApi.courses });
  const [adding, setAdding] = useState('');
  const ids = pkg.courses.map((c) => c.courseId);

  const set = useMutation({
    mutationFn: (next: string[]) => adminApi.setPackageCourses(pkg.id, next),
    onSuccess: (next) => {
      queryClient.setQueryData(['admin', 'package', pkg.id], next);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'packages'] });
    },
  });

  const move = (from: number, to: number) => {
    const next = [...ids];
    const [id] = next.splice(from, 1);
    next.splice(to, 0, id!);
    set.mutate(next);
  };

  const available = (courses.data ?? []).filter((c) => !ids.includes(c.id));
  const byId = new Map((courses.data ?? []).map((c) => [c.id, c]));

  return (
    <Card title={`Courses in this package · ${pkg.courses.length}`}>
      <ErrorNote error={set.error ?? courses.error} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {pkg.courses.map((c, i) => {
          const admin = byId.get(c.courseId);
          return (
            <div key={c.courseId} className="builder-lesson" style={{ alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <IconButton icon="chevron" label="Move up" disabled={i === 0 || set.isPending} onClick={() => move(i, i - 1)} />
                <IconButton
                  icon="chevron"
                  label="Move down"
                  disabled={i === pkg.courses.length - 1 || set.isPending}
                  onClick={() => move(i, i + 1)}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Link to="/admin/courses/$id" params={{ id: c.courseId }} style={{ fontSize: 13, fontWeight: 600 }}>
                  {c.title}
                </Link>
                <div className="dim" style={{ fontSize: 11 }}>
                  {c.lessonCount} lessons · {durationLabel(c.durationMinutes)}
                  {admin && !admin.isPublished ? ' · draft (hidden from members)' : ''}
                  {admin?.packageOnly ? ' · only through packages' : admin ? ` · also open to ${admin.minTier}+` : ''}
                </div>
              </div>
              <IconButton
                icon="back"
                label={`Remove ${c.title}`}
                disabled={set.isPending}
                onClick={() => set.mutate(ids.filter((id) => id !== c.courseId))}
              />
            </div>
          );
        })}
        {pkg.courses.length === 0 && <Empty>No courses yet. Add the courses this package includes.</Empty>}
      </div>
      <Toolbar>
        <select value={adding} onChange={(e) => setAdding(e.target.value)} style={{ minWidth: 240, flex: 1 }} aria-label="Course to add">
          <option value="">Choose a course to add…</option>
          {available.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
              {c.isPublished ? '' : ' (draft)'}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-soft"
          disabled={!adding || set.isPending}
          onClick={() => {
            set.mutate([...ids, adding]);
            setAdding('');
          }}
        >
          <Icon name="plus" size={13} />
          Add course
        </button>
      </Toolbar>
    </Card>
  );
}

function Access({ pkg }: { pkg: PackageDetail }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [member, setMember] = useState('');
  const [note, setNote] = useState('');
  const key = ['admin', 'package-grants', pkg.id];
  const grants = useQuery({ queryKey: key, queryFn: () => adminApi.packageGrants({ packageId: pkg.id }) });

  const give = useMutation({
    mutationFn: () => adminApi.grantPackage(pkg.id, { member: member.trim(), note: note.trim() || null }),
    onSuccess: (g) => {
      setMember('');
      setNote('');
      void queryClient.invalidateQueries({ queryKey: key });
      toast.show(`${g.memberName} now has ${pkg.title}`);
    },
  });
  const revoke = useMutation({
    mutationFn: (grantId: string) => adminApi.revokePackageGrant(grantId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      toast.show('Access removed');
    },
    onError: toast.error,
  });

  const live = (grants.data ?? []).filter((g) => !g.revokedAt && (!g.expiresAt || Date.parse(g.expiresAt) > Date.now()));
  const past = (grants.data ?? []).filter((g) => !live.includes(g));

  return (
    <Card title={`Members with this package · ${live.length}`}>
      <p className="muted" style={{ fontSize: 12.5, margin: '0 0 10px', lineHeight: 1.55 }}>
        Online purchases appear here by themselves. For a member who paid another way (UPI, bank transfer, cash), give it
        here using the email they sign in with. Giving it again to someone who already has it extends their access.
      </p>
      <ErrorNote error={give.error ?? grants.error} />
      <div className="field-row">
        <Field label="Member's email">
          <input
            type="email"
            value={member}
            placeholder="member@example.com"
            onChange={(e) => setMember(e.target.value)}
          />
        </Field>
        <Field label="Note (optional)">
          <input value={note} placeholder="Paid ₹4,999 by UPI on 18 Nov" onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <Toolbar>
        <button
          type="button"
          className="btn btn-pink"
          disabled={member.trim().length < 3 || give.isPending}
          onClick={() => give.mutate()}
        >
          {give.isPending ? 'Giving…' : 'Give package'}
        </button>
      </Toolbar>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
        {live.map((g) => (
          <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 0', borderTop: '1px solid var(--softer)' }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <Link to="/admin/members/$id" params={{ id: g.userId }} style={{ fontSize: 13, fontWeight: 600 }}>
                {g.memberName}
              </Link>
              <div className="dim" style={{ fontSize: 11 }}>
                {g.memberEmail} · {g.source === 'razorpay' ? 'bought online' : 'given by an admin'} ·{' '}
                {g.expiresAt ? `until ${new Date(g.expiresAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}` : 'lifetime'}
                {g.note ? ` · ${g.note}` : ''}
              </div>
            </div>
            <ConfirmButton
              label="Remove"
              confirmLabel="Remove access"
              disabled={revoke.isPending}
              onConfirm={() => revoke.mutate(g.id)}
            />
          </div>
        ))}
        {grants.data && live.length === 0 && <Empty>Nobody has this package yet.</Empty>}
        {past.length > 0 && (
          <details style={{ fontSize: 12 }}>
            <summary className="dim" style={{ cursor: 'pointer' }}>
              Ended or removed · {past.length}
            </summary>
            {past.map((g) => (
              <div key={g.id} className="dim" style={{ padding: '4px 0' }}>
                {g.memberName} · {g.revokedAt ? 'removed' : 'expired'}{' '}
                {new Date(g.revokedAt ?? g.expiresAt!).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
              </div>
            ))}
          </details>
        )}
      </div>
    </Card>
  );
}

export function AdminPackageEditorPage() {
  const { id } = useParams({ from: '/admin/packages/$id' });
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const pkg = useQuery({ queryKey: ['admin', 'package', id], queryFn: () => adminApi.package(id) });

  const remove = useMutation({
    mutationFn: () => adminApi.deletePackage(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'packages'] });
      toast.show('Package deleted');
      void navigate({ to: '/admin/packages' });
    },
    onError: toast.error,
  });

  const data = pkg.data;
  return (
    <Page>
      <PageHeader
        title={data?.title ?? 'Package'}
        back="/admin/packages"
        crumbs={[{ label: 'Studio', to: '/admin' }, { label: 'Packages', to: '/admin/packages' }, { label: data?.title ?? '…' }]}
        actions={
          data && (
            <>
              {data.isPublished && (
                <Link to="/packages/$slug" params={{ slug: data.slug }} className="btn btn-soft">
                  <Icon name="eye" size={13} />
                  View as member
                </Link>
              )}
              <ConfirmButton
                label="Delete"
                confirmLabel="Delete this package"
                disabled={remove.isPending}
                onConfirm={() => remove.mutate()}
              />
            </>
          )
        }
      />
      <ErrorNote error={pkg.error} />
      {pkg.isPending && <SkeletonCard height={240} lines={4} />}
      {data && (
        <>
          <Details pkg={data} />
          <Courses pkg={data} />
          <Access pkg={data} />
        </>
      )}
    </Page>
  );
}
