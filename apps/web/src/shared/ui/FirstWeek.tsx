import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { OnboardingStep } from '@ipc/contracts';
import { api } from '../api.ts';
import { Card, Icon } from './primitives.tsx';

/**
 * The first five things to do, and then it goes away forever.
 *
 * A new member arrived at a dashboard of charts about a course they had not
 * started. This is the first move they were never given.
 *
 * Two rules keep it from becoming furniture:
 *
 * **It disappears when finished.** A checklist with five ticks on it is a
 * trophy for about a day and clutter after that. Once every step is done the
 * card stops rendering and does not come back.
 *
 * **Only the next undone step is a button.** Five equal calls to action is
 * five decisions, and the whole point is to remove the decision. The rest are
 * listed so the member can see how short the list is — which is the other
 * half of why they finish it.
 */

function Row({ step, isNext }: { step: OnboardingStep; isNext: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: 999,
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          background: step.done ? 'var(--green)' : 'transparent',
          border: step.done ? 'none' : `1.5px solid ${isNext ? 'var(--pink)' : 'var(--hair)'}`,
        }}
      >
        {step.done && <Icon name="check" size={11} strokeWidth={3.2} color="#fff" />}
      </span>

      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: isNext ? 600 : 400,
            color: step.done ? 'var(--ink-3)' : 'var(--ink)',
            textDecoration: step.done ? 'line-through' : undefined,
          }}
        >
          {step.title}
        </span>
        {isNext && (
          <span style={{ fontSize: 10.5, lineHeight: 1.45 }} className="dim">
            {step.hint}
          </span>
        )}
      </span>

      {isNext && (
        <Link to={step.href} className="btn btn-pink" style={{ flexShrink: 0, fontSize: 11 }}>
          {step.cta}
        </Link>
      )}
    </div>
  );
}

export function FirstWeek() {
  const onboarding = useQuery({
    queryKey: ['onboarding'],
    queryFn: api.onboarding,
    staleTime: 60_000,
    retry: false,
  });

  const data = onboarding.data;
  // Nothing while loading, and nothing once finished. A checklist of five
  // ticks is a trophy for a day and clutter after that.
  if (!data || data.completedAt || data.done === data.total) return null;

  const next = data.steps.find((s) => !s.done);

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>Your first week</span>
        <span style={{ fontSize: 10.5 }} className="dim num">
          {data.done} of {data.total}
        </span>
      </div>

      <span style={{ display: 'block', height: 4, borderRadius: 999, background: 'var(--track)' }}>
        <span
          style={{
            display: 'block',
            width: `${Math.round((data.done / data.total) * 100)}%`,
            height: '100%',
            borderRadius: 999,
            background: 'var(--pink)',
            transition: 'width 200ms ease',
          }}
        />
      </span>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 2 }}>
        {data.steps.map((s) => (
          <Row key={s.key} step={s} isNext={s.key === next?.key} />
        ))}
      </div>
    </Card>
  );
}
