import { useCallback, useEffect, useRef, useState } from 'react';
import { clock } from '../format.ts';
import { Icon } from './primitives.tsx';
import type { PlayerHandle } from './VideoPlayer.tsx';

/**
 * A YouTube lesson, wearing this application's controls instead of YouTube's.
 *
 * The point of this file is that **a lesson hosted on YouTube still behaves
 * like a lesson**. It resumes where the member stopped, it reports watch time,
 * it marks itself complete at the end, and it feeds the same `lesson_progress`
 * rows the streak and the cohort roster read. Embedding a plain iframe would
 * have been four lines and would have quietly cost all of that — the member
 * would watch a course and the app would believe they had done nothing.
 *
 * `controls: 0` hides YouTube's bar and this file supplies the replacement, so
 * a YouTube lesson and a self-hosted one look the same: the same scrubber, the
 * same speed control, the same fullscreen button. That parameter is part of
 * the IFrame API and using it is expressly supported.
 *
 * Three things deliberately not attempted, all for the same reason — they
 * would breach the YouTube terms, and the risk would land on the club's
 * channel rather than on this codebase:
 *
 * **The logo is not hidden.** `modestbranding` was retired and no longer does
 * anything. The logo stays.
 *
 * **The title and "Watch on YouTube" overlay is not covered.** It appears on
 * hover and on pause and cannot be turned off. A transparent layer over the
 * player would hide it and would also be exactly the kind of obscuring the
 * terms prohibit.
 *
 * **Nothing pretends the video is private.** An unlisted video is reachable by
 * anyone holding the id, and implying otherwise would suggest an access
 * control that does not exist.
 */

type YTPlayer = {
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  setPlaybackRate: (rate: number) => void;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  destroy: () => void;
};

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
      PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

/**
 * Loads the IFrame API once per page, and lets every player await the same
 * load. Two lessons opened in one session must not inject the script twice.
 */
let apiPromise: Promise<void> | null = null;
function loadApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<void>((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    document.head.appendChild(script);
  });
  return apiPromise;
}

const SPEEDS = [1, 1.25, 1.5, 1.75, 2] as const;

