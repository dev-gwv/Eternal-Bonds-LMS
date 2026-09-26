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
  /** Signed cover image, or null — the card falls back to a gradient. */
  coverUrl: z.string().nullable().default(null),
  /** Free text. A guest teaching one course is a name, not an account. */
  instructorName: z.string().nullable().default(null),
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
  /* Signed for an hour on read, like every other image here. Null is the
     normal case and the card falls back to a gradient — a missing cover must
     degrade, never break the grid. */
  coverUrl: z.string().nullable().default(null),
});
export type Workshop = z.infer<typeof Workshop>;

export const Channel = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  unread: z.int().nonnegative(),
});
export type Channel = z.infer<typeof Channel>;

/**
 * An image attached to a post or a win.
 *
 * `url` is a short-lived signed link minted per request, never a stable path:
 * the storage bucket is private, so a URL that leaked would expire rather than
 * hand out a permanent reader. The client must not cache these past the query.
 */
export const MediaItem = z.object({
  id: z.uuid(),
  url: z.string(),
  mime: z.string(),
  width: z.int().positive().nullable().default(null),
  height: z.int().positive().nullable().default(null),
});
export type MediaItem = z.infer<typeof MediaItem>;

export const Post = z.object({
  id: z.uuid(),
  channelSlug: z.string(),
  author: z.object({ name: z.string(), initials: z.string(), tier: Tier }),
  bodyMd: z.string(),
  mediaCount: z.int().nonnegative(),
  /** Signed URLs for the attached images, newest post media first. */
  media: z.array(MediaItem).default([]),
  likes: z.int().nonnegative(),
  /** Whether *this* member has liked it — drives the filled heart. */
  likedByMe: z.boolean().default(false),
  comments: z.int().nonnegative(),
  /** Distinct people who have seen it. Zero until someone other than the
      author scrolls past, so a brand-new post does not claim a reader. */
  views: z.int().nonnegative().default(0),
  createdAt: z.iso.datetime(),
  teamReply: z.string().nullable(),
});
export type Post = z.infer<typeof Post>;

/**
 * One thing in the library.
 *
 * `url` is resolved by the API: a stored file comes back as a short-lived
 * signed link and an external resource as its own address, so the client never
 * has to know which kind it is holding.
 */
export const LibraryItem = z.object({
  id: z.uuid(),
  categorySlug: z.string(),
  title: z.string(),
  /* A thumbnail, distinct from the file itself. A PDF contract has both; a
     link to a Drive folder has a thumbnail and no file at all. */
  coverUrl: z.string().nullable().default(null),
  /** 'file' when it lives in our storage, 'link' when it points elsewhere. */
  kind: z.enum(['file', 'link']),
  url: z.string().nullable(),
  mime: z.string().nullable(),
  minTier: Tier,
  createdAt: z.iso.datetime(),
});
export type LibraryItem = z.infer<typeof LibraryItem>;

export const LibraryCategory = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  blurb: z.string(),
  itemCount: z.int().nonnegative(),
  unit: z.enum(['files', 'links', 'images', 'videos']),
});
export type LibraryCategory = z.infer<typeof LibraryCategory>;

/**
 * Writing to the library, which until now nobody could.
 *
 * The library shipped with a read API and admin RLS policies and no write
 * endpoint between them, so the only resources the club will ever have are
 * the ones the seed script inserted. For a section whose entire purpose is
 * "the things we give members", that is the most complete-looking dead end in
 * the application.
 *
 * An item is a file we host or a link somewhere else, never both. The two are
 * genuinely different — one has a storage key and a mime type and can be
 * signed for six hours, the other is a URL — and a row holding both raises a
 * question nothing can answer about which one a member should get.
 */
export const LibraryItemInput = z
  .object({
    categoryId: z.uuid(),
    title: z.string().trim().min(2).max(200),
    minTier: Tier,
    /** Set for a link. Mutually exclusive with `storageKey`. */
    externalUrl: z.url().max(2000).nullable().default(null),
    /** Set for a hosted file, after the upload ticket has been used. */
    storageKey: z.string().max(500).nullable().default(null),
    mime: z.string().max(120).nullable().default(null),
  })
  .refine((v) => (v.externalUrl === null) !== (v.storageKey === null), {
    message: 'An item is either a link or an uploaded file, not both and not neither',
    path: ['externalUrl'],
  });
export type LibraryItemInput = z.infer<typeof LibraryItemInput>;

/**
 * Editing an item, which is deliberately *not* the same shape as creating one.
 *
 * What a resource is — the file, or the link — cannot be edited. Swapping the
 * target under a title members already know is how somebody downloads last
 * year's contract believing it is this year's. Replacing a resource is a new
 * item and a deleted old one: two deliberate acts rather than one quiet one.
 *
 * It also keeps the client honest. The read shape carries `kind` and a URL,
 * never the storage key, so a whole-object PATCH could not round-trip a hosted
 * file without inventing one.
 */
export const LibraryItemPatch = z.object({
  categoryId: z.uuid(),
  title: z.string().trim().min(2).max(200),
  minTier: Tier,
});
export type LibraryItemPatch = z.infer<typeof LibraryItemPatch>;

