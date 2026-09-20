import {
  ActivityDay,
  Badge,
  Brief,
  Certificate,
  ClubEvent,
  Comment,
  CreateBrief,
  CreateComment,
  CreatePost,
  CreateReport,
  DirectoryMember,
  EventInput,
  Insight,
  InsightDetail,
  LessonNote,
  LessonQuestion,
  LessonResource,
  LikeState,
  MembershipState,
  Notification,
  NotificationFeed,
  NotificationPrefs,
  OrderTicket,
  DeletionState,
  Channel,
  Course,
  CourseDetail,
  DashboardStats,
  FeatureFlag,
  LeaderboardRow,
  LibraryCategory,
  Member,
  Performance,
  PlaybackTicket,
  Post,
  ProgressUpdate,
  Report,
  SearchResults,
  ShareInsight,
  Solution,
  SubmitWin,
  Win,
  AuditEntry,
  Workshop,
} from '@ipc/contracts';
import { z } from 'zod';
import { accessToken } from './supabase.ts';

/**
 * Plain fetch + Zod parsing. Responses are validated at the boundary, so a
 * shape change in the API surfaces here rather than as a blank card.
 */
const BASE = import.meta.env.VITE_API_URL ?? '';

async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  // Bearer, never a cookie: the same client code works in a Capacitor WebView.
  const token = await accessToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      accept: 'application/json',
      'x-client': 'web',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    // The API answers with RFC 9457 problem+json, so surface its title.
    const body = (await res.json().catch(() => null)) as { title?: string } | null;
    throw new Error(body?.title ? `${body.title} (${res.status})` : `${res.status} ${res.statusText}`);
  }
  return schema.parse(await res.json());
}

const list = <T>(item: z.ZodType<T>) => z.object({ items: z.array(item) });

async function send<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  schema?: z.ZodType<T>,
): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-client': 'web',
      // A retry on a flaky connection must not create the thing twice.
      'idempotency-key': crypto.randomUUID(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const problem = (await res.json().catch(() => null)) as { title?: string; detail?: string } | null;
    throw new Error(problem?.detail ?? problem?.title ?? `${res.status} ${res.statusText}`);
  }
  // 204 has no body; parsing it would throw on a perfectly good response.
  if (res.status === 204) return undefined as T;
  const json = await res.json();
  return schema ? schema.parse(json) : (json as T);
}

