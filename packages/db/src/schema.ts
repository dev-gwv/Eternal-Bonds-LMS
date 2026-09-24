import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  smallint,
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

/** Drizzle has no partial-unique helper; this keeps the predicate readable. */
const sqlNotNull = (col: unknown) => sql`${col} is not null`;

export const tierEnum = pgEnum('tier', ['free', 'silver', 'diamond', 'franchisee']);
export const roleEnum = pgEnum('role', ['member', 'instructor', 'admin']);
export const videoStatusEnum = pgEnum('video_status', ['none', 'uploading', 'processing', 'ready', 'errored']);
export const membershipStatusEnum = pgEnum('membership_status', ['active', 'expired', 'cancelled', 'trial']);

/**
 * Profile row. The id IS auth.users.id — Supabase Auth owns identity, sessions,
 * providers and MFA; this table holds only what the club needs about a member.
 * The foreign key to auth.users is added in the Supabase migration, because
 * drizzle-kit does not model schemas it did not create.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    handle: text('handle').notNull(),
    memberCode: text('member_code').notNull(),
    fullName: text('full_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    avatarUrl: text('avatar_url'),
    city: text('city'),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    role: roleEnum('role').notNull().default('member'),
    isSuspended: boolean('is_suspended').notNull().default(false),
    onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_handle_key').on(t.handle),
    uniqueIndex('users_member_code_key').on(t.memberCode),
    uniqueIndex('users_email_key').on(t.email).where(sqlNotNull(t.email)),
    uniqueIndex('users_phone_key').on(t.phone).where(sqlNotNull(t.phone)),
  ],
);

/** Tier lives here, never as a bare column on users — trials and expiries need it. */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tier: tierEnum('tier').notNull(),
    status: membershipStatusEnum('status').notNull().default('active'),
    source: text('source').notNull().default('manual'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [index('memberships_user_idx').on(t.userId)],
);

export const courses = pgTable(
  'courses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    summaryMd: text('summary_md'),
    // A storage key, signed on read — the bucket is private like the rest.
    coverKey: text('cover_key'),
    // Free text: a guest teaching one course is a name, not an account.
    instructorName: text('instructor_name'),
    category: text('category').notNull(),
    level: text('level').notNull().default('beginner'),
    language: text('language').notNull().default('hindi'),
    thumbnailUrl: text('thumbnail_url'),
    minTier: tierEnum('min_tier').notNull().default('diamond'),
    isPublished: boolean('is_published').notNull().default(false),
    rank: numeric('rank').notNull().default('1000'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Maintained by a trigger, so an out-of-band UPDATE cannot leave it stale. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('courses_slug_key').on(t.slug)],
);

export const modules = pgTable('modules', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseId: uuid('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  // A hard date nobody sees the module before.
  availableFrom: timestamp('available_from', { withTimezone: true }),
  // Days after the member's own clock — cohort start, or enrolment.
  dripDays: smallint('drip_days'),
  rank: numeric('rank').notNull().default('1000'),
});

export const lessons = pgTable(
  'lessons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    moduleId: uuid('module_id').notNull().references(() => modules.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    /** Never a playback URL — those are signed and expire. */
    videoProvider: text('video_provider'),
    videoAssetId: text('video_asset_id'),
    videoStatus: videoStatusEnum('video_status').notNull().default('none'),
    /** The provider's handle on the upload, which is not always the asset id. */
    videoUploadId: text('video_upload_id'),
    /** Why a transcode failed — shown to the admin who uploaded it. */
    videoError: text('video_error'),
    videoReadyAt: timestamp('video_ready_at', { withTimezone: true }),
    videoDurationSource: text('video_duration_source'),
    durationSeconds: integer('duration_seconds').notNull().default(0),
    summaryMd: text('summary_md'),
    isPreview: boolean('is_preview').notNull().default(false),
    rank: numeric('rank').notNull().default('1000'),
  },
  (t) => [uniqueIndex('lessons_slug_key').on(t.moduleId, t.slug)],
);

export const enrollments = pgTable(
  'enrollments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastLessonId: uuid('last_lesson_id'),
    score: integer('score'),
    certificateKey: text('certificate_key'),
  },
  (t) => [uniqueIndex('enrollments_user_course_key').on(t.userId, t.courseId)],
);

/** Highest-write table in the system. Position is written debounced, ~15s. */
export const lessonProgress = pgTable(
  'lesson_progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    lessonId: uuid('lesson_id').notNull().references(() => lessons.id, { onDelete: 'cascade' }),
    isCompleted: boolean('is_completed').notNull().default(false),
    lastPositionSeconds: integer('last_position_seconds').notNull().default(0),
    watchSeconds: integer('watch_seconds').notNull().default(0),
    firstStartedAt: timestamp('first_started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('lesson_progress_user_lesson_key').on(t.userId, t.lessonId)],
);

export const workshops = pgTable(
  'workshops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    hostName: text('host_name'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    platform: text('platform').notNull().default('zoom_webinar'),
    joinUrl: text('join_url'),
    registrationUrl: text('registration_url'),
    recurring: boolean('recurring').notNull().default(false),
    occurrenceIndex: integer('occurrence_index'),
    occurrenceTotal: integer('occurrence_total'),
    minTier: tierEnum('min_tier').notNull().default('diamond'),
    /** Null means unlimited — a recorded webinar has no seat count. */
    capacity: integer('capacity'),
  },
  (t) => [index('workshops_starts_at_idx').on(t.startsAt)],
);

