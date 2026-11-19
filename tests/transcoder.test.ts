import { describe, expect, test } from 'bun:test';
import { buildFfmpegArgs, ceilingKbps, ladderFor, parseProgress, RUNGS } from '../services/transcoder/src/ladder.ts';

describe('HLS ladder', () => {
  test('never upscales', () => {
    expect(ladderFor({ width: 1280, height: 720, durationSeconds: 1, hasAudio: true }).map((r) => r.name)).toEqual(['360p', '720p']);
    expect(ladderFor({ width: 1920, height: 1080, durationSeconds: 1, hasAudio: true }).map((r) => r.name)).toEqual(['360p', '720p', '1080p']);
    expect(ladderFor({ width: 3840, height: 2160, durationSeconds: 1, hasAudio: true })).toHaveLength(3);
  });

  test('a source between rungs also gets a rung at its own size', () => {
    const ladder = ladderFor({ width: 1948, height: 982, durationSeconds: 1, hasAudio: true });
    expect(ladder.map((r) => r.name)).toEqual(['360p', '720p', '982p']);
    expect(ladder[2]).toMatchObject({ short: 982, videoKbps: 4400 });
    // Close to a rung: no extra one (1.2x rule), and 1080+ tops out at 1080p.
    expect(ladderFor({ width: 1366, height: 768, durationSeconds: 1, hasAudio: true }).map((r) => r.name)).toEqual(['360p', '720p']);
    expect(ladderFor({ width: 2560, height: 1440, durationSeconds: 1, hasAudio: true }).map((r) => r.name)).toEqual(['360p', '720p', '1080p']);
    expect(ladderFor({ width: 854, height: 480, durationSeconds: 1, hasAudio: true }).map((r) => r.name)).toEqual(['360p', '480p']);
  });

  test('portrait phone video is laddered by its short side', () => {
    const ladder = ladderFor({ width: 1080, height: 1920, durationSeconds: 1, hasAudio: true });
    expect(ladder.map((r) => r.name)).toEqual(['360p', '720p', '1080p']);
    const args = buildFfmpegArgs({ source: 's', probe: { width: 1080, height: 1920, durationSeconds: 1, hasAudio: true }, ladder, preset: 'veryfast', threads: '0' });
    expect(args.join(' ')).toContain('scale=720:-2');
  });

  test('a tiny source still gets one rung', () => {
    expect(ladderFor({ width: 320, height: 240, durationSeconds: 1, hasAudio: false }).map((r) => r.name)).toEqual(['240p']);
  });

  test('no audio map when the file has no audio', () => {
    const probe = { width: 1280, height: 720, durationSeconds: 1, hasAudio: false };
    const args = buildFfmpegArgs({ source: 's', probe, ladder: ladderFor(probe), preset: 'veryfast', threads: '0' });
    expect(args).not.toContain('a:0');
    expect(args[args.indexOf('-var_stream_map') + 1]).toBe('v:0,name:360p v:1,name:720p');
  });

  test('quality-targeted, capped at the rung and at the source bitrate', () => {
    const probe = { width: 1948, height: 982, durationSeconds: 1, hasAudio: true, videoKbps: 1300 };
    const args = buildFfmpegArgs({ source: 's', probe, ladder: ladderFor(probe), preset: 'superfast', threads: '3' });
    expect(args).toContain('-crf:v:0');
    expect(args.some((a) => a.startsWith('-b:v'))).toBe(false);
    // 360p's own ceiling (800k) is below the source's 1430k; the others are capped at the source.
    expect(args[args.indexOf('-maxrate:v:0') + 1]).toBe('800k');
    expect(args[args.indexOf('-maxrate:v:2') + 1]).toBe('1430k');
    // Unknown source bitrate: the rung's own ceiling. Starved source: the floor.
    expect(ceilingKbps(RUNGS[1]!, { ...probe, videoKbps: null })).toBe(2800);
    expect(ceilingKbps(RUNGS[1]!, { ...probe, videoKbps: 100 })).toBe(400);
  });

  test('reads ffmpeg progress', () => {
    expect(parseProgress('out_time_us=12500000')).toBe(12.5);
    expect(parseProgress('frame=10')).toBeNull();
  });
});
