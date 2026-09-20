import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  numeric,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
  date,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { lessons, tierEnum, users } from './schema.ts';

/**
 * Everything PLAN M4–M6 adds on top of the course/community core:
 * Think Tank, Wins, Events, badges, moderation, consent, flags and the
 * LMS refinements (resources, Q&A, notes, certificates, directory).
 *
 * One file so the whole second half of the product is reviewable in one
 * place. All tables reference `users.id`, which IS auth.users.id.
 */

/* ── Think Tank (M4) ───────────────────────────────────────────────────
   Domains and impact areas are lookup tables, not enums — the club will
   add categories and an enum migration is friction nobody needs. */

export const insightDomains = pgTable(
  'insight_domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    rank: numeric('rank').notNull().default('1000'),
  },
  (t) => [uniqueIndex('insight_domains_slug_key').on(t.slug)],
);

export const insightImpactAreas = pgTable(
  'insight_impact_areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    rank: numeric('rank').notNull().default('1000'),
  },
  (t) => [uniqueIndex('insight_impact_areas_slug_key').on(t.slug)],
);

export const insightStatusEnum = pgEnum('insight_status', ['draft', 'published', 'hidden']);

export const voteCycles = pgTable(
  'vote_cycles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    status: text('status').notNull().default('open'),
  },
  (t) => [index('vote_cycles_dates_idx').on(t.startsOn, t.endsOn)],
);

export const insights = pgTable(
  'insights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    domainId: uuid('domain_id').references(() => insightDomains.id),
    impactAreaId: uuid('impact_area_id').references(() => insightImpactAreas.id),
    voteCycleId: uuid('vote_cycle_id').references(() => voteCycles.id),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    situationMd: text('situation_md').notNull().default(''),
    bigIdeaMd: text('big_idea_md').notNull().default(''),
    howMd: text('how_md').notNull().default(''),
    status: insightStatusEnum('status').notNull().default('draft'),
    votesCount: integer('votes_count').notNull().default(0),
    savesCount: integer('saves_count').notNull().default(0),
    featuredAt: timestamp('featured_at', { withTimezone: true }),
    featuredBy: uuid('featured_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('insights_slug_key').on(t.slug),
    index('insights_cycle_idx').on(t.voteCycleId, t.votesCount),
    index('insights_author_idx').on(t.authorId),
  ],
);

export const insightSteps = pgTable(
  'insight_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    insightId: uuid('insight_id').notNull().references(() => insights.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    bodyMd: text('body_md').notNull().default(''),
    rank: numeric('rank').notNull().default('1000'),
  },
  (t) => [index('insight_steps_insight_idx').on(t.insightId)],
);

export const insightVotes = pgTable(
  'insight_votes',
  {
    insightId: uuid('insight_id').notNull().references(() => insights.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    cycleId: uuid('cycle_id').notNull().references(() => voteCycles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.insightId, t.userId] }), index('insight_votes_cycle_idx').on(t.cycleId)],
);

/** One table for saves across insights, wins and posts. Not three. */
export const bookmarks = pgTable(
  'bookmarks',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.targetType, t.targetId] })],
);

/** Solution Finder: editorial ordering, not incidental. */
export const solutions = pgTable(
  'solutions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dilemma: text('dilemma').notNull(),
    bodyMd: text('body_md').notNull(),
    curatedBy: uuid('curated_by').references(() => users.id),
    rank: numeric('rank').notNull().default('1000'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('solutions_rank_idx').on(t.rank)],
);

/** Every unmatched dilemma is logged — it is the content roadmap, free. */
export const unmatchedDilemmas = pgTable(
  'unmatched_dilemmas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    query: text('query').notNull(),
    context: text('context'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('unmatched_dilemmas_created_idx').on(t.createdAt)],
);

/* ── Wins Board (M5) ─────────────────────────────────────────────────── */

export const winStatusEnum = pgEnum('win_status', ['pending', 'published', 'hidden']);

export const wins = pgTable(
  'wins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    bigIdeaMd: text('big_idea_md').notNull().default(''),
    howItHappenedMd: text('how_it_happened_md').notNull().default(''),
    category: text('category').notNull().default('general'),
    occurredOn: date('occurred_on'),
    tags: text('tags').array().notNull().default([]),
    status: winStatusEnum('status').notNull().default('pending'),
    publicShare: boolean('public_share').notNull().default(false),
    commentsCount: integer('comments_count').notNull().default(0),
    reactionsCount: integer('reactions_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('wins_slug_key').on(t.slug),
    index('wins_status_created_idx').on(t.status, t.createdAt),
    index('wins_author_idx').on(t.authorId),
  ],
);

export const winMedia = pgTable(
  'win_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    winId: uuid('win_id').notNull().references(() => wins.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    mime: text('mime').notNull(),
    width: integer('width'),
    height: integer('height'),
    rank: numeric('rank').notNull().default('1000'),
  },
  (t) => [index('win_media_win_idx').on(t.winId)],
);

/** One polymorphic table for claps/likes across wins, insights, posts. */
export const reactions = pgTable(
  'reactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    kind: text('kind').notNull().default('like'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('reactions_unique_key').on(t.userId, t.targetType, t.targetId, t.kind),
    index('reactions_target_idx').on(t.targetType, t.targetId),
  ],
);

export const winComments = pgTable(
  'win_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    winId: uuid('win_id').notNull().references(() => wins.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    bodyMd: text('body_md').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('win_comments_win_idx').on(t.winId, t.createdAt)],
);

