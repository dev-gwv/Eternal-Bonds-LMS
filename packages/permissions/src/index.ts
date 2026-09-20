/**
 * The single tier × role × action matrix.
 * Imported by API middleware (authoritative) and by the UI (cosmetic gating only).
 * RLS remains the row-level enforcer — this is route-level capability.
 */

export type Tier = 'free' | 'silver' | 'diamond' | 'franchisee';
export type Role = 'member' | 'instructor' | 'admin';
export type Action =
  | 'course.read' | 'course.author' | 'workshop.manage' | 'event.manage'
  | 'insight.publish' | 'win.publish' | 'brief.publish'
  | 'member.moderate' | 'member.impersonate' | 'flags.manage';

const TIER_RANK: Record<Tier, number> = { free: 0, silver: 1, diamond: 2, franchisee: 3 };

const TIER_GATE: Partial<Record<Action, Tier>> = {
  'course.read': 'free',
  'insight.publish': 'free',
  'win.publish': 'free',
  'brief.publish': 'silver',
};

const ADMIN_ONLY: Action[] = [
  'course.author', 'workshop.manage', 'event.manage',
  'member.moderate', 'member.impersonate', 'flags.manage',
];

export function can(params: { role: Role; tier: Tier; action: Action }): boolean {
  if (params.role === 'admin') return true;
  if (ADMIN_ONLY.includes(params.action)) return false;
  const gate = TIER_GATE[params.action];
  if (!gate) return true;
  return TIER_RANK[params.tier] >= TIER_RANK[gate];
}
