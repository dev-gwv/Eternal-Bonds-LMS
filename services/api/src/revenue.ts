import { sql } from 'drizzle-orm';
import { withUser } from '@ipc/db';
import type { Revenue, RevenueOrder } from '@ipc/contracts';
import type { Env } from './env.ts';
import { HttpError } from './lib/problem.ts';
import { getDb } from './repo.ts';

/**
 * What the club actually earned.
 *
 * Nothing in the admin surface showed money at all — there were plans, orders,
 * payments and a working Razorpay integration, and no page that answered "how
 * much came in this month". For a business with one person running it, that is
 * the number the whole operation turns on.
 *
 * Three decisions worth stating.
 *
 * **Captured payments are the source of truth, not orders.** An order is an
 * intention: it exists the moment somebody clicks checkout, including the ones
 * who close the tab. Counting orders as revenue overstates it by however many
 * people hesitated, which is most of them. Only `payments.status = 'captured'`
 * is money.
 *
 * **Everything is in paise, converted once at the edge.** The database stores
 * paise because ₹4,999.00 in a float is how you end up owing somebody a rupee.
 * The conversion happens in the response shape and nowhere else.
 *
 * **Failed and abandoned checkouts are reported, not hidden.** They are the
 * most actionable number here: somebody who tried to pay and could not is a
 * customer who wanted to buy, and with 849 members and a handful of orders,
 * each one is worth a personal message.
 */

const requireDb = (env: Env) => {
  const db = getDb(env);
  if (!db) throw new HttpError(503, 'Needs a database');
  return db;
};

const rupees = (paise: unknown) => Math.round(Number(paise ?? 0) / 100);

export async function getRevenue(env: Env, userId: string, days = 90): Promise<Revenue> {
  const db = requireDb(env);

  return withUser(db, userId, async (tx) => {
    const [totals] = await tx.execute<{
      this_month: number; last_month: number; all_time: number;
      paying: number; captured_count: number;
      pending: number; failed: number;
    }>(sql`
      select
        -- Calendar months in the club's own timezone. "This month" in UTC
        -- would move the boundary by five and a half hours, which lands a
        -- late-evening payment in the wrong month for an Indian business.
        coalesce(sum(p.amount_paise) filter (
          where p.status = 'captured'
            and p.captured_at >= date_trunc('month', now() at time zone 'Asia/Kolkata')
        ), 0)::bigint as this_month,
        coalesce(sum(p.amount_paise) filter (
          where p.status = 'captured'
            and p.captured_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') - interval '1 month'
            and p.captured_at <  date_trunc('month', now() at time zone 'Asia/Kolkata')
        ), 0)::bigint as last_month,
        coalesce(sum(p.amount_paise) filter (where p.status = 'captured'), 0)::bigint as all_time,
        (select count(distinct m.user_id)::int from memberships m
          where m.status = 'active' and m.tier <> 'free') as paying,
        count(*) filter (where p.status = 'captured')::int as captured_count,
        -- 'created' and 'abandoned' are the real states for a checkout that
        -- was started and not completed. There is no 'pending' in
        -- order_status, and naming one Postgres does not know rejects the
        -- whole statement — which is why this was a 500 rather than a zero.
        (select count(*)::int from orders o
          where o.status in ('created', 'abandoned')
            and o.created_at < now() - interval '1 hour'
            and o.created_at > now() - interval '30 days') as pending,
        (select count(*)::int from orders o
          where o.status = 'failed' and o.created_at > now() - interval '30 days') as failed
      from payments p
    `);

    // Per-plan, over the window. What people actually buy is a different
    // question from what is on the price list.
    const byPlan = await tx.execute<{ name: string; tier: string; sold: number; paise: number }>(sql`
      select
        pl.name, pl.tier,
        count(*) filter (where pay.status = 'captured')::int as sold,
        coalesce(sum(pay.amount_paise) filter (where pay.status = 'captured'), 0)::bigint as paise
      from plans pl
      left join orders o on o.plan_id = pl.id
      left join payments pay on pay.order_id = o.id
        and pay.captured_at > now() - ${`${days} days`}::interval
      group by pl.id, pl.name, pl.tier, pl.rank
      order by pl.rank asc
    `);

    // Daily captured totals, for the chart. Gaps are filled with zero —
    // a line that skips empty days makes a quiet fortnight look like growth.
    const daily = await tx.execute<{ day: string; paise: number }>(sql`
      select
        d::date::text as day,
        coalesce((
          select sum(p.amount_paise) from payments p
          where p.status = 'captured'
            and (p.captured_at at time zone 'Asia/Kolkata')::date = d::date
        ), 0)::bigint as paise
      from generate_series(
        (now() at time zone 'Asia/Kolkata')::date - ${days - 1}::int,
        (now() at time zone 'Asia/Kolkata')::date,
        interval '1 day'
      ) d
      order by d asc
    `);

    const recent = await tx.execute<{
      id: string; created_at: string; status: string; amount_paise: number;
      member_name: string | null; member_email: string | null; plan_name: string | null;
      captured_at: string | null; method: string | null;
    }>(sql`
      select
        o.id, o.created_at, o.status, o.amount_paise,
        u.full_name as member_name, u.email as member_email,
        pl.name as plan_name,
        pay.captured_at, pay.method
      from orders o
      left join users u on u.id = o.user_id
      left join plans pl on pl.id = o.plan_id
      left join lateral (
        select p.captured_at, p.method from payments p
        where p.order_id = o.id order by p.created_at desc limit 1
      ) pay on true
      order by o.created_at desc
      limit 50
    `);

    const thisMonth = rupees(totals?.this_month);
    const lastMonth = rupees(totals?.last_month);

    return {
      thisMonthInr: thisMonth,
      lastMonthInr: lastMonth,
      allTimeInr: rupees(totals?.all_time),
      payingMembers: Number(totals?.paying ?? 0),
      // Average revenue per paying member, all time. Null rather than a
      // divide-by-zero dressed up as ₹0 when nobody has paid yet.
      averageOrderInr:
        Number(totals?.captured_count ?? 0) === 0
          ? null
          : Math.round(rupees(totals?.all_time) / Number(totals!.captured_count)),
      pendingCheckouts: Number(totals?.pending ?? 0),
      failedCheckouts: Number(totals?.failed ?? 0),
      byPlan: byPlan.map((p) => ({
        name: p.name,
        tier: p.tier as Revenue['byPlan'][number]['tier'],
        sold: Number(p.sold) || 0,
        inr: rupees(p.paise),
      })),
      daily: daily.map((d) => ({ day: String(d.day), inr: rupees(d.paise) })),
      recent: recent.map((r): RevenueOrder => ({
        id: r.id,
        memberName: r.member_name ?? 'Deleted member',
        memberEmail: r.member_email,
        planName: r.plan_name ?? 'Unknown plan',
        inr: rupees(r.amount_paise),
        status: r.status,
        method: r.method,
        createdAt: new Date(r.created_at).toISOString(),
        capturedAt: r.captured_at ? new Date(r.captured_at).toISOString() : null,
      })),
    };
  });
}
