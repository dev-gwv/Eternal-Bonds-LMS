import { describe, expect, test } from 'bun:test';
import { buildFfmpegArgs, ladderFor, parseProgress } from '../services/transcoder/src/ladder.ts';

describe('HLS ladder', () => {
  test('never upscales', () => {
    expect(ladderFor({ width: 1280, height: 720, durationSeconds: 1, hasAudio: true }).map((r) => r.name)).toEqual(['360p', '720p']);
    expect(ladderFor({ width: 1920, height: 1080, durationSeconds: 1, hasAudio: true }).map((r) => r.name)).toEqual(['360p', '720p', '1080p']);
    expect(ladderFor({ width: 3840, height: 2160, durationSeconds: 1, hasAudio: true })).toHaveLength(3);
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

  test('reads ffmpeg progress', () => {
    expect(parseProgress('out_time_us=12500000')).toBe(12.5);
    expect(parseProgress('frame=10')).toBeNull();
  });
});
