import { describe, expect, test } from 'bun:test';
import { parseEnv } from '../services/api/src/env.ts';
import { mediaUrl, relayMedia, sign, verify } from '../services/api/src/lib/google-drive.ts';

/**
 * The signed links are the whole boundary around the club's Drive files.
 *
 * A media link is played by a `<video>` element that cannot carry a session,
 * so whoever holds the URL gets the bytes until it expires. These pin the
 * three ways that could go wrong: a forged link, an altered one, an old one.
 */

const env = parseEnv({ DRIVE_SECRET: 'test-secret-that-is-long-enough-123456', PUBLIC_API_URL: 'https://api.example' });
const other = parseEnv({ DRIVE_SECRET: 'a-different-secret-entirely-9876543210', PUBLIC_API_URL: 'https://api.example' });
const inAMinute = () => Math.floor(Date.now() / 1000) + 60;

describe('signed Drive links', () => {
  test('round-trips a payload', async () => {
    const token = await sign(env, { f: 'file_123456789', e: inAMinute() });
    expect(await verify<{ f: string; e: number }>(env, token)).toMatchObject({ f: 'file_123456789' });
  });

  test('refuses an expired link', async () => {
    const token = await sign(env, { f: 'file_123456789', e: Math.floor(Date.now() / 1000) - 1 });
    expect(await verify(env, token)).toBeNull();
  });

  test('refuses a link signed with another secret', async () => {
    const token = await sign(other, { f: 'file_123456789', e: inAMinute() });
    expect(await verify(env, token)).toBeNull();
  });

  test('refuses a link whose file id was swapped', async () => {
    const token = await sign(env, { f: 'file_123456789', e: inAMinute() });
    const [, sig] = token.split('.');
    const forged = btoa(JSON.stringify({ f: 'someone_elses_file', e: inAMinute() }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(await verify(env, `${forged}.${sig}`)).toBeNull();
  });

  test('refuses garbage without throwing', async () => {
    expect(await verify(env, 'not-a-token')).toBeNull();
    expect(await verify(env, '...')).toBeNull();
    expect(await verify(env, '')).toBeNull();
  });

  test('media URLs point at this API', async () => {
    const url = await mediaUrl(env, 'file_123456789', { ttlSeconds: 60 });
    expect(url.startsWith('https://api.example/v1/drive/media/')).toBe(true);
  });

  test('the relay answers 403 to a bad link before touching Google', async () => {
    const res = await relayMedia(env, 'forged.token', new Request('https://api.example/v1/drive/media/forged.token'));
    expect(res.status).toBe(403);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