export const LibraryCategoryInput = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, numbers and hyphens only'),
  name: z.string().trim().min(2).max(80),
  blurb: z.string().trim().max(300).nullable().default(null),
  /** What the count under the category name is counting. */
  unit: z.enum(['files', 'links', 'images', 'videos']).default('files'),
});
export type LibraryCategoryInput = z.infer<typeof LibraryCategoryInput>;

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
  /**
   * A signed, expiring link to the member's photograph, or null.
   *
   * `users.avatar_url` has existed since the first migration and was read by
   * exactly one admin query and written by nothing — so no member has ever
   * been able to set a picture, and every avatar in the app is initials. The
   * column holds a storage key; this field is that key signed for reading,
   * because the bucket is private like everything else.
   */
  avatarUrl: z.string().nullable().default(null),
  initialsOnly: z.boolean().default(false),
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
  /**
   * Momentum, not exam scores — there are no quizzes yet, and a breakdown
   * into quiz/exam splits would be fiction. Consistency is active days in the
   * last 30, completion is finished vs started lessons, streak is the longest
   * run held against a 30-day scale.
   */
  breakdown: z.object({
    consistency: z.int().min(0).max(100),
    completion: z.int().min(0).max(100),
    streak: z.int().min(0).max(100),
  }),
  /** Monthly momentum, oldest first, 0–100. */
  trend: z.array(z.object({ label: z.string(), value: z.int().min(0).max(100) })),
});
export type Performance = z.infer<typeof Performance>;

/**
 * The four numbers on a member's dashboard.
 *
 * These used to be total workshops, registrations, attendees and attendance
 * rate — organiser metrics, on the landing page of somebody who is not the
 * organiser. A member opening the app wants to know how *they* are doing:
 * what they have finished, how long they have spent, whether the streak is
 * alive, and where they stand.
 */
export const DashboardStats = z.object({
  lessonsCompleted: z.int().nonnegative(),
  coursesInProgress: z.int().nonnegative(),
  /** Across the last 30 days, which is the window the chart also covers. */
  minutesLearned: z.int().nonnegative(),
  streakDays: z.int().nonnegative(),
  longestStreakDays: z.int().nonnegative(),
  xp: z.int().nonnegative(),
  /** Null until the member has any XP at all — an unranked member is not 0th. */
  rank: z.int().positive().nullable(),
  workshopsAttended: z.int().nonnegative(),
  upcomingWorkshops: z.int().nonnegative(),
});
export type DashboardStats = z.infer<typeof DashboardStats>;

/**
 * The whole dashboard in one round trip: five parallel queries were five TLS
 * handshakes on a phone over 4G before first paint.
 */
/**
 * One course a member is partway through, ready to resume.
 *
 * `lessonSlug` is the lesson they stopped on, not the next unwatched one: a
 * member who left at 40% of a video wants that video, and a member who
 * finished it gets the same lesson page, which sends them onward. Guessing
 * "next" is how a resume button skips the thing somebody meant to rewatch.
 */
export const ContinueItem = z.object({
  courseId: z.uuid(),
  courseSlug: z.string(),
  courseTitle: z.string(),
  lessonId: z.uuid().nullable(),
  lessonTitle: z.string().nullable(),
  /** 0–100, over the whole course. */
  progress: z.int().min(0).max(100),
  lessonsDone: z.int().nonnegative(),
  lessonsTotal: z.int().nonnegative(),
  /** Null when they enrolled and never opened anything. */
  lastActivityAt: z.iso.datetime().nullable(),
  /** Rough minutes left, from lesson durations. Null when nothing has one. */
  minutesLeft: z.int().nonnegative().nullable(),
});
export type ContinueItem = z.infer<typeof ContinueItem>;

export const Dashboard = z.object({
  stats: DashboardStats,
  /** Courses in flight, coldest last. Empty for a member with nothing started. */
  continueLearning: z.array(ContinueItem).default([]),
  activity: z.array(ActivityDay),
  performance: Performance,
  leaderboard: z.array(LeaderboardRow),
  workshops: z.array(Workshop),
});
export type Dashboard = z.infer<typeof Dashboard>;

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
  /** True when the member's tier does not reach it, or its module has not dripped yet. */
  locked: z.boolean(),
  completed: z.boolean(),
  lastPositionSeconds: z.int().nonnegative(),
});
export type Lesson = z.infer<typeof Lesson>;

export const CourseModule = z.object({
  id: z.uuid(),
  title: z.string(),
  /**
   * When this module opens for *this* member — their cohort start plus the
   * module's drip, or its hard date, whichever is later. Null means open now,
   * which is the common case and costs nothing to represent.
   */
  unlocksAt: z.iso.datetime().nullable().default(null),
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
  /**
   * For hls/mp4 this is a signed, expiring URL. For `youtube` it is the bare
   * video id — there is nothing to sign, because the video is hosted by
   * YouTube and the player is their iframe rather than our <video> element.
   */
  url: z.string(),
  kind: z.enum(['hls', 'mp4', 'youtube']),
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
  /**
   * Which video backend is configured. The studio needs it to decide whether a
   * lesson gets a file dropzone or a paste-a-link box — asking for a file when
   * the answer is a YouTube URL is the kind of wrong affordance somebody
   * fights for ten minutes before reading the docs.
   */
  videoProvider: z.enum(['none', 'cloudflare', 'bunny', 'youtube']).default('none'),
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
  instructorName: z.string().trim().max(120).nullable().default(null),
  isPublished: z.boolean().default(false),
});
export type CourseInput = z.infer<typeof CourseInput>;

/** PATCH: every field optional, but each still validated if present. */
export const CoursePatch = CourseInput.partial();
export type CoursePatch = z.infer<typeof CoursePatch>;

