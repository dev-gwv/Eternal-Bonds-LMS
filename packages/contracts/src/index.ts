import { z } from 'zod';

/**
 * Zod is the source of truth. Types are inferred, never hand-written.
 * The API validates against these; the web app parses responses with them.
 */

export const Tier = z.enum(['free', 'silver', 'diamond', 'franchisee']);
export type Tier = z.infer<typeof Tier>;

export const CourseStatus = z.enum(['not_started', 'ongoing', 'completed']);
export type CourseStatus = z.infer<typeof CourseStatus>;

export const CourseCategory = z.enum([
  'business',
  'marketing',
  'mindset',
  'sales',
  'operations',
  'sessions',
]);
export type CourseCategory = z.infer<typeof CourseCategory>;

export const Course = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  category: CourseCategory,
  level: z.enum(['beginner', 'intermediate', 'advanced', 'all']),
  language: z.enum(['english', 'hindi']),
  lessonCount: z.int().nonnegative(),
  durationMinutes: z.int().nonnegative(),
  minTier: Tier,
  /** 0–100, for the ring on the course card */
  progress: z.int().min(0).max(100),
  status: CourseStatus,
  score: z.int().min(0).max(100).nullable(),
  certificateUrl: z.string().nullable(),
});
export type Course = z.infer<typeof Course>;

export const Workshop = z.object({
  id: z.uuid(),
  title: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  platform: z.enum(['zoom_webinar', 'zoom_meeting', 'in_person']),
  recurring: z.boolean(),
  occurrence: z.object({ index: z.int(), total: z.int() }).nullable(),
  registered: z.boolean(),
  joinUrl: z.string().nullable(),
});
export type Workshop = z.infer<typeof Workshop>;

export const Channel = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  unread: z.int().nonnegative(),
});
export type Channel = z.infer<typeof Channel>;

export const Post = z.object({
  id: z.uuid(),
  channelSlug: z.string(),
  author: z.object({ name: z.string(), initials: z.string(), tier: Tier }),
  bodyMd: z.string(),
  mediaCount: z.int().nonnegative(),
  likes: z.int().nonnegative(),
  /** Whether *this* member has liked it — drives the filled heart. */
  likedByMe: z.boolean().default(false),
  comments: z.int().nonnegative(),
  createdAt: z.iso.datetime(),
  teamReply: z.string().nullable(),
});
export type Post = z.infer<typeof Post>;

export const LibraryCategory = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  blurb: z.string(),
  itemCount: z.int().nonnegative(),
  unit: z.enum(['files', 'links', 'images', 'videos']),
});
export type LibraryCategory = z.infer<typeof LibraryCategory>;

export const LeaderboardRow = z.object({
  rank: z.int().positive(),
  name: z.string(),
  initials: z.string(),
  xp: z.int().nonnegative(),
});
export type LeaderboardRow = z.infer<typeof LeaderboardRow>;

export const Member = z.object({
  id: z.uuid(),
  memberCode: z.string(),
  fullName: z.string(),
  initials: z.string(),
  tier: Tier,
  active: z.boolean(),
  joinedAt: z.iso.datetime(),
  email: z.email(),
  phone: z.string(),
  city: z.string(),
  socials: z.array(z.object({ network: z.string(), handle: z.string() })),
});
export type Member = z.infer<typeof Member>;

/** One weekday of the Learning Activity chart. Minutes, split by source. */
export const ActivityDay = z.object({
  day: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  courses: z.int().nonnegative(),
  workshops: z.int().nonnegative(),
  library: z.int().nonnegative(),
});
export type ActivityDay = z.infer<typeof ActivityDay>;

export const Performance = z.object({
  totalScore: z.int().min(0).max(100),
  breakdown: z.object({
    participation: z.int().min(0).max(100),
    quiz: z.int().min(0).max(100),
    exam: z.int().min(0).max(100),
  }),
  /** Monthly trend, oldest first, 0–100. */
  trend: z.array(z.object({ label: z.string(), value: z.int().min(0).max(100) })),
});
export type Performance = z.infer<typeof Performance>;

