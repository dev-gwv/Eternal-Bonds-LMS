import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { Icon } from './primitives.tsx';

/**
 * Report a post, a win, an insight or a member.
 *
 * This existed as an orphan: exported from the directory page and rendered
 * nowhere, including there. The moderation queue, the reports table and the
 * resolve flow were all built and working, and no member could put anything
 * into them — a whole feature that was complete apart from its first step.
 *
 * Deliberately quiet in the interface. A flag on every post invites use as a
 * disagree button; small, grey, and behind a hover is enough for the person
 * who actually needs it.
 */
export function ReportButton({
  targetType,
  targetId,
  label = 'Report',
}: {
  targetType: 'post' | 'comment' | 'win' | 'insight' | 'member';
  targetId: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const report = useMutation({
    mutationFn: () => api.report({ targetType, targetId, reason: reason.trim() }),
    onSuccess: () => {
      setSent(true);
      setOpen(false);
    },
  });

  // No queue invalidation: a member cannot see the moderation queue, so there
  // is nothing of theirs to refresh. What they need is confirmation it landed.
  if (sent) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5 }} className="dim">
        <Icon name="check" size={12} strokeWidth={2.6} />
        Reported — a moderator will look
      </span>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-ghost"
        style={{ fontSize: 10.5, color: 'var(--ink-3)' }}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <input
        ref={input}
        value={reason}
        placeholder="What is wrong with it?"
        aria-label="Why are you reporting this?"
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          if (e.key === 'Enter' && reason.trim().length >= 4) report.mutate();
        }}
        style={{
          font: 'inherit',
          fontSize: 11,
          background: 'var(--soft)',
          border: '1px solid transparent',
          borderRadius: 'var(--r-ctl)',
          padding: '6px 10px',
          color: 'var(--ink)',
          width: 190,
        }}
      />
      <button
        type="button"
        className="btn btn-pink"
        style={{ fontSize: 10.5, padding: '6px 12px' }}
        disabled={reason.trim().length < 4 || report.isPending}
        onClick={() => report.mutate()}
      >
        {report.isPending ? 'Sending…' : 'Send'}
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        style={{ fontSize: 10.5 }}
        onClick={() => setOpen(false)}
      >
        Cancel
      </button>
      {report.error && (
        <span className="field-error">{(report.error as Error).message}</span>
      )}
    </span>
  );
}