export function YouTubePlayer({
  videoId,
  startAt,
  title,
  onProgress,
  onEnded,
  onDurationKnown,
  reportEverySeconds = 15,
}: {
  videoId: string;
  startAt: number;
  title: string;
  /* Called once, when YouTube first reports a length. Nothing else knows it:
     there is no upload and no webhook for a YouTube lesson, so without this
     the catalogue says 0:00 forever. */
  onDurationKnown?: (seconds: number) => void;
  reportEverySeconds?: number;
} & PlayerHandle) {
  const frame = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  const [muted, setMuted] = useState(false);
  // While the member is dragging, the scrubber shows where their thumb is
  // rather than where the video is — otherwise the poll fights the drag.
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  // Accumulated watch time since the last report, so scrubbing through a
  // lesson does not count as having watched it.
  const watched = useRef(0);
  const lastTick = useRef(0);

  // Held in refs so the polling loop never closes over a stale callback and
  // the effect does not need to tear the player down when a parent re-renders.
  const progressRef = useRef(onProgress);
  const endedRef = useRef(onEnded);
  const durationRef = useRef(onDurationKnown);
  useEffect(() => {
    progressRef.current = onProgress;
    endedRef.current = onEnded;
    durationRef.current = onDurationKnown;
  }, [onProgress, onEnded, onDurationKnown]);

  // Reported once per mount. The duration does not change mid-video, and the
  // endpoint ignores a second report anyway — this just avoids the request.
  const durationReported = useRef(false);

  /**
   * Where to resume, read once.
   *
   * `startAt` is `lastPositionSeconds`, and it changes every time progress is
   * saved. It used to be in the effect's dependency array, which meant that
   * every fifteen seconds of watching destroyed the player and built a new
   * one: the video stopped and the iframe reloaded. On a two-hour lesson that
   * is about eight rebuilds a minute.
   *
   * It is an *initial* position, not a live one. Held in a ref so a later save
   * cannot reach back and restart the thing that produced it.
   */
  const resumeAt = useRef(startAt);

  useEffect(() => {
    let disposed = false;
    let ticker: ReturnType<typeof setInterval> | null = null;

    void loadApi().then(() => {
      if (disposed || !host.current || !window.YT) return;

      player.current = new window.YT.Player(host.current, {
        videoId,
        playerVars: {
          // The bar below is ours. See the file comment for what this can and
          // cannot remove.
          controls: 0,
          // Ours too — with YouTube's handler off, this file owns the keys.
          disablekb: 1,
          // No annotation overlays on top of a lesson.
          iv_load_policy: 3,
          // Fullscreen is a button on our bar, on the frame rather than the
          // iframe, so the controls come with it.
          fs: 0,
          // `rel: 0` keeps the end screen to this channel rather than the
          // whole of YouTube, which is as far as it can be limited.
          rel: 0,
          playsinline: 1,
          // Resume is handled on ready rather than by `start`, because `start`
          // is ignored when the value exceeds the video length — which is
          // exactly what a stale progress row contains.
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            if (disposed || !player.current) return;
            const total = player.current.getDuration();
            setDuration(total);
            if (total > 0 && !durationReported.current) {
              durationReported.current = true;
              durationRef.current?.(Math.round(total));
            }
            setMuted(player.current.isMuted());
            const at = resumeAt.current;
            if (at > 2 && total > 0 && at < total - 5) {
              player.current.seekTo(at, true);
              setPosition(at);
            }
            setReady(true);
          },
          onStateChange: (event: { data: number }) => {
            if (!window.YT || !player.current) return;
            const state = event.data;
            setPlaying(state === window.YT.PlayerState.PLAYING);

            // The duration is often still 0 at onReady and only real once
            // playback starts, which would leave the scrubber unusable.
            if (state === window.YT.PlayerState.PLAYING) {
              const total = player.current.getDuration();
              if (total > 0) setDuration(total);
              // `getDuration()` is commonly 0 at onReady and only real once
              // playback starts, so this is usually the report that lands.
              if (total > 0 && !durationReported.current) {
                durationReported.current = true;
                durationRef.current?.(Math.round(total));
              }
            }

            if (state === window.YT.PlayerState.ENDED) {
              progressRef.current(Math.floor(player.current.getCurrentTime()), Math.floor(watched.current));
              endedRef.current();
            }
            // Pausing flushes immediately: somebody who pauses and navigates
            // away should not lose the last fifteen seconds of position.
            if (state === window.YT.PlayerState.PAUSED) {
              progressRef.current(Math.floor(player.current.getCurrentTime()), Math.floor(watched.current));
              watched.current = 0;
            }
          },
          onError: () => {
            // Deleted, private, or embedding disabled by the uploader. The
            // last one is the common mistake and worth naming.
            setFailed('This video is unavailable. It may be private, deleted, or have embedding turned off.');
          },
        },
      });

      /* Four times a second, because the scrubber has to look continuous.
         Watch time is still only credited while the position is genuinely
         advancing — that is what separates watching from scrubbing, and from
         leaving a paused tab open. At 2× a quarter-second tick advances the
         video half a second, so the ceiling is 1, well under any seek. */
      lastTick.current = 0;
      ticker = setInterval(() => {
        const p = player.current;
        if (!p) return;
        const now = p.getCurrentTime();
        const delta = now - lastTick.current;
        if (delta > 0 && delta < 1) watched.current += delta;
        lastTick.current = now;
        setPosition(now);

        if (watched.current >= reportEverySeconds) {
          progressRef.current(Math.floor(now), Math.floor(watched.current));
          watched.current = 0;
        }
      }, 250);
    });

    return () => {
      disposed = true;
      if (ticker) clearInterval(ticker);
      // Flush on the way out, or navigating away loses the position entirely.
      const p = player.current;
      if (p) {
        try {
          const at = p.getCurrentTime();
          if (at > 0) progressRef.current(Math.floor(at), Math.floor(watched.current));
        } catch {
          // The iframe may already be gone; losing one report is not worth an
          // error in the console on every navigation.
        }
        p.destroy();
        player.current = null;
      }
    };
    // Only the video. Rebuilding on anything else — a new resume position, a
    // parent re-render — interrupts playback, which is the one thing a player
    // must never do to itself.
  }, [videoId]);

  /* ── The controls ────────────────────────────────────────────────────── */

  const toggle = useCallback(() => {
    const p = player.current;
    if (!p || !window.YT) return;
    if (p.getPlayerState() === window.YT.PlayerState.PLAYING) p.pauseVideo();
    else p.playVideo();
  }, []);

  const seekBy = useCallback((seconds: number) => {
    const p = player.current;
    if (!p) return;
    const next = Math.max(0, Math.min(p.getDuration() || 0, p.getCurrentTime() + seconds));
    p.seekTo(next, true);
    setPosition(next);
    // A jump is not watching, and the tick would otherwise credit the gap.
    lastTick.current = next;
  }, []);

  const cycleSpeed = useCallback(() => {
    const next = SPEEDS[(SPEEDS.indexOf(speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length]!;
    setSpeed(next);
    player.current?.setPlaybackRate(next);
  }, [speed]);

  const toggleMute = useCallback(() => {
    const p = player.current;
    if (!p) return;
    /* Decide first, then act, then record the decision.
       Reading `isMuted()` back immediately after calling `mute()` returns the
       *old* value — the call crosses into the iframe and has not landed yet —
       so the label was being set from a stale read and never changed. The
       intent is the truth here; the player catches up. */
    const next = !p.isMuted();
    if (next) p.mute();
    else p.unMute();
    setMuted(next);
  }, []);

  const fullscreen = useCallback(() => {
    // The frame, not the iframe: taking the iframe fullscreen would leave our
    // controls behind and hand the member back to YouTube's.
    const el = frame.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }, []);

  /* With `disablekb: 1` YouTube handles no keys, so these are ours. Bound to
     the frame rather than the document, so typing a question in the Q&A box
     below does not pause the video. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (key === ' ' || key === 'k') {
      e.preventDefault();
      toggle();
    } else if (key === 'arrowright') {
      e.preventDefault();
      seekBy(10);
    } else if (key === 'arrowleft') {
      e.preventDefault();
      seekBy(-10);
    } else if (key === 'f') {
      fullscreen();
    } else if (key === 'm') {
      toggleMute();
    }
  };

  if (failed) {
    return (
      <div
        style={{
          aspectRatio: '16 / 9',
          borderRadius: 'var(--r-card)',
          background: 'var(--soft)',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          textAlign: 'center',
        }}
      >
        <span style={{ fontSize: 12.5, lineHeight: 1.6, maxWidth: 380 }} className="muted">
          {failed}
        </span>
      </div>
    );
  }

  const shown = scrubbing ?? position;
  const pct = duration ? (shown / duration) * 100 : 0;

  return (
    <div
      ref={frame}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label={title}
      style={{
        position: 'relative',
        borderRadius: 'var(--r-card)',
        overflow: 'hidden',
        background: '#14161f',
        outline: 'none',
      }}
    >
      <div style={{ aspectRatio: '16 / 9' }}>
        {/* The API replaces this node with the iframe, so it carries no
            styling of its own beyond filling the frame. */}
        <div ref={host} style={{ width: '100%', height: '100%' }} />
      </div>

      {/* The big one, for a lesson nobody has started. Placed above the iframe
          but only while paused, so it never sits over the YouTube overlay
          during playback. */}
      {ready && !playing && (
        <button
          type="button"
          onClick={toggle}
          aria-label="Play"
          style={{
            position: 'absolute',
            inset: 0,
            bottom: 64,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(20, 22, 31, 0.3)',
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

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          background: 'linear-gradient(180deg, rgba(20,22,31,0) 0%, rgba(20,22,31,0.88) 100%)',
        }}
      >
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(pct * 10)}
          aria-label="Seek"
          disabled={!duration}
          onChange={(e) => setScrubbing((Number(e.target.value) / 1000) * duration)}
          // Committed on release, not on every pixel of the drag: seeking on
          // each frame of a two-hour video makes YouTube re-buffer constantly.
          onPointerUp={() => {
            if (scrubbing === null) return;
            player.current?.seekTo(scrubbing, true);
            setPosition(scrubbing);
            lastTick.current = scrubbing;
            setScrubbing(null);
          }}
          onKeyUp={() => {
            if (scrubbing === null) return;
            player.current?.seekTo(scrubbing, true);
            setPosition(scrubbing);
            lastTick.current = scrubbing;
            setScrubbing(null);
          }}
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

          {/* Ten seconds back is the control people actually reach for in a
              lecture — "what did he just say" — so it gets its own button. */}
          <button type="button" onClick={() => seekBy(-10)} aria-label="Back ten seconds" style={ctrl}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M11 5 6 9l5 4" />
              <path d="M6 9h7a5 5 0 1 1 0 10H9" />
            </svg>
          </button>

          <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: '#c9ccd8' }}>
            {clock(shown)} / {clock(duration)}
          </span>

          <span style={{ flex: 1 }} />

          <button type="button" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} style={ctrl}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 9v6h4l5 4V5L8 9H4z" />
              {muted ? <path d="m17 9 4 6M21 9l-4 6" /> : <path d="M17 8a5 5 0 0 1 0 8" />}
            </svg>
          </button>

          <button type="button" onClick={cycleSpeed} aria-label="Playback speed" style={{ ...ctrl, fontSize: 12, fontWeight: 600 }}>
            {speed}×
          </button>

          <button type="button" onClick={fullscreen} aria-label="Full screen" style={ctrl}>
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
  cursor: 'pointer',
};
