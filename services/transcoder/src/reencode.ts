/**
 * Re-encodes an already-transcoded video in place, from its own top rung, for
 * when the original is gone (originals are deleted after a successful
 * transcode) and the ladder settings have improved since.
 *
 * Run inside the transcoder container on the VPS:
 *   docker compose exec -d transcoder bun src/reencode.ts <assetId>          re-encode and replace
 *   docker compose exec transcoder bun src/reencode.ts <assetId> 300         dry run: first 300 s, sizes only
 *   ... <assetId> 0 1300                                                      full run, ceiling 1300 kbps
 *
 * The third argument stands in for the original's bitrate (bytes × 8 ÷
 * seconds of the deleted upload): the top rung is a copy at its own, higher
 * rate, so without it the "never above the source" ceiling cannot work.
 *
 * Same asset, same rung names, same 6-second segment timing, so the lesson
 * needs no change: new segments overwrite old ones, playlists go last, and
 * leftover old files are deleted at the end. The poster is kept.
 */
import { appendFile, mkdir, rm, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { buildFfmpegArgs, ladderFor } from './ladder.ts';
import {
  bucketUrl,
  deleteKeys,
  listFiles,
  log,
  objectUrl,
  PRESET,
  probe,
  r2,
  retry,
  runFfmpeg,
  THREADS,
  uploadDir,
  WORK,
} from './main.ts';

const [assetId, sampleArg, capArg] = process.argv.slice(2);
if (!assetId || !/^[0-9a-f-]{36}$/.test(assetId)) throw new Error('usage: bun src/reencode.ts <assetId> [sampleSeconds] [sourceKbps]');
const sample = Number(sampleArg ?? 0) || 0;
const sourceKbps = Number(capArg ?? 0) || 0;
const prefix = `hls/${assetId}/`;
// No API job behind this run: progress has nowhere to go.
const quiet = { set() {}, get cancelled() { return false; }, stop() {} } as unknown as Parameters<typeof runFfmpeg>[2];

async function listSized(p: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  let token: string | null = null;
  do {
    const url = new URL(bucketUrl);
    url.searchParams.set('list-type', '2');
    url.searchParams.set('prefix', p);
    if (token) url.searchParams.set('continuation-token', token);
    const res = await r2.fetch(url.toString());
    if (!res.ok) throw new Error(`R2 list ${res.status}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>.*?<Size>(\d+)<\/Size>/gs)) out.set(m[1]!.replace(/&amp;/g, '&'), Number(m[2]));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (xml.match(/<NextContinuationToken>([^<]+)</)?.[1] ?? null) : null;
  } while (token);
  return out;
}

const before = await listSized(prefix);
if (before.size === 0) throw new Error(`nothing under ${prefix}`);
const rungs = [...new Set([...before.keys()].map((k) => k.slice(prefix.length).split('/')[0]!))]
  .filter((n) => /^\d+p$/.test(n))
  .sort((a, b) => Number.parseInt(b) - Number.parseInt(a));
const top = rungs[0]!;
const dir = join(WORK, `reencode-${assetId}`);
const src = join(dir, 'src');
const out = join(dir, 'out');
await rm(dir, { recursive: true, force: true });
await mkdir(src, { recursive: true });
await mkdir(out, { recursive: true });

// The top rung's playlist and segments (only the first few for a dry run).
const segKeys = [...before.keys()].filter((k) => k.startsWith(`${prefix}${top}/`) && k.endsWith('.ts')).sort();
const wanted = sample ? segKeys.slice(0, Math.ceil(sample / 6) + 2) : segKeys;
log('reencode: downloading', { asset: assetId, from: top, segments: wanted.length });
const queue = [`${prefix}${top}/index.m3u8`, ...wanted];
await Promise.all(
  Array.from({ length: 8 }, async () => {
    for (let k = queue.shift(); k; k = queue.shift()) {
      const key = k;
      await retry(`get ${key}`, async () => {
        const res = await r2.fetch(objectUrl(key));
        if (!res.ok) throw new Error(`R2 GET ${res.status}`);
        // Buffered: segments are a few MB, and writing the Response stream
        // directly hung with Bun spinning at 100% CPU.
        await Bun.write(join(src, key.slice(`${prefix}${top}/`.length)), await res.arrayBuffer());
      });
    }
  }),
);

// Back into one file, without re-encoding.
const source = join(dir, 'source.mp4');
await runFfmpeg(
  ['-hide_banner', '-y', '-allowed_extensions', 'ALL', '-i', join(src, 'index.m3u8'), ...(sample ? ['-t', String(sample)] : []), '-c', 'copy', '-bsf:a', 'aac_adtstoasc', source],
  0,
  quiet,
);
await rm(src, { recursive: true, force: true });

const info = await probe(source);
if (sourceKbps > 0) info.videoKbps = sourceKbps;
const ladder = ladderFor(info);
log('reencode: encoding', { asset: assetId, ...info, rungs: ladder.map((r) => r.name), preset: PRESET });
for (const r of ladder) await mkdir(join(out, r.name), { recursive: true });
const started = Date.now();
await runFfmpeg(buildFfmpegArgs({ source, probe: info, ladder, preset: PRESET, threads: THREADS }), info.durationSeconds, quiet, out);
const minutes = ((Date.now() - started) / 60000).toFixed(1);

const files = await listFiles(out);
const sizeOf = async (f: string) => (await stat(f)).size;
const report: Record<string, { beforeMB: number; afterMB: number }> = {};
for (const r of ladder) {
  const mine = files.filter((f) => relative(out, f).split(/[\\/]/)[0] === r.name && f.endsWith('.ts'));
  const after = (await Promise.all(mine.map(sizeOf))).reduce((a, b) => a + b, 0);
  const oldKeys = [...before.keys()].filter((k) => k.startsWith(`${prefix}${r.name}/`) && k.endsWith('.ts')).sort().slice(0, sample ? mine.length : undefined);
  const old = oldKeys.reduce((a, k) => a + (before.get(k) ?? 0), 0);
  report[r.name] = { beforeMB: Math.round(old / 1e6), afterMB: Math.round(after / 1e6) };
}
log('reencode: sizes', { asset: assetId, sample: sample || 'full', encodeMinutes: minutes, report });
await appendFile(join(WORK, 'reencode.log'), `${new Date().toISOString()} ${assetId} ${JSON.stringify(report)}\n`);

if (sample) {
  await rm(dir, { recursive: true, force: true });
  process.exit(0);
}

// Replace in place: segments, then playlists (uploadDir's order), then the
// files the new encode no longer has. The poster stays.
await uploadDir(out, prefix, quiet);
const now = new Set((await listFiles(out)).map((f) => prefix + relative(out, f).split('\\').join('/')));
const stale = [...before.keys()].filter((k) => !now.has(k) && !k.endsWith('/poster.jpg'));
await deleteKeys(stale);
log('reencode: done', { asset: assetId, uploaded: now.size, removed: stale.length });
await rm(dir, { recursive: true, force: true });
