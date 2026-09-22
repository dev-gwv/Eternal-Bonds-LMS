import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
  time,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { posts, tierEnum, users } from './schema.ts';

/**
 * Everything the club does *around* the content: reactions, notifications and
 * money.
 *
 * Kept in its own file because `schema.ts` had become the place every table
 * went, and these three groups only touch the core through `users` and
 * `posts`. Drizzle does not care; a person reading it does.
 */

/* ── Likes and comments ────────────────────────────────────────────────────
   The counters on `posts` are maintained by database triggers, not from here.
   Two people liking the same post in the same millisecond is the normal case,
   and read-modify-write from application code loses one of them. */

export const postLikes = pgTable(
  'post_likes',
  {
    postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // The primary key is the rule: one like per person per post.
  (t) => [primaryKey({ columns: [t.postId, t.userId] }), index('post_likes_user_idx').on(t.userId)],
);

export const postComments = pgTable(
  'post_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** One level only — a reply to a comment, never a reply to a reply. */
    parentId: uuid('parent_id'),
    bodyMd: text('body_md').notNull(),
    likesCount: integer('likes_count').notNull().default(0),
    /** Soft: a reply must not lose the comment it was answering. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (t) => [index('post_comments_post_idx').on(t.postId, t.createdAt), index('post_comments_author_idx').on(t.authorId)],
);

export const commentLikes = pgTable(
  'comment_likes',
  {
    commentId: uuid('comment_id').notNull().references(() => postComments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId] })],
);

/**
 * Who has seen a post.
 *
 * Distinct viewers rather than a hit counter: a counter that increments on
 * every render rewards refreshing and can never answer the only question an
 * author has, which is how many *people* read it.
 */
export const postViews = pgTable(
  'post_views',
  {
    postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    firstViewedAt: timestamp('first_viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] }), index('post_views_user_idx').on(t.userId)],
);

/* ── Notifications ─────────────────────────────────────────────────────────*/

export const notificationKindEnum = pgEnum('notification_kind', [
  'post.replied',
  'post.liked',
  'comment.liked',
  'workshop.reminder',
  'workshop.starting',
  'course.published',
  'membership.activated',
  'membership.expiring',
  'digest.weekly',
  'system',
]);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: notificationKindEnum('kind').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    /** An in-app path, never an absolute URL — a native build has another origin. */
    link: text('link'),
    subjectType: text('subject_type'),
    subjectId: uuid('subject_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Delivery state per channel. Null means "not applicable". */
    emailSentAt: timestamp('email_sent_at', { withTimezone: true }),
    pushSentAt: timestamp('push_sent_at', { withTimezone: true }),
    deliveryError: text('delivery_error'),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

export const notificationPrefs = pgTable('notification_prefs', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  inApp: boolean('in_app').notNull().default(true),
  emailDigest: boolean('email_digest').notNull().default(true),
  emailActivity: boolean('email_activity').notNull().default(false),
  /** Off until the member actually grants permission on a device. */
  push: boolean('push').notNull().default(false),
  quietFrom: time('quiet_from').notNull().default('22:00'),
  quietTo: time('quiet_to').notNull().default('08:00'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pushTokens = pgTable(
  'push_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    platform: text('platform').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when the provider says the token is dead, so we stop trying. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('push_tokens_token_key').on(t.token)],
);

/* ── Billing ───────────────────────────────────────────────────────────────*/

export const orderStatusEnum = pgEnum('order_status', ['created', 'paid', 'failed', 'refunded', 'abandoned']);

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tier: tierEnum('tier').notNull(),
  /** Paise. Money in a float is how ₹4,999.00 becomes ₹4,998.99. */
  amountPaise: integer('amount_paise').notNull(),
  currency: text('currency').notNull().default('INR'),
  durationDays: integer('duration_days').notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  rank: integer('rank').notNull().default(100),
});

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    planId: text('plan_id').notNull().references(() => plans.id),
    /** Snapshotted, so a later price change never rewrites history. */
    amountPaise: integer('amount_paise').notNull(),
    currency: text('currency').notNull().default('INR'),
    status: orderStatusEnum('status').notNull().default('created'),
    provider: text('provider').notNull().default('razorpay'),
    providerOrderId: text('provider_order_id'),
    notes: jsonb('notes').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('orders_user_idx').on(t.userId, t.createdAt)],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    providerPaymentId: text('provider_payment_id').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    currency: text('currency').notNull().default('INR'),
    status: text('status').notNull(),
    method: text('method'),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    raw: jsonb('raw').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // The same payment id arriving twice is a retry, not a second payment.
  (t) => [uniqueIndex('payments_provider_key').on(t.providerPaymentId)],
);

/**
 * Every webhook delivery, by provider id.
 *
 * Providers retry for days and deliver out of order. Recording the raw body
 * makes a replay free to ignore and means an argument months later can be
 * settled with evidence.
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
  },
  (t) => [uniqueIndex('webhook_events_key').on(t.provider, t.eventId)],
);

/**
 * When each member last opened each channel.
 *
 * Unread is derived from this — a count of posts newer than `last_read_at` —
 * rather than stored as a counter. A counter would need incrementing for every
 * member on every post, and would drift the first time anything went wrong.
 */
export const channelReads = pgTable(
  'channel_reads',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id').notNull(),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.channelId] }), index('channel_reads_user_idx').on(t.userId)],
);
