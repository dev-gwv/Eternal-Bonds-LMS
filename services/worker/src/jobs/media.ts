import { sql } from 'drizzle-orm';
import type { Db } from '@ipc/db';
import type { Env } from '../env.ts';

/**
 * Video lifecycle from the worker's side.
 *
 * The provider's webhook is the fast path and the normal one. This is the slow
 * path for the webhook that never came — a deploy during a transcode, a
 * misconfigured URL, an outage at the provider. Without it a lesson can sit at
 * `processing` forever and nobody finds out until a member complains.
 */

type Pending = { id: string; asset_id: string; provider: string; updated: string };

export async function pollVideoStatus(db: Db, env: Env) {
  if (env.VIDEO_PROVIDER === 'none') {
    // With no provider, "uploaded" and "playable" are the same moment, so
    // there is nothing to poll for.
    return { checked: 0, promoted: 0, failed: 0, note: 'no provider configured' };
  }

  const rows = await db.execute<Pending>(sql`
    select l.id, l.video_asset_id as asset_id, l.video_provider as provider,
           coalesce(l.video_ready_at, now())::text as updated
    from lessons l
    where l.video_status in ('uploading', 'processing')
      and l.video_asset_id is not null
    limit 25
  `);

  let promoted = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const state = await fetchState(env, row.asset_id);
      if (state.status === 'ready') {
        await db.execute(sql`
          update lessons set
            video_status = 'ready',
            video_ready_at = now(),
            video_error = null,
            duration_seconds = coalesce(${state.durationSeconds ?? null}, duration_seconds),
            video_duration_source = case when ${state.durationSeconds ?? null} is null
              then video_duration_source else 'provider' end
          where id = ${row.id}
        `);
        promoted += 1;
      } else if (state.status === 'errored') {
        await db.execute(sql`
          update lessons set video_status = 'errored', video_error = ${state.error ?? 'The provider could not encode this file'}
          where id = ${row.id}
        `);
        failed += 1;
      }
    } catch (error) {
      // A provider being briefly unreachable is not a transcode failure, and
      // marking it as one would make an admin re-upload a perfectly good file.
      console.warn(JSON.stringify({ videoPoll: row.id, error: String(error) }));
    }
  }

  return { checked: rows.length, promoted, failed };
}

/**
 * Asks the provider about one asset.
 *
 * Duplicated from the API's provider layer rather than imported: the worker
 * does not depend on `@ipc/api`, and making it do so to read two fields would
 * drag the whole HTTP surface into a background process.
 */
async function fetchState(
  env: Env,
  assetId: string,
): Promise<{ status: 'processing' | 'ready' | 'errored'; durationSeconds?: number; error?: string }> {
  if (env.VIDEO_PROVIDER === 'cloudflare') {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.VIDEO_ACCOUNT_ID}/stream/${assetId}`,
      { headers: { authorization: `Bearer ${env.VIDEO_API_TOKEN}` } },
    );
    if (!res.ok) throw new Error(`Cloudflare Stream returned ${res.status}`);
    const body = (await res.json()) as {
      result?: { status?: { state?: string; errorReasonText?: string }; duration?: number };
    };
    const state = body.result?.status?.state;
    return {
      status: state === 'ready' ? 'ready' : state === 'error' ? 'errored' : 'processing',
      durationSeconds: body.result?.duration ? Math.round(body.result.duration) : undefined,
      error: body.result?.status?.errorReasonText,
    };
  }

  const res = await fetch(`https://video.bunnycdn.com/library/${env.VIDEO_LIBRARY_ID}/videos/${assetId}`, {
    headers: { AccessKey: env.VIDEO_API_TOKEN, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Bunny Stream returned ${res.status}`);
  const body = (await res.json()) as { status: number; length: number };
  return {
    status: body.status === 4 ? 'ready' : body.status === 5 ? 'errored' : 'processing',
    durationSeconds: body.length > 0 ? body.length : undefined,
    error: body.status === 5 ? 'Bunny could not encode this file' : undefined,
  };
}

/**
 * Unpublishes a course whose video has broken.
 *
 * Publishing checks every lesson has a ready video, but a video can break
 * afterwards — a provider asset deleted by hand, a failed re-encode. A
 * published course with a dead player is worse than one that is briefly
 * missing, so it comes down and the admin is told.
 */
export async function guardPublishedCourses(db: Db) {
  const broken = await db.execute<{ id: string; title: string }>(sql`
    update courses c set is_published = false
    where c.is_published
      and exists (
        select 1 from modules m
        join lessons l on l.module_id = m.id
        where m.course_id = c.id and l.video_status = 'errored'
      )
    returning c.id, c.title
  `);

  for (const course of broken) {
    await db.execute(sql`
      insert into notifications (user_id, kind, title, body, link, subject_type, subject_id)
      select u.id, 'system',
             'Unpublished: ' || ${course.title},
             'A lesson video failed, so the course was taken down before members reached a dead player.',
             '/admin/courses/' || ${course.id}::text,
             'course', ${course.id}::uuid
      from users u where u.role = 'admin'
      on conflict do nothing
    `);
  }

  return { unpublished: broken.length };
}