export const DashboardStats = z.object({
  totalWorkshops: z.int().nonnegative(),
  registrations: z.int().nonnegative(),
  attendees: z.int().nonnegative(),
  attendanceRate: z.number().min(0).max(100),
});
export type DashboardStats = z.infer<typeof DashboardStats>;

export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.int(),
  detail: z.string().optional(),
});
export type Problem = z.infer<typeof Problem>;

/* ── Request bodies ────────────────────────────────────────────────────────
   Every mutation validates against one of these. The web app uses the same
   schema to check a form before it ever hits the network. */

export const CreatePost = z.object({
  channelSlug: z.string().min(1),
  bodyMd: z.string().trim().min(4, 'Say a little more than that').max(4000),
});
export type CreatePost = z.infer<typeof CreatePost>;

export const ProgressUpdate = z.object({
  /** Written debounced (~15s) from the player, never per tick. */
  positionSeconds: z.int().nonnegative(),
  watchedSeconds: z.int().nonnegative().default(0),
  completed: z.boolean().optional(),
});
export type ProgressUpdate = z.infer<typeof ProgressUpdate>;

/**
 * Account deletion. Apple 5.1.1(v) requires this to be reachable in-app, and
 * India's DPDP Act requires erasure. Authored content is anonymised rather
 * than cascade-deleted, so community threads do not develop holes.
 */
export const DeleteAccount = z.object({
  confirm: z.literal('DELETE'),
  reason: z.string().max(500).optional(),
});
export type DeleteAccount = z.infer<typeof DeleteAccount>;

export const DeletionState = z.object({
  scheduled: z.boolean(),
  /** 30-day grace period; cancellable until then. */
  purgeAt: z.iso.datetime().nullable(),
});
export type DeletionState = z.infer<typeof DeletionState>;

/* ── Course detail & playback ─────────────────────────────────────────────── */

export const Lesson = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  durationSeconds: z.int().nonnegative(),
  isPreview: z.boolean(),
  /** False when the member's tier does not reach the course. */
  locked: z.boolean(),
  completed: z.boolean(),
  lastPositionSeconds: z.int().nonnegative(),
});
export type Lesson = z.infer<typeof Lesson>;

export const CourseModule = z.object({
  id: z.uuid(),
  title: z.string(),
  lessons: z.array(Lesson),
});
export type CourseModule = z.infer<typeof CourseModule>;

export const CourseDetail = Course.extend({
  summaryMd: z.string().nullable(),
  modules: z.array(CourseModule),
});
export type CourseDetail = z.infer<typeof CourseDetail>;

/**
 * A short-lived ticket to play one lesson. The URL is minted on request and
 * expires — a playback URL is never stored on the lesson row, and access is
 * decided here rather than by hiding the player in the UI.
 */
export const PlaybackTicket = z.object({
  lessonId: z.uuid(),
  url: z.string(),
  kind: z.enum(['hls', 'mp4']),
  expiresAt: z.iso.datetime(),
});
export type PlaybackTicket = z.infer<typeof PlaybackTicket>;

/* ── Authoring (admin studio) ──────────────────────────────────────────────
   The studio writes through the same contracts the reader uses, so a draft
   cannot be shaped differently from a published course. Every field a member
   eventually sees is validated once, here. */

export const Role = z.enum(['member', 'instructor', 'admin']);
export type Role = z.infer<typeof Role>;

/** Who the signed-in person is, and what the UI is allowed to offer them. */
export const Viewer = z.object({
  userId: z.uuid().nullable(),
  role: Role,
  tier: Tier,
  /** True only for `admin`. The API re-checks; this just avoids dead buttons. */
  canAuthor: z.boolean(),
});
export type Viewer = z.infer<typeof Viewer>;

