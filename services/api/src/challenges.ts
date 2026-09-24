import { sql } from 'drizzle-orm';
import { withUser } from '@ipc/db';
import type { Challenge, ChallengeDetail, ChallengeInput } from '@ipc/contracts';
import type { Env } from './env.ts';
import { HttpError } from './lib/problem.ts';
import { createStorage } from './lib/storage.ts';
import { getDb } from './repo.ts';

/**
 * Challenges: a prompt with a deadline.
 *
 * There are no entries in this file, because an entry is a win. A challenge
 * supplies the question and the date; everything after that — the photographs,
 * the moderation of a first-time poster, the reactions, the public share
 * link — is the wins pipeline, already built and already understood by the
 * members using it.
 *
 * What this module owns is therefore small: the prompt, who may answer it,
 * how many did, and which answer won.
 */

const requireDb = (env: Env) => {
  const db = getDb(env);
  if (!db) throw new HttpError(503, 'Needs a database');
  return db;
};

type Row = {
  id: string; slug: string; title: string; prompt: string; brief_md: string | null;
  status: string; starts_on: string; ends_on: string; min_tier: string;
  entry_count: number; my_entry_slug: string | null; tier_ok: boolean;
  winner_slug: string | null; winner_title: string | null; winner_author: string | null;
};

/**
 * One expression for both the list and the detail, so the entry count on a
 * card and the number on the page it opens can never disagree.
 *
 * `entry_count` is counted over published wins only. A pending first post is
 * real to its author and not yet real to anybody else, and a count that
 * includes invisible rows is a count nobody can reconcile by looking.
 */
const SELECT = (userId: string) => sql`
  select
    c.id, c.slug, c.title, c.prompt, c.brief_md, c.status::text,
    c.starts_on, c.ends_on, c.min_tier::text,
    (
      select count(*)::int from wins w
      where w.challenge_id = c.id and w.status = 'published'
    ) as entry_count,
    (
      select w.slug from wins w
      where w.challenge_id = c.id and w.author_id = ${userId}::uuid
      limit 1
    ) as my_entry_slug,
    public.tier_allows(c.min_tier) as tier_ok,
    win.slug as winner_slug, win.title as winner_title, u.full_name as winner_author
  from challenges c
  left join wins win on win.id = c.winner_win_id
  left join users u on u.id = win.author_id
`;

const dayDiff = (to: string) =>
  Math.ceil((new Date(`${to}T23:59:59Z`).getTime() - Date.now()) / 86_400_000);

const toChallenge = (r: Row): Challenge => {
  const endsOn = String(r.ends_on).slice(0, 10);
  const daysLeft = dayDiff(endsOn);
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    prompt: r.prompt,
    briefMd: r.brief_md,
    status: r.status as Challenge['status'],
    startsOn: String(r.starts_on).slice(0, 10),
    endsOn,
    minTier: r.min_tier as Challenge['minTier'],
    entryCount: Number(r.entry_count) || 0,
    // Every condition the database trigger enforces, reported rather than
    // discovered. A member should know the button will not work before they
    // have written four paragraphs.
    canEnter: r.status === 'open' && daysLeft >= 0 && Boolean(r.tier_ok) && r.my_entry_slug === null,
    myEntrySlug: r.my_entry_slug,
    daysLeft,
    winner: r.winner_slug
      ? { winSlug: r.winner_slug, title: r.winner_title ?? '', authorName: r.winner_author ?? '' }
      : null,
  };
};

export async function listChallenges(env: Env, userId: string | null): Promise<Challenge[]> {
  const db = getDb(env);
  if (!db || !userId) return [];
  return withUser(db, userId, async (tx) => {
    const rows = await tx.execute<Row>(sql`
      ${SELECT(userId)}
      -- Open first, then the most recent closed. A member arriving mid-week
      -- wants the thing they can still do.
      order by (c.status = 'open') desc, c.starts_on desc
      limit 50
    `);
    return rows.map(toChallenge);
  });
}

