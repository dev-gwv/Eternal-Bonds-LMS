import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { DeleteAccount, NotificationPrefs, ProfilePatch, RegisterPushToken } from '@ipc/contracts';
import type { AppEnv } from '../context.ts';
import { roleOf } from '../admin.ts';
import { listNotifications, markNotificationsRead } from '../engagement.ts';
import { getPrefs, registerPushToken, revokePushToken, updatePrefs } from '../prefs.ts';
import { getActivity, getDashboard, getPerformance, getStats } from '../rollups.ts';
import { problem } from '../lib/problem.ts';
import { requireAuth } from '../middleware/auth.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { getMember } from '../repo.ts';
import { cancelDeletion, deletionState, exportAccount, scheduleDeletion } from '../writes.ts';

export const meRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)
  .get('/', async (c) => {
    const member = await getMember(c.env, c.get('userId'));
    if (!member) return problem(c, 404, 'Profile not found');
    return c.json(member);
  })
  // Read from the worker's rollups, never from the raw event stream.
  .get('/activity', async (c) => c.json({ items: await getActivity(c.env, c.get('userId')) }))
  // Momentum, computed from real rollups. There are no quizzes, so the old
  // participation/quiz/exam breakdown was fiction served as data.
  .get('/performance', async (c) => c.json(await getPerformance(c.env, c.get('userId'))))
  .get('/stats', async (c) => c.json(await getStats(c.env, c.get('userId'))))
  // One round trip for first paint. The individual endpoints stay for the
  // pages that own them.
  .get('/dashboard', async (c) => c.json(await getDashboard(c.env, c.get('userId'))))
  /* A member changing their own details.
     There was no such endpoint, which is why the Account page rendered their
     name, city and phone with nothing editable on it — and why the setup flow
     had nowhere to write. Deliberately narrow: name and city only. Email and
     phone are identity and change through auth; role and tier are not the
     member's to set. */
  .patch(
    '/',
    requireAuth,
    zValidator('json', ProfilePatch, (result, c) =>
      result.success
        ? undefined
        : problem(c, 422, 'That does not look right', result.error.issues[0]?.message),
    ),
    async (c) => {
      const { updateOwnProfile } = await import('../onboarding.ts');
      return c.json(await updateOwnProfile(c.env, c.get('userId'), c.req.valid('json')));
    },
  )

  /* The member's photograph. Two steps, because the file goes browser →
     storage directly; see onboarding.ts for why the key is scoped. */
  .post(
    '/avatar-ticket',
    requireAuth,
    zValidator('json', z.object({ mime: z.enum(['image/jpeg', 'image/png', 'image/webp']) }), (result, c) =>
      result.success ? undefined : problem(c, 422, 'Only JPEG, PNG or WebP images'),
    ),
    async (c) => {
      const { avatarTicket } = await import('../onboarding.ts');
      return c.json(await avatarTicket(c.env, c.get('userId'), c.req.valid('json').mime));
    },
  )
  .post(
    '/avatar',
    requireAuth,
    zValidator('json', z.object({ key: z.string().min(1).max(500) }), (result, c) =>
      result.success ? undefined : problem(c, 422, 'Invalid image'),
    ),
    async (c) => {
      const { setAvatar } = await import('../onboarding.ts');
      return c.json(await setAvatar(c.env, c.get('userId'), c.req.valid('json').key));
    },
  )
  .delete('/avatar', requireAuth, async (c) => {
    const { clearAvatar } = await import('../onboarding.ts');
    await clearAvatar(c.env, c.get('userId'));
    return c.body(null, 204);
  })

  // Skipping the setup flow. Recorded server-side rather than in localStorage,
  // so it does not reappear on the member's phone as if the app had forgotten
  // them. It records that they skipped, never that they finished.
  .post('/onboarding/dismiss', requireAuth, async (c) => {
    const { dismissOnboarding } = await import('../onboarding.ts');
    await dismissOnboarding(c.env, c.get('userId'));
    return c.body(null, 204);
  })

  // The first week. Derived on read rather than tracked — see onboarding.ts.
  .get('/onboarding', async (c) => {
    const { getOnboarding } = await import('../onboarding.ts');
    return c.json(await getOnboarding(c.env, c.get('userId')));
  })

  /* Who the UI is rendering for. It exists so the shell can decide whether to
     show the Studio link without guessing — the API still re-checks on every
     authoring call, so a forged answer here buys nothing but a dead link. */
  .get('/viewer', async (c) => {
    const userId = c.get('userId');
    const [role, member] = await Promise.all([roleOf(c.env, userId), getMember(c.env, userId)]);
    return c.json({
      userId,
      role,
      tier: member?.tier ?? 'free',
      canAuthor: role === 'admin',
      videoProvider: c.env.VIDEO_PROVIDER,
    });
  })

  /* ── Notifications ────────────────────────────────────────────────────────
     The bell in the header reads this. Marking read is a PATCH with no id for
     "all", which is what the "Mark all read" action sends. */
  .get('/notifications', async (c) => c.json(await listNotifications(c.env, c.get('userId'))))
  .post('/notifications/read', async (c) => {
    const id = c.req.query('id') ?? null;
    return c.json(await markNotificationsRead(c.env, c.get('userId'), id));
  })
  .get('/prefs', async (c) => c.json(await getPrefs(c.env, c.get('userId'))))
  .patch(
    '/prefs',
    zValidator('json', NotificationPrefs.partial(), (result, c) =>
      result.success ? undefined : problem(c, 422, 'Invalid preferences', result.error.issues[0]?.message),
    ),
    async (c) => c.json(await updatePrefs(c.env, c.get('userId'), c.req.valid('json'))),
  )
  .post(
    '/push-tokens',
    zValidator('json', RegisterPushToken, (result, c) =>
      result.success ? undefined : problem(c, 422, 'Invalid token', result.error.issues[0]?.message),
    ),
    async (c) => c.json(await registerPushToken(c.env, c.get('userId'), c.req.valid('json')), 201),
  )
  .delete(
    '/push-tokens',
    zValidator('json', z.object({ token: z.string().min(1) }), (result, c) =>
      result.success ? undefined : problem(c, 422, 'Invalid token'),
    ),
    async (c) => {
      await revokePushToken(c.env, c.get('userId'), c.req.valid('json').token);
      return c.body(null, 204);
    },
  )

  /* Account lifecycle. Apple 5.1.1(v) requires deletion to be reachable
     in-app; DPDP requires both erasure and portability. */
  .get('/export', rateLimit({ name: 'export', limit: 3, windowSeconds: 3600 }), async (c) => {
    const data = await exportAccount(c.env, c.get('userId'));
    c.header('content-disposition', 'attachment; filename="ipc-account-export.json"');
    return c.json(data);
  })
  .get('/deletion', (c) => c.json(deletionState(c.env)))
  .post(
    '/deletion',
    rateLimit({ name: 'deletion', limit: 5, windowSeconds: 3600 }),
    zValidator('json', DeleteAccount, (result, c) =>
      result.success
        ? undefined
        : problem(c, 422, 'Confirmation required', 'Type DELETE to confirm account deletion.'),
    ),
    async (c) => c.json(await scheduleDeletion(c.env, c.get('userId'), c.req.valid('json').reason)),
  )
  .delete('/deletion', async (c) => c.json(await cancelDeletion(c.env, c.get('userId'))));
