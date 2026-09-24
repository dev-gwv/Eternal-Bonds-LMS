import {
  AdminCourse,
  AdminCourseDetail,
  AdminLesson,
  AdminModule,
  AdminOverview,
  AdminMemberDetail,
  AdminMemberPage,
  AdminWorkshop,
  AdminQuizQuestion,
  Challenge,
  ChallengeDetail,
  Cohort,
  CohortDetail,
  Journey,
  JourneyDetail,
  LibraryCategory,
  LibraryItem,
  Revenue,
  UploadTicket,
  Viewer,
  type CourseInput,
  type ChallengeInput,
  type CohortInput,
  type JourneyInput,
  type JourneyStepInput,
  type LibraryCategoryInput,
  type LibraryItemInput,
  type LibraryItemPatch,
  type CoursePatch,
  type LessonInput,
  type LessonPatch,
  type GrantTier,
  type ModuleInput,
  type QuizQuestionInput,
  type SetSuspended,
  type WorkshopInput,
} from '@ipc/contracts';
import { z } from 'zod';

import { accessToken } from './supabase.ts';

/**
 * The studio's client.
 *
 * Kept apart from `api.ts` on purpose: these calls are only ever made by an
 * admin, they are the ones that can change what members see, and none of them
 * should be reachable by accident from a reader page.
 */
const BASE = import.meta.env.VITE_API_URL ?? '';