export const ModuleInput = z.object({
  title: z.string().trim().min(2).max(140),
  /**
   * Days after the member's cohort start (or enrolment) before this module
   * opens. Null unlocks it immediately, which is what every existing module
   * does and what a course without a schedule should keep doing.
   */
  dripDays: z.int().min(0).max(365).nullable().default(null),
  /** A hard date nobody sees the module before, whatever their drip says. */
  availableFrom: z.iso.datetime().nullable().default(null),
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
  /* The lesson's own notes. It has always been in `LessonInput` and was never
     returned, so the studio could write it once at creation and never read it
     back — which means it could never be edited. */
  bodyMd: z.string().nullable().default(null),
});
export type AdminLesson = z.infer<typeof AdminLesson>;

export const AdminModule = z.object({
  id: z.uuid(),
  title: z.string(),
  rank: z.number(),
  dripDays: z.int().nonnegative().nullable().default(null),
  availableFrom: z.iso.datetime().nullable().default(null),
  lessons: z.array(AdminLesson),
});
export type AdminModule = z.infer<typeof AdminModule>;

export const AdminCourse = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  coverUrl: z.string().nullable().default(null),
  instructorName: z.string().nullable().default(null),
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
  coverUrl: z.string().nullable().default(null),
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
  provider: z.enum(['none', 'cloudflare', 'bunny', 'youtube']),
  expiresAt: z.iso.datetime(),
});
export type UploadTicket = z.infer<typeof UploadTicket>;

/** What the browser reports back once the upload to storage finished. */
/**
 * Attaching a video to a lesson.
 *
 * `key` is whatever the provider handed back from a direct upload. With
 * YouTube there is no upload at all — the author pastes a link — so `key`
 * carries the URL and the server extracts the id from it. Accepting the whole
 * URL rather than asking for an 11-character id is the difference between
 * pasting from the address bar and hunting through it.
 */
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

/**
 * Must stay in step with the `notification_kind` enum in Postgres.
 *
 * A value added to the database and not to this list is not a cosmetic
 * mismatch: the browser parses the feed with this schema, so one unknown kind
 * makes the *entire* notification list fail to parse and the bell go dark.
 * `bun run test:contracts` exists to catch exactly this, and did.
 */
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
  // Added with the learning and ritual work.
  'learning.nudge',
  'learning.unlocked',
  'cohort.deadline',
  'thinktank.featured',
  'onboarding.nudge',
  'journey.complete',
  'challenge.open',
  'challenge.ending',
  'challenge.won',
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

/* ── Think Tank (M4) ─────────────────────────────────────────────────── */

export const InsightStatus = z.enum(['draft', 'published', 'hidden']);
export type InsightStatus = z.infer<typeof InsightStatus>;

export const InsightDomain = z.object({ id: z.uuid(), slug: z.string(), name: z.string() });
export type InsightDomain = z.infer<typeof InsightDomain>;

export const VoteCycle = z.object({
  id: z.uuid(),
  startsOn: z.string(),
  endsOn: z.string(),
  status: z.string(),
});
export type VoteCycle = z.infer<typeof VoteCycle>;

export const Insight = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  situationMd: z.string(),
  bigIdeaMd: z.string(),
  howMd: z.string(),
  status: InsightStatus,
  domainSlug: z.string().nullable(),
  impactSlug: z.string().nullable(),
  votes: z.int().nonnegative(),
  votedByMe: z.boolean().default(false),
  savedByMe: z.boolean().default(false),
  featuredAt: z.iso.datetime().nullable(),
  coverUrl: z.string().nullable().default(null),
  author: z.object({ name: z.string(), initials: z.string(), tier: Tier }),
  createdAt: z.iso.datetime(),
});
export type Insight = z.infer<typeof Insight>;

export const InsightDetail = Insight.extend({
  steps: z.array(z.object({ id: z.uuid(), title: z.string(), bodyMd: z.string() })),
});
export type InsightDetail = z.infer<typeof InsightDetail>;

export const ShareInsight = z.object({
  title: z.string().trim().min(8).max(140),
  situationMd: z.string().trim().min(20).max(8000),
  bigIdeaMd: z.string().trim().min(20).max(8000),
  howMd: z.string().trim().min(10).max(8000).default(''),
  domainSlug: z.string().min(1),
  impactSlug: z.string().min(1),
  steps: z.array(z.object({ title: z.string().min(2).max(140), bodyMd: z.string().max(4000) })).max(12).default([]),
});
export type ShareInsight = z.infer<typeof ShareInsight>;

export const Solution = z.object({
  id: z.uuid(),
  dilemma: z.string(),
  bodyMd: z.string(),
  rank: z.number(),
});
export type Solution = z.infer<typeof Solution>;

/* ── Wins Board (M5) ─────────────────────────────────────────────────── */

export const WinStatus = z.enum(['pending', 'published', 'hidden']);
export type WinStatus = z.infer<typeof WinStatus>;

export const Win = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  bigIdeaMd: z.string(),
  howItHappenedMd: z.string(),
  category: z.string(),
  occurredOn: z.string().nullable(),
  tags: z.array(z.string()),
  status: WinStatus,
  publicShare: z.boolean(),
  /**
   * Whether the viewer wrote it. Decided server-side from the session, because
   * the client's only other option is comparing display names — and two
   * members called Rahul Sharma would each get the other's share control.
   */
  isMine: z.boolean().default(false),
  reactions: z.int().nonnegative(),
  reactedByMe: z.boolean().default(false),
  comments: z.int().nonnegative(),
  media: z.array(MediaItem).default([]),
  author: z.object({ name: z.string(), initials: z.string(), tier: Tier }),
  createdAt: z.iso.datetime(),
});
export type Win = z.infer<typeof Win>;

