import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';
import { clock } from '../api.ts';
import { Icon } from './primitives.tsx';

/**
 * HLS player.
 *
 * Safari and iOS play HLS natively; everywhere else hls.js attaches to the
 * same <video>. Either way this component owns playback only — it reports
 * position upward and never decides what the member is allowed to watch.
 */
export type PlayerHandle = {
  /** Called at most every `reportEverySeconds`, and on pause/seek/unmount. */
  onProgress: (positionSeconds: number, watchedSeconds: number) => void;
  onEnded: () => void;
};

const SPEEDS = [1, 1.25, 1.5, 2] as const;

export function VideoPlayer({
  src,
  startAt,
  title,
  onProgress,
  onEnded,
  reportEverySeconds = 15,
}: {
  src: string | null;
  startAt: number;
  title: string;
  reportEverySeconds?: number;
} & PlayerHandle) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(startAt);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [error, setError] = useState<string | null>(null);

  // Accumulated since the last report, so a scrub does not inflate watch time.
  const watched = useRef(0);
  const lastReport = useRef(0);
  const lastTick = useRef(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    setError(null);

    // hls.js first, native second — and not the other way round. Chrome answers
    // "maybe" to canPlayType('application/vnd.apple.mpegurl') despite having no
    // native HLS, so checking native first silently leaves the video at
    // readyState 0 forever. Safari and iOS fall through to the native path.
    if (!Hls.isSupported()) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = src;
      else setError('Your browser cannot play this video.');
      return;
    }

    let disposed = false;
    const hls = new Hls({ enableWorker: true, lowLatencyMode: false });

    // Listeners before attach, and the source loaded only once the media is
    // attached: in React StrictMode the effect runs twice, and loading before
    // attachment leaves the surviving instance parsed but never fetching.
    hls.on(Hls.Events.MEDIA_ATTACHED, () => {
      if (!disposed) hls.loadSource(src);
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) setError('This video could not be loaded.');
    });
    hls.attachMedia(video);

    return () => {
      disposed = true;
      hls.destroy();
    };
  }, [src]);

  // Resume where the member left off, once metadata says the seek is legal.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !ready || startAt <= 0) return;
    if (Math.abs(video.currentTime - startAt) > 2 && startAt < video.duration - 5) {
      video.currentTime = startAt;
    }
  }, [ready, startAt]);

  // Flush progress on unmount — otherwise navigating away loses the position.
  useEffect(() => {
    return () => {
      const video = videoRef.current;
      if (video && video.currentTime > 0) onProgress(Math.floor(video.currentTime), Math.floor(watched.current));
    };
  }, [onProgress]);

  const report = (force = false) => {
    const video = videoRef.current;
    if (!video) return;
    const now = video.currentTime;
    if (!force && now - lastReport.current < reportEverySeconds) return;
    lastReport.current = now;
    onProgress(Math.floor(now), Math.floor(watched.current));
    watched.current = 0;
  };

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  };

  const scrub = (fraction: number) => {
    const video = videoRef.current;
    if (!video || !duration) return;
    video.currentTime = fraction * duration;
    report(true);
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
    setSpeed(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  };

  const pct = duration ? (position / duration) * 100 : 0;

  return (
    <div style={{ position: 'relative', borderRadius: 'var(--r-card)', overflow: 'hidden', background: '#14161f' }}>
      <video
        ref={videoRef}
        playsInline
        style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', background: '#14161f' }}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration || 0);
          setReady(true);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          report(true);
        }}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          // Only count forward, real-time movement as "watched".
          const delta = t - lastTick.current;
          if (delta > 0 && delta < 2) watched.current += delta;
          lastTick.current = t;
          setPosition(t);
          report();
        }}
        onEnded={() => {
          report(true);
          onEnded();
        }}
        aria-label={title}
      />

      {!playing && (
        <button
          type="button"
          onClick={toggle}
          aria-label="Play"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(20, 22, 31, 0.35)',
            border: 0,
          }}
        >
          <span
            style={{
              width: 64,
              height: 64,
              borderRadius: 999,
              background: 'var(--pink)',
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </button>
      )}

      {error && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 12 }}>
          {error}
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          background: 'linear-gradient(180deg, rgba(20,22,31,0) 0%, rgba(20,22,31,0.85) 100%)',
        }}
      >
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(pct * 10)}
          onChange={(e) => scrub(Number(e.target.value) / 1000)}
          aria-label="Seek"
          style={{ width: '100%', accentColor: 'var(--pink)', height: 4, cursor: 'pointer' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, color: '#fff' }}>
          <button type="button" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} style={ctrl}>
            {playing ? (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M7 5h3v14H7zM14 5h3v14h-3z" />
              </svg>
            ) : (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
          <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: '#c9ccd8' }}>
            {clock(position)} / {clock(duration)}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={cycleSpeed} style={{ ...ctrl, fontSize: 12, fontWeight: 600 }}>
            {speed}×
          </button>
          <button
            type="button"
            onClick={() => void videoRef.current?.requestFullscreen?.()}
            aria-label="Full screen"
            style={ctrl}
          >
            <Icon name="expand" size={17} color="#fff" />
          </button>
        </div>
      </div>
    </div>
  );
}

const ctrl: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  color: '#fff',
  background: 'transparent',
  border: 0,
  padding: 0,
};