/* ── Events / live sessions (M6) ───────────────────────────────────────
   Workshops are one-off classes. Events are the community rhythm —
   notably the weekly featured-insight session that closes the vote loop. */

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    descriptionMd: text('description_md'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    joinUrl: text('join_url'),
    recordingLessonId: uuid('recording_lesson_id').references(() => lessons.id),
    isFeaturedSession: boolean('is_featured_session').notNull().default(false),
    minTier: tierEnum('min_tier').notNull().default('free'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('events_slug_key').on(t.slug), index('events_starts_idx').on(t.startsAt)],
);

export const eventRsvps = pgTable(
  'event_rsvps',
  {
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] })],
);

export const eventInsights = pgTable(
  'event_insights',
  {
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    insightId: uuid('insight_id').notNull().references(() => insights.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.insightId] })],
);

/* ── Gamification / badges ─────────────────────────────────────────────
   Profiles show badges and streaks; this is the engine that awards them
   by evaluating activity_events. */

export const badgeDefs = pgTable(
  'badge_defs',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    icon: text('icon').notNull().default('award'),
    /** Machine-readable rule, e.g. { kind: "lessons_completed", count: 10 }. */
    rule: jsonb('rule').$type<Record<string, unknown>>().notNull().default({}),
  },
);

export const userBadges = pgTable(
  'user_badges',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    badgeId: text('badge_id').notNull().references(() => badgeDefs.id, { onDelete: 'cascade' }),
    awardedAt: timestamp('awarded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.badgeId] })],
);

/* ── Moderation ──────────────────────────────────────────────────────── */

export const reportStatusEnum = pgEnum('report_status', ['open', 'actioned', 'dismissed']);

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    reason: text('reason').notNull(),
    status: reportStatusEnum('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [index('reports_status_idx').on(t.status, t.createdAt)],
);

export const channelModerators = pgTable(
  'channel_moderators',
  {
    channelId: uuid('channel_id').notNull(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.userId] })],
);

/** Every admin and moderation action. Cheap now, invaluable in a dispute. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_actor_idx').on(t.actorId, t.createdAt)],
);

/* ── Legal & consent ─────────────────────────────────────────────────── */

export const termsAcceptances = pgTable(
  'terms_acceptances',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.version] })],
);

/* ── Member directory ──────────────────────────────────────────────────
   The value of a mastermind is peers. Searchable by expertise and city. */

export const memberProfiles = pgTable('member_profiles', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  bioMd: text('bio_md'),
  expertise: text('expertise').array().notNull().default([]),
  showInDirectory: boolean('show_in_directory').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ── Feature flags ───────────────────────────────────────────────────── */

export const featureFlags = pgTable('feature_flags', {
  key: text('key').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ── LMS refinements ─────────────────────────────────────────────────── */

export const lessonResources = pgTable(
  'lesson_resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lessonId: uuid('lesson_id').notNull().references(() => lessons.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    storageKey: text('storage_key').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    mime: text('mime').notNull().default('application/octet-stream'),
    rank: numeric('rank').notNull().default('1000'),
    downloadCount: integer('download_count').notNull().default(0),
  },
  (t) => [index('lesson_resources_lesson_idx').on(t.lessonId)],
);

/** Questions asked at the point of confusion, attached to the lesson. */
export const lessonQuestions = pgTable(
  'lesson_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lessonId: uuid('lesson_id').notNull().references(() => lessons.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    bodyMd: text('body_md').notNull(),
    resolved: boolean('resolved').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('lesson_questions_lesson_idx').on(t.lessonId, t.createdAt)],
);

export const lessonNotes = pgTable(
  'lesson_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    lessonId: uuid('lesson_id').notNull().references(() => lessons.id, { onDelete: 'cascade' }),
    bodyMd: text('body_md').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('lesson_notes_user_lesson_key').on(t.userId, t.lessonId)],
);

export const certificates = pgTable(
  'certificates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id').notNull(),
    code: text('code').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    pdfKey: text('pdf_key'),
  },
  (t) => [uniqueIndex('certificates_code_key').on(t.code), index('certificates_user_idx').on(t.userId)],
);

/* ── Photolancer (marketplace) ───────────────────────────────────────── */

export const briefStatusEnum = pgEnum('brief_status', ['open', 'assigned', 'closed']);

export const freelanceBriefs = pgTable(
  'freelance_briefs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    bodyMd: text('body_md').notNull(),
    city: text('city'),
    budgetPaise: integer('budget_paise'),
    shootOn: date('shoot_on'),
    status: briefStatusEnum('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('freelance_briefs_status_idx').on(t.status, t.createdAt)],
);

export const freelanceApplications = pgTable(
  'freelance_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    briefId: uuid('brief_id').notNull().references(() => freelanceBriefs.id, { onDelete: 'cascade' }),
    applicantId: uuid('applicant_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    pitchMd: text('pitch_md').notNull(),
    status: text('status').notNull().default('applied'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('freelance_applications_unique').on(t.briefId, t.applicantId),
    index('freelance_applications_brief_idx').on(t.briefId),
  ],
);

/* ── Support ───────────────────────────────────────────────────────────
   Admin "view as member": audit-logged, time-boxed, never for admins. */

export const impersonationSessions = pgTable(
  'impersonation_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    targetUserId: uuid('target_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('impersonation_target_idx').on(t.targetUserId)],
);
