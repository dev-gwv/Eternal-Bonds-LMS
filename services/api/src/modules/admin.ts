import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  AttachVideo,
  CourseInput,
  CoursePatch,
  LessonInput,
  LessonPatch,
  ModuleInput,
  QuizQuestionInput,
  ReorderInput,
  WorkshopInput,
} from '@ipc/contracts';
import type { AppEnv } from '../context.ts';
import * as studio from '../admin.ts';
import { getRevenue } from '../revenue.ts';
import { problem } from '../lib/problem.ts';
import { requireAdmin } from '../middleware/auth.ts';
import { cohortRoutes } from './cohorts.ts';
import { adminJourneyRoutes } from './journeys.ts';
import { adminChallengeRoutes } from './challenges.ts';
import { membersRoutes } from './members.ts';
import { adminLibraryRoutes } from './library-admin.ts';
import { attachVideo, createUploadTicket, detachVideo } from '../video.ts';

/**
 * The authoring API.
 *
 * Mounted at /v1/admin behind `requireAdmin`, and every handler underneath
 * also runs its query under RLS as the calling admin. Two locks, because this
 * is the surface that can make content visible to paying members.
 *
 * Validation failures answer 422 with the field path, so the studio can put
 * the message next to the input rather than in a toast.
 */

const invalid = (result: { success: boolean; error?: z.ZodError }, c: never) => {
  if (result.success) return undefined;
  const first = result.error?.issues[0];
  return problem(
    c as never,
    422,
    'That does not look right',
    first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Check the fields and try again.',
  );
};

const body = <T extends z.ZodType>(schema: T) => zValidator('json', schema, invalid as never);

/** The admin's own id — present because requireAdmin already rejected nulls. */
const who = (c: { get: (k: 'userId') => string | null }) => c.get('userId') ?? 'seed-admin';