export const SubmitWin = z.object({
  title: z.string().trim().min(8).max(140),
  bigIdeaMd: z.string().trim().min(40, 'Say enough that someone else could copy it').max(8000),
  howItHappenedMd: z.string().trim().min(40).max(8000),
  category: z.string().min(1).default('general'),
  occurredOn: z.string().nullable().default(null),
  tags: z.array(z.string().max(30)).max(8).default([]),
  publicShare: z.boolean().default(false),
  /**
   * The challenge this answers, if any.
   *
   * On `SubmitWin` rather than on a separate endpoint, because an entry is a
   * win — it goes through the same moderation, carries the same photographs,
   * and lands on the same board. The only difference is that somebody asked.
   */
  challengeSlug: z.string().nullable().default(null),
});
export type SubmitWin = z.infer<typeof SubmitWin>;

/* ── Challenges ──────────────────────────────────────────────────────── */

/**
 * A prompt with a deadline.
 *
 * The wins board has always been there and nothing ever asked anybody to use
 * it; an empty box captioned "share a win" is a blank page, and a blank page
 * with no deadline is something everyone intends to fill later. This is the
 * opposite: one prompt, one week, everybody at once.
 */
export const Challenge = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  /** The prompt in one line. "One light, one portrait" — a thing you can picture doing. */
  prompt: z.string(),
  briefMd: z.string().nullable(),
  status: z.enum(['draft', 'open', 'closed']),
  startsOn: z.string(),
  endsOn: z.string(),
  minTier: Tier,
  entryCount: z.int().nonnegative(),
  /** Whether the viewer may enter: open, in date, and their tier allows it. */
  canEnter: z.boolean(),
  /** Their entry's slug, if they have one. One entry per member per challenge. */
  myEntrySlug: z.string().nullable(),
  /** Negative once it has ended; the UI says "closed" rather than counting up. */
  daysLeft: z.int(),
  winner: z
    .object({ winSlug: z.string(), title: z.string(), authorName: z.string() })
    .nullable(),
});
export type Challenge = z.infer<typeof Challenge>;

export const ChallengeDetail = Challenge.extend({
  entries: z.array(
    z.object({
      winSlug: z.string(),
      title: z.string(),
      authorName: z.string(),
      authorInitials: z.string(),
      reactions: z.int().nonnegative(),
      coverUrl: z.string().nullable(),
      createdAt: z.iso.datetime(),
      isWinner: z.boolean(),
    }),
  ),
});
export type ChallengeDetail = z.infer<typeof ChallengeDetail>;

export const ChallengeInput = z.object({
  slug: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, numbers and hyphens only'),
  title: z.string().trim().min(3).max(140),
  prompt: z.string().trim().min(8, 'One line a member could picture doing').max(200),
  briefMd: z.string().max(8000).nullable().default(null),
  startsOn: z.string(),
  endsOn: z.string(),
  minTier: Tier,
  status: z.enum(['draft', 'open', 'closed']).default('draft'),
});
export type ChallengeInput = z.infer<typeof ChallengeInput>;

/* ── Quizzes ─────────────────────────────────────────────────────────── */

/**
 * A lesson asking whether it landed.
 *
 * Note what is *not* in this shape: which option is correct. The member-facing
 * read cannot carry it, because the member-facing read is where an answer key
 * would leak — and in this case the database will not even return the column
 * (see the migration's column-level grant), so the type and the schema agree
 * about it rather than the type being a promise the API has to keep.
 */
export const QuizQuestion = z.object({
  id: z.uuid(),
  prompt: z.string(),
  options: z.array(z.object({ id: z.uuid(), label: z.string() })),
});
export type QuizQuestion = z.infer<typeof QuizQuestion>;

export const Quiz = z.object({
  lessonId: z.uuid(),
  questions: z.array(QuizQuestion),
  /** The member's most recent attempt, so the card can say "2 of 3 last time". */
  lastAttempt: z.object({ score: z.int(), total: z.int(), at: z.iso.datetime() }).nullable(),
  /** Whether they have ever got everything right. Drives the tick, and the XP. */
  everPerfect: z.boolean(),
});
export type Quiz = z.infer<typeof Quiz>;

/** Answers in; marks, the right answers, and the explanations out. */
export const QuizSubmission = z.object({
  answers: z
    .array(z.object({ questionId: z.uuid(), optionId: z.uuid().nullable() }))
    .min(1)
    .max(50),
});
export type QuizSubmission = z.infer<typeof QuizSubmission>;

export const QuizResult = z.object({
  score: z.int().nonnegative(),
  total: z.int().nonnegative(),
  marks: z.array(
    z.object({
      questionId: z.uuid(),
      correctOptionId: z.uuid().nullable(),
      chosenOptionId: z.uuid().nullable(),
      wasRight: z.boolean(),
      explanation: z.string().nullable(),
    }),
  ),
});
export type QuizResult = z.infer<typeof QuizResult>;

/** Authoring. One correct option per question — the form enforces it too. */
export const QuizQuestionInput = z.object({
  prompt: z.string().trim().min(5).max(500),
  explanation: z.string().trim().max(1000).nullable().default(null),
  options: z
    .array(z.object({ label: z.string().trim().min(1).max(200), isCorrect: z.boolean() }))
    .min(2, 'A question needs at least two options')
    .max(6),
}).refine((q) => q.options.filter((o) => o.isCorrect).length === 1, {
  message: 'Exactly one option has to be the right one',
  path: ['options'],
});
export type QuizQuestionInput = z.infer<typeof QuizQuestionInput>;

