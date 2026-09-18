import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';
import * as engagement from './engagement.ts';

export type Db = ReturnType<typeof createDb>;

/**
 * The single place that knows how we talk to Postgres.
 * A VPS passes a pooled local URL; a Workers build passes a Hyperdrive URL.
 * Nothing above this function knows the difference.
 */
export function createDb(connectionString: string, opts: { max?: number } = {}) {
  const sql = postgres(connectionString, {
    max: opts.max ?? 10,
    // Required for transaction-mode poolers (PgBouncer, Hyperdrive).
    prepare: false,
  });
  return drizzle(sql, { schema: { ...schema, ...engagement } });
}