const slug = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, numbers and hyphens only');

export const CourseInput = z.object({
  slug,
  title: z.string().trim().min(3).max(140),
  category: Course.shape.category,
  level: Course.shape.level,
  language: Course.shape.language,
  minTier: Tier,
  summaryMd: z.string().max(8000).nullable().default(null),
  isPublished: z.boolean().default(false),
});
export type CourseInput = z.infer<typeof CourseInput>;

/** PATCH: every field optional, but each still validated if present. */
export const CoursePatch = CourseInput.partial();
export type CoursePatch = z.infer<typeof CoursePatch>;

export const ModuleInput = z.object({
  title: z.string().trim().min(2).max(140),
});
export type ModuleInput = z.infer<typeof ModuleInput>;

export const LessonInput = z.object({
  slug,
  title: z.string().trim().min(2).max(140),
  durationSeconds: z.int().nonnegative().max(60 * 60 * 12).default(0),
  isPreview: z.boolean().default(false),
  bodyMd: z.string().max(20000).nullable().default(null),
});
export type LessonInput = z.infer<typeof LessonInput>;

export const LessonPatch = LessonInput.partial();
export type LessonPatch = z.infer<typeof LessonPatch>;

/**
 * Reordering sends the whole list rather than a pair of indices: it is
 * idempotent, it survives a lost request, and two editors cannot interleave
 * into an order neither of them chose.
 */
export const ReorderInput = z.object({
  ids: z.array(z.uuid()).min(1).max(500),
});
export type ReorderInput = z.infer<typeof ReorderInput>;

export const WorkshopInput = z.object({
  title: z.string().trim().min(3).max(140),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  platform: Workshop.shape.platform,
  minTier: Tier,
  joinUrl: z.string().url().nullable().default(null),
  recurring: z.boolean().default(false),
  capacity: z.int().positive().max(100000).nullable().default(null),
}).refine((w) => Date.parse(w.endsAt) > Date.parse(w.startsAt), {
  message: 'The workshop has to end after it starts',
  path: ['endsAt'],
});
export type WorkshopInput = z.infer<typeof WorkshopInput>;

/** The editable shape of a course, drafts included — never sent to members. */
export const AdminLesson = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  durationSeconds: z.int().nonnegative(),
  isPreview: z.boolean(),
  rank: z.number(),
  videoStatus: z.enum(['none', 'uploading', 'processing', 'ready', 'errored']),
  videoAssetId: z.string().nullable(),
  /** The provider's own words on why a transcode failed. Actionable; shown. */
  videoError: z.string().nullable(),
});
export type AdminLesson = z.infer<typeof AdminLesson>;

export const AdminModule = z.object({
  id: z.uuid(),
  title: z.string(),
  rank: z.number(),
  lessons: z.array(AdminLesson),
});
export type AdminModule = z.infer<typeof AdminModule>;

export const AdminCourse = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  category: Course.shape.category,
  level: Course.shape.level,
  language: Course.shape.language,
  minTier: Tier,
  summaryMd: z.string().nullable(),
  isPublished: z.boolean(),
  lessonCount: z.int().nonnegative(),
  durationMinutes: z.int().nonnegative(),
  updatedAt: z.iso.datetime(),
});
export type AdminCourse = z.infer<typeof AdminCourse>;

export const AdminCourseDetail = AdminCourse.extend({
  modules: z.array(AdminModule),
});
export type AdminCourseDetail = z.infer<typeof AdminCourseDetail>;

export const AdminWorkshop = z.object({
  id: z.uuid(),
  title: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  platform: Workshop.shape.platform,
  minTier: Tier,
  joinUrl: z.string().nullable(),
  recurring: z.boolean(),
  capacity: z.int().nullable(),
  registrationCount: z.int().nonnegative(),
});
export type AdminWorkshop = z.infer<typeof AdminWorkshop>;