/** What an admin sees: the same question, with the answer showing. */
export const AdminQuizQuestion = z.object({
  id: z.uuid(),
  prompt: z.string(),
  explanation: z.string().nullable(),
  options: z.array(z.object({ id: z.uuid(), label: z.string(), isCorrect: z.boolean() })),
});
export type AdminQuizQuestion = z.infer<typeof AdminQuizQuestion>;

/* ── Events (M6) ─────────────────────────────────────────────────────── */

export const ClubEvent = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  descriptionMd: z.string().nullable(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  joinUrl: z.string().nullable(),
  rsvpd: z.boolean().default(false),
  rsvpCount: z.int().nonnegative().default(0),
  isFeaturedSession: z.boolean(),
  /**
   * The lesson this session's recording became, once an admin promotes it.
   * The last leg of the Think Tank loop: vote, session, and then the session
   * stops being an hour that happened and becomes something a member who
   * joined in March can still watch.
   */
  recordingLessonId: z.uuid().nullable().default(null),
  recordingCourseSlug: z.string().nullable().default(null),
  recordingLessonSlug: z.string().nullable().default(null),
  featuredInsights: z.array(z.object({ id: z.uuid(), slug: z.string(), title: z.string() })).default([]),
});
export type ClubEvent = z.infer<typeof ClubEvent>;

export const EventInput = z.object({
  slug,
  title: z.string().trim().min(3).max(140),
  descriptionMd: z.string().max(8000).nullable().default(null),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  joinUrl: z.string().url().nullable().default(null),
  minTier: Tier.default('free'),
  isFeaturedSession: z.boolean().default(false),
  insightIds: z.array(z.uuid()).max(10).default([]),
});
export type EventInput = z.infer<typeof EventInput>;

/* ── Moderation / audit / flags / directory ──────────────────────────── */

export const Report = z.object({
  id: z.uuid(),
  targetType: z.string(),
  targetId: z.uuid(),
  reason: z.string(),
  status: z.enum(['open', 'actioned', 'dismissed']),
  createdAt: z.iso.datetime(),
});
export type Report = z.infer<typeof Report>;

export const CreateReport = z.object({
  targetType: z.string().min(1),
  targetId: z.uuid(),
  reason: z.string().trim().min(4).max(1000),
});
export type CreateReport = z.infer<typeof CreateReport>;

export const AuditEntry = z.object({
  id: z.uuid(),
  actorName: z.string().nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const FeatureFlag = z.object({ key: z.string(), enabled: z.boolean() });
export type FeatureFlag = z.infer<typeof FeatureFlag>;

export const DirectoryMember = z.object({
  id: z.uuid(),
  fullName: z.string(),
  initials: z.string(),
  tier: Tier,
  city: z.string().nullable(),
  expertise: z.array(z.string()),
  bioMd: z.string().nullable(),
});
export type DirectoryMember = z.infer<typeof DirectoryMember>;

export const Badge = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string(),
  earned: z.boolean(),
  awardedAt: z.iso.datetime().nullable(),
});
export type Badge = z.infer<typeof Badge>;

/* ── LMS refinements ─────────────────────────────────────────────────── */

export const LessonResource = z.object({
  id: z.uuid(),
  title: z.string(),
  mime: z.string(),
  sizeBytes: z.int().nonnegative(),
  url: z.string(),
  downloadCount: z.int().nonnegative(),
});
export type LessonResource = z.infer<typeof LessonResource>;

export const LessonQuestion = z.object({
  id: z.uuid(),
  lessonId: z.uuid(),
  author: z.object({ name: z.string(), initials: z.string() }),
  bodyMd: z.string(),
  resolved: z.boolean(),
  mine: z.boolean(),
  createdAt: z.iso.datetime(),
  replies: z.array(z.object({
    id: z.uuid(), bodyMd: z.string(), authorName: z.string(), createdAt: z.iso.datetime(),
  })).default([]),
});
export type LessonQuestion = z.infer<typeof LessonQuestion>;

export const LessonNote = z.object({ lessonId: z.uuid(), bodyMd: z.string() });
export type LessonNote = z.infer<typeof LessonNote>;

export const Certificate = z.object({
  id: z.uuid(),
  /* Which course, not just its name. Without it nothing can ask "does this
     member already have one for *this* course", which is the only question the
     course-finished panel needs answered. */
  courseId: z.uuid().nullable(),
  courseTitle: z.string(),
  code: z.string(),
  issuedAt: z.iso.datetime(),
  url: z.string().nullable(),
});
export type Certificate = z.infer<typeof Certificate>;

/* ── Photolancer ─────────────────────────────────────────────────────── */

export const Brief = z.object({
  id: z.uuid(),
  title: z.string(),
  bodyMd: z.string(),
  city: z.string().nullable(),
  budgetPaise: z.int().nullable(),
  shootOn: z.string().nullable(),
  status: z.enum(['open', 'assigned', 'closed']),
  applicationCount: z.int().nonnegative().default(0),
  appliedByMe: z.boolean().default(false),
  createdAt: z.iso.datetime(),
});
export type Brief = z.infer<typeof Brief>;

