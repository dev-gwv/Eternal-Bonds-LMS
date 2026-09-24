import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { LibraryCategory, LibraryItem, Tier } from '@ipc/contracts';
import { LibraryCategoryInput, LibraryItemInput } from '@ipc/contracts';
import { adminApi, uploadLibraryFile } from '../../shared/admin-api.ts';
import { PageHeader, Page } from '../../shared/layout/AppShell.tsx';
import { Card, Chip, EmptyState, Icon } from '../../shared/ui/primitives.tsx';
import { LoadingLabel, SkeletonCard } from '../../shared/ui/Skeleton.tsx';
import { useToast } from '../../shared/ui/Toast.tsx';
import { ConfirmButton, ErrorNote, Field, Select, Toolbar, slugify } from './studio-ui.tsx';

/**
 * Filling the library.
 *
 * The section shipped with a read API, admin-write RLS policies, and nothing
 * in between — so the only resources the club would ever offer were the ones
 * the seed script inserted, and the page that exists to say "here are the
 * things we give you" could not gain a single file. This is the missing half.
 *
 * Two kinds of item, and the form makes you choose rather than offering both
 * fields at once. A row holding a storage key *and* an external URL raises a
 * question nothing downstream can answer about which one a member should get,
 * so the contract rejects it and the form never produces it.
 */

const TIERS: readonly Tier[] = ['free', 'silver', 'diamond', 'franchisee'] as const;
const UNITS = ['files', 'links', 'images', 'videos'] as const;

/* ── Adding an item ────────────────────────────────────────────────────── */

function NewItem({ categories, onDone }: { categories: LibraryCategory[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<'link' | 'file'>('link');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [minTier, setMinTier] = useState<Tier>('diamond');
  const [externalUrl, setExternalUrl] = useState('');
  // Set once the bytes are in storage. Until then a file item cannot be saved,
  // which is correct: the row would point at nothing.
  const [uploaded, setUploaded] = useState<{ key: string; mime: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  const body = () => ({
    categoryId,
    title: title.trim(),
    minTier,
    externalUrl: kind === 'link' ? externalUrl.trim() || null : null,
    storageKey: kind === 'file' ? (uploaded?.key ?? null) : null,
    mime: kind === 'file' ? (uploaded?.mime ?? null) : null,
  });

  const parsed = LibraryItemInput.safeParse(body());
  const errors: Record<string, string> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      errors[key] ??= issue.message;
    }
  }

  const create = useMutation({
    mutationFn: () => adminApi.createLibraryItem(LibraryItemInput.parse(body())),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'library'] });
      toast.show('Added to the library');
      onDone();
    },
    onError: toast.error,
  });

  const pick = async (file: File) => {
    setUploading(true);
    try {
      const done = await uploadLibraryFile(file);
      setUploaded({ ...done, name: file.name });
      // The filename is a better first guess at a title than an empty box, and
      // it is the name members will see on the download anyway.
      if (title.trim() === '') setTitle(file.name.replace(/\.[^.]+$/, ''));
    } catch (e) {
      toast.error(e);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <Card title="New resource">
      <ErrorNote error={create.error} />

      {/* Kind first, because it decides which of the two fields below exists.
          Showing both and ignoring one is how you get rows with a URL and a
          file that disagree. */}
      <div className="segmented">
        <button
          type="button"
          className={kind === 'link' ? 'is-on' : undefined}
          onClick={() => setKind('link')}
        >
          <Icon name="link" size={13} />A link
        </button>
        <button
          type="button"
          className={kind === 'file' ? 'is-on' : undefined}
          onClick={() => setKind('file')}
        >
          <Icon name="image" size={13} />A file we host
        </button>
      </div>

      <div className="field-row">
        <Field label="Title" error={title.trim() === '' ? null : errors.title}>
          <input value={title} placeholder="Contract template for wedding shoots" onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Category">
          <Select
            value={categoryId}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            onChange={setCategoryId}
          />
        </Field>
        <Field label="Minimum tier">
          <Select value={minTier} options={TIERS} onChange={(v) => setMinTier(v as Tier)} />
        </Field>
      </div>

      {kind === 'link' ? (
        <Field label="Where it points" error={externalUrl.trim() === '' ? null : errors.externalUrl}>
          <input
            value={externalUrl}
            placeholder="https://drive.google.com/…"
            onChange={(e) => setExternalUrl(e.target.value)}
          />
        </Field>
      ) : (
        <Field label="The file">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <input
              ref={fileInput}
              type="file"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void pick(f);
              }}
            />
            <button
              type="button"
              className="btn btn-soft"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              {uploading ? 'Uploading…' : uploaded ? 'Replace file' : 'Choose a file'}
            </button>
            {uploaded ? (
              <Chip tone="green">{uploaded.name}</Chip>
            ) : (
              <span style={{ fontSize: 10.5 }} className="dim">
                Goes straight to storage. Members get a short-lived signed link, never the raw path.
              </span>
            )}
          </div>
        </Field>
      )}

      <Toolbar>
        <button
          type="button"
          className="btn btn-pink"
          disabled={!parsed.success || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? 'Adding…' : 'Add resource'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <span style={{ flex: 1 }} />
        {/* Never a silently grey button. That exact shape — valid-looking form,
            disabled action, no reason given — is what made the new-course form
            look broken for a week. */}
        {!parsed.success && title.trim() !== '' && (
          <span style={{ fontSize: 10, textAlign: 'right' }} className="dim">
            {Object.values(errors)[0]}
          </span>
        )}
      </Toolbar>
    </Card>
  );
}

