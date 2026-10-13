import { isNotFound } from '../api.ts';
import { Card } from './primitives.tsx';

/**
 * What a page shows when its data did not arrive.
 *
 * Pages used to fall through to their empty state on a failed request, so a
 * dropped connection read as "you have no courses" — a confident lie, and one
 * nobody would think to retry. This says what happened and offers the retry.
 */
export function ErrorState({
  onRetry,
  retrying = false,
  message = "We couldn't load this. Check your connection and try again.",
  title,
}: {
  onRetry?: () => unknown;
  retrying?: boolean;
  message?: string;
  title?: string;
}) {
  return (
    <Card title={title}>
      <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ flex: 1, minWidth: 200, fontSize: 12.5, lineHeight: 1.55, color: 'var(--ink-2)' }}>
          {message}
        </span>
        {onRetry && (
          <button
            type="button"
            className="btn btn-soft"
            disabled={retrying}
            onClick={() => void onRetry()}
          >
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        )}
      </div>
    </Card>
  );
}

/** The `isError` + retry props for a TanStack query, so a call site is one line. */
export function QueryError({
  query,
  title,
  message,
}: {
  query: { refetch: () => unknown; isFetching: boolean; error?: unknown };
  title?: string;
  message?: string;
}) {
  return <ErrorState onRetry={query.refetch} retrying={query.isFetching} title={title} message={message} />;
}

export { isNotFound };