export const CreateBrief = z.object({
  title: z.string().trim().min(8).max(140),
  bodyMd: z.string().trim().min(20).max(8000),
  city: z.string().max(80).nullable().default(null),
  budgetPaise: z.int().positive().nullable().default(null),
  shootOn: z.string().nullable().default(null),
});
export type CreateBrief = z.infer<typeof CreateBrief>;

export const TermsAccept = z.object({ version: z.string().min(1) });
export type TermsAccept = z.infer<typeof TermsAccept>;

export const CursorPage = z.object({ cursor: z.string().nullable(), limit: z.int().min(1).max(100).default(20) });
export type CursorPage = z.infer<typeof CursorPage>;

/* ── Members console (admin) ───────────────────────────────────────────────
   The club has hundreds of members and, until now, no way to look at one of
   them. Everything here is admin-only and read-mostly: the two writes are a
   manual tier grant and a suspension, both of which land in the audit log. */

export const MemberRisk = z.enum(['active', 'idle', 'stalled', 'dormant', 'never_started']);
export type MemberRisk = z.infer<typeof MemberRisk>;

export const AdminMember = z.object({
  id: z.uuid(),
  memberCode: z.string(),
  fullName: z.string(),
  initials: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  city: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  tier: Tier,
  role: Role,
  suspended: z.boolean(),
  joinedAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime().nullable(),
  xp: z.int().nonnegative(),
  lessonsCompleted: z.int().nonnegative(),
  coursesEnrolled: z.int().nonnegative(),
  coursesCompleted: z.int().nonnegative(),
  streakDays: z.int().nonnegative(),
  /**
   * Where this member is, in one word, so a roster of 849 can be triaged
   * without opening any of them.
   */
  risk: MemberRisk,
  /** Days since they last did anything. Null when they never have. */
  idleDays: z.int().nonnegative().nullable(),
});
export type AdminMember = z.infer<typeof AdminMember>;

export const AdminMemberPage = z.object({
  items: z.array(AdminMember),
  nextCursor: z.string().nullable(),
  /** Counts for the whole roster, not this page — the filter chips need them. */
  totals: z.object({
    all: z.int().nonnegative(),
    active: z.int().nonnegative(),
    idle: z.int().nonnegative(),
    stalled: z.int().nonnegative(),
    dormant: z.int().nonnegative(),
    neverStarted: z.int().nonnegative(),
    suspended: z.int().nonnegative(),
  }),
});
export type AdminMemberPage = z.infer<typeof AdminMemberPage>;

export const AdminMemberCourse = z.object({
  courseId: z.uuid(),
  title: z.string(),
  slug: z.string(),
  enrolledAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  lessonsTotal: z.int().nonnegative(),
  lessonsDone: z.int().nonnegative(),
  progress: z.int().min(0).max(100),
  lastLessonTitle: z.string().nullable(),
  lastActivityAt: z.iso.datetime().nullable(),
});
export type AdminMemberCourse = z.infer<typeof AdminMemberCourse>;

export const AdminMemberEvent = z.object({
  kind: z.string(),
  at: z.iso.datetime(),
  summary: z.string(),
});
export type AdminMemberEvent = z.infer<typeof AdminMemberEvent>;

export const AdminMemberDetail = AdminMember.extend({
  bio: z.string().nullable(),
  courses: z.array(AdminMemberCourse),
  /** Most recent first, capped — this is a timeline, not an export. */
  timeline: z.array(AdminMemberEvent),
  memberships: z.array(
    z.object({
      tier: Tier,
      status: z.string(),
      source: z.string(),
      startedAt: z.iso.datetime(),
      expiresAt: z.iso.datetime().nullable(),
    }),
  ),
});
export type AdminMemberDetail = z.infer<typeof AdminMemberDetail>;

export const GrantTier = z.object({
  tier: Tier,
  /** Months to grant. Null for a tier with no end, which admins rarely want. */
  months: z.int().positive().max(120).nullable().default(12),
  /** Free text, stored on the audit row. "Why" is the useful half of an audit. */
  reason: z.string().trim().min(3).max(300),
});
export type GrantTier = z.infer<typeof GrantTier>;

export const SetSuspended = z.object({
  suspended: z.boolean(),
  reason: z.string().trim().min(3).max(300),
});
export type SetSuspended = z.infer<typeof SetSuspended>;

/**
 * Changing what somebody is allowed to do.
 *
 * The most dangerous write in the application, so it carries a reason like a
 * suspension does — the audit log is the only record of why somebody has the
 * keys, and "who made this person an admin, and when" is a question that gets
 * asked exactly once, urgently.
 */
export const SetRole = z.object({
  role: z.enum(['member', 'instructor', 'admin']),
  reason: z.string().trim().min(3).max(300),
});
export type SetRole = z.infer<typeof SetRole>;

/* ── Member media uploads ────────────────────────────────────────────────
   Posts and wins share one shape. The browser asks for a ticket, PUTs the
   file straight at storage, then tells the API the key it used — the file
   never passes through a request worker. */

export const MediaTicket = z.object({
  key: z.string(),
  url: z.string(),
  token: z.string(),
  method: z.literal('PUT'),
});
export type MediaTicket = z.infer<typeof MediaTicket>;

export const AttachMedia = z.object({
  key: z.string().min(1).max(500),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  width: z.int().positive().max(20000).nullable().default(null),
  height: z.int().positive().max(20000).nullable().default(null),
});
export type AttachMedia = z.infer<typeof AttachMedia>;