/**
 * The browser uploads straight to storage with this, so a 2GB lecture never
 * passes through the API process. The API only ever signs and records.
 */
export const UploadTicket = z.object({
  /** Storage key, or the provider's asset id — whatever identifies the upload. */
  key: z.string(),
  url: z.string(),
  token: z.string(),
  /** Providers disagree about this, so the server says which to use. */
  method: z.enum(['PUT', 'POST']),
  headers: z.record(z.string(), z.string()),
  provider: z.enum(['none', 'cloudflare', 'bunny']),
  expiresAt: z.iso.datetime(),
});
export type UploadTicket = z.infer<typeof UploadTicket>;

/** What the browser reports back once the upload to storage finished. */
export const AttachVideo = z.object({
  key: z.string().min(1),
  durationSeconds: z.int().nonnegative().optional(),
});
export type AttachVideo = z.infer<typeof AttachVideo>;

/** A one-line count of what is actually in the club, for the studio landing. */
export const AdminOverview = z.object({
  courses: z.object({ published: z.int(), draft: z.int() }),
  lessons: z.object({ total: z.int(), withoutVideo: z.int() }),
  workshops: z.object({ upcoming: z.int() }),
  members: z.object({ total: z.int(), paid: z.int() }),
});
export type AdminOverview = z.infer<typeof AdminOverview>;

/* ── Engagement ────────────────────────────────────────────────────────────
   The counters on a post were always zero because nothing could increment
   them. These are the shapes behind the like button and the comment thread. */

export const CommentAuthor = z.object({
  id: z.uuid(),
  name: z.string(),
  initials: z.string(),
  tier: Tier,
});
export type CommentAuthor = z.infer<typeof CommentAuthor>;

/**
 * A comment, with its replies nested one level.
 *
 * The type is declared by hand and the schema annotated with it, rather than
 * inferred: `z.lazy` cannot describe a recursive shape to TypeScript on its
 * own, and the inferred `replies` collapses to `unknown[]` — which is exactly
 * the field a component needs to walk.
 */
export type Comment = {
  id: string;
  postId: string;
  parentId: string | null;
  author: CommentAuthor;
  bodyMd: string;
  likes: number;
  /** Whether *this* member has liked it — drives the filled heart. */
  likedByMe: boolean;
  /** Soft-deleted: the body is replaced, the row stays so replies keep a parent. */
  deleted: boolean;
  mine: boolean;
  createdAt: string;
  editedAt: string | null;
  replies: Comment[];
};

export const Comment: z.ZodType<Comment> = z.lazy(() =>
  z.object({
    id: z.uuid(),
    postId: z.uuid(),
    parentId: z.uuid().nullable(),
    author: CommentAuthor,
    bodyMd: z.string(),
    likes: z.int().nonnegative(),
    likedByMe: z.boolean(),
    deleted: z.boolean(),
    mine: z.boolean(),
    createdAt: z.iso.datetime(),
    editedAt: z.iso.datetime().nullable(),
    replies: z.array(Comment),
  }),
);

export const CreateComment = z.object({
  bodyMd: z.string().trim().min(1, 'Say something').max(2000),
  /** One level of nesting only; a reply to a reply attaches to its parent. */
  parentId: z.uuid().nullable().default(null),
});
export type CreateComment = z.infer<typeof CreateComment>;

export const LikeState = z.object({
  liked: z.boolean(),
  likes: z.int().nonnegative(),
});
export type LikeState = z.infer<typeof LikeState>;

/* ── Notifications ─────────────────────────────────────────────────────────*/

