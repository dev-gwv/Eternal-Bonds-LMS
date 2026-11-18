import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { OrderTicket, Package } from '@ipc/contracts';
import { api, durationLabel } from '../shared/api.ts';
import { ErrorState } from '../shared/ui/ErrorState.tsx';
import { Page, PageHeader } from '../shared/layout/AppShell.tsx';
import { SkeletonCard } from '../shared/ui/Skeleton.tsx';
import { Card, Chip, Icon } from '../shared/ui/primitives.tsx';
import { loadCheckout, rupees } from './Membership.tsx';

/**
 * Packages, as a member sees them: a shelf on the Courses page, and a page per
 * package with what is inside and how to get it.
 *
 * Buying works like a membership: Razorpay takes the payment and the webhook,
 * not this page, grants access. Until online payment is switched on the page
 * says how to buy through the team instead, who give the package by hand.
 */

const accessLabel = (days: number | null) =>
  days === null ? 'Lifetime access' : days % 365 === 0 ? `${days / 365} year${days === 365 ? '' : 's'} of access` : `${days} days of access`;

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' });

function Cover({ url, title, height }: { url: string | null; title: string; height?: number }) {
  return url ? (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      style={{ aspectRatio: height ? undefined : '16 / 9', height, width: '100%', objectFit: 'cover', borderRadius: 11, display: 'block' }}
    />
  ) : (
    <div
      style={{
        aspectRatio: height ? undefined : '16 / 9',
        height,
        borderRadius: 11,
        background: 'linear-gradient(135deg, #f9a8c9 0%, #fcd34d 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 12px',
        textAlign: 'center',
      }}
    >
      {/* No words on a thumbnail: at that size they only wrap into noise. */}
      {!height && (
        <span style={{ fontSize: 12, fontWeight: 600, color: '#7a1140', letterSpacing: '0.04em' }}>{title.toUpperCase()}</span>
      )}
    </div>
  );
}

export function PackageCard({ pkg }: { pkg: Package }) {
  return (
    <Link to="/packages/$slug" params={{ slug: pkg.slug }} className="card" style={{ padding: 12, gap: 10, color: 'inherit' }}>
      <Cover url={pkg.coverUrl} title={pkg.title} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.35 }}>{pkg.title}</span>
        <span style={{ fontSize: 10.5 }} className="dim">
          {pkg.courseCount} course{pkg.courseCount === 1 ? '' : 's'} · {pkg.lessonCount} lessons · {durationLabel(pkg.durationMinutes)}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 9, borderTop: '1px solid var(--softer)' }}>
        {pkg.owned ? (
          <Chip tone="green">
            <Icon name="check" size={10} strokeWidth={3} />
            You own this
          </Chip>
        ) : (
          <span style={{ fontSize: 14, fontWeight: 700 }} className="num">
            {pkg.pricePaise > 0 ? rupees(pkg.pricePaise) : 'Included'}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10.5 }} className="dim">
          {accessLabel(pkg.accessDays)}
        </span>
      </div>
    </Link>
  );
}

/** The shelf on the Courses page. Renders nothing when there are no packages. */
export function PackagesShelf() {
  const packages = useQuery({ queryKey: ['packages'], queryFn: api.packages, staleTime: 60_000 });
  const items = packages.data ?? [];
  if (items.length === 0) return null;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>Packages</h2>
        <span style={{ fontSize: 11.5 }} className="dim">
          Course bundles you can buy on their own
        </span>
      </div>
      <div className="grid grid-4" style={{ alignContent: 'start' }}>
        {items.map((p) => (
          <PackageCard key={p.id} pkg={p} />
        ))}
      </div>
    </section>
  );
}