/* ── Cohorts ─────────────────────────────────────────────────────────────
   A cohort is one start date shared by a group. Everything a schedule needs
   — which module opens when, who is behind, when to warn them — derives from
   that date, which is what makes it the highest-leverage thing one author can
   run. */

export const Cohort = z.object({
  id: z.uuid(),
  courseId: z.uuid(),
  courseTitle: z.string(),
  slug: z.string(),
  name: z.string(),
  /** A plain date, not a timestamp: a cohort starts on a day, not at a moment. */
  startsOn: z.string(),
  endsOn: z.string().nullable(),
  capacity: z.int().positive().nullable(),
  isOpen: z.boolean(),
  memberCount: z.int().nonnegative(),
  /** Mean completion across its members, 0–100. */
  averageProgress: z.int().min(0).max(100),
  createdAt: z.iso.datetime(),
});
export type Cohort = z.infer<typeof Cohort>;

export const CohortInput = z.object({
  courseId: z.uuid(),
  slug,
  name: z.string().trim().min(3).max(120),
  startsOn: z.string().min(8),
  endsOn: z.string().nullable().default(null),
  capacity: z.int().positive().max(10000).nullable().default(null),
  isOpen: z.boolean().default(true),
});
export type CohortInput = z.infer<typeof CohortInput>;

/** One member's standing inside a cohort, for the admin roster. */
export const CohortMember = z.object({
  userId: z.uuid(),
  fullName: z.string(),
  initials: z.string(),
  email: z.string().nullable(),
  joinedAt: z.iso.datetime(),
  progress: z.int().min(0).max(100),
  lessonsDone: z.int().nonnegative(),
  lessonsTotal: z.int().nonnegative(),
  lastActivityAt: z.iso.datetime().nullable(),
  /** True when their progress is behind what the schedule expects by today. */
  behind: z.boolean(),
});
export type CohortMember = z.infer<typeof CohortMember>;

export const CohortDetail = Cohort.extend({
  members: z.array(CohortMember),
  /** The drip timetable: which module opens on which date. */
  schedule: z.array(
    z.object({
      moduleId: z.uuid(),
      title: z.string(),
      opensOn: z.string().nullable(),
      lessonCount: z.int().nonnegative(),
    }),
  ),
});
export type CohortDetail = z.infer<typeof CohortDetail>;

/* ── Journeys ────────────────────────────────────────────────────────────
   Eighteen courses in a grid asks the newest member to design their own
   syllabus. A journey names an outcome and puts courses behind it in order.
   It recommends; it never locks — drip does the locking, and a sequence that
   refuses somebody who is already ahead teaches them the platform is in the
   way. */

export const JourneyStep = z.object({
  id: z.uuid(),
  courseId: z.uuid(),
  courseSlug: z.string(),
  courseTitle: z.string(),
  /** Why this course, here. The line that makes a list into a path. */
  note: z.string().nullable(),
  lessonCount: z.int().nonnegative(),
  durationMinutes: z.int().nonnegative(),
  /** This member's completion of that course, 0–100. */
  progress: z.int().min(0).max(100),
  completed: z.boolean(),
  /** False when the member's tier does not reach the course. */
  reachable: z.boolean(),
});
export type JourneyStep = z.infer<typeof JourneyStep>;

export const Journey = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  promise: z.string(),
  descriptionMd: z.string().nullable(),
  minTier: Tier,
  isPublished: z.boolean(),
  stepCount: z.int().nonnegative(),
  stepsDone: z.int().nonnegative(),
  /** Whole-journey completion, weighted by lessons rather than by step. */
  progress: z.int().min(0).max(100),
  /** The step to open next: the first unfinished one, or null when done. */
  nextCourseSlug: z.string().nullable(),
  nextCourseTitle: z.string().nullable(),
  /**
   * Whether the member has chosen this path.
   *
   * Distinct from having progress on it: finishing a course that happens to
   * sit on four journeys does not mean the member is following four paths.
   * Following is a decision, and it is the only thing that makes one journey
   * *theirs* out of the sixteen that are published.
   */
  following: z.boolean(),
  coverUrl: z.string().nullable().default(null),
  /** When they picked it, null if they have not. */
  startedAt: z.iso.datetime().nullable(),
  /** When the congratulation was sent. Only ever set for a followed path. */
  completedAt: z.iso.datetime().nullable(),
});
export type Journey = z.infer<typeof Journey>;

export const JourneyDetail = Journey.extend({
  steps: z.array(JourneyStep),
});
export type JourneyDetail = z.infer<typeof JourneyDetail>;

export const JourneyInput = z.object({
  slug,
  title: z.string().trim().min(3).max(140),
  promise: z.string().trim().min(8, 'Say the outcome, not the topic').max(200),
  descriptionMd: z.string().max(8000).nullable().default(null),
  minTier: Tier.default('free'),
  isPublished: z.boolean().default(false),
});
export type JourneyInput = z.infer<typeof JourneyInput>;

export const JourneyStepInput = z.object({
  courseId: z.uuid(),
  note: z.string().trim().max(300).nullable().default(null),
});
export type JourneyStepInput = z.infer<typeof JourneyStepInput>;

/* ── Onboarding ──────────────────────────────────────────────────────────
   The first week. Every step is derived from tables that already know the
   answer — posts, lesson_progress, enrollments, event_rsvps — so there is
   nothing to keep in sync and nothing that can go stale. */

export const OnboardingStep = z.object({
  key: z.enum(['profile', 'introduce', 'first_lesson', 'journey', 'session']),
  title: z.string(),
  hint: z.string(),
  /** Where the step is done. An in-app path, never an absolute URL. */
  href: z.string(),
  cta: z.string(),
  done: z.boolean(),
});
export type OnboardingStep = z.infer<typeof OnboardingStep>;

