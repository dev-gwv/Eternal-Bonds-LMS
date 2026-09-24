/**
 * Proves the library can be written to, which for most of this project it
 * could not.
 *
 *   bun run db:test-library
 *
 * The tables carried admin-write RLS policies from the first auth migration
 * and the API exposed three reads against them, so the only resources the club
 * would ever have were the ones the seed script inserted. Nothing failed; the
 * feature was simply absent, which is the kind of gap tests do not find unless
 * somebody writes the test.
 *
 * Two invariants are worth more than the CRUD:
 *
 *   - An item is a hosted file or an external link, never both and never
 *     neither. A row with both raises a question nothing downstream can answer.
 *   - Editing cannot change which of those it is. The patch shape has no
 *     storage key and no URL, so retitling a contract cannot quietly swap the
 *     file behind it.
 */
import { sql } from 'drizzle-orm';
import { createDb } from '@ipc/db';
import * as library from '../services/api/src/library-admin.ts';
import { EnvSchema } from '../services/api/src/env.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const env = EnvSchema.parse(process.env);
const db = createDb(url, { max: 1 });

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const stamp = Date.now();
const admin = crypto.randomUUID();
const member = crypto.randomUUID();
let categoryId = '';
let otherId = '';

async function createUser(id: string, email: string, role: 'admin' | 'member') {
  await db.execute(sql`
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data, aud, role)
    values (${id}::uuid, ${email}, '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated')
    on conflict (id) do nothing
  `);
  await db.execute(sql`
    update users set role = ${role}, full_name = ${role === 'admin' ? 'Library Admin' : 'Library Member'}
    where id = ${id}::uuid
  `);
}

try {
  console.log('\nSetup');
  await createUser(admin, `library-admin-${stamp}@example.test`, 'admin');
  await createUser(member, `library-member-${stamp}@example.test`, 'member');
  check('an admin and a member exist', true);

  console.log('\nShelves');
  const shelf = await library.createCategory(env, admin, {
    slug: `audit-shelf-${stamp}`,
    name: 'Audit shelf',
    blurb: 'Written by the test',
    unit: 'files',
  });
  categoryId = shelf.id;
  check('an admin can create one', shelf.slug === `audit-shelf-${stamp}`);
  check('and it starts empty', shelf.itemCount === 0);

  const other = await library.createCategory(env, admin, {
    slug: `audit-shelf-two-${stamp}`,
    name: 'Second shelf',
    blurb: null,
    unit: 'links',
  });
  otherId = other.id;

  // Re-saving the same slug is an author pressing save twice, not a new shelf.
  const again = await library.createCategory(env, admin, {
    slug: `audit-shelf-${stamp}`,
    name: 'Audit shelf renamed',
    blurb: null,
    unit: 'files',
  });
  check('creating the same slug twice updates rather than duplicates', again.id === categoryId);

  console.log('\nItems');
  const link = await library.createItem(env, admin, {
    categoryId,
    title: 'A link resource',
    minTier: 'free',
    externalUrl: 'https://example.test/guide.pdf',
    storageKey: null,
    mime: null,
  });
  check('a link item is a link', link.kind === 'link', link.kind);

  const file = await library.createItem(env, admin, {
    categoryId,
    title: 'A hosted file',
    minTier: 'diamond',
    externalUrl: null,
    storageKey: `library/${stamp}-contract.pdf`,
    mime: 'application/pdf',
  });
  check('a hosted item is a file', file.kind === 'file', file.kind);

  const listed = await library.listAdminItems(env, admin, categoryId);
  check('both are on the shelf', listed.length === 2, String(listed.length));

  const filtered = await library.listAdminItems(env, admin, otherId);
  check('and the other shelf is empty', filtered.length === 0);

  console.log('\nEditing cannot change what a resource is');
  await library.updateItem(env, admin, file.id, {
    categoryId: otherId,
    title: 'Moved and renamed',
    minTier: 'silver',
  });
  const moved = (await library.listAdminItems(env, admin, otherId))[0];
  check('the title changed', moved?.title === 'Moved and renamed', moved?.title);
  check('the shelf changed', moved?.categorySlug === other.slug, moved?.categorySlug);
  check('the tier changed', moved?.minTier === 'silver', moved?.minTier);
  // The one that matters: a whole-object patch used to be able to blank the
  // storage key, turning a hosted file into a row pointing at nothing.
  check('it is still a hosted file', moved?.kind === 'file', moved?.kind);

  console.log('\nA shelf with items on it');
  let refused = false;
  try {
    await library.deleteCategory(env, admin, categoryId);
  } catch (e) {
    refused = true;
    check('the message says how many', /1 item/.test((e as Error).message), (e as Error).message);
  }
  check('cannot be deleted', refused);

  console.log('\nMembers cannot write');
  let blocked = false;
  try {
    await library.createItem(env, member, {
      categoryId,
      title: 'A member should not manage this',
      minTier: 'free',
      externalUrl: 'https://example.test/nope',
      storageKey: null,
      mime: null,
    });
  } catch {
    blocked = true;
  }
  check('RLS refuses a member insert', blocked);

  console.log('\nDeleting');
  await library.deleteItem(env, admin, link.id);
  await library.deleteItem(env, admin, moved!.id);
  check('items go', (await library.listAdminItems(env, admin, categoryId)).length === 0);
  await library.deleteCategory(env, admin, categoryId);
  await library.deleteCategory(env, admin, otherId);
  categoryId = '';
  otherId = '';
  check('and an empty shelf goes', true);
} finally {
  console.log('\nCleanup');
  for (const id of [categoryId, otherId].filter(Boolean)) {
    await db.execute(sql`delete from library_categories where id = ${id}::uuid`);
  }
  await db.execute(sql`delete from auth.users where id in (${admin}::uuid, ${member}::uuid)`);
  await db.$client.end({ timeout: 5 });
}

console.log(failures === 0 ? '\nThe library can be filled.\n' : `\n${failures} check(s) failed.\n`);
// Explicit, like every other suite: postgres.js keeps a handle warm after
// `end()` and the process otherwise sits there looking like a hang.
process.exit(failures === 0 ? 0 : 1);