export async function getChallenge(env: Env, userId: string | null, slug: string): Promise<ChallengeDetail> {
  const db = requireDb(env);
  if (!userId) throw new HttpError(401, 'Not authenticated');

  return withUser(db, userId, async (tx) => {
    const rows = await tx.execute<Row>(sql`${SELECT(userId)} where c.slug = ${slug}`);
    const head = rows[0];
    if (!head) throw new HttpError(404, 'Challenge not found');

    const entries = await tx.execute<{
      slug: string; title: string; full_name: string; reactions_count: number;
      created_at: string; cover_key: string | null; is_winner: boolean;
    }>(sql`
      select
        w.slug, w.title, u.full_name, w.reactions_count, w.created_at,
        (select m.storage_key from win_media m where m.win_id = w.id order by m.rank asc limit 1) as cover_key,
        (w.id = c.winner_win_id) as is_winner
      from wins w
      join users u on u.id = w.author_id
      join challenges c on c.id = w.challenge_id
      where w.challenge_id = ${head.id}::uuid and w.status = 'published'
      -- The winner first if there is one, then most-liked. A gallery ordered
      -- by time buries the best work under whoever posted last.
      order by (w.id = c.winner_win_id) desc, w.reactions_count desc, w.created_at desc
      limit 200
    `);

    const storage = createStorage(env);
    return {
      ...toChallenge(head),
      entries: await Promise.all(
        entries.map(async (e) => ({
          winSlug: e.slug,
          title: e.title,
          authorName: e.full_name,
          authorInitials: e.full_name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase(),
          reactions: Number(e.reactions_count) || 0,
          // A thumbnail is the entire point of a photography challenge. A
          // failed signature degrades to no image rather than no gallery.
          coverUrl: e.cover_key ? await storage.signedDownloadUrl(e.cover_key, 3600).catch(() => null) : null,
          createdAt: new Date(e.created_at).toISOString(),
          isWinner: Boolean(e.is_winner),
        })),
      ),
    };
  });
}

/* ── Authoring ─────────────────────────────────────────────────────────── */

export async function createChallenge(env: Env, userId: string, input: ChallengeInput): Promise<Challenge> {
  const db = requireDb(env);
  /* The insert finishes and its transaction closes before the read starts.
     Calling `getChallenge` from inside the callback opens a second connection
     against a row the first has not committed, so it finds nothing — and with
     a single-connection pool it does not even get that far. */
  const slug = await withUser(db, userId, async (tx) => {
    const rows = await tx.execute<{ slug: string }>(sql`
      insert into challenges (slug, title, prompt, brief_md, starts_on, ends_on, min_tier, status)
      values (
        ${input.slug}, ${input.title}, ${input.prompt}, ${input.briefMd},
        ${input.startsOn}::date, ${input.endsOn}::date,
        ${input.minTier}::public.tier, ${input.status}::public.challenge_status
      )
      returning slug
    `);
    if (!rows[0]) throw new HttpError(500, 'Challenge was not created');
    return rows[0].slug;
  });
  return getChallenge(env, userId, slug);
}

export async function updateChallenge(
  env: Env,
  userId: string,
  id: string,
  input: ChallengeInput,
): Promise<Challenge> {
  const db = requireDb(env);
  const slug = await withUser(db, userId, async (tx) => {
    const rows = await tx.execute<{ slug: string }>(sql`
      update challenges set
        slug = ${input.slug}, title = ${input.title}, prompt = ${input.prompt},
        brief_md = ${input.briefMd}, starts_on = ${input.startsOn}::date,
        ends_on = ${input.endsOn}::date, min_tier = ${input.minTier}::public.tier,
        status = ${input.status}::public.challenge_status, updated_at = now()
      where id = ${id}::uuid
      returning slug
    `);
    if (!rows[0]) throw new HttpError(404, 'Challenge not found');
    return rows[0].slug;
  });
  return getChallenge(env, userId, slug);
}

/**
 * Deleting a prompt.
 *
 * The entries survive it. `wins.challenge_id` is `on delete set null`, so the
 * photographs stay on the board as ordinary wins — deleting a question must
 * never delete the work people did to answer it.
 */
export async function deleteChallenge(env: Env, userId: string, id: string): Promise<void> {
  const db = requireDb(env);
  await withUser(db, userId, async (tx) => {
    await tx.execute(sql`delete from challenges where id = ${id}::uuid`);
  });
}

/**
 * Picking a winner.
 *
 * Refuses an entry from a different challenge, which is the one mistake this
 * endpoint can make that nothing downstream would catch: the challenge page
 * would show a winner nobody recognised, taken for a different prompt.
 *
 * The congratulation is sent by the `challenge.lifecycle` job rather than
 * here, so it is sent exactly once even if the choice is changed twice.
 */
export async function pickWinner(
  env: Env,
  userId: string,
  id: string,
  winSlug: string | null,
): Promise<Challenge> {
  const db = requireDb(env);
  const slug = await withUser(db, userId, async (tx) => {
    if (winSlug !== null) {
      const [entry] = await tx.execute<{ id: string }>(sql`
        select w.id from wins w
        where w.slug = ${winSlug} and w.challenge_id = ${id}::uuid and w.status = 'published'
      `);
      if (!entry) throw new HttpError(422, 'That entry is not in this challenge');
    }
    const rows = await tx.execute<{ slug: string }>(sql`
      update challenges set
        winner_win_id = ${winSlug === null
          ? sql`null`
          : sql`(select id from wins where slug = ${winSlug})`},
        updated_at = now()
      where id = ${id}::uuid
      returning slug
    `);
    if (!rows[0]) throw new HttpError(404, 'Challenge not found');
    return rows[0].slug;
  });
  return getChallenge(env, userId, slug);
}