/** What a member may change about their own core profile. */
export const ProfilePatch = z.object({
  fullName: z.string().trim().min(2, 'Your name, as members will see it').max(80),
  city: z.string().trim().max(80).nullable().default(null),
});
export type ProfilePatch = z.infer<typeof ProfilePatch>;

export const Onboarding = z.object({
  steps: z.array(OnboardingStep),
  done: z.int().nonnegative(),
  total: z.int().nonnegative(),
  /** Set once, the first time every step is done. */
  completedAt: z.iso.datetime().nullable(),
  dismissed: z.boolean().default(false),
});
export type Onboarding = z.infer<typeof Onboarding>;

/* ── Public wins ─────────────────────────────────────────────────────────
   The one thing in this app a stranger may read. A deliberately thinner
   shape than `Win`: no reaction state, no comment count, no viewer context,
   because there is no viewer. Everything here is safe on an open page. */

export const PublicWin = z.object({
  slug: z.string(),
  title: z.string(),
  bigIdeaMd: z.string(),
  howItHappenedMd: z.string(),
  category: z.string(),
  occurredOn: z.string().nullable(),
  tags: z.array(z.string()),
  authorName: z.string(),
  media: z.array(MediaItem),
  createdAt: z.iso.datetime(),
});
export type PublicWin = z.infer<typeof PublicWin>;

/* ── Revenue ─────────────────────────────────────────────────────────────
   Money, in rupees. The database stores paise — ₹4,999.00 in a float is how
   you end up owing somebody a rupee — and the conversion happens once, in the
   response shape. Captured payments only: an order is an intention, and
   counting intentions as revenue overstates it by everybody who hesitated. */

export const RevenueOrder = z.object({
  id: z.uuid(),
  memberName: z.string(),
  memberEmail: z.string().nullable(),
  planName: z.string(),
  inr: z.int().nonnegative(),
  status: z.string(),
  /** Card, UPI, netbanking — whatever the provider reported. */
  method: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** Null until the money actually arrived. */
  capturedAt: z.iso.datetime().nullable(),
});
export type RevenueOrder = z.infer<typeof RevenueOrder>;

export const Revenue = z.object({
  thisMonthInr: z.int().nonnegative(),
  lastMonthInr: z.int().nonnegative(),
  allTimeInr: z.int().nonnegative(),
  payingMembers: z.int().nonnegative(),
  /** Null when nobody has paid yet — not ₹0, which would read as a real average. */
  averageOrderInr: z.int().nonnegative().nullable(),
  /** Started over an hour ago and never completed. Someone who wanted to buy. */
  pendingCheckouts: z.int().nonnegative(),
  failedCheckouts: z.int().nonnegative(),
  byPlan: z.array(
    z.object({
      name: z.string(),
      tier: Tier,
      sold: z.int().nonnegative(),
      inr: z.int().nonnegative(),
    }),
  ),
  daily: z.array(z.object({ day: z.string(), inr: z.int().nonnegative() })),
  recent: z.array(RevenueOrder),
});
export type Revenue = z.infer<typeof Revenue>;

/* ── A member, seen by another member ─────────────────────────────────────
   Deliberately thinner than the admin view and thinner than your own profile.
   No email, no phone, no member code, no XP, no risk band: those are either
   contact details somebody did not consent to publish, or operational numbers
   that would turn a directory into a leaderboard of who is falling behind. */

export const PublicMember = z.object({
  id: z.uuid(),
  fullName: z.string(),
  initials: z.string(),
  avatarUrl: z.string().nullable(),
  tier: Tier,
  city: z.string().nullable(),
  bioMd: z.string().nullable(),
  expertise: z.array(z.string()),
  joinedAt: z.iso.datetime(),
  /** Published wins only — the member's own proof, as the club sees it. */
  wins: z.array(z.object({ slug: z.string(), title: z.string(), createdAt: z.iso.datetime() })),
  /** True when this is you, so the page can offer Edit instead of Report. */
  isMe: z.boolean(),
});
export type PublicMember = z.infer<typeof PublicMember>;

/* ── My cohorts ───────────────────────────────────────────────────────────
   Cohorts have been gating the drip since they were built, and members had no
   way to see one: unlock notifications arrived for a schedule that existed
   nowhere in their interface. */

export const MyCohort = z.object({
  id: z.uuid(),
  name: z.string(),
  courseSlug: z.string(),
  courseTitle: z.string(),
  startsOn: z.string(),
  endsOn: z.string().nullable(),
  /** Which day of the cohort today is. Negative before it starts. */
  dayNumber: z.int(),
  memberCount: z.int().nonnegative(),
  progress: z.int().min(0).max(100),
  lessonsDone: z.int().nonnegative(),
  lessonsTotal: z.int().nonnegative(),
  /** The timetable, as the whole group sees it. */
  schedule: z.array(
    z.object({
      title: z.string(),
      opensOn: z.string().nullable(),
      lessonCount: z.int().nonnegative(),
      open: z.boolean(),
    }),
  ),
});
export type MyCohort = z.infer<typeof MyCohort>;

/** A win the member submitted, including the ones still in review. */
export const MySubmission = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  status: z.enum(['pending', 'published', 'hidden']),
  createdAt: z.iso.datetime(),
});
export type MySubmission = z.infer<typeof MySubmission>;
