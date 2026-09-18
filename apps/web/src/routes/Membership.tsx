import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { OrderTicket, Plan } from '@ipc/contracts';
import { api } from '../shared/api.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { Card, Chip, Icon } from '../shared/ui/primitives.tsx';

/**
 * Membership and checkout.
 *
 * What this page deliberately does **not** do: tell the API that a payment
 * succeeded. Razorpay's success callback is a `fetch` anybody can issue, so
 * the membership is granted by the webhook and this page only says "we heard
 * you" and re-reads the state a moment later.
 */

const rupees = (paise: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    paise / 100,
  );

const monthsLabel = (days: number) =>
  days % 365 === 0 ? `${days / 365} year${days / 365 === 1 ? '' : 's'}` : `${Math.round(days / 30)} months`;

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: Record<string, string>) => void;
  modal?: { ondismiss?: () => void };
  theme?: { color: string };
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

/**
 * Loads Razorpay's script the first time somebody actually opens checkout.
 *
 * Not in index.html: a third-party script on every page load slows down the
 * dashboard for the overwhelming majority of visits that will never buy
 * anything, and it watches every one of them.
 */
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load the payment form. Check your connection.'));
    document.head.appendChild(script);
  });
}

function PlanCard({
  plan,
  currentTier,
  onChoose,
  pending,
  disabled,
}: {
  plan: Plan;
  currentTier: string;
  onChoose: (planId: string) => void;
  pending: boolean;
  disabled: boolean;
}) {
  const isCurrent = plan.tier === currentTier;

  return (
    <Card style={{ gap: 12, borderColor: isCurrent ? 'var(--pink)' : 'var(--hair)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="card-title" style={{ flex: 1 }}>
          {plan.name}
        </span>
        {isCurrent && <Chip tone="pink">Your plan</Chip>}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span className="metric">{rupees(plan.amountPaise)}</span>
        <span style={{ fontSize: 11 }} className="dim">
          / {monthsLabel(plan.durationDays)}
        </span>
      </div>

      {plan.description && (
        <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.6 }} className="muted">
          {plan.description}
        </p>
      )}

      <button
        type="button"
        className={plan.current ? 'btn btn-soft' : 'btn btn-pink'}
        disabled={pending || disabled}
        onClick={() => onChoose(plan.id)}
      >
        {pending ? 'Opening…' : plan.current ? 'Renew' : 'Upgrade'}
      </button>
    </Card>
  );
}

export function MembershipPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);

  const membership = useQuery({ queryKey: ['membership'], queryFn: api.membership });

  const checkout = useMutation({
    mutationFn: async (planId: string) => {
      const ticket = await api.createOrder(planId);
      await loadCheckout();
      return ticket;
    },
    onSuccess: (ticket: OrderTicket) => {
      const Checkout = window.Razorpay;
      if (!Checkout) {
        setError('The payment form did not load. Try again in a moment.');
        setBusyPlan(null);
        return;
      }

      new Checkout({
        key: ticket.keyId,
        amount: ticket.amountPaise,
        currency: ticket.currency,
        name: 'India Photographers Club',
        description: ticket.planName,
        order_id: ticket.providerOrderId,
        theme: { color: '#f48fb1' },
        handler: () => {
          // Razorpay says it worked. We wait for the webhook to say so too,
          // which usually lands within seconds — hence the re-check rather
          // than a confident "you're upgraded".
          setBusyPlan(null);
          setStatus('Payment received. Your membership updates as soon as the bank confirms it.');
          setTimeout(() => queryClient.invalidateQueries({ queryKey: ['membership'] }), 4000);
        },
        modal: {
          ondismiss: () => {
            setBusyPlan(null);
            setStatus(null);
          },
        },
      }).open();
    },
    onError: (e) => {
      setBusyPlan(null);
      setError(e instanceof Error ? e.message : String(e));
    },
  });

  const choose = (planId: string) => {
    setError(null);
    setStatus(null);
    setBusyPlan(planId);
    checkout.mutate(planId);
  };

  const data = membership.data;
  const webOnly = data?.billingMode === 'web_only';

  return (
    <Page>
      <PageHeader
        title="Membership"
        crumbs={[{ label: 'Account', to: '/account' }, { label: 'Membership' }]}
        back="/account"
      />

      {error && <div className="alert">{error}</div>}
      {status && <div className="callout">{status}</div>}

      {data && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="card-title" style={{ flex: 1 }}>
              You are on {data.tier}
            </span>
            {data.expiresAt && (
              <Chip tone="yellow">
                <Icon name="clock" size={11} />
                Until {new Date(data.expiresAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
              </Chip>
            )}
          </div>
          {data.tier === 'free' && (
            <span style={{ fontSize: 11.5 }} className="muted">
              Courses and live workshops need a paid tier. The community, the library and your profile do not.
            </span>
          )}
        </Card>
      )}

      {webOnly && (
        <div className="callout">
          Memberships are purchased on the website. This is deliberate — the app stores take a share of in-app
          purchases, and the club would rather put that into the workshops.
        </div>
      )}

      {membership.isLoading && <span style={{ fontSize: 12 }} className="muted">Loading…</span>}
      {membership.error && <div className="alert">{(membership.error as Error).message}</div>}

      <span className="section-label">Plans</span>
      <div className="grid grid-2" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {data?.plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            currentTier={data.tier}
            onChoose={choose}
            pending={busyPlan === plan.id}
            disabled={webOnly}
          />
        ))}
      </div>

      {data && data.orders.length > 0 && (
        <>
          <span className="section-label">Your orders</span>
          <Card style={{ gap: 0, padding: 0 }}>
            {data.orders.map((order, i) => (
              <div
                key={order.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '11px 15px',
                  borderTop: i === 0 ? 0 : '1px solid var(--rule)',
                  fontSize: 11.5,
                }}
              >
                <span style={{ flex: 1, fontWeight: 500 }}>{order.planName}</span>
                <span className="num">{rupees(order.amountPaise)}</span>
                <span className="dim">
                  {new Date(order.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                </span>
                {order.status === 'paid' ? (
                  <Chip tone="green">Paid</Chip>
                ) : order.status === 'failed' ? (
                  <Chip tone="pink">Failed</Chip>
                ) : order.status === 'refunded' ? (
                  <Chip tone="blue">Refunded</Chip>
                ) : (
                  <Chip tone="yellow">Not completed</Chip>
                )}
              </div>
            ))}
          </Card>
        </>
      )}
    </Page>
  );
}
