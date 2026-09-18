import { and, eq, sql } from 'drizzle-orm';
import { notificationPrefs, pushTokens, withUser } from '@ipc/db';
import type { NotificationPrefs, RegisterPushToken } from '@ipc/contracts';
import type { Env } from './env.ts';
import { HttpError } from './lib/problem.ts';
import { getDb } from './repo.ts';

/**
 * Notification preferences and device tokens.
 *
 * Both are the member's own data under RLS, so there is nothing clever here —
 * except one thing worth stating: a push token is registered by *upsert on the
 * token*, not by insert. The same device reinstalling the app, or a token
 * rotating, must not leave two live rows, because two live rows is two buzzes
 * for one notification and that is how push permission gets revoked for good.
 */

function requireDb(env: Env) {
  const db = getDb(env);
  if (!db) throw new HttpError(503, 'This needs a database', 'Set DATABASE_URL.');
  return db;
}

const HHMM = (value: unknown) => String(value).slice(0, 5);

export async function getPrefs(env: Env, userId: string | null): Promise<NotificationPrefs> {
  const db = requireDb(env);
  if (!userId) throw new HttpError(401, 'Not authenticated');

  return withUser(db, userId, async (tx) => {
    const [row] = await tx
      .select()
      .from(notificationPrefs)
      .where(eq(notificationPrefs.userId, userId))
      .limit(1);
    // The sign-up trigger creates this row, so a missing one means something
    // is wrong rather than that defaults should be invented.
    if (!row) throw new HttpError(404, 'Preferences not found');

    return {
      inApp: row.inApp,
      emailDigest: row.emailDigest,
      emailActivity: row.emailActivity,
      push: row.push,
      quietFrom: HHMM(row.quietFrom),
      quietTo: HHMM(row.quietTo),
    };
  });
}

export async function updatePrefs(
  env: Env,
  userId: string | null,
  patch: Partial<NotificationPrefs>,
): Promise<NotificationPrefs> {
  const db = requireDb(env);
  if (!userId) throw new HttpError(401, 'Not authenticated');

  await withUser(db, userId, (tx) =>
    tx
      .update(notificationPrefs)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(notificationPrefs.userId, userId)),
  );
  return getPrefs(env, userId);
}

export async function registerPushToken(
  env: Env,
  userId: string | null,
  input: RegisterPushToken,
): Promise<{ registered: true }> {
  const db = requireDb(env);
  if (!userId) throw new HttpError(401, 'Not authenticated');

  await withUser(db, userId, async (tx) => {
    await tx
      .insert(pushTokens)
      .values({ userId, token: input.token, platform: input.platform })
      .onConflictDoUpdate({
        target: pushTokens.token,
        // A token that moves to another account belongs to that account now —
        // shared phones are real, and the old owner must stop receiving it.
        set: { userId, platform: input.platform, lastSeenAt: new Date(), revokedAt: null },
      });

    // Registering a device is the moment push becomes meaningful, so it also
    // turns the preference on. Turning it back off is one switch away.
    await tx
      .update(notificationPrefs)
      .set({ push: true, updatedAt: new Date() })
      .where(eq(notificationPrefs.userId, userId));
  });

  return { registered: true };
}

export async function revokePushToken(env: Env, userId: string | null, token: string): Promise<void> {
  const db = requireDb(env);
  if (!userId) throw new HttpError(401, 'Not authenticated');

  await withUser(db, userId, (tx) =>
    tx
      .update(pushTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token))),
  );
}

/** How many live devices this member has — shown on the account page. */
export async function deviceCount(env: Env, userId: string | null): Promise<number> {
  const db = getDb(env);
  if (!db || !userId) return 0;
  const [row] = await withUser(db, userId, (tx) =>
    tx
      .select({ n: sql<number>`count(*)` })
      .from(pushTokens)
      .where(and(eq(pushTokens.userId, userId), sql`${pushTokens.revokedAt} is null`)),
  );
  return Number(row?.n ?? 0);
}
