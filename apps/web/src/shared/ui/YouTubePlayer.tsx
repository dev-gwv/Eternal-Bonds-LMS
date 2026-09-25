import { useEffect, useRef, useState } from 'react';
import type { PlayerHandle } from './VideoPlayer.tsx';

/**
 * A YouTube lesson, wired into the same progress contract as our own player.
 *
 * The point of this file is that **a lesson hosted on YouTube still behaves
 * like a lesson**. It resumes where the member stopped, it reports watch time,
 * it marks itself complete at the end, and it feeds the same
 * `lesson_progress` rows the streak and the cohort roster read. Embedding a
 * plain iframe would have been four lines and would have quietly cost all of
 * that — the member would watch a course and the app would believe they had
 * done nothing.
 *
 * The IFrame API is what makes it possible: `getCurrentTime`, `getDuration`
 * and player-state events give us everything our own `<video>` element gives
 * us, minus the ability to style the controls.
 *
 * Two things deliberately not attempted:
 *
 * **Hiding that it is YouTube.** `modestbranding` was removed by YouTube and
 * `rel=0` now means "related videos from this channel only" rather than none.
 * Fighting the chrome is a losing, and slightly dishonest, game — the logo
 * stays.
 *
 * **Blocking the "Watch on YouTube" link.** It cannot be removed, and an
 * unlisted video is reachable by anyone with the id anyway. Pretending
 * otherwise would imply an access control that does not exist.
 */

type YTPlayer = {
  getCurrentTime: () => number;
  getDuration: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  destroy: () => void;
};

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
      PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
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

export function YouTubePlayer({
  videoId,
  startAt,
  title,
  onProgress,
  onEnded,
  reportEverySeconds = 15,
}: {
  videoId: string;
  startAt: number;
  title: string;
  reportEverySeconds?: number;
} & PlayerHandle) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // Accumulated watch time since the last report, so scrubbing through a
  // lesson does not count as having watched it.
  const watched = useRef(0);
  const lastTick = useRef(0);

  // Held in refs so the polling loop never closes over a stale callback and
  // the effect does not need to tear the player down when a parent re-renders.
  const progressRef = useRef(onProgress);
  const endedRef = useRef(onEnded);
  useEffect(() => {
    progressRef.current = onProgress;
    endedRef.current = onEnded;
  }, [onProgress, onEnded]);

  /**
   * Where to resume, read once.
   *
   * `startAt` is `lastPositionSeconds`, and it changes every time progress is
   * saved. It used to be in the effect's dependency array, which meant that
   * every fifteen seconds of watching destroyed the player and built a new
   * one: the video stopped, the iframe reloaded, and playback restarted. On a
   * two-hour lesson that is about eight rebuilds a minute, which is what
   * "not playing properly" looked like.
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
          // `rel: 0` keeps the end screen to this channel rather than the
          // whole of YouTube, which is as far as it can be limited.
          rel: 0,
          playsinline: 1,
          // Resume is handled here rather than by `start`, because `start` is
          // ignored when the value exceeds the video length — which is exactly
          // what a stale progress row contains.
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            if (disposed || !player.current) return;
            const duration = player.current.getDuration();
            const at = resumeAt.current;
            if (at > 2 && duration > 0 && at < duration - 5) {
              player.current.seekTo(at, true);
            }
          },
          onStateChange: (event: { data: number }) => {
            if (!window.YT || !player.current) return;
            if (event.data === window.YT.PlayerState.ENDED) {
              progressRef.current(Math.floor(player.current.getCurrentTime()), Math.floor(watched.current));
              endedRef.current();
            }
            // Pausing flushes immediately: somebody who pauses and navigates
            // away should not lose the last fifteen seconds of position.
            if (event.data === window.YT.PlayerState.PAUSED) {
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

      // One second of wall clock is one second watched only while the position
      // is actually advancing — that is what distinguishes watching from
      // scrubbing, and from leaving a paused tab open.
      lastTick.current = 0;
      ticker = setInterval(() => {
        const p = player.current;
        if (!p) return;
        const now = p.getCurrentTime();
        const delta = now - lastTick.current;
        if (delta > 0 && delta < 2) watched.current += delta;
        lastTick.current = now;

        if (watched.current >= reportEverySeconds) {
          progressRef.current(Math.floor(now), Math.floor(watched.current));
          watched.current = 0;
        }
      }, 1000);
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

  if (failed) {
    return (
      <div
        style={{
          aspectRatio: '16 / 9',
          borderRadius: 14,
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

  return (
    <div style={{ aspectRatio: '16 / 9', borderRadius: 14, overflow: 'hidden', background: '#000' }}>
      {/* The API replaces this node with the iframe, so it carries no styling
          of its own beyond filling the frame. */}
      <div ref={host} title={title} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
