import { useEffect, useRef } from 'react';
import { api } from '../api.ts';

/**
 * Reports which posts have actually been on screen.
 *
 * Three decisions worth stating, because the naive version of this is wrong in
 * all three ways:
 *
 *   - **IntersectionObserver, not "it rendered".** A post twenty screens down
 *     in the DOM has not been seen by anybody. Requiring half of it to be
 *     visible for a moment is the closest a browser gets to "a person read
 *     this".
 *   - **Batched and debounced.** Scrolling fires dozens of intersections a
 *     second; one request per post would be one request per scroll tick.
 *   - **Fire and forget.** A failed view count is not worth an error over
 *     somebody's feed. The server deduplicates, so a lost batch costs nothing
 *     and a repeated one costs nothing either.
 */
export function useSeen() {
  const pending = useRef(new Set<string>());
  const reported = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observer = useRef<IntersectionObserver | null>(null);

  const flush = () => {
    const batch = [...pending.current].filter((id) => !reported.current.has(id));
    pending.current.clear();
    if (batch.length === 0) return;
    for (const id of batch) reported.current.add(id);
    // The server caps a batch at 50.
    void api.recordPostViews(batch.slice(0, 50)).catch(() => {
      // Deliberately silent: the count is a nicety, the feed is the point.
    });
  };

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;

    observer.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.postId;
          if (!entry.isIntersecting || !id || reported.current.has(id)) continue;
          pending.current.add(id);
        }
        if (pending.current.size === 0) return;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, 1200);
      },
      // Half the card, so a post skimmed past at speed does not count.
      { threshold: 0.5 },
    );

    return () => {
      observer.current?.disconnect();
      if (timer.current) clearTimeout(timer.current);
      // Send whatever is still queued rather than losing it on navigation.
      flush();
    };
  }, []);

  /** Attach to each post element: ref={seen(post.id)} */
  return (id: string) => (node: HTMLElement | null) => {
    if (!node || !observer.current) return;
    node.dataset.postId = id;
    observer.current.observe(node);
  };
}
