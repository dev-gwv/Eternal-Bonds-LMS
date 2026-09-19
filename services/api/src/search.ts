import { sql } from 'drizzle-orm';
import { withUser } from '@ipc/db';
import type { SearchHit, SearchResults } from '@ipc/contracts';
import type { Env } from './env.ts';
import { getDb } from './repo.ts';
import * as seed from './data/seed.ts';

/**
 * One search across everything the member can reach.
 *
 * Deliberately `ilike`, not Postgres full-text. Full-text brings stemming and
 * ranking, and its stemmer is built for English — this club's content is
 * Hindi, English and Hinglish mixed inside single titles, where stemming makes
 * matches *worse*. At a few thousand rows a substring scan is instant and
 * behaves exactly as a person expects: what they typed, where they typed it.
 *
 * Every query runs through `withUser`, so RLS does the filtering. A free
 * member searching "lighting" cannot find a diamond course by its title, which
 * would otherwise be a quiet information leak — the existence and name of paid
 * content is itself something you pay for.
 */

const PER_GROUP = 5;

export async function search(env: Env, userId: string | null, raw: string): Promise<SearchResults> {
  const query = raw.trim().slice(0, 80);
  if (query.length < 2) return { query, hits: [], truncated: false };

  const db = getDb(env);
  if (!db) {
    const hits = seed.courses
      .filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))
      .slice(0, PER_GROUP)
      .map((c): SearchHit => ({
        kind: 'course',
        id: c.id,
        title: c.title,
        subtitle: c.category,
        href: `/courses/${c.slug}`,
      }));
    return { query, hits, truncated: false };
  }

  // `%` and `_` are wildcards in LIKE. Someone searching for "100%" should not
  // silently match everything.
  const pattern = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

  return withUser(db, userId, async (tx) => {
    const rows = await tx.execute<{
      kind: SearchHit['kind'];
      id: string;
      title: string;
      subtitle: string | null;
      href: string;
    }>(sql`
      (
        select 'course' as kind, c.id::text as id, c.title,
               initcap(c.category) || ' · ' || initcap(c.level::text) as subtitle,
               '/courses/' || c.slug as href
        from courses c
        where c.is_published and c.title ilike ${pattern}
        order by c.rank limit ${PER_GROUP}
      )
      union all
      (
        select 'workshop', w.id::text, w.title,
               to_char(w.starts_at at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM'),
               '/workshops'
        from workshops w
        where w.title ilike ${pattern}
        order by w.starts_at desc limit ${PER_GROUP}
      )
      union all
      (
        select 'library', li.id::text, li.title,
               lc.name, '/library'
        from library_items li
        join library_categories lc on lc.id = li.category_id
        where li.title ilike ${pattern}
        limit ${PER_GROUP}
      )
      union all
      (
        select 'member', u.id::text, u.full_name,
               initcap(public.current_tier(u.id)::text) || ' · ' || coalesce(u.city, 'India'),
               '/members/me'
        from users u
        where not u.is_suspended and u.full_name ilike ${pattern}
        limit ${PER_GROUP}
      )
      union all
      (
        select 'post', p.id::text, left(p.body_md, 70),
               'Posted by ' || u.full_name,
               '/community?post=' || p.id::text
        from posts p
        join users u on u.id = p.author_id
        where p.status = 'published' and p.body_md ilike ${pattern}
        order by p.created_at desc limit ${PER_GROUP}
      )
    `);

    const hits = [...rows];
    return {
      query,
      hits,
      // Every group hit its cap, so there is almost certainly more.
      truncated: hits.length >= PER_GROUP * 5,
    };
  });
}