export const adminRoutes = new Hono<AppEnv>()
  .use('*', requireAdmin)

  // The members console. Its own module because it is a different job from
  // authoring: this is about people, not content.
  .route('/members', membersRoutes)

  // Scheduling. Its own module again: a cohort is about *when*, which is a
  // third job alongside content and people.
  .route('/cohorts', cohortRoutes)

  // Sequencing. What to do first, which is the question eighteen courses in a
  // grid cannot answer.
  .route('/journeys', adminJourneyRoutes)

  // The library. Its tables have had admin-write policies since the first auth
  // migration and there was no endpoint between them and the author, so the
  // section could never hold anything the seed script had not put there.
  .route('/library', adminLibraryRoutes)

  // Prompts with deadlines. The wins board has always existed and nothing ever
  // asked anybody to use it.
  .route('/challenges', adminChallengeRoutes)


  .get('/overview', async (c) => c.json(await studio.overview(c.env, who(c))))

  // Money. Captured payments only — see revenue.ts for why orders are not it.
  .get('/revenue', async (c) =>
    c.json(await getRevenue(c.env, who(c), Math.min(365, Math.max(7, Number(c.req.query('days') ?? 90))))),
  )

  /* ── Courses ──────────────────────────────────────────────────────────── */
  .get('/courses', async (c) => c.json({ items: await studio.listAdminCourses(c.env, who(c)) }))
  .post('/courses', body(CourseInput), async (c) =>
    c.json(await studio.createCourse(c.env, who(c), c.req.valid('json')), 201),
  )
  .get('/courses/:id', async (c) => c.json(await studio.getAdminCourse(c.env, who(c), c.req.param('id'))))
  .patch('/courses/:id', body(CoursePatch), async (c) =>
    c.json(await studio.updateCourse(c.env, who(c), c.req.param('id'), c.req.valid('json'))),
  )
  // Publishing is its own verb: a different act from saving, with its own checks.
  .post('/courses/:id/publish', body(z.object({ isPublished: z.boolean() })), async (c) =>
    c.json(
      await studio.setCoursePublished(c.env, who(c), c.req.param('id'), c.req.valid('json').isPublished),
    ),
  )
  .delete('/courses/:id', async (c) => {
    await studio.deleteCourse(c.env, who(c), c.req.param('id'));
    return c.body(null, 204);
  })
  .post('/courses/:id/modules', body(ModuleInput), async (c) =>
    c.json(await studio.createModule(c.env, who(c), c.req.param('id'), c.req.valid('json')), 201),
  )
  .post('/courses/:id/modules/order', body(ReorderInput), async (c) => {
    await studio.reorder(c.env, who(c), 'modules', c.req.param('id'), c.req.valid('json').ids);
    return c.body(null, 204);
  })

  /* ── Modules ──────────────────────────────────────────────────────────── */
  .patch('/modules/:id', body(ModuleInput), async (c) =>
    c.json(await studio.updateModule(c.env, who(c), c.req.param('id'), c.req.valid('json'))),
  )
  .delete('/modules/:id', async (c) => {
    await studio.deleteModule(c.env, who(c), c.req.param('id'));
    return c.body(null, 204);
  })
  .post('/modules/:id/lessons', body(LessonInput), async (c) =>
    c.json(await studio.createLesson(c.env, who(c), c.req.param('id'), c.req.valid('json')), 201),
  )
  .post('/modules/:id/lessons/order', body(ReorderInput), async (c) => {
    await studio.reorder(c.env, who(c), 'lessons', c.req.param('id'), c.req.valid('json').ids);
    return c.body(null, 204);
  })

  /* ── Lessons ──────────────────────────────────────────────────────────── */
  .patch('/lessons/:id', body(LessonPatch), async (c) =>
    c.json(await studio.updateLesson(c.env, who(c), c.req.param('id'), c.req.valid('json'))),
  )
  .delete('/lessons/:id', async (c) => {
    await studio.deleteLesson(c.env, who(c), c.req.param('id'));
    return c.body(null, 204);
  })

  /* ── Video ────────────────────────────────────────────────────────────────
     The file goes browser → storage directly. This process only signs the URL
     and records the key, so an upload never occupies a request worker. */
  .post(
    '/lessons/:id/upload',
    body(z.object({ filename: z.string().min(1).max(255) })),
    async (c) => c.json(await createUploadTicket(c.env, who(c), c.req.param('id'), c.req.valid('json').filename)),
  )
  .post('/lessons/:id/video', body(AttachVideo), async (c) =>
    c.json(await attachVideo(c.env, who(c), c.req.param('id'), c.req.valid('json'))),
  )
  .delete('/lessons/:id/video', async (c) => {
    await detachVideo(c.env, who(c), c.req.param('id'));
    return c.body(null, 204);
  })

  /* ── Quizzes ──────────────────────────────────────────────────────────────
     Authoring only. `is_correct` is readable here because an admin holds the
     table-wide grant the member role does not — an author cannot check a
     question without being able to see its answer. */
  .get('/lessons/:id/quiz', async (c) => {
    const { listAdminQuiz } = await import('../quizzes.ts');
    return c.json({ items: await listAdminQuiz(c.env, who(c), c.req.param('id')) });
  })
  .post('/lessons/:id/quiz', body(QuizQuestionInput), async (c) => {
    const { addQuestion } = await import('../quizzes.ts');
    await addQuestion(c.env, who(c), c.req.param('id'), c.req.valid('json'));
    return c.body(null, 204);
  })
  .delete('/quiz-questions/:id', async (c) => {
    const { deleteQuestion } = await import('../quizzes.ts');
    await deleteQuestion(c.env, who(c), c.req.param('id'));
    return c.body(null, 204);
  })

  /* ── Course cover ─────────────────────────────────────────────────────────
     Same two-step as every other image in the app: ticket, direct upload,
     then record. The card falls back to a gradient when there is none, so a
     failed upload degrades rather than breaks. */
  .post(
    '/courses/:id/cover-ticket',
    body(z.object({ mime: z.enum(['image/jpeg', 'image/png', 'image/webp']) })),
    async (c) => {
      const { createStorage } = await import('../lib/storage.ts');
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[c.req.valid('json').mime];
      const key = `covers/${c.req.param('id')}/${crypto.randomUUID()}.${ext}`;
      const { url, token } = await createStorage(c.env).signedUploadUrl(key);
      return c.json({ key, url, token, method: 'PUT' as const });
    },
  )
  .post('/courses/:id/cover', body(z.object({ key: z.string().min(1).max(500) })), async (c) =>
    c.json(await studio.setCourseCover(c.env, who(c), c.req.param('id'), c.req.valid('json').key)),
  )
  .delete('/courses/:id/cover', async (c) =>
    c.json(await studio.setCourseCover(c.env, who(c), c.req.param('id'), null)),
  )

  /* ── Workshops ────────────────────────────────────────────────────────── */
  .get('/workshops', async (c) => c.json({ items: await studio.listAdminWorkshops(c.env, who(c)) }))
  .post('/workshops', body(WorkshopInput), async (c) =>
    c.json(await studio.createWorkshop(c.env, who(c), c.req.valid('json')), 201),
  )
  .patch('/workshops/:id', body(WorkshopInput), async (c) =>
    c.json(await studio.updateWorkshop(c.env, who(c), c.req.param('id'), c.req.valid('json'))),
  )
  .delete('/workshops/:id', async (c) => {
    await studio.deleteWorkshop(c.env, who(c), c.req.param('id'));
    return c.body(null, 204);
  });
