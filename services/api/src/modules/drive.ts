import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../context.ts';
import * as drive from '../lib/google-drive.ts';
import { HttpError, problem } from '../lib/problem.ts';

/**
 * Google Drive, over HTTP.
 *
 * Two routers, because they have opposite trust:
 *
 *   - `adminDriveRoutes`, under /v1/admin/drive — behind `requireAdmin` like
 *     every other authoring route. Connecting, disconnecting, upload sessions
 *     and the Picker token.
 *   - `driveRoutes`, under /v1/drive — no session at all. The OAuth callback
 *     is a browser redirect from Google, and a media link is played by a
 *     `<video>` element that cannot send an Authorization header. Each one
 *     carries its own signed, expiring proof instead; see lib/google-drive.ts.
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

const who = (c: { get: (k: 'userId') => string | null }) => {
  const id = c.get('userId');
  if (!id) throw new HttpError(401, 'Not authenticated');
  return id;
};

/** Where the studio's Drive page lives, which the callback returns to. */
const STUDIO_PATH = '/admin/drive';

export const adminDriveRoutes = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await drive.driveStatus(c.env)))

  /** Starts the Google consent flow. The browser navigates to the URL returned. */
  .post('/connect', async (c) => {
    const returnTo = `${c.env.APP_URL.replace(/\/$/, '')}${STUDIO_PATH}`;
    return c.json({ url: await drive.authUrl(c.env, who(c), returnTo) });
  })

  .delete('/', async (c) => {
    await drive.disconnect(c.env);
    return c.body(null, 204);
  })

  /**
   * A short-lived access token for the Picker, in the admin's browser.
   *
   * Scoped `drive.file`, an hour long, admins only. It can reach files the app
   * created and files picked — the same set the API already serves — and the
   * Picker needs it to know whose Drive to show.
   */
  .post('/picker-token', async (c) => {
    const status = await drive.driveStatus(c.env);
    if (!status.connected) throw new HttpError(409, 'Google Drive is not connected');
    if (!c.env.GOOGLE_API_KEY || !c.env.GOOGLE_APP_ID) {
      throw new HttpError(503, 'The Drive picker is not set up', 'GOOGLE_API_KEY and GOOGLE_APP_ID must be set on the API.');
    }
    const { token, expiresAt } = await drive.accessToken(c.env);
    return c.json({
      accessToken: token,
      expiresAt: new Date(expiresAt).toISOString(),
      apiKey: c.env.GOOGLE_API_KEY,
      appId: c.env.GOOGLE_APP_ID,
      folderId: status.folderId,
    });
  })

  /** Opens a resumable upload into the club folder; the browser PUTs the file to `url`. */
  .post(
    '/uploads',
    zValidator(
      'json',
      z.object({
        filename: z.string().trim().min(1).max(255),
        mimeType: z.string().max(200).default('application/octet-stream'),
        size: z.number().int().positive().max(1024 ** 4 * 5),
      }),
      invalid as never,
    ),
    async (c) => {
      const input = c.req.valid('json');
      return c.json(await drive.createUploadSession(c.env, { ...input, origin: c.req.header('origin') ?? null }));
    },
  )

  /** What the app knows about a file — and whether it may reach it at all. */
  .get('/files/:id', async (c) => c.json(await drive.fileInfo(c.env, c.req.param('id'))));

export const driveRoutes = new Hono<AppEnv>()
  /**
   * Google sends the browser here after consent. Whatever happens, the browser
   * goes back to the studio with a result in the query string — a JSON error
   * page on the API's domain would strand the admin somewhere with no way back.
   */
  .get('/callback', async (c) => {
    const back = new URL(`${c.env.APP_URL.replace(/\/$/, '')}${STUDIO_PATH}`);
    const denied = c.req.query('error');
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (denied || !code || !state) {
      back.searchParams.set('drive', 'cancelled');
      return c.redirect(back.toString(), 302);
    }
    try {
      const returnTo = await drive.completeConnection(c.env, code, state);
      const to = new URL(returnTo);
      // Never redirect off the app: the signed state is ours, but belt and braces.
      if (to.origin !== back.origin) throw new HttpError(400, 'Bad return address');
      to.searchParams.set('drive', 'connected');
      return c.redirect(to.toString(), 302);
    } catch (error) {
      const message = error instanceof HttpError ? [error.title, error.detail].filter(Boolean).join(' — ') : 'Something went wrong';
      console.warn(JSON.stringify({ driveCallback: String(error) }));
      back.searchParams.set('drive', 'error');
      back.searchParams.set('message', message.slice(0, 300));
      return c.redirect(back.toString(), 302);
    }
  })

  .on(['GET', 'HEAD'], '/media/:token', async (c) => drive.relayMedia(c.env, c.req.param('token'), c.req.raw));
