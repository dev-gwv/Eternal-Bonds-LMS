/**
 * Product analytics. Sentry catches errors, not behaviour — PostHog
 * (self-hostable, keeps the portability story) owns funnels:
 * signup → first lesson → first insight.
 *
 * The browser never talks to PostHog directly: this endpoint proxies
 * server-side so ad-blockers do not silently halve the numbers and so no
 * tracking key ships in the bundle. When POSTHOG_KEY is unset the calls
 * are logged and dropped — analytics must never break the app.
 */

export type AnalyticsEvent = {
  userId?: string;
  event: string;
  properties?: Record<string, unknown>;
};

export async function track(env: Record<string, string | undefined>, e: AnalyticsEvent): Promise<void> {
  const key = env.POSTHOG_KEY;
  const host = env.POSTHOG_HOST ?? 'https://app.posthog.com';
  if (!key) {
    console.log(JSON.stringify({ analytics: e.event, userId: e.userId ?? null }));
    return;
  }
  try {
    await fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: key, distinct_id: e.userId ?? 'anon', event: e.event, properties: e.properties ?? {} }),
    });
  } catch {
    // Analytics failure is never a request failure.
  }
}
