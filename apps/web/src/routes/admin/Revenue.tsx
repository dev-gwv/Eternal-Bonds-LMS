import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { RevenueOrder } from '@ipc/contracts';
import { adminApi } from '../../shared/admin-api.ts';
import { relativeTime } from '../../shared/api.ts';
import { PageHeader, Page } from '../../shared/layout/AppShell.tsx';
import { Card, Chip, EmptyState } from '../../shared/ui/primitives.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { ErrorNote, Toolbar } from './studio-ui.tsx';

/**
 * What the club earned.
 *
 * There were plans, orders, payments and a working Razorpay integration, and
 * no page that answered "how much came in this month" — which for a business
 * one person runs is the number everything else turns on.
 *
 * Captured payments only. An order is an intention: it exists the moment
 * somebody clicks checkout, including everybody who then closed the tab.
 * Counting orders as revenue overstates it by however many people hesitated,
 * which is most of them.
 */

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** Sparkline. Deliberately not a chart library for fourteen numbers. */
function Spark({ points }: { points: { day: string; inr: number }[] }) {
  if (points.length < 2) return null;
  const max = Math.max(...points.map((p) => p.inr));
  const w = 100;
  const h = 28;

  // A flat zero line, not a jagged one: with no revenue at all every point is
  // 0 and a naive scale would divide by zero and draw noise.
  const y = (v: number) => (max === 0 ? h - 1 : h - 1 - (v / max) * (h - 2));
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i / (points.length - 1)) * w} ${y(p.inr)}`)
    .join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 34 }} aria-hidden>
      <path d={d} fill="none" stroke="var(--pink)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function StatusChip({ status }: { status: string }) {
  if (status === 'paid' || status === 'captured') return <Chip tone="green">Paid</Chip>;
  if (status === 'failed') return <Chip tone="pink">Failed</Chip>;
  return <Chip tone="yellow">{status}</Chip>;
}

function OrderRow({ o }: { o: RevenueOrder }) {
  return (
    <div className="card-row" style={{ gap: 12 }}>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{o.memberName}</span>
        <span style={{ fontSize: 10 }} className="dim">
          {o.planName}
          {o.memberEmail ? ` · ${o.memberEmail}` : ''}
        </span>
      </span>

      <span style={{ width: 90, textAlign: 'right', fontSize: 12, fontWeight: 600 }} className="num">
        {inr(o.inr)}
      </span>
      <span style={{ width: 70, textAlign: 'right', fontSize: 10 }} className="dim hide-sm">
        {o.method ?? '—'}
      </span>
      <span style={{ width: 84, textAlign: 'right', fontSize: 10 }} className="dim hide-sm">
        {relativeTime(o.capturedAt ?? o.createdAt)}
      </span>
      <StatusChip status={o.status} />
    </div>
  );
}

export function RevenuePage() {
  const [days, setDays] = useState(90);
  const revenue = useQuery({ queryKey: ['admin', 'revenue', days], queryFn: () => adminApi.revenue(days) });

  if (revenue.isPending) {
    return (
      <Page>
        <Skeleton width={220} height={22} />
        <Skeleton height={130} radius={14} />
        <Skeleton height={220} radius={14} />
      </Page>
    );
  }
  if (revenue.error || !revenue.data) {
    return (
      <Page>
        <ErrorNote error={revenue.error ?? new Error('Could not load revenue')} />
      </Page>
    );
  }

  const r = revenue.data;
  const delta = r.lastMonthInr === 0 ? null : Math.round(((r.thisMonthInr - r.lastMonthInr) / r.lastMonthInr) * 100);
  const stuck = r.pendingCheckouts + r.failedCheckouts;

  return (
    <Page>
      <PageHeader
        title="Revenue"
        back="/admin"
        crumbs={[{ label: 'Studio', to: '/admin' }, { label: 'Revenue' }]}
        actions={
          <Toolbar>
            {[30, 90, 365].map((d) => (
              <button
                key={d}
                type="button"
                className={days === d ? 'btn btn-pink' : 'btn btn-soft'}
                onClick={() => setDays(d)}
              >
                {d === 365 ? '1 year' : `${d} days`}
              </button>
            ))}
          </Toolbar>
        }
      />

      <div className="content">
        <div className="col col-main">
          <Card>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: 16,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 10 }} className="dim">
                  This month
                </span>
                <span className="metric num">{inr(r.thisMonthInr)}</span>
                {delta !== null && (
                  <span
                    style={{ fontSize: 10.5, color: delta >= 0 ? 'var(--green)' : 'var(--red)' }}
                    className="num"
                  >
                    {delta >= 0 ? '+' : ''}
                    {delta}% on last month
                  </span>
                )}
              </div>
              {[
                ['Last month', inr(r.lastMonthInr)],
                ['All time', inr(r.allTimeInr)],
                ['Paying members', String(r.payingMembers)],
                ['Average payment', r.averageOrderInr === null ? '—' : inr(r.averageOrderInr)],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 10 }} className="dim">
                    {label}
                  </span>
                  <span className="metric num">{value}</span>
                </div>
              ))}
            </div>

            <Spark points={r.daily} />
            <span style={{ fontSize: 10 }} className="dim">
              Captured payments over the last {days} days. An order that was started and never paid is not
              revenue and is not on this line.
            </span>
          </Card>

          {/* The most actionable number here. Somebody who tried to pay and
              could not is a customer who wanted to buy. */}
          {stuck > 0 && (
            <div className="callout">
              {r.pendingCheckouts > 0 && (
                <>
                  {r.pendingCheckouts} checkout{r.pendingCheckouts === 1 ? '' : 's'} started and never
                  finished
                </>
              )}
              {r.pendingCheckouts > 0 && r.failedCheckouts > 0 && ', and '}
              {r.failedCheckouts > 0 && (
                <>
                  {r.failedCheckouts} payment{r.failedCheckouts === 1 ? '' : 's'} failed
                </>
              )}{' '}
              in the last 30 days. These are people who wanted to buy — at this volume each one is worth a
              message.
            </div>
          )}

          <span className="section-label">Recent orders</span>
          {r.recent.length === 0 ? (
            <Card>
              <EmptyState
                icon="chart"
                title="Nothing sold yet"
                hint="Orders appear here the moment somebody opens checkout, paid or not."
              />
            </Card>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {r.recent.map((o) => (
                <OrderRow key={o.id} o={o} />
              ))}
            </div>
          )}
        </div>

        <div className="col rail">
          <Card title="By plan" style={{ flex: 1 }}>
            {r.byPlan.every((p) => p.sold === 0) ? (
              <span style={{ fontSize: 11, lineHeight: 1.6 }} className="dim">
                Nothing sold in this window. The price list is live — three plans, all active.
              </span>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                {r.byPlan.map((p) => {
                  const top = Math.max(...r.byPlan.map((x) => x.inr), 1);
                  return (
                    <div key={p.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 11.5 }}>
                        <span style={{ flex: 1, fontWeight: 500 }}>{p.name}</span>
                        <span className="num dim">{p.sold}×</span>
                        <span className="num" style={{ fontWeight: 600 }}>
                          {inr(p.inr)}
                        </span>
                      </span>
                      <span style={{ height: 4, borderRadius: 999, background: 'var(--track)' }}>
                        <span
                          style={{
                            display: 'block',
                            width: `${Math.round((p.inr / top) * 100)}%`,
                            height: '100%',
                            borderRadius: 999,
                            background: 'var(--pink)',
                          }}
                        />
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <span style={{ fontSize: 10, lineHeight: 1.5 }} className="dim">
              What people actually buy is a different question from what is on the price list.
            </span>
          </Card>
        </div>
      </div>
    </Page>
  );
}