/* ── Categories ────────────────────────────────────────────────────────── */

function NewCategory({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);
  const [blurb, setBlurb] = useState('');
  const [unit, setUnit] = useState<(typeof UNITS)[number]>('files');

  const effectiveSlug = touched ? slug : slugify(name);
  const body = { slug: effectiveSlug, name: name.trim(), blurb: blurb.trim() || null, unit };
  const parsed = LibraryCategoryInput.safeParse(body);

  const create = useMutation({
    mutationFn: () => adminApi.createLibraryCategory(LibraryCategoryInput.parse(body)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'library'] });
      toast.show('Shelf added');
      onDone();
    },
    onError: toast.error,
  });

  return (
    <Card title="New shelf">
      <ErrorNote error={create.error} />
      <div className="field-row">
        <Field label="Name">
          <input value={name} placeholder="Contracts and templates" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Address">
          <span className="input-prefixed">
            <span className="input-prefix">/library/</span>
            <input
              value={effectiveSlug}
              placeholder="contracts"
              onChange={(e) => {
                setTouched(true);
                setSlug(e.target.value);
              }}
              onBlur={(e) => setSlug(slugify(e.target.value))}
            />
          </span>
        </Field>
        <Field label="Counted as">
          <Select value={unit} options={UNITS} onChange={(v) => setUnit(v as (typeof UNITS)[number])} />
        </Field>
      </div>
      <Field label="One line about what is on this shelf">
        <input value={blurb} placeholder="Everything you send a client before the shoot." onChange={(e) => setBlurb(e.target.value)} />
      </Field>
      <Toolbar>
        <button
          type="button"
          className="btn btn-pink"
          disabled={!parsed.success || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? 'Adding…' : 'Add shelf'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </Toolbar>
    </Card>
  );
}

/* ── The page ──────────────────────────────────────────────────────────── */

