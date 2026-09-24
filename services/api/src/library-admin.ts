import { sql } from 'drizzle-orm';
import { withUser } from '@ipc/db';
import type {
  LibraryCategory,
  LibraryCategoryInput,
  LibraryItem,
  LibraryItemInput,
  LibraryItemPatch,
} from '@ipc/contracts';
import type { Env } from './env.ts';
import { HttpError } from './lib/problem.ts';
import { createStorage } from './lib/storage.ts';
import { getDb } from './repo.ts';

/**
 * Managing the library — the half of it that was never built.
 *
 * `library_categories` and `library_items` have had admin-write RLS policies
 * since the first auth migration, and the API exposed exactly three reads
 * against them. Nothing could create a row. Every resource the club will ever
 * offer was whatever the seed script happened to insert, and the one section
 * of the site that exists to say "here are the things we give you" could never
 * grow by a single file.
 *
 * Reads live in `modules/library.ts`; this is the writing side, kept apart
 * because it is the only part that needs signed uploads.
 */

const requireDb = (env: Env) => {
  const db = getDb(env);
  if (!db) throw new HttpError(503, 'Needs a database');
  return db;
};

/* ── Categories ────────────────────────────────────────────────────────── */

export async function listAdminCategories(env: Env, userId: string): Promise<LibraryCategory[]> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    const rows = await tx.execute<{
      id: string; slug: string; name: string; blurb: string | null; unit: string; item_count: number;
    }>(sql`
      select
        c.id, c.slug, c.name, c.blurb, c.unit,
        (select count(*)::int from library_items i where i.category_id = c.id) as item_count
      from library_categories c
      order by c.rank asc, c.name asc
    `);
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      blurb: r.blurb ?? '',
      unit: r.unit as LibraryCategory['unit'],
      itemCount: Number(r.item_count) || 0,
    }));
  });
}

export async function createCategory(
  env: Env,
  userId: string,
  input: LibraryCategoryInput,
): Promise<LibraryCategory> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into library_categories (slug, name, blurb, unit, rank)
      values (
        ${input.slug}, ${input.name}, ${input.blurb}, ${input.unit},
        coalesce((select max(rank) from library_categories), 0) + 1000
      )
      -- A duplicate slug is an author re-saving, not a new category.
      on conflict (slug) do update set name = excluded.name, blurb = excluded.blurb, unit = excluded.unit
      returning id
    `);
    if (!row) throw new HttpError(500, 'Category was not created');
    return {
      id: row.id,
      slug: input.slug,
      name: input.name,
      blurb: input.blurb ?? '',
      unit: input.unit,
      itemCount: 0,
    };
  });
}

export async function updateCategory(
  env: Env,
  userId: string,
  id: string,
  input: LibraryCategoryInput,
): Promise<void> {
  const db = requireDb(env);
  await withUser(db, userId, async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      update library_categories
      set slug = ${input.slug}, name = ${input.name}, blurb = ${input.blurb}, unit = ${input.unit}
      where id = ${id}::uuid
      returning id
    `);
    if (rows.length === 0) throw new HttpError(404, 'Category not found');
  });
}

/**
 * Deleting a category takes its items with it — the foreign key cascades — so
 * this refuses while it still holds any. An author clearing an empty shelf and
 * an author destroying forty resources should not be the same click.
 */
