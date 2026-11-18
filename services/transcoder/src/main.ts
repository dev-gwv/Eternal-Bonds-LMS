import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { AwsClient } from 'aws4fetch';
import { buildFfmpegArgs, ladderFor, parseProgress, type Probe } from './ladder.ts';

/**
 * The club's video transcoder. Runs on the VPS, in Docker.
 *
 * Loop: ask the API for a job → download the original from R2 → ffmpeg it to
 * an HLS ladder (360p/720p/1080p, never above the source) → upload the result
 * beside it in R2 → tell the API it is done. One job at a time: ffmpeg already
 * uses every core, and two at once only makes both slower.
 *
 * It never talks to the database. If it crashes mid-job the API's lease runs
 * out and the job comes back; three failures and the lesson shows the error.
 */

const env = (name: string, fallback?: string) => {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`${name} is not set`);
  return v;
};

const API = env('API_URL').replace(/\/$/, '');
const SECRET = env('TRANSCODER_SECRET');
const BUCKET = env('R2_BUCKET', 'eb-videos');
const ACCOUNT = env('R2_ACCOUNT_ID');
const WORK = env('WORK_DIR', '/work');
const PRESET = env('X264_PRESET', 'veryfast');
const THREADS = env('FFMPEG_THREADS', '0');
const POLL_MS = 15_000;

const r2 = new AwsClient({
  accessKeyId: env('R2_ACCESS_KEY_ID'),
  secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
  service: 's3',
  region: 'auto',
});
// R2_ENDPOINT is only for testing against a local stand-in; R2 itself needs nothing here.
const bucketUrl = `${process.env.R2_ENDPOINT?.replace(/\/$/, '') || `https://${ACCOUNT}.r2.cloudflarestorage.com`}/${BUCKET}`;
const objectUrl = (key: string) => `${bucketUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;

type Job = {
  id: string;
  kind: 'transcode' | 'delete';
  assetId: string;
  attempt: number;
  sourceUrl: string | null;
  sourceBytes: number | null;
  outputPrefix: string;
};

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

/** A failure that retrying cannot fix: the file itself is the problem. */
class Permanent extends Error {}
/** The API took the job away (replaced, or given up) — stop quietly. */
class Cancelled extends Error {}

async function api<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`${API}/v1/transcoder${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) throw new Error(`API ${path} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function retry<T>(what: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      if (error instanceof Permanent || error instanceof Cancelled) throw error;
      await Bun.sleep(1000 * 2 ** i);
    }
  }
  throw new Error(`${what}: ${String(last)}`);
}

/* ── Progress / heartbeat ─────────────────────────────────────────────── */

function heartbeat(jobId: string) {
  let percent = 0;
  let cancelled = false;
  const tick = async () => {
    try {
      const { keepGoing } = await api<{ keepGoing: boolean }>(`/jobs/${jobId}/progress`, { percent });
      if (!keepGoing) cancelled = true;
    } catch (error) {
      // A missed heartbeat is not fatal; the lease is two minutes long.
      log('heartbeat failed', { error: String(error) });
    }
  };
  const timer = setInterval(tick, 20_000);
  void tick();
  return {
    set: (p: number) => {
      percent = Math.max(percent, Math.min(99, p));
    },
    get cancelled() {
      return cancelled;
    },
    stop: () => clearInterval(timer),
  };
}

/* ── Transcode ────────────────────────────────────────────────────────── */

async function probe(file: string): Promise<Probe> {
  const proc = Bun.spawn(['ffprobe', '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if ((await proc.exited) !== 0) throw new Permanent(`This file could not be read as a video (${err.trim().slice(0, 200)})`);
  const data = JSON.parse(out) as {
    streams?: { codec_type?: string; width?: number; height?: number; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[];
    format?: { duration?: string };
  };
  const video = data.streams?.find((s) => s.codec_type === 'video' && s.width && s.height);
  if (!video) throw new Permanent('This file has no video in it');
  const rotation = Math.abs(Number(video.tags?.rotate ?? video.side_data_list?.[0]?.rotation ?? 0)) % 180;
  // Phones store portrait video as landscape plus a rotation flag; ffmpeg
  // applies the rotation, so the ladder has to be chosen on the turned size.
  const [width, height] = rotation === 90 ? [video.height!, video.width!] : [video.width!, video.height!];
  return {
    width,
    height,
    durationSeconds: Number(data.format?.duration ?? 0) || 0,
    hasAudio: Boolean(data.streams?.some((s) => s.codec_type === 'audio')),
  };
}

async function download(url: string, to: string, beat: ReturnType<typeof heartbeat>, size: number | null) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download answered ${res.status}`);
  const writer = Bun.file(to).writer();
  let got = 0;
  for await (const chunk of res.body) {
    writer.write(chunk);
    got += chunk.byteLength;
    // Download is the first tenth of the bar.
    if (size) beat.set((got / size) * 10);
    if (beat.cancelled) {
      await writer.end();
      throw new Cancelled();
    }
  }
  await writer.end();
}