export const api = {
  courses: (status?: string) =>
    get(`/v1/courses${status && status !== 'all' ? `?status=${status}` : ''}`, list(Course)).then((r) => r.items),
  workshops: (scope: 'upcoming' | 'completed' = 'upcoming') =>
    get(`/v1/workshops?scope=${scope}`, list(Workshop)).then((r) => r.items),
  channels: () => get('/v1/community/channels', list(Channel)).then((r) => r.items),
  posts: (channel?: string) =>
    get(`/v1/community/posts${channel ? `?channel=${channel}` : ''}`, list(Post)).then((r) => r.items),
  leaderboard: () => get('/v1/community/leaderboard', list(LeaderboardRow)).then((r) => r.items),
  libraryCategories: () => get('/v1/library/categories', list(LibraryCategory)).then((r) => r.items),
  course: (slug: string) => get(`/v1/courses/${slug}`, CourseDetail),
  playback: (lessonId: string) => get(`/v1/lessons/${lessonId}/playback`, PlaybackTicket),
  me: () => get('/v1/me', Member),
  activity: () => get('/v1/me/activity', list(ActivityDay)).then((r) => r.items),
  performance: () => get('/v1/me/performance', Performance),
  stats: () => get('/v1/me/stats', DashboardStats),
  search: (q: string) => get(`/v1/search?q=${encodeURIComponent(q)}`, SearchResults),

  createPost: (input: CreatePost) => send('POST', '/v1/community/posts', input, Post),
  markChannelRead: (slug: string) => send<void>('POST', `/v1/community/channels/${slug}/read`),
  setRegistration: (workshopId: string, registered: boolean) =>
    send<{ registered: boolean }>(
      registered ? 'POST' : 'DELETE',
      `/v1/workshops/${workshopId}/registration`,
    ),
  saveProgress: (lessonId: string, input: ProgressUpdate) =>
    send<{ lessonId: string; completed: boolean; courseProgress: number }>(
      'PUT',
      `/v1/lessons/${lessonId}/progress`,
      input,
    ),

  /* Engagement. Like and unlike are separate verbs rather than a toggle: a
     retried toggle flips twice, a retried POST lands on the same state. */
  likePost: (postId: string, liked: boolean) =>
    send(liked ? 'POST' : 'DELETE', `/v1/community/posts/${postId}/like`, undefined, LikeState),
  likeComment: (commentId: string, liked: boolean) =>
    send(liked ? 'POST' : 'DELETE', `/v1/community/comments/${commentId}/like`, undefined, LikeState),
  comments: (postId: string) =>
    get(`/v1/community/posts/${postId}/comments`, z.object({ items: z.array(Comment) })).then((r) => r.items),
  addComment: (postId: string, input: CreateComment) =>
    send('POST', `/v1/community/posts/${postId}/comments`, input, Comment),
  editComment: (commentId: string, bodyMd: string) =>
    send<{ id: string; bodyMd: string }>('PATCH', `/v1/community/comments/${commentId}`, { bodyMd }),
  deleteComment: (commentId: string) => send<void>('DELETE', `/v1/community/comments/${commentId}`),

  /* Notifications. */
  notifications: () => get('/v1/me/notifications', NotificationFeed),
  markNotificationsRead: (id?: string) =>
    send<{ unread: number }>('POST', `/v1/me/notifications/read${id ? `?id=${id}` : ''}`),
  prefs: () => get('/v1/me/prefs', NotificationPrefs),
  updatePrefs: (patch: Partial<NotificationPrefs>) =>
    send('PATCH', '/v1/me/prefs', patch, NotificationPrefs),
  registerPushToken: (token: string, platform: 'android' | 'ios' | 'web') =>
    send<{ registered: boolean }>('POST', '/v1/me/push-tokens', { token, platform }),

  /* Membership. There is deliberately no "confirm payment" call — the webhook
     grants the membership, and nothing the browser sends can shortcut it. */
  membership: () => get('/v1/billing/membership', MembershipState),
  createOrder: (planId: string) => send('POST', '/v1/billing/orders', { planId }, OrderTicket),

  deletionState: () => get('/v1/me/deletion', DeletionState),
  scheduleDeletion: (reason?: string) =>
    send('POST', '/v1/me/deletion', { confirm: 'DELETE', reason }, DeletionState),
  cancelDeletion: () => send('DELETE', '/v1/me/deletion', undefined, DeletionState),
  exportUrl: `${BASE}/v1/me/export`,

  /* Think Tank. Cursor pages: pass nextCursor back as cursor. */
  insights: (opts?: { cursor?: string; domain?: string }) =>
    get(`/v1/think-tank/insights?limit=20${opts?.cursor ? `&cursor=${opts.cursor}` : ''}${opts?.domain ? `&domain=${opts.domain}` : ''}`,
      z.object({ items: z.array(Insight), nextCursor: z.string().nullable() })),
  insight: (slug: string) => get(`/v1/think-tank/insights/${slug}`, InsightDetail),
  shareInsight: (input: ShareInsight) => send('POST', '/v1/think-tank/insights', input, z.object({ id: z.string(), slug: z.string() })),
  voteInsight: (id: string, voted: boolean) =>
    send(voted ? 'POST' : 'DELETE', `/v1/think-tank/insights/${id}/vote`, undefined, LikeState),
  solutions: (q: string) =>
    get(`/v1/think-tank/solutions?q=${encodeURIComponent(q)}`, z.object({ items: z.array(Solution) })).then((r) => r.items),
  saveBookmark: (targetType: string, targetId: string) => send('POST', '/v1/think-tank/bookmarks', { targetType, targetId }),
  removeBookmark: (targetType: string, targetId: string) => send<void>('DELETE', `/v1/think-tank/bookmarks/${targetType}/${targetId}`),

  /* Wins. */
  wins: (opts?: { cursor?: string; category?: string }) =>
    get(`/v1/wins?limit=20${opts?.cursor ? `&cursor=${opts.cursor}` : ''}${opts?.category ? `&category=${opts.category}` : ''}`,
      z.object({ items: z.array(Win), nextCursor: z.string().nullable() })),
  win: (slug: string) => get(`/v1/wins/${slug}`, Win),
  submitWin: (input: SubmitWin) => send('POST', '/v1/wins', input, z.object({ id: z.string(), slug: z.string() })),
  reactWin: (id: string, reacted: boolean) =>
    send(reacted ? 'POST' : 'DELETE', `/v1/wins/${id}/react`, undefined, LikeState),

  /* Events. */
  events: () => get('/v1/events', z.object({ items: z.array(ClubEvent) })).then((r) => r.items),
  rsvpEvent: (id: string, rsvpd: boolean) => send(rsvpd ? 'POST' : 'DELETE', `/v1/events/${id}/rsvp`),

  /* Photolancer. */
  briefs: () => get('/v1/photolancer/briefs', z.object({ items: z.array(Brief) })).then((r) => r.items),
  createBrief: (input: CreateBrief) => send('POST', '/v1/photolancer/briefs', input, z.object({ id: z.string() })),
  applyBrief: (id: string, pitchMd: string) =>
    send('POST', `/v1/photolancer/briefs/${id}/apply`, { bodyMd: pitchMd }),

  /* Directory + badges. */
  directory: (q?: string) =>
    get(`/v1/directory${q ? `?q=${encodeURIComponent(q)}` : ''}`, z.object({ items: z.array(DirectoryMember), nextCursor: z.string().nullable() })).then((r) => r.items),
  badges: () => get('/v1/directory/badges', z.object({ items: z.array(Badge) })).then((r) => r.items),
  updateDirectoryProfile: (patch: { bioMd?: string | null; expertise?: string[]; showInDirectory?: boolean }) =>
    send('PUT', '/v1/directory/me', patch),

  /* Learning refinements. */
  lessonQuestions: (lessonId: string) =>
    get(`/v1/learning/lessons/${lessonId}/questions`, z.object({ items: z.array(LessonQuestion) })).then((r) => r.items),
  askQuestion: (lessonId: string, bodyMd: string, parentId?: string) =>
    send('POST', `/v1/learning/lessons/${lessonId}/questions`, { bodyMd, parentId: parentId ?? null }),
  lessonNote: (lessonId: string) => get(`/v1/learning/lessons/${lessonId}/notes`, LessonNote),
  saveNote: (lessonId: string, bodyMd: string) => send('PUT', `/v1/learning/lessons/${lessonId}/notes`, { bodyMd }),
  lessonResources: (lessonId: string) =>
    get(`/v1/learning/lessons/${lessonId}/resources`, z.object({ items: z.array(LessonResource) })).then((r) => r.items),
  certificates: () => get('/v1/learning/certificates', z.object({ items: z.array(Certificate) })).then((r) => r.items),
  issueCertificate: (courseId: string) => send('POST', `/v1/learning/courses/${courseId}/certificate`),

  /* Moderation + legal + flags. */
  report: (input: CreateReport) => send('POST', '/v1/moderation/reports', input),
  reports: () => get('/v1/moderation/reports', z.object({ items: z.array(Report) })).then((r) => r.items),
  audit: () => get('/v1/moderation/audit', z.object({ items: z.array(AuditEntry) })).then((r) => r.items),
  flags: () => get('/v1/moderation/flags', z.object({ items: z.array(FeatureFlag) })).then((r) => r.items),
  acceptTerms: (version: string) => send('POST', '/v1/legal/terms', { version }),
  createEvent: (input: EventInput) => send('POST', '/v1/events', input),
};

/* Formatting helpers used across pages. */

export const hoursMinutes = (minutes: number) => ({
  hours: Math.floor(minutes / 60),
  minutes: minutes % 60,
});

/** mm:ss for the player and lesson lists. */
export const clock = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

export const durationLabel = (minutes: number) =>
  minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes}m`;

export const xpLabel = (xp: number) =>
  xp >= 100000 ? `${(xp / 100000).toFixed(xp % 100000 === 0 ? 0 : 2)}L` : `${Math.round(xp / 1000)}K`;

const IST = 'Asia/Kolkata';

export const timeRange = (startsAt: string, endsAt: string) => {
  const f = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: IST });
  return `${f.format(new Date(startsAt))} – ${f.format(new Date(endsAt))} IST`;
};

export const dayHeading = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: IST })
    .format(new Date(iso));

export const monthShort = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: IST }).format(new Date(iso)).toUpperCase();

export const dayNumber = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { day: '2-digit', timeZone: IST }).format(new Date(iso));

export const relativeTime = (iso: string) => {
  const diff = Date.now() - Date.parse(iso);
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
};
