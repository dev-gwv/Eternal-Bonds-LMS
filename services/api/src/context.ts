import type { Role } from '@ipc/contracts';
import type { Env } from './env.ts';
import type { Session } from './middleware/auth.ts';

export type Variables = {
  requestId: string;
  userId: string | null;
  session?: Session;
  /** Set by requireAdmin once it has checked; never trusted from the client. */
  role?: Role;
};

export type AppEnv = { Bindings: Env; Variables: Variables };