async function runFfmpeg(args: string[], durationSeconds: number, beat: ReturnType<typeof heartbeat>, cwd?: string) {
  const proc = Bun.spawn(['ffmpeg', ...args], { stdout: 'pipe', stderr: 'pipe', cwd });
  const errTail: string[] = [];
  const stderr = (async () => {
    for await (const chunk of proc.stderr) {
      errTail.push(new TextDecoder().decode(chunk));
      if (errTail.length > 400) errTail.shift();
    }
  })();
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of proc.stdout) {
    buffer += decoder.decode(chunk);
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const seconds = parseProgress(line);
      // Encoding is 10%–90% of the bar.
      if (seconds !== null && durationSeconds > 0) beat.set(10 + (seconds / durationSeconds) * 80);
    }
    if (beat.cancelled) {
      proc.kill();
      throw new Cancelled();
    }
  }
  const code = await proc.exited;
  await stderr;
  // Set FFMPEG_LOG=/work/ffmpeg.log to keep ffmpeg's full output for debugging.
  if (process.env.FFMPEG_LOG) await Bun.write(process.env.FFMPEG_LOG, `${args.join(' ')}\n\n${errTail.join('')}`);
  if (code !== 0) {
    // ffmpeg ends with encoder statistics; the line that says what went wrong
    // is earlier. Report that one, and the last few lines for context.
    const lines = errTail.join('').split(/\r?\n/).filter((l) => l.trim() && !/^\[(libx264|aac) @/.test(l));
    const cause = lines.find((l) => /error|denied|invalid|no such|unable|failed to/i.test(l) && !/^Conversion failed/.test(l));
    throw new Error(`ffmpeg exited ${code}: ${(cause ?? lines.slice(-3).join(' | ')).trim().slice(0, 400)}`);
  }
}

const CONTENT_TYPES: Record<string, string> = {
  m3u8: 'application/vnd.apple.mpegurl',
  ts: 'video/mp2t',
  jpg: 'image/jpeg',
};

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out;
}

async function uploadDir(dir: string, prefix: string, beat: ReturnType<typeof heartbeat>) {
  const files = await listFiles(dir);
  // Playlists last: a player that somehow got in early finds no playlist,
  // rather than a playlist pointing at segments that are not there yet.
  files.sort((a, b) => Number(a.endsWith('.m3u8')) - Number(b.endsWith('.m3u8')));
  const segments = files.filter((f) => !f.endsWith('.m3u8'));
  const playlists = files.filter((f) => f.endsWith('.m3u8'));
  let done = 0;

  const put = async (file: string) => {
    const key = prefix + relative(dir, file).split('\\').join('/');
    const ext = file.split('.').pop() ?? '';
    await retry(`upload ${key}`, async () => {
      const res = await r2.fetch(objectUrl(key), {
        method: 'PUT',
        body: Bun.file(file),
        headers: {
          'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
          // Segments never change once written; playlists might on a re-run.
          'cache-control': ext === 'm3u8' ? 'no-cache' : 'public, max-age=31536000, immutable',
        },
      });
      if (!res.ok) throw new Error(`R2 PUT ${res.status}: ${(await res.text()).slice(0, 200)}`);
    });
    done += 1;
    // Uploading is the last tenth.
    beat.set(90 + (done / files.length) * 9);
    if (beat.cancelled) throw new Cancelled();
  };

  const queue = [...segments];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let f = queue.shift(); f; f = queue.shift()) await put(f);
    }),
  );
  for (const f of playlists) await put(f);
}