function ItemRow({ item, categories }: { item: LibraryItem; categories: LibraryCategory[] }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'library'] });

  const category = categories.find((c) => c.slug === item.categorySlug);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [categoryId, setCategoryId] = useState(category?.id ?? categories[0]?.id ?? '');
  const [minTier, setMinTier] = useState<Tier>(item.minTier);

  const remove = useMutation({
    mutationFn: () => adminApi.deleteLibraryItem(item.id),
    onSuccess: () => {
      refresh();
      toast.show('Removed from the library');
    },
    onError: toast.error,
  });

  /**
   * Editing in place, and only the three things that change.
   *
   * Not the file or the URL: swapping what a resource *is* under a title
   * members already know is how somebody downloads last year's contract
   * believing it is this year's. That is a new item and a deleted old one,
   * which is two deliberate acts rather than one quiet one.
   */
  const save = useMutation({
    mutationFn: () =>
      adminApi.updateLibraryItem(item.id, { categoryId, title: title.trim(), minTier }),
    onSuccess: () => {
      refresh();
      setEditing(false);
      toast.show('Saved');
    },
    onError: toast.error,
  });

  if (editing) {
    return (
      <div className="card-row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Shelf">
          <Select
            value={categoryId}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            onChange={setCategoryId}
          />
        </Field>
        <Field label="Minimum tier">
          <Select value={minTier} options={TIERS} onChange={(v) => setMinTier(v as Tier)} />
        </Field>
        <button
          type="button"
          className="btn btn-pink"
          disabled={save.isPending || title.trim().length < 2}
          onClick={() => save.mutate()}
        >
          Save
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="card-row" style={{ gap: 10, alignItems: 'center' }}>
      <Icon name={item.kind === 'link' ? 'link' : 'image'} size={14} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>{item.title}</span>
        <span style={{ fontSize: 10 }} className="dim">
          {category?.name ?? item.categorySlug}
          {item.kind === 'link' && item.url ? ` · ${new URL(item.url).hostname}` : ''}
          {item.mime ? ` · ${item.mime}` : ''}
        </span>
      </span>
      {item.minTier !== 'free' && <Chip tone="pink">{item.minTier}</Chip>}
      <button type="button" className="btn btn-ghost" style={{ fontSize: 10 }} onClick={() => setEditing(true)}>
        Edit
      </button>
      <ConfirmButton
        label="Delete"
        confirmLabel="Delete it"
        style={{ fontSize: 10, color: 'var(--red)' }}
        disabled={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

/**
 * A shelf, renameable in place.
 *
 * Renaming matters more here than it looks: the name is the heading members
 * browse by, and the first version of a shelf is always called something like
 * "Docs" before anybody knows what will end up on it. The address is not
 * editable — changing a slug breaks every link anybody saved to it, and a
 * library whose URLs move is a library people stop linking to.
 */
function CategoryCard({
  category,
  showing,
  onToggleFilter,
  onDelete,
  deleting,
}: {
  category: LibraryCategory;
  showing: boolean;
  onToggleFilter: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [blurb, setBlurb] = useState(category.blurb);

  const save = useMutation({
    mutationFn: () =>
      adminApi.updateLibraryCategory(category.id, {
        slug: category.slug,
        name: name.trim(),
        blurb: blurb.trim() || null,
        unit: category.unit,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'library'] });
      setEditing(false);
      toast.show('Shelf updated');
    },
    onError: toast.error,
  });

  if (editing) {
    return (
      <Card>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="One line about this shelf">
          <input value={blurb} onChange={(e) => setBlurb(e.target.value)} />
        </Field>
        <span style={{ fontSize: 10 }} className="dim">
          The address stays /library/{category.slug} — changing it would break every link saved to it.
        </span>
        <Toolbar>
          <button
            type="button"
            className="btn btn-pink"
            disabled={save.isPending || name.trim().length < 2}
            onClick={() => save.mutate()}
          >
            Save
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </Toolbar>
      </Card>
    );
  }

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600 }}>{category.name}</span>
        <Chip>{category.itemCount}</Chip>
      </div>
      {category.blurb && (
        <span style={{ fontSize: 11, lineHeight: 1.5 }} className="muted">
          {category.blurb}
        </span>
      )}
      <Toolbar>
        <button
          type="button"
          className={showing ? 'btn btn-pink' : 'btn btn-ghost'}
          style={showing ? { color: '#fff' } : { fontSize: 10 }}
          onClick={onToggleFilter}
        >
          {showing ? 'Showing this shelf' : 'Show only this'}
        </button>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 10 }} onClick={() => setEditing(true)}>
          Edit
        </button>
        <span style={{ flex: 1 }} />
        <ConfirmButton
          label="Delete"
          confirmLabel="Delete shelf"
          style={{ fontSize: 10, color: 'var(--red)' }}
          disabled={deleting}
          onConfirm={onDelete}
        />
      </Toolbar>
    </Card>
  );
}