export const workshopRegistrations = pgTable(
  'workshop_registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workshopId: uuid('workshop_id').notNull().references(() => workshops.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
    attendedMinutes: integer('attended_minutes').notNull().default(0),
  },
  (t) => [uniqueIndex('workshop_registrations_key').on(t.workshopId, t.userId)],
);

export const channels = pgTable(
  'channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    visibility: text('visibility').notNull().default('public'),
    minTier: tierEnum('min_tier').notNull().default('free'),
    isArchived: boolean('is_archived').notNull().default(false),
  },
  (t) => [uniqueIndex('channels_slug_key').on(t.slug)],
);

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** Markdown, sanitised on render. Never stored HTML. */
    bodyMd: text('body_md').notNull(),
    status: text('status').notNull().default('published'),
    likesCount: integer('likes_count').notNull().default(0),
    commentsCount: integer('comments_count').notNull().default(0),
    /** Distinct viewers, maintained by a trigger on post_views. */
    viewsCount: integer('views_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('posts_channel_created_idx').on(t.channelId, t.createdAt)],
);

export const postMedia = pgTable('post_media', {
  id: uuid('id').primaryKey().defaultRandom(),
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  storageKey: text('storage_key').notNull(),
  mime: text('mime').notNull(),
  width: integer('width'),
  height: integer('height'),
  rank: numeric('rank').notNull().default('1000'),
});

export const libraryCategories = pgTable(
  'library_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    blurb: text('blurb'),
    unit: text('unit').notNull().default('files'),
    rank: numeric('rank').notNull().default('1000'),
  },
  (t) => [uniqueIndex('library_categories_slug_key').on(t.slug)],
);

export const libraryItems = pgTable('library_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  categoryId: uuid('category_id').notNull().references(() => libraryCategories.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  storageKey: text('storage_key'),
  externalUrl: text('external_url'),
  mime: text('mime'),
  minTier: tierEnum('min_tier').notNull().default('diamond'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only. Powers the feed, streaks, XP and the activity chart. */
export const activityEvents = pgTable(
  'activity_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull().default({}),
    xp: integer('xp').notNull().default(0),
    minutes: integer('minutes').notNull().default(0),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('activity_events_user_time_idx').on(t.userId, t.occurredAt)],
);

/** Written in the same transaction as the change it describes. Drained by the worker. */
export const outbox = pgTable('outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  topic: text('topic').notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});


/* ── Worker ────────────────────────────────────────────────────────────────
   The queue is Postgres, claimed with `for update skip locked`. One fewer
   moving part than Redis, and sufficient at this size. */

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull().default({}),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('jobs_kind_idx').on(t.kind)],
);

/** Last run per scheduled job, so a restart does not replay everything. */
export const jobSchedule = pgTable('job_schedule', {
  kind: text('kind').primaryKey(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastStatus: text('last_status'),
  lastError: text('last_error'),
  durationMs: integer('duration_ms'),
});

/** One row per member per day. The activity chart reads this, not the events. */
export const dailyActivity = pgTable(
  'daily_activity',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    coursesMinutes: integer('courses_minutes').notNull().default(0),
    workshopsMinutes: integer('workshops_minutes').notNull().default(0),
    libraryMinutes: integer('library_minutes').notNull().default(0),
    xp: integer('xp').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

export const streaks = pgTable('streaks', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  currentDays: integer('current_days').notNull().default(0),
  longestDays: integer('longest_days').notNull().default(0),
  lastActiveOn: date('last_active_on'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Denormalised totals, always rebuildable from activity_events. */
export const memberStats = pgTable(
  'member_stats',
  {
    userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
    xp: integer('xp').notNull().default(0),
    lessonsCompleted: integer('lessons_completed').notNull().default(0),
    postsCreated: integer('posts_created').notNull().default(0),
    workshopsAttended: integer('workshops_attended').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('member_stats_xp_idx').on(t.xp)],
);

/**
 * Replayed responses for retried mutations.
 *
 * Kept in Postgres rather than process memory so a restart, a second instance,
 * or a request that lands on a different edge node all give the same answer to
 * the same Idempotency-Key. Swept by the `idempotency.sweep` job.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: text('key').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    status: integer('status').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.key, t.path] }), index('idempotency_keys_created_idx').on(t.createdAt)],
);

/**
 * Fixed-window rate limit counters.
 *
 * In Postgres rather than memory so the limit is the limit, not the limit
 * multiplied by the number of instances. Swept by the `sweep.expired` job.
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    bucket: text('bucket').primaryKey(),
    count: integer('count').notNull().default(0),
    resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('rate_limits_reset_idx').on(t.resetAt)],
);