async function transcode(job: Job) {
  if (!job.sourceUrl) throw new Permanent('The job has no source file');
  const dir = join(WORK, job.id);
  const out = join(dir, 'out');
  await rm(dir, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const beat = heartbeat(job.id);
  try {
    const source = join(dir, 'source');
    log('downloading', { job: job.id, bytes: job.sourceBytes });
    await download(job.sourceUrl, source, beat, job.sourceBytes);

    const info = await probe(source);
    const ladder = ladderFor(info);
    log('encoding', { job: job.id, ...info, rungs: ladder.map((r) => r.name) });

    for (const r of ladder) await mkdir(join(out, r.name), { recursive: true });
    await runFfmpeg(buildFfmpegArgs({ source, probe: info, ladder, preset: PRESET, threads: THREADS }), info.durationSeconds, beat, out);

    // A poster a few seconds in: the first frame of a recording is usually black.
    const at = Math.min(5, Math.max(0, info.durationSeconds / 3));
    await runFfmpeg(
      ['-hide_banner', '-y', '-ss', at.toFixed(2), '-i', source, '-frames:v', '1', '-vf', 'scale=-2:720', '-q:v', '3', join(out, 'poster.jpg')],
      0,
      beat,
    ).catch((error) => log('poster failed', { error: String(error) }));

    log('uploading', { job: job.id });
    await uploadDir(out, job.outputPrefix, beat);
    await api(`/jobs/${job.id}/complete`, { durationSeconds: info.durationSeconds || null });
    log('done', { job: job.id });
  } finally {
    beat.stop();
    await rm(dir, { recursive: true, force: true });
  }
}

/* ── Delete ───────────────────────────────────────────────────────────── */

async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | null = null;
  do {
    const url = new URL(bucketUrl);
    url.searchParams.set('list-type', '2');
    url.searchParams.set('prefix', prefix);
    if (token) url.searchParams.set('continuation-token', token);
    const res = await r2.fetch(url.toString());
    if (!res.ok) throw new Error(`R2 list ${res.status}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]!.replace(/&amp;/g, '&'));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (xml.match(/<NextContinuationToken>([^<]+)</)?.[1] ?? null) : null;
  } while (token);
  return keys;
}

async function deleteKeys(keys: string[]) {
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    const body =
      '<Delete><Quiet>true</Quiet>' +
      batch.map((k) => `<Object><Key>${k.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</Key></Object>`).join('') +
      '</Delete>';
    await retry('delete batch', async () => {
      const res = await r2.fetch(`${bucketUrl}?delete`, {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/xml', 'content-md5': createHash('md5').update(body).digest('base64') },
      });
      if (!res.ok) throw new Error(`R2 delete ${res.status}: ${(await res.text()).slice(0, 200)}`);
    });
  }
}

async function remove(job: Job) {
  const keys = [...(await listKeys(`hls/${job.assetId}/`)), ...(await listKeys(`originals/${job.assetId}/`))];
  await deleteKeys(keys);
  await api(`/jobs/${job.id}/complete`, { durationSeconds: null });
  log('deleted', { job: job.id, asset: job.assetId, objects: keys.length });
}

/* ── Loop ─────────────────────────────────────────────────────────────── */

async function freeSpaceNote() {
  try {
    await mkdir(WORK, { recursive: true });
    await stat(WORK);
  } catch (error) {
    throw new Error(`WORK_DIR ${WORK} is not usable: ${String(error)}`);
  }
}

async function main() {
  await freeSpaceNote();
  log('transcoder started', { api: API, bucket: BUCKET, preset: PRESET });
  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => (stopping = true));

  while (!stopping) {
    let job: Job | null = null;
    try {
      ({ job } = await api<{ job: Job | null }>('/claim'));
    } catch (error) {
      log('claim failed', { error: String(error) });
    }
    if (!job) {
      await Bun.sleep(POLL_MS);
      continue;
    }

    log('claimed', { job: job.id, kind: job.kind, asset: job.assetId, attempt: job.attempt });
    try {
      if (job.kind === 'delete') await remove(job);
      else await transcode(job);
    } catch (error) {
      if (error instanceof Cancelled) {
        log('cancelled by the API', { job: job.id });
        continue;
      }
      const permanent = error instanceof Permanent;
      log('failed', { job: job.id, permanent, error: String(error) });
      await api(`/jobs/${job.id}/fail`, {
        error: error instanceof Error ? error.message : String(error),
        permanent,
      }).catch((e) => log('could not report the failure', { error: String(e) }));
    }
  }
  log('transcoder stopped');
}

void main();
