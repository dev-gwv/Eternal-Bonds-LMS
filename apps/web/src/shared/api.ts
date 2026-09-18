import {
  ActivityDay,
  Comment,
  CreateComment,
  CreatePost,
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
  LeaderboardRow,
  LibraryCategory,
  Member,
  Performance,
  PlaybackTicket,
  Post,
  ProgressUpdate,
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

  createPost: (input: CreatePost) => send('POST', '/v1/community/posts', input, Post),
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
