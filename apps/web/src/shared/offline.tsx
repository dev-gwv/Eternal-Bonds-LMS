import { useEffect, useState } from 'react';

/** Honest offline state: queued progress writes flush on reconnect. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" style={{
      background: '#3a2b00', color: '#ffd77a', fontSize: 12, textAlign: 'center', padding: '8px 12px',
    }}>
      You're offline — progress and posts are queued on this device and will send when you reconnect.
    </div>
  );
}

/** Fire-and-forget product analytics via the API proxy (never blocks UI). */
export function track(event: string, properties?: Record<string, unknown>): void {
  try {
    fetch('/v1/analytics/track', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event, properties }),
      keepalive: true,
    }).catch(() => null);
  } catch { /* analytics never breaks the app */ }
}

/** Last-viewed course cache: the course page renders instantly, then refreshes. */
const KEY = 'ipc:last-course';
export function rememberCourse(slug: string): void {
  try { localStorage.setItem(KEY, slug); } catch { /* private mode */ }
}
export function lastCourse(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
