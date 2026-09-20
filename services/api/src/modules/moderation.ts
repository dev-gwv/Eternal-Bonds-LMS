import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { desc, eq, sql } from 'drizzle-orm';
import { auditLog, channelModerators, featureFlags, impersonationSessions, reports, users, withUser } from '@ipc/db';
import { CreateReport, TermsAccept } from '@ipc/contracts';
import type { AppEnv } from '../context.ts';
import { problem, HttpError } from '../lib/problem.ts';
import { requireAdmin, requireAuth } from '../middleware/auth.ts';
import { getDb } from '../repo.ts';

const invalid = (result: any, c: any) =>
  result.success ? undefined : problem(c, 422, 'Invalid request', result.error.issues[0]?.message);

function needDb(env: any) {
  const db = getDb(env);
  if (!db) throw new HttpError(503, 'Needs a database', 'Set DATABASE_URL.');
  return db;
}

export const moderationRoutes = new Hono<AppEnv>()
  // Reports: ship flag-on-day-one. Members file, admins triage.
  .post('/reports', requireAuth, zValidator('json', CreateReport, invalid), async (c) => {
    const db = needDb(c.env);
    const userId = c.get('userId');
    return withUser(db, userId, async (tx) => {
      const row = (await tx.insert(reports).values({
        reporterId: userId, targetType: c.req.valid('json').targetType,
        targetId: c.req.valid('json').targetId, reason: c.req.valid('json').reason,
      }).returning())[0]!;
      return c.json({ id: row.id }, 201);
    });
  })
  .get('/reports', requireAdmin, async (c) => {
    const db = needDb(c.env);
    return withUser(db, c.get('userId'), async (tx) => {
      const rows = await tx.select().from(reports).orderBy(desc(reports.createdAt)).limit(100);
      return c.json({
        items: rows.map((r) => ({
          id: r.id, targetType: r.targetType, targetId: r.targetId,
          reason: r.reason, status: r.status, createdAt: r.createdAt.toISOString(),
        })),
      });
    });
  })
  .post('/reports/:id/resolve', requireAdmin,
    zValidator('json', z.object({ status: z.enum(['actioned', 'dismissed']) }), invalid), async (c) => {
      const db = needDb(c.env);
      return withUser(db, c.get('userId'), async (tx) => {
        await tx.update(reports)
          .set({ status: c.req.valid('json').status, resolvedAt: new Date() })
          .where(eq(reports.id, c.req.param('id')));
        await tx.insert(auditLog).values({
          actorId: c.get('userId'), action: `report.${c.req.valid('json').status}`,
          targetType: 'report', targetId: c.req.param('id'),
        });
        return c.json({ ok: true });
      });
    })
  .get('/audit', requireAdmin, async (c) => {
    const db = needDb(c.env);
    return withUser(db, c.get('userId'), async (tx) => {
      const rows = await tx.select({ a: auditLog, name: users.fullName })
        .from(auditLog).leftJoin(users, eq(users.id, auditLog.actorId))
        .orderBy(desc(auditLog.createdAt)).limit(100);
      return c.json({
        items: rows.map((r) => ({
          id: r.a.id, actorName: r.name, action: r.a.action,
          targetType: r.a.targetType, targetId: r.a.targetId,
          createdAt: r.a.createdAt.toISOString(),
        })),
      });
    });
  })
  .post('/moderators', requireAdmin,
    zValidator('json', z.object({ channelId: z.uuid(), userId: z.uuid() }), invalid), async (c) => {
      const db = needDb(c.env);
      return withUser(db, c.get('userId'), async (tx) => {
        await tx.insert(channelModerators)
          .values({ channelId: c.req.valid('json').channelId, userId: c.req.valid('json').userId })
          .onConflictDoNothing();
        await tx.insert(auditLog).values({
          actorId: c.get('userId'), action: 'moderator.grant',
          targetType: 'user', targetId: c.req.valid('json').userId,
        });
        return c.json({ ok: true });
      });
    })
  // Feature flags with per-tier targeting payload; kill switches without a deploy.
  .get('/flags', async (c) => {
    const db = getDb(c.env);
    if (!db) return c.json({ items: [] });
    const rows = await db.select().from(featureFlags);
    return c.json({ items: rows.map((f) => ({ key: f.key, enabled: f.enabled })) });
  })
  .put('/flags/:key', requireAdmin,
    zValidator('json', z.object({ enabled: z.boolean(), payload: z.record(z.string(), z.unknown()).optional() }), invalid),
    async (c) => {
      const db = needDb(c.env);
      return withUser(db, c.get('userId'), async (tx) => {
        await tx.insert(featureFlags)
          .values({ key: c.req.param('key'), enabled: c.req.valid('json').enabled, payload: c.req.valid('json').payload ?? {} })
          .onConflictDoUpdate({ target: featureFlags.key, set: { enabled: c.req.valid('json').enabled } });
        await tx.insert(auditLog).values({
          actorId: c.get('userId'), action: 'flag.set',
          targetType: 'flag', meta: { key: c.req.param('key'), enabled: c.req.valid('json').enabled },
        });
        return c.json({ ok: true });
      });
    })
  // Support: audit-logged, time-boxed impersonation. Never for admins.
  .post('/impersonate', requireAdmin, zValidator('json',
    z.object({ targetUserId: z.uuid(), reason: z.string().min(4).max(500), minutes: z.int().min(5).max(120).default(30) }),
    invalid), async (c) => {
      const db = needDb(c.env);
      const adminId = c.get('userId');
      return withUser(db, adminId, async (tx) => {
        const [target] = await tx.select({ role: users.role }).from(users).where(eq(users.id, c.req.valid('json').targetUserId)).limit(1);
        if (!target) throw new HttpError(404, 'Member not found');
        if (target.role === 'admin') throw new HttpError(403, 'Never impersonate an admin');
        const endsAt = new Date(Date.now() + c.req.valid('json').minutes * 60000);
        const row = (await tx.insert(impersonationSessions).values({
          adminId: adminId!, targetUserId: c.req.valid('json').targetUserId,
          reason: c.req.valid('json').reason, endsAt,
        }).returning())[0]!;
        await tx.insert(auditLog).values({
          actorId: adminId, action: 'support.impersonate',
          targetType: 'user', targetId: c.req.valid('json').targetUserId,
          meta: { sessionId: row.id, reason: c.req.valid('json').reason },
        });
        return c.json({ sessionId: row.id, endsAt: endsAt.toISOString() });
      });
    });

export const legalRoutes = new Hono<AppEnv>()
  .post('/terms', requireAuth, zValidator('json', TermsAccept, invalid), async (c) => {
    const db = needDb(c.env);
    const userId = c.get('userId')!;
    const { termsAcceptances } = await import('@ipc/db');
    return withUser(db, userId, async (tx) => {
      await tx.insert(termsAcceptances).values({ userId, version: c.req.valid('json').version }).onConflictDoNothing();
      return c.json({ ok: true });
    });
  });