export function PackagePage() {
  const { slug } = useParams({ from: '/packages/$slug' });
  const queryClient = useQueryClient();
  const pkg = useQuery({ queryKey: ['package', slug], queryFn: () => api.package(slug) });
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // After Razorpay says yes, wait for the webhook to grant it: re-read until
  // the package reads as owned, then refresh everything access touches.
  useEffect(() => {
    if (!confirming) return;
    if (pkg.data?.owned) {
      setConfirming(false);
      for (const key of ['packages', 'courses', 'course', 'playback', 'dashboard']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      return;
    }
    const poll = setInterval(() => void pkg.refetch(), 3000);
    const giveUp = setTimeout(() => {
      setConfirming(false);
      setError('Your payment went through, but the confirmation is taking longer than usual. Refresh in a few minutes, or contact the club team.');
    }, 90_000);
    return () => {
      clearInterval(poll);
      clearTimeout(giveUp);
    };
  }, [confirming, pkg.data?.owned, pkg, queryClient]);

  const buy = useMutation({
    mutationFn: async (packageId: string) => {
      const ticket = await api.createPackageOrder(packageId);
      await loadCheckout();
      return ticket;
    },
    onSuccess: (ticket: OrderTicket) => {
      const Checkout = window.Razorpay;
      if (!Checkout) {
        setError('The payment form did not load. Try again in a moment.');
        return;
      }
      new Checkout({
        key: ticket.keyId,
        amount: ticket.amountPaise,
        currency: ticket.currency,
        name: 'Eternal Bonds',
        description: ticket.planName,
        order_id: ticket.providerOrderId,
        theme: { color: '#e0457b' },
        handler: () => setConfirming(true),
      }).open();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const data = pkg.data;

  return (
    <Page>
      <PageHeader
        title={data?.title ?? 'Package'}
        back="/courses"
        crumbs={[{ label: 'Courses', to: '/courses' }, { label: data?.title ?? 'Package' }]}
      />
      {pkg.isPending && <SkeletonCard height={220} lines={3} />}
      {pkg.isError && <ErrorState onRetry={pkg.refetch} retrying={pkg.isFetching} />}
      {data && (
        <div className="package-layout">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            <Cover url={data.coverUrl} title={data.title} />
            {data.summaryMd && (
              <Card>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{data.summaryMd}</p>
              </Card>
            )}
            <Card title={`What's inside · ${data.courseCount} course${data.courseCount === 1 ? '' : 's'}`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.courses.map((c, i) => {
                  const row = (
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <span className="dim num" style={{ fontSize: 12, width: 18, textAlign: 'right' }}>
                        {i + 1}
                      </span>
                      <div style={{ width: 96, flexShrink: 0 }}>
                        <Cover url={c.coverUrl} title={c.title} height={54} />
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>{c.title}</div>
                        <div style={{ fontSize: 11 }} className="dim">
                          {c.lessonCount} lessons · {durationLabel(c.durationMinutes)}
                          {c.instructorName ? ` · ${c.instructorName}` : ''}
                        </div>
                      </div>
                      {data.owned && <Icon name="play" size={14} color="var(--pink)" />}
                    </div>
                  );
                  return data.owned ? (
                    <Link key={c.courseId} to="/courses/$slug" params={{ slug: c.slug }} style={{ color: 'inherit' }}>
                      {row}
                    </Link>
                  ) : (
                    <div key={c.courseId}>{row}</div>
                  );
                })}
                {data.courses.length === 0 && (
                  <span className="dim" style={{ fontSize: 12 }}>
                    Courses are being added to this package.
                  </span>
                )}
              </div>
            </Card>
          </div>

          <Card>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {data.owned ? (
                <>
                  <Chip tone="green">
                    <Icon name="check" size={10} strokeWidth={3} />
                    You own this package
                  </Chip>
                  <span style={{ fontSize: 12.5 }} className="muted">
                    {data.ownedUntil ? `Your access runs until ${dateLabel(data.ownedUntil)}.` : 'Your access does not expire.'}
                  </span>
                  {data.courses[0] && (
                    <Link className="btn btn-pink" to="/courses/$slug" params={{ slug: data.courses[0].slug }}>
                      <Icon name="play" size={13} />
                      Start the first course
                    </Link>
                  )}
                </>
              ) : (
                <>
                  <span style={{ fontSize: 26, fontWeight: 700 }} className="num">
                    {data.pricePaise > 0 ? rupees(data.pricePaise) : 'Ask the team'}
                  </span>
                  <span style={{ fontSize: 12 }} className="muted">
                    {accessLabel(data.accessDays)} · {data.lessonCount} lessons · {durationLabel(data.durationMinutes)}
                  </span>
                  {error && <div className="alert">{error}</div>}
                  {confirming ? (
                    <div className="callout">Payment received. Unlocking your courses…</div>
                  ) : data.canBuyOnline ? (
                    <button
                      type="button"
                      className="btn btn-pink"
                      disabled={buy.isPending}
                      onClick={() => {
                        setError(null);
                        buy.mutate(data.id);
                      }}
                    >
                      {buy.isPending ? 'Opening checkout…' : `Buy for ${rupees(data.pricePaise)}`}
                    </button>
                  ) : (
                    <div className="callout" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                      To buy this package, message the club team. Once your payment is received they add it to your
                      account, and these courses open straight away.
                    </div>
                  )}
                </>
              )}
            </div>
          </Card>
        </div>
      )}
    </Page>
  );
}
