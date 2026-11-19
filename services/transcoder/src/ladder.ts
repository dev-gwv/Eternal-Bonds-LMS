/**
 * The HLS ladder and the ffmpeg command that makes it. Pure, so it is tested
 * without running ffmpeg (tests/transcoder.test.ts).
 */

export type Probe = {
  width: number;
  height: number;
  durationSeconds: number;
  hasAudio: boolean;
  /** The source's video bitrate, when the file says. No rung is given more. */
  videoKbps?: number | null;
};

export type Rung = {
  name: string;
  /** The short side: 720 means 1280×720 landscape or 720×1280 portrait. */
  short: number;
  /** The ceiling, not the target: see CRF below. */
  videoKbps: number;
  audioKbps: number;
};

/**
 * Bitrates for talking-head and slide content, which is what course videos
 * are. Sports footage would want more; a lecture at 2.8 Mbps 720p is clean.
 */
export const RUNGS: Rung[] = [
  { name: '360p', short: 360, videoKbps: 800, audioKbps: 96 },
  { name: '720p', short: 720, videoKbps: 2800, audioKbps: 128 },
  { name: '1080p', short: 1080, videoKbps: 5000, audioKbps: 160 },
];

/**
 * Every rung the source can fill, never upscaled; a tiny source gets one rung
 * at its own size.
 *
 * A source that falls between two rungs (a 1948×982 screen or Zoom recording)
 * also gets a rung at its own full size, so its sharpness is not thrown away
 * by topping out at the rung below. Only below 1080: at 1080 and above, 1080p
 * is the top, which is plenty for a lecture and bounds the encoding work.
 */
export function ladderFor(probe: Probe): Rung[] {
  const short = Math.min(probe.width, probe.height);
  const even = Math.max(2, short - (short % 2));
  // A little slack, so a 1072-line export still gets its 1080p rung.
  const fits = RUNGS.filter((r) => r.short <= short + 16);
  if (fits.length === 0) return [{ name: `${even}p`, short: even, videoKbps: 600, audioKbps: 96 }];
  const top = fits[fits.length - 1]!;
  const next = RUNGS[fits.length];
  if (next && even >= top.short * 1.2) {
    // Bitrate in proportion to where it sits between the rungs around it.
    const at = (even - top.short) / (next.short - top.short);
    const videoKbps = Math.round((top.videoKbps + at * (next.videoKbps - top.videoKbps)) / 100) * 100;
    return [...fits, { name: `${even}p`, short: even, videoKbps, audioKbps: next.audioKbps }];
  }
  return fits;
}

/**
 * Quality-targeted encoding with a ceiling ("capped CRF"): x264 spends what
 * each scene needs for the same visual quality, up to the rung's videoKbps.
 * A slide or a talking head needs a fraction of the ceiling, so lectures come
 * out 3-5x smaller than at a fixed bitrate, looking the same. 23 is x264's
 * default and visually clean at these sizes.
 */
export const CRF = 23;

/**
 * The ceiling for one rung: its own, but never more than the source had,
 * since bits above that add nothing. A floor keeps a starved source watchable.
 */
export function ceilingKbps(rung: Rung, probe: Probe): number {
  const source = probe.videoKbps && probe.videoKbps > 0 ? Math.round(probe.videoKbps * 1.1) : Infinity;
  return Math.max(400, Math.min(rung.videoKbps, source));
}

/** Six-second segments: Apple's recommendation, and fine-grained enough to seek. */
export const SEGMENT_SECONDS = 6;

/**
 * Output paths are relative (`360p/index.m3u8`): run ffmpeg with its working
 * directory set to the output folder. ffmpeg resolves where the HLS files go
 * partly against its working directory, and on a machine where that differs
 * from the output's drive or root it fails with "Permission denied".
 */
export function buildFfmpegArgs(o: {
  source: string;
  probe: Probe;
  ladder: Rung[];
  preset: string;
  threads: string;
}): string[] {
  const portrait = o.probe.height > o.probe.width;
  const n = o.ladder.length;
  const split = `[0:v]split=${n}${o.ladder.map((_, i) => `[s${i}]`).join('')}`;
  const scales = o.ladder.map((r, i) => {
    const size = portrait ? `${r.short}:-2` : `-2:${r.short}`;
    return `[s${i}]scale=${size}:flags=bicubic,format=yuv420p[v${i}]`;
  });

  const args = ['-hide_banner', '-y', '-nostats', '-i', o.source, '-threads', o.threads];
  args.push('-filter_complex', [split, ...scales].join(';'));

  o.ladder.forEach((r, i) => {
    const ceiling = ceilingKbps(r, o.probe);
    args.push(
      '-map', `[v${i}]`,
      `-c:v:${i}`, 'libx264',
      `-crf:v:${i}`, String(CRF),
      `-maxrate:v:${i}`, `${ceiling}k`,
      `-bufsize:v:${i}`, `${ceiling * 2}k`,
    );
    if (o.probe.hasAudio) {
      args.push('-map', 'a:0', `-c:a:${i}`, 'aac', `-b:a:${i}`, `${r.audioKbps}k`, `-ac:a:${i}`, '2');
    }
  });

  args.push(
    '-preset', o.preset,
    '-profile:v', 'main',
    // Keyframes exactly on segment boundaries, the same in every rung, so a
    // player switching quality mid-lecture never stalls or jumps.
    '-sc_threshold', '0',
    '-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
    '-f', 'hls',
    '-hls_time', String(SEGMENT_SECONDS),
    '-hls_playlist_type', 'vod',
    '-hls_flags', 'independent_segments',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', '%v/seg%05d.ts',
    '-master_pl_name', 'master.m3u8',
    '-var_stream_map', o.ladder.map((r, i) => (o.probe.hasAudio ? `v:${i},a:${i},name:${r.name}` : `v:${i},name:${r.name}`)).join(' '),
    '-progress', 'pipe:1',
    '%v/index.m3u8',
  );
  return args;
}

/** ffmpeg's `-progress` lines: `out_time_us=12345678` → 12.3 seconds. */
export function parseProgress(line: string): number | null {
  const m = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim());
  if (!m) return null;
  return Number(m[1]) / 1_000_000;
}