export async function deleteCategory(env: Env, userId: string, id: string): Promise<void> {
  const db = requireDb(env);
  await withUser(db, userId, async (tx) => {
    const [count] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from library_items where category_id = ${id}::uuid
    `);
    const held = Number(count?.n ?? 0);
    if (held > 0) {
      throw new HttpError(409, `This category still holds ${held} item(s). Move or delete them first.`);
    }
    await tx.execute(sql`delete from library_categories where id = ${id}::uuid`);
  });
}

/* ── Items ─────────────────────────────────────────────────────────────── */

type ItemRow = {
  id: string; category_slug: string; title: string; storage_key: string | null;
  external_url: string | null; mime: string | null; min_tier: string; created_at: string;
};

const toItem = (r: ItemRow): LibraryItem => ({
  id: r.id,
  categorySlug: r.category_slug,
  title: r.title,
  kind: r.storage_key ? 'file' : 'link',
  // Deliberately unsigned. The admin table shows what a row *is*; the member
  // read path signs, and signing forty rows to draw a table is forty round
  // trips to storage for links nobody is going to click.
  url: r.external_url,
  mime: r.mime,
  minTier: r.min_tier as LibraryItem['minTier'],
  createdAt: new Date(r.created_at).toISOString(),
});

export async function listAdminItems(env: Env, userId: string, categoryId?: string): Promise<LibraryItem[]> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    const rows = await tx.execute<ItemRow>(sql`
      select i.id, c.slug as category_slug, i.title, i.storage_key, i.external_url,
             i.mime, i.min_tier::text, i.created_at
      from library_items i
      join library_categories c on c.id = i.category_id
      ${categoryId ? sql`where i.category_id = ${categoryId}::uuid` : sql``}
      order by i.created_at desc
      limit 500
    `);
    return rows.map(toItem);
  });
}

export async function createItem(env: Env, userId: string, input: LibraryItemInput): Promise<LibraryItem> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    const rows = await tx.execute<ItemRow>(sql`
      with inserted as (
        insert into library_items (category_id, title, storage_key, external_url, mime, min_tier)
        values (
          ${input.categoryId}::uuid, ${input.title}, ${input.storageKey},
          ${input.externalUrl}, ${input.mime}, ${input.minTier}::public.tier
        )
        returning *
      )
      select i.id, c.slug as category_slug, i.title, i.storage_key, i.external_url,
             i.mime, i.min_tier::text, i.created_at
      from inserted i join library_categories c on c.id = i.category_id
    `);
    const row = rows[0];
    if (!row) throw new HttpError(500, 'Item was not created');
    return toItem(row);
  });
}

/**
 * Retitle it, move it to another shelf, change who can reach it.
 *
 * Not what it points at — see `LibraryItemPatch`. The columns holding the file
 * or the URL are untouched here by design, which also means this cannot turn a
 * hosted file into a row pointing at nothing.
 */
export async function updateItem(
  env: Env,
  userId: string,
  id: string,
  input: LibraryItemPatch,
): Promise<void> {
  const db = requireDb(env);
  await withUser(db, userId, async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      update library_items set
        category_id = ${input.categoryId}::uuid,
        title = ${input.title},
        min_tier = ${input.minTier}::public.tier
      where id = ${id}::uuid
      returning id
    `);
    if (rows.length === 0) throw new HttpError(404, 'Item not found');
  });
}

/**
 * The row goes; the file stays.
 *
 * Deleting the object from storage too would be tidier and is the wrong trade.
 * An item removed by mistake is recoverable while its bytes are still there,
 * and orphaned objects cost pennies against the one time somebody deletes the
 * wrong row. Reclaiming that space is a separate, deliberate job.
 */
export async function deleteItem(env: Env, userId: string, id: string): Promise<void> {
  const db = requireDb(env);
  await withUser(db, userId, async (tx) => {
    await tx.execute(sql`delete from library_items where id = ${id}::uuid`);
  });
}

/** Signs a direct browser-to-storage upload, the same two-step as course covers. */
export async function itemUploadTicket(
  env: Env,
  _userId: string,
  filename: string,
): Promise<{ key: string; url: string; token: string | null; method: 'PUT' }> {
  // The extension is kept, because members download these by name and a
  // resource that arrives with no extension will not open.
  const safe = filename.replace(/[^\w.-]+/g, '-').slice(-120);
  const key = `library/${crypto.randomUUID()}-${safe}`;
  const { url, token } = await createStorage(env).signedUploadUrl(key);
  return { key, url, token, method: 'PUT' };
}