export const NotificationKind = z.enum([
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
export type NotificationKind = z.infer<typeof NotificationKind>;

export const Notification = z.object({
  id: z.uuid(),
  kind: NotificationKind,
  title: z.string(),
  body: z.string().nullable(),
  /** An in-app path, never an absolute URL — a native build has another origin. */
  link: z.string().nullable(),
  read: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type Notification = z.infer<typeof Notification>;

export const NotificationFeed = z.object({
  items: z.array(Notification),
  unread: z.int().nonnegative(),
});
export type NotificationFeed = z.infer<typeof NotificationFeed>;

export const NotificationPrefs = z.object({
  inApp: z.boolean(),
  emailDigest: z.boolean(),
  emailActivity: z.boolean(),
  push: z.boolean(),
  /** "HH:MM", in the member's own timezone. A 3am buzz ends push for good. */
  quietFrom: z.string(),
  quietTo: z.string(),
});
export type NotificationPrefs = z.infer<typeof NotificationPrefs>;

export const RegisterPushToken = z.object({
  token: z.string().min(16).max(4096),
  platform: z.enum(['android', 'ios', 'web']),
});
export type RegisterPushToken = z.infer<typeof RegisterPushToken>;

/* ── Billing ───────────────────────────────────────────────────────────────
   Prices live in the database because they change; orders snapshot the amount
   so a change never rewrites what somebody already paid. */

export const Plan = z.object({
  id: z.string(),
  name: z.string(),
  tier: Tier,
  /** Paise. Money in a float is how ₹4,999.00 becomes ₹4,998.99. */
  amountPaise: z.int().nonnegative(),
  currency: z.string(),
  durationDays: z.int().positive(),
  description: z.string().nullable(),
  /** True when the member is already on this tier or better. */
  current: z.boolean(),
});
export type Plan = z.infer<typeof Plan>;

export const CreateOrder = z.object({
  planId: z.string().min(1),
});
export type CreateOrder = z.infer<typeof CreateOrder>;

/**
 * What the browser needs to open Razorpay's checkout.
 *
 * Note what is *not* here: nothing that could be used to mark the order paid.
 * The membership is granted by the webhook, never by the browser coming back
 * and saying it went well.
 */
export const OrderTicket = z.object({
  orderId: z.uuid(),
  providerOrderId: z.string(),
  /** The publishable key id — safe in a browser, unlike the secret. */
  keyId: z.string(),
  amountPaise: z.int().nonnegative(),
  currency: z.string(),
  planName: z.string(),
});
export type OrderTicket = z.infer<typeof OrderTicket>;

export const OrderSummary = z.object({
  id: z.uuid(),
  planId: z.string(),
  planName: z.string(),
  amountPaise: z.int().nonnegative(),
  currency: z.string(),
  status: z.enum(['created', 'paid', 'failed', 'refunded', 'abandoned']),
  createdAt: z.iso.datetime(),
});
export type OrderSummary = z.infer<typeof OrderSummary>;

export const MembershipState = z.object({
  tier: Tier,
  /** Null for the free tier, which never expires. */
  expiresAt: z.iso.datetime().nullable(),
  /** How the app decides whether to offer checkout at all (PLAN §7). */
  billingMode: z.enum(['web_only', 'razorpay']),
  plans: z.array(Plan),
  orders: z.array(OrderSummary),
});
export type MembershipState = z.infer<typeof MembershipState>;

/* ── Search ────────────────────────────────────────────────────────────────
   One endpoint across everything a member can reach. Results are grouped
   rather than ranked into a single list: "which course was that" and "which
   member was that" are different questions, and a mixed list answers neither
   well. */

export const SearchHit = z.object({
  kind: z.enum(['course', 'workshop', 'library', 'member', 'post']),
  id: z.string(),
  title: z.string(),
  /** A line of context — the category, the date, the tier. */
  subtitle: z.string().nullable(),
  /** In-app path, so the same result works in a native build. */
  href: z.string(),
});
export type SearchHit = z.infer<typeof SearchHit>;

export const SearchResults = z.object({
  query: z.string(),
  hits: z.array(SearchHit),
  /** True when results were cut off, so the UI can say "keep typing". */
  truncated: z.boolean(),
});
export type SearchResults = z.infer<typeof SearchResults>;
