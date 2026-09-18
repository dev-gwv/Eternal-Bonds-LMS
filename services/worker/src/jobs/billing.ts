import { sql } from 'drizzle-orm';
import type { Db } from '@ipc/db';

/**
 * Keeping memberships honest between webhooks.
 *
 * Nothing here talks to a payment provider. Everything money-related that
 * *changes* state happens in the webhook handler, under a verified signature.
 * These jobs only tidy up after time passes.
 */

/**
 * Expires memberships whose term has run out.
 *
 * `current_tier()` already ignores an expired row, so access is correct
 * without this — but the row keeps claiming `active`, which makes every
 * report and every support conversation wrong. This is about the data telling
 * the truth, not about access control.
 */
export async function expireMemberships(db: Db) {
  const expired = await db.execute<{ user_id: string }>(sql`
    update memberships set status = 'expired'
    where status = 'active' and expires_at is not null and expires_at <= now()
    returning user_id
  `);

  // Seven days ahead, once: enough time to renew without it becoming nagging.
  const warned = await db.execute<{ user_id: string }>(sql`
    insert into notifications (user_id, kind, title, body, link, subject_type, subject_id)
    select
      m.user_id,
      'membership.expiring',
      'Your membership ends on ' || to_char(m.expires_at, 'DD Mon'),
      'Renew to keep your courses and the live workshops.',
      '/account',
      'membership',
      m.id
    from memberships m
    where m.status = 'active'
      and m.expires_at between now() and now() + interval '7 days'
    on conflict do nothing
    returning user_id
  `);

  return { expired: expired.length, warned: warned.length };
}

/**
 * Retries webhook deliveries whose handler threw.
 *
 * The signature was already verified and the raw body is on the row, so this
 * is a replay of our own processing, not of the provider's request. It is the
 * difference between "a database blip lost someone's membership" and "it was
 * granted ninety seconds late".
 */
export async function reprocessWebhooks(db: Db) {
  const stuck = await db.execute<{ id: string; provider: string; event_type: string }>(sql`
    select id, provider, event_type
    from webhook_events
    where processed_at is null
      and error is not null
      and received_at > now() - interval '3 days'
    order by received_at
    limit 20
  `);

  // Razorpay payments are the only kind worth replaying blind: the effect is
  // idempotent (grant_membership extends from the later of now and the current
  // expiry, and a paid order short-circuits), so a double run is harmless.
  let regranted = 0;
  for (const event of stuck) {
    if (event.provider !== 'razorpay') continue;
    const applied = await db.execute<{ id: string }>(sql`
      with target as (
        select o.id, o.user_id, o.plan_id
        from webhook_events w
        join orders o
          on o.provider_order_id = w.payload -> 'payload' -> 'payment' -> 'entity' ->> 'order_id'
          or o.id::text = w.payload -> 'payload' -> 'payment' -> 'entity' -> 'notes' ->> 'orderId'
        where w.id = ${event.id} and o.status <> 'paid'
      ),
      paid as (
        update orders set status = 'paid', updated_at = now()
        where id in (select id from target)
        returning id, user_id, plan_id
      )
      select id from paid
    `);

    for (const order of applied) {
      await db.execute(sql`
        select public.grant_membership(o.user_id, o.plan_id, 'razorpay-retry')
        from orders o where o.id = ${order.id}
      `);
      regranted += 1;
    }

    await db.execute(sql`
      update webhook_events set processed_at = now(), error = null where id = ${event.id}
    `);
  }

  return { retried: stuck.length, regranted };
}