export function AdminLibraryPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState<'item' | 'category' | null>(null);
  const [filter, setFilter] = useState('');

  const categories = useQuery({
    queryKey: ['admin', 'library', 'categories'],
    queryFn: adminApi.libraryCategories,
  });
  const items = useQuery({
    queryKey: ['admin', 'library', 'items', filter],
    queryFn: () => adminApi.libraryItems(filter || undefined),
  });

  const removeCategory = useMutation({
    mutationFn: (id: string) => adminApi.deleteLibraryCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'library'] });
      toast.show('Shelf removed');
    },
    // The API refuses a shelf that still holds items and says how many, which
    // is the whole message — a cascade that silently took forty resources with
    // it would be the worst button in the studio.
    onError: toast.error,
  });

  const cats = categories.data ?? [];

  return (
    <Page>
      <PageHeader
        title="Library"
        back="/admin"
        crumbs={[{ label: 'Studio', to: '/admin' }, { label: 'Library' }]}
        actions={
          <Toolbar>
            <button type="button" className="btn btn-soft" onClick={() => setAdding('category')}>
              <Icon name="plus" size={13} />
              New shelf
            </button>
            <button
              type="button"
              className="btn btn-pink"
              disabled={cats.length === 0}
              title={cats.length === 0 ? 'Add a shelf first — a resource has to live somewhere' : undefined}
              onClick={() => setAdding('item')}
            >
              <Icon name="plus" size={13} />
              New resource
            </button>
          </Toolbar>
        }
      />

      {adding === 'category' && <NewCategory onDone={() => setAdding(null)} />}
      {adding === 'item' && cats.length > 0 && (
        <NewItem categories={cats} onDone={() => setAdding(null)} />
      )}

      <span className="section-label">Shelves</span>
      {categories.isPending ? (
        <SkeletonCard />
      ) : cats.length === 0 ? (
        <Card>
          <EmptyState
            icon="library"
            title="Nothing on the shelves yet"
            hint="A shelf is a heading members browse by — contracts, presets, price lists. Resources go on one."
          />
        </Card>
      ) : (
        <div className="grid grid-3">
          {cats.map((c) => (
            <CategoryCard
              key={c.id}
              category={c}
              showing={filter === c.id}
              onToggleFilter={() => setFilter(filter === c.id ? '' : c.id)}
              onDelete={() => removeCategory.mutate(c.id)}
              deleting={removeCategory.isPending}
            />
          ))}
        </div>
      )}

      <span className="section-label">
        Resources{filter ? ` · ${cats.find((c) => c.id === filter)?.name ?? ''}` : ''}
      </span>
      {items.isPending ? (
        <>
          <LoadingLabel>Loading the library</LoadingLabel>
          <SkeletonCard />
        </>
      ) : (items.data ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon="library"
            title={filter ? 'Nothing on this shelf yet' : 'No resources yet'}
            hint="A resource is either a file we host or a link somewhere else. Both appear the same way to members."
          />
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {items.data!.map((i) => (
            <ItemRow key={i.id} item={i} categories={cats} />
          ))}
        </div>
      )}
    </Page>
  );
}