async function call<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  options: { body?: unknown; schema?: z.ZodType<T> } = {},
): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      'x-client': 'web',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      // A save that times out and gets retried must not create a second course.
      ...(method === 'GET' ? {} : { 'idempotency-key': crypto.randomUUID() }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!res.ok) {
    // problem+json carries the detail the studio shows next to the form.
    const problem = (await res.json().catch(() => null)) as { title?: string; detail?: string } | null;
    throw new Error(problem?.detail ?? problem?.title ?? `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;

  const json = await res.json();
  return options.schema ? options.schema.parse(json) : (json as T);
}

const list = <T>(item: z.ZodType<T>) => z.object({ items: z.array(item) });

export const adminApi = {
  overview: () => call('GET', '/v1/admin/overview', { schema: AdminOverview }),

  courses: () => call('GET', '/v1/admin/courses', { schema: list(AdminCourse) }).then((r) => r.items),
  course: (id: string) => call('GET', `/v1/admin/courses/${id}`, { schema: AdminCourseDetail }),
  createCourse: (body: CourseInput) => call('POST', '/v1/admin/courses', { body, schema: AdminCourse }),
  updateCourse: (id: string, body: CoursePatch) =>
    call('PATCH', `/v1/admin/courses/${id}`, { body, schema: AdminCourse }),
  publishCourse: (id: string, isPublished: boolean) =>
    call('POST', `/v1/admin/courses/${id}/publish`, { body: { isPublished }, schema: AdminCourse }),
  deleteCourse: (id: string) => call<void>('DELETE', `/v1/admin/courses/${id}`),

  createModule: (courseId: string, body: ModuleInput) =>
    call('POST', `/v1/admin/courses/${courseId}/modules`, { body, schema: AdminModule }),
  updateModule: (id: string, body: ModuleInput) =>
    call('PATCH', `/v1/admin/modules/${id}`, { body, schema: AdminModule }),
  deleteModule: (id: string) => call<void>('DELETE', `/v1/admin/modules/${id}`),
  reorderModules: (courseId: string, ids: string[]) =>
    call<void>('POST', `/v1/admin/courses/${courseId}/modules/order`, { body: { ids } }),

  createLesson: (moduleId: string, body: LessonInput) =>
    call('POST', `/v1/admin/modules/${moduleId}/lessons`, { body, schema: AdminLesson }),
  updateLesson: (id: string, body: LessonPatch) =>
    call('PATCH', `/v1/admin/lessons/${id}`, { body, schema: AdminLesson }),
  deleteLesson: (id: string) => call<void>('DELETE', `/v1/admin/lessons/${id}`),
  reorderLessons: (moduleId: string, ids: string[]) =>
    call<void>('POST', `/v1/admin/modules/${moduleId}/lessons/order`, { body: { ids } }),

  workshops: () => call('GET', '/v1/admin/workshops', { schema: list(AdminWorkshop) }).then((r) => r.items),
  createWorkshop: (body: WorkshopInput) => call('POST', '/v1/admin/workshops', { body, schema: AdminWorkshop }),
  updateWorkshop: (id: string, body: WorkshopInput) =>
    call('PATCH', `/v1/admin/workshops/${id}`, { body, schema: AdminWorkshop }),
  deleteWorkshop: (id: string) => call<void>('DELETE', `/v1/admin/workshops/${id}`),

  detachVideo: (lessonId: string) => call<void>('DELETE', `/v1/admin/lessons/${lessonId}/video`),
  /**
   * Attach a video that was not uploaded through us — today that means a
   * YouTube link. The server parses the URL, so the studio can pass whatever
   * the author pasted rather than making them extract an id by hand.
   */
  attachVideoLink: (lessonId: string, link: string) =>
    call('POST', `/v1/admin/lessons/${lessonId}/video`, { body: { key: link }, schema: AdminLesson }),

  /* The members console. Filters are server-side because the roster is the one
     list that will not fit in the browser — 849 today and growing. */
  members: (opts: { q?: string; risk?: string; tier?: string; cursor?: string } = {}) => {
    const p = new URLSearchParams();
    if (opts.q) p.set('q', opts.q);
    if (opts.risk && opts.risk !== 'all') p.set('risk', opts.risk);
    if (opts.tier && opts.tier !== 'all') p.set('tier', opts.tier);
    if (opts.cursor) p.set('cursor', opts.cursor);
    return call('GET', `/v1/admin/members?${p}`, { schema: AdminMemberPage });
  },
  member: (id: string) => call('GET', `/v1/admin/members/${id}`, { schema: AdminMemberDetail }),
  grantTier: (id: string, body: GrantTier) =>
    call('POST', `/v1/admin/members/${id}/tier`, { body, schema: AdminMemberDetail }),
  setSuspended: (id: string, body: SetSuspended) =>
    call('POST', `/v1/admin/members/${id}/suspension`, { body, schema: AdminMemberDetail }),

  /* Cohorts. One start date, and the schedule falls out of it. */
  revenue: (days = 90) => call('GET', `/v1/admin/revenue?days=${days}`, { schema: Revenue }),

  cohorts: () =>
    call('GET', '/v1/admin/cohorts', { schema: z.object({ items: z.array(Cohort) }) }).then((r) => r.items),
  cohort: (id: string) => call('GET', `/v1/admin/cohorts/${id}`, { schema: CohortDetail }),
  createCohort: (body: CohortInput) => call('POST', '/v1/admin/cohorts', { body, schema: Cohort }),
  updateCohort: (id: string, body: CohortInput) =>
    call('PATCH', `/v1/admin/cohorts/${id}`, { body, schema: Cohort }),
  deleteCohort: (id: string) => call<void>('DELETE', `/v1/admin/cohorts/${id}`),
  addCohortMembers: (id: string, userIds: string[]) =>
    call('POST', `/v1/admin/cohorts/${id}/members`, {
      body: { userIds },
      schema: z.object({ added: z.number(), skipped: z.number() }),
    }),
  removeCohortMember: (id: string, userId: string) =>
    call<void>('DELETE', `/v1/admin/cohorts/${id}/members/${userId}`),

  /* Journeys — sequencing, which is what eighteen courses in a grid lack. */
  journeys: () =>
    call('GET', '/v1/admin/journeys', { schema: z.object({ items: z.array(Journey) }) }).then((r) => r.items),
  journey: (slug: string) => call('GET', `/v1/admin/journeys/${slug}`, { schema: JourneyDetail }),
  createJourney: (body: JourneyInput) => call('POST', '/v1/admin/journeys', { body, schema: Journey }),
  updateJourney: (id: string, body: JourneyInput) =>
    call('PATCH', `/v1/admin/journeys/${id}`, { body, schema: Journey }),
  deleteJourney: (id: string) => call<void>('DELETE', `/v1/admin/journeys/${id}`),
  addJourneyStep: (id: string, body: JourneyStepInput) =>
    call<void>('POST', `/v1/admin/journeys/${id}/steps`, { body }),
  reorderJourneySteps: (id: string, ids: string[]) =>
    call<void>('POST', `/v1/admin/journeys/${id}/steps/order`, { body: { ids } }),
  removeJourneyStep: (stepId: string) => call<void>('DELETE', `/v1/admin/journeys/steps/${stepId}`),

  /* Challenges — a prompt with a deadline. Entries are wins, so there is
     nothing here for managing them; moderation already covers that. */
  challenges: () =>
    call('GET', '/v1/admin/challenges', { schema: z.object({ items: z.array(Challenge) }) }).then((r) => r.items),
  challenge: (slug: string) => call('GET', `/v1/admin/challenges/${slug}`, { schema: ChallengeDetail }),
  createChallenge: (body: ChallengeInput) => call('POST', '/v1/admin/challenges', { body, schema: Challenge }),
  updateChallenge: (id: string, body: ChallengeInput) =>
    call('PATCH', `/v1/admin/challenges/${id}`, { body, schema: Challenge }),
  pickChallengeWinner: (id: string, winSlug: string | null) =>
    call('POST', `/v1/admin/challenges/${id}/winner`, { body: { winSlug }, schema: Challenge }),
  deleteChallenge: (id: string) => call<void>('DELETE', `/v1/admin/challenges/${id}`),

  /* Quiz authoring. This is the only read in the app that returns which option
     is correct, and it goes through a definer function that checks is_admin()
     — the column is not granted to the role either side of that. */
  lessonQuiz: (lessonId: string) =>
    call('GET', `/v1/admin/lessons/${lessonId}/quiz`, {
      schema: z.object({ items: z.array(AdminQuizQuestion) }),
    }).then((r) => r.items),
  addQuizQuestion: (lessonId: string, body: QuizQuestionInput) =>
    call<void>('POST', `/v1/admin/lessons/${lessonId}/quiz`, { body }),
  deleteQuizQuestion: (id: string) => call<void>('DELETE', `/v1/admin/quiz-questions/${id}`),

  /* The library. Read-only until now, for everyone including the person whose
     job it is to fill it. */
  libraryCategories: () =>
    call('GET', '/v1/admin/library/categories', {
      schema: z.object({ items: z.array(LibraryCategory) }),
    }).then((r) => r.items),
  createLibraryCategory: (body: LibraryCategoryInput) =>
    call('POST', '/v1/admin/library/categories', { body, schema: LibraryCategory }),
  updateLibraryCategory: (id: string, body: LibraryCategoryInput) =>
    call<void>('PATCH', `/v1/admin/library/categories/${id}`, { body }),
  deleteLibraryCategory: (id: string) => call<void>('DELETE', `/v1/admin/library/categories/${id}`),

  libraryItems: (categoryId?: string) =>
    call('GET', `/v1/admin/library/items${categoryId ? `?categoryId=${categoryId}` : ''}`, {
      schema: z.object({ items: z.array(LibraryItem) }),
    }).then((r) => r.items),
  createLibraryItem: (body: LibraryItemInput) =>
    call('POST', '/v1/admin/library/items', { body, schema: LibraryItem }),
  updateLibraryItem: (id: string, body: LibraryItemPatch) =>
    call<void>('PATCH', `/v1/admin/library/items/${id}`, { body }),
  deleteLibraryItem: (id: string) => call<void>('DELETE', `/v1/admin/library/items/${id}`),
};

/**
 * A library file, browser to storage, without passing through this process.
 *
 * Same shape as the lesson video and course cover paths: the API signs a URL,
 * the bytes go direct, and only the key comes back here. A 40MB PDF never
 * occupies a request worker.
 */
export async function uploadLibraryFile(file: File): Promise<{ key: string; mime: string }> {
  const ticket = await call('POST', '/v1/admin/library/items/upload-ticket', {
    body: { filename: file.name },
    schema: UploadTicket,
  });
  const put = await fetch(ticket.url, {
    method: ticket.method,
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!put.ok) throw new Error(`Storage refused the upload (${put.status})`);
  return { key: ticket.key, mime: file.type || 'application/octet-stream' };
}

/** Anonymous is a normal answer here, not an error — the shell asks on load. */
export async function fetchViewer(): Promise<Viewer> {
  try {
    return await call('GET', '/v1/me/viewer', { schema: Viewer });
  } catch {
    return { userId: null, role: 'member', tier: 'free', canAuthor: false, videoProvider: 'none' };
  }
}

/**
 * Uploads a video straight from the browser to wherever it belongs, then tells
 * the API where it landed.
 *
 * "Wherever it belongs" is the server's decision, not this file's: the ticket
 * carries the URL, the method and any headers, so adding a provider never
 * means touching the browser. With `VIDEO_PROVIDER=none` that is a signed
 * Supabase Storage PUT; with Cloudflare Stream it is a multipart POST to a
 * one-off upload URL.
 *
 * Deliberately XHR and not fetch: XHR is still the only way to get upload
 * progress, and a two-hour upload with no progress bar is one a person
 * cancels.
 */
export async function uploadLessonVideo(
  lessonId: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<AdminLesson> {
  const ticket = await call('POST', `/v1/admin/lessons/${lessonId}/upload`, {
    body: { filename: file.name },
    schema: UploadTicket,
  });

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(ticket.method, ticket.url);

    // The signed URL or the ticket headers carry their own authorisation. The
    // session token is never sent to a third party.
    for (const [name, value] of Object.entries(ticket.headers)) xhr.setRequestHeader(name, value);

    let payload: XMLHttpRequestBodyInit = file;
    if (ticket.method === 'PUT') {
      xhr.setRequestHeader('content-type', file.type || 'video/mp4');
    } else {
      // Cloudflare Stream's direct-upload endpoint expects multipart, with the
      // file under `file`. Sending the raw body there returns a 400 that reads
      // like an auth failure, which is a bad hour to spend.
      const form = new FormData();
      form.append('file', file, file.name);
      payload = form;
    }

    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`The upload was rejected (${xhr.status}). Try again, or use a smaller file.`));
    xhr.onerror = () => reject(new Error('The upload failed. Check the connection and try again.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    xhr.send(payload);
  });

  // Read from the file rather than asking anyone to type it. A provider that
  // probes the real duration overrides this later.
  const durationSeconds = await probeDuration(file).catch(() => undefined);
  return call('POST', `/v1/admin/lessons/${lessonId}/video`, {
    body: { key: ticket.key, durationSeconds },
    schema: AdminLesson,
  });
}

/**
 * Reads the real duration out of the file itself, so nobody has to type it and
 * the lesson list cannot disagree with the player.
 */
function probeDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      Number.isFinite(video.duration) ? resolve(Math.round(video.duration)) : reject(new Error('No duration'));
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read the file'));
    };
    video.src = url;
  });
}
