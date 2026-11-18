import { describe, expect, test } from 'bun:test';
import { parseEnv } from '../services/api/src/env.ts';
import { signToken, verifyToken } from '../services/api/src/lib/signed.ts';
import { presign } from '../services/api/src/lib/r2.ts';
import {
  hlsPlaybackUrl,
  joinKey,
  partPlan,
  rewritePlaylist,
  servePlaylist,
  transcoderAuthorized,
} from '../services/api/src/r2-video.ts';

/**
 * R2 video: the pieces that are pure enough to pin without a bucket.
 *
 * The signed playback link is the only thing between the internet and the
 * club's course videos, the playlist rewrite decides which objects a holder of
 * that link can reach, and the transcoder secret guards the queue.
 */

const env = parseEnv({
  R2_ACCOUNT_ID: 'acct123',
  R2_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  R2_SECRET_ACCESS_KEY: 'secret-key-that-is-long-enough-0123456789',
  R2_BUCKET: 'eb-videos',
  TRANSCODER_SECRET: 'transcoder-secret-0123456789abcdef',
  PUBLIC_API_URL: 'https://api.example',
});
const asset = '0f8fad5b-d9cb-469f-a165-70867728950e';
const inAMinute = () => Math.floor(Date.now() / 1000) + 60;

describe('signed tokens', () => {
  test('round-trip, and refuse another label or secret', async () => {
    const token = await signToken('s3cret-value', 'a', { x: 1, e: inAMinute() });
    expect(await verifyToken('s3cret-value', 'a', token)).toMatchObject({ x: 1 });
    expect(await verifyToken('s3cret-value', 'b', token)).toBeNull();
    expect(await verifyToken('other-secret', 'a', token)).toBeNull();
  });

  test('refuse expired and malformed', async () => {
    const old = await signToken('s3cret-value', 'a', { e: Math.floor(Date.now() / 1000) - 5 });
    expect(await verifyToken('s3cret-value', 'a', old)).toBeNull();
    expect(await verifyToken('s3cret-value', 'a', 'nope')).toBeNull();
    expect(await verifyToken('s3cret-value', 'a', `${old}.extra`)).toBeNull();
  });
});

describe('multipart plan', () => {
  test('64MB parts for ordinary files', () => {
    expect(partPlan(1)).toEqual({ partSize: 64 * 1024 * 1024, partCount: 1 });
    expect(partPlan(1024 ** 3).partCount).toBe(16);
  });
  test('never more than 10,000 parts', () => {
    expect(partPlan(1024 ** 4).partCount).toBeLessThanOrEqual(10_000);
  });
});

describe('playlist rewrite', () => {
  test('signs segments and init sections, leaves variant playlists relative', async () => {
    const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720\n720p/index.m3u8\n';
    expect(await rewritePlaylist(master, async (r) => `SIGNED(${r})`)).toContain('\n720p/index.m3u8');

    const media = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6.0,\nseg00001.ts\n#EXT-X-ENDLIST\n';
    const out = await rewritePlaylist(media, async (r) => `SIGNED(${r})`);
    expect(out).toContain('#EXT-X-MAP:URI="SIGNED(init.mp4)"');
    expect(out).toContain('\nSIGNED(seg00001.ts)\n');
    expect(out).toContain('#EXT-X-ENDLIST');
  });

  test('joins keys under the playlist and refuses climbing out', () => {
    expect(joinKey('720p/index.m3u8', 'seg00001.ts')).toBe('720p/seg00001.ts');
    expect(joinKey('master.m3u8', 'poster.jpg')).toBe('poster.jpg');
    expect(joinKey('720p/index.m3u8', '../../other/seg.ts')).toBeNull();
  });
});

describe('playback link', () => {
  test('a valid link reaches only playlists of its own asset', async () => {
    const url = await hlsPlaybackUrl(env, asset, 60);
    expect(url.startsWith('https://api.example/v1/media/hls/')).toBe(true);
    const token = url.split('/v1/media/hls/')[1]!.split('/')[0]!;
    // Anything that is not a playlist is refused before storage is touched.
    expect((await servePlaylist(env, token, 'seg00001.ts')).status).toBe(404);
    expect((await servePlaylist(env, token, '../x/master.m3u8')).status).toBe(404);
  });

  test('a forged or expired link is refused', async () => {
    const forged = await signToken('a-different-secret-entirely', 'hls-playback', { a: asset, e: inAMinute() });
    expect((await servePlaylist(env, forged, 'master.m3u8')).status).toBe(403);
    const expired = await signToken(env.R2_SECRET_ACCESS_KEY, 'hls-playback', { a: asset, e: 1 });
    expect((await servePlaylist(env, expired, 'master.m3u8')).status).toBe(403);
  });
});

describe('presigned R2 URLs', () => {
  test('point at the bucket and carry a signature and expiry', async () => {
    const url = new URL(await presign(env, `hls/${asset}/720p/seg00001.ts`, { ttlSeconds: 600 }));
    expect(url.host).toBe('acct123.r2.cloudflarestorage.com');
    expect(url.pathname).toBe(`/eb-videos/hls/${asset}/720p/seg00001.ts`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('transcoder secret', () => {
  test('accepts only the exact bearer', () => {
    expect(transcoderAuthorized(env, `Bearer ${env.TRANSCODER_SECRET}`)).toBe(true);
    expect(transcoderAuthorized(env, 'Bearer nope')).toBe(false);
    expect(transcoderAuthorized(env, undefined)).toBe(false);
    expect(transcoderAuthorized(parseEnv({ TRANSCODER_SECRET: '' }), 'Bearer ')).toBe(false);
  });
});
