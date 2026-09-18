import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { memberships, orders, payments, plans, users, webhookEvents, withUser } from '@ipc/db';
import type { MembershipState, OrderTicket, Plan } from '@ipc/contracts';
import type { Env } from './env.ts';
import { HttpError } from './lib/problem.ts';
import { timingSafeEqual } from './lib/video-provider.ts';
import { getDb } from './repo.ts';

/**
 * Memberships and money.
 *
 * One rule shapes everything here: **a membership is granted by the webhook,
 * never by the browser.** The browser tells us a payment succeeded; Razorpay
 * tells us it actually did. Trusting the first is how people end up with free
 * diamond memberships, and it is not a theoretical attack — the success
 * callback is a `fetch` anyone can issue.
 *
 * So `orders` has no update policy for members, the grant happens inside
 * `grant_membership()` under the service role, and the only thing the browser
 * gets back from checkout is "we heard you, refresh in a moment".
 */

const TIER_ORDER = ['free', 'silver', 'diamond', 'franchisee'] as const;

function requireDb(env: Env) {
  const db = getDb(env);
  if (!db) throw new HttpError(503, 'Billing needs a database', 'Set DATABASE_URL.');
  return db;
}

/**
 * Everything the membership page needs, in one request: the current tier, the
 * price list, and this member's order history.
 */
export async function membershipState(env: Env, userId: string | null): Promise<MembershipState> {
  const db = requireDb(env);
  if (!userId) throw new HttpError(401, 'Not authenticated');

  return withUser(db, userId, async (tx) => {
    const [me] = await tx
      .select({ tier: sql<string>`public.current_tier(${users.id})` })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const tier = (me?.tier ?? 'free') as MembershipState['tier'];

    const [active] = await tx
      .select({ expiresAt: memberships.expiresAt })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')))
      .orderBy(desc(memberships.expiresAt))
      .limit(1);

    const priceList = await tx
      .select()
      .from(plans)
      .where(eq(plans.isActive, true))
      .orderBy(asc(plans.rank));

    const history = await tx
      .select({
        id: orders.id,
        planId: orders.planId,
        planName: plans.name,
        amountPaise: orders.amountPaise,
        currency: orders.currency,
        status: orders.status,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .innerJoin(plans, eq(plans.id, orders.planId))
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt))
      .limit(20);

    const rank = (t: string) => TIER_ORDER.indexOf(t as (typeof TIER_ORDER)[number]);

    return {
      tier,
      expiresAt: active?.expiresAt?.toISOString() ?? null,
      billingMode: env.BILLING_MODE,
      plans: priceList.map(
        (p): Plan => ({
          id: p.id,
          name: p.name,
          tier: p.tier,
          amountPaise: p.amountPaise,
          currency: p.currency,
          durationDays: p.durationDays,
          description: p.description,
          // "Current" means already at this tier or above — renewing is still
          // allowed, but the button should not say Upgrade.
          current: rank(tier) >= rank(p.tier),
        }),
      ),
      orders: history.map((o) => ({
        id: o.id,
        planId: o.planId,
        planName: o.planName,
        amountPaise: o.amountPaise,
        currency: o.currency,
        status: o.status,
        createdAt: o.createdAt.toISOString(),
      })),
    };
  });
}

/**
 * Creates an order, ours and Razorpay's, in that order.
 *
 * The amount comes from the `plans` row, never from the request. A client that
 * could name its own price would name ₹1.
 */
export async function createOrder(env: Env, userId: string | null, planId: string): Promise<OrderTicket> {
  const db = requireDb(env);
  if (!userId) throw new HttpError(401, 'Not authenticated');

  if (env.BILLING_MODE !== 'razorpay') {
    // The store builds ship with web_only (PLAN §7). Saying so plainly beats a
    // checkout that opens and then fails.
    throw new HttpError(
      409,
      'Checkout is not available here',
      'Memberships are purchased on the website. Open the club in a browser to upgrade.',
    );
  }
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new HttpError(503, 'Payments are not configured', 'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required.');
  }

  const [plan] = await db.select().from(plans).where(and(eq(plans.id, planId), eq(plans.isActive, true))).limit(1);
  if (!plan) throw new HttpError(404, 'Unknown plan');

  const [order] = await db
    .insert(orders)
    .values({
      userId,
      planId: plan.id,
      amountPaise: plan.amountPaise,
      currency: plan.currency,
      provider: 'razorpay',
    })
    .returning();
  if (!order) throw new HttpError(500, 'Could not create the order');

  const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      amount: plan.amountPaise,
      currency: plan.currency,
      // Our order id travels with theirs, so the webhook can find its way back
      // here even if `notes` is the only thing that survives.
      receipt: order.id,
      notes: { orderId: order.id, userId, planId: plan.id },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    await db.update(orders).set({ status: 'failed' }).where(eq(orders.id, order.id));
    throw new HttpError(502, 'Razorpay rejected the order', detail.slice(0, 300));
  }

  const created = (await res.json()) as { id: string };
  await db
    .update(orders)
    .set({ providerOrderId: created.id, updatedAt: new Date() })
    .where(eq(orders.id, order.id));

  return {
    orderId: order.id,
    providerOrderId: created.id,
    // The key *id* is publishable and belongs in the browser. The secret does
    // not, and is the reason signature verification happens server-side.
    keyId: env.RAZORPAY_KEY_ID,
    amountPaise: plan.amountPaise,
    currency: plan.currency,
    planName: plan.name,
  };
}

