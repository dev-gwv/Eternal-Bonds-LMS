import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * RFC 9457 problem details. One error shape for every failure, so a client
 * parses errors once instead of per endpoint.
 *
 * Written with c.body rather than c.json because c.json() forces
 * `application/json` and would drop the problem+json content type.
 */
export function problem(
  c: Context,
  status: ContentfulStatusCode,
  title: string,
  detail?: string,
  extra?: Record<string, unknown>,
) {
  const body = JSON.stringify({ type: 'about:blank', title, status, detail, ...extra });
  return c.body(body, status, { 'content-type': 'application/problem+json' });
}

export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly title: string,
    readonly detail?: string,
  ) {
    super(`${status} ${title}`);
  }
}