/**
 * Handles a Razorpay webhook.
 *
 * Signature first, then the ledger, then the effect. Recording the delivery by
 * its event id makes retries — which Razorpay does for days — free to ignore.
 */
export async function applyRazorpayWebhook(env: Env, rawBody: string, headers: Headers): Promise<'ok' | 'ignored'> {
  const db = requireDb(env);

  const signature = headers.get('x-razorpay-signature');
  if (!signature || !env.RAZORPAY_WEBHOOK_SECRET) return 'ignored';
  if (!(await hmacSha256Matches(env.RAZORPAY_WEBHOOK_SECRET, rawBody, signature))) return 'ignored';

  const body = JSON.parse(rawBody) as {
    event?: string;
    payload?: {
      payment?: {
        entity?: {
          id?: string;
          order_id?: string;
          amount?: number;
          currency?: string;
          status?: string;
          method?: string;
          notes?: Record<string, string>;
        };
      };
    };
  };

  const entity = body.payload?.payment?.entity;
  if (!body.event || !entity?.id) return 'ignored';

  // Razorpay has no single event id header, so the payment id plus the event
  // name identifies the delivery. Two different events about the same payment
  // are two rows; the same one twice is one.
  const eventId = `${entity.id}:${body.event}`;

  const inserted = await db
    .insert(webhookEvents)
    .values({
      provider: 'razorpay',
      eventId,
      eventType: body.event,
      payload: body as Record<string, unknown>,
    })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });

  if (inserted.length === 0) return 'ok'; // Already handled.

  try {
    if (body.event === 'payment.captured' || body.event === 'order.paid') {
      await capturePayment(db, entity);
    } else if (body.event === 'payment.failed') {
      const order = await findOrder(db, entity);
      if (order) await db.update(orders).set({ status: 'failed', updatedAt: new Date() }).where(eq(orders.id, order.id));
    } else if (body.event === 'refund.processed') {
      const order = await findOrder(db, entity);
      if (order) {
        await db.update(orders).set({ status: 'refunded', updatedAt: new Date() }).where(eq(orders.id, order.id));
        // The membership is deliberately *not* revoked here. Refunds are rare
        // and usually mean a conversation is already happening; silently
        // cutting access mid-course would be the wrong first move.
      }
    }
    await db.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, inserted[0]!.id));
  } catch (error) {
    // Recorded, not swallowed: `webhooks.process` retries unprocessed rows.
    await db
      .update(webhookEvents)
      .set({ error: error instanceof Error ? error.message : String(error) })
      .where(eq(webhookEvents.id, inserted[0]!.id));
    throw error;
  }

  return 'ok';
}

type PaymentEntity = {
  id?: string;
  order_id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  method?: string;
  notes?: Record<string, string>;
};

async function findOrder(db: ReturnType<typeof requireDb>, entity: PaymentEntity) {
  // Two ways in, because `notes` survives some flows that `order_id` does not.
  if (entity.order_id) {
    const [byProvider] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.provider, 'razorpay'), eq(orders.providerOrderId, entity.order_id)))
      .limit(1);
    if (byProvider) return byProvider;
  }
  const ours = entity.notes?.orderId;
  if (ours) {
    const [byId] = await db.select().from(orders).where(eq(orders.id, ours)).limit(1);
    if (byId) return byId;
  }
  return null;
}

async function capturePayment(db: ReturnType<typeof requireDb>, entity: PaymentEntity) {
  const order = await findOrder(db, entity);
  if (!order) throw new Error(`No order for payment ${entity.id}`);

  // The amount is checked, not assumed. A captured payment for less than the
  // plan costs is not a membership.
  if (typeof entity.amount === 'number' && entity.amount < order.amountPaise) {
    throw new Error(`Payment ${entity.id} is ${entity.amount} paise, order expects ${order.amountPaise}`);
  }

  await db
    .insert(payments)
    .values({
      orderId: order.id,
      providerPaymentId: entity.id!,
      amountPaise: entity.amount ?? order.amountPaise,
      currency: entity.currency ?? order.currency,
      status: entity.status ?? 'captured',
      method: entity.method ?? null,
      capturedAt: new Date(),
      raw: entity as Record<string, unknown>,
    })
    .onConflictDoNothing();

  // Already paid: a duplicate capture must not extend the membership twice.
  if (order.status === 'paid') return;

  await db.update(orders).set({ status: 'paid', updatedAt: new Date() }).where(eq(orders.id, order.id));
  await db.execute(
    sql`select public.grant_membership(${order.userId}::uuid, ${order.planId}, ${'razorpay'})`,
  );
}

/** Razorpay signs the raw body with the webhook secret, HMAC-SHA256, hex. */
async function hmacSha256Matches(secret: string, message: string, expectedHex: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const actual = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(actual, expectedHex);
}
