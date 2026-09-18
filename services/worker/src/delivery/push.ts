import { SignJWT, importPKCS8 } from 'jose';
import type { Env } from '../env.ts';

/**
 * Push notifications, behind one interface.
 *
 * FCM HTTP v1 for both Android and iOS — iOS rides on FCM rather than talking
 * to APNs directly, so there is one code path and one certificate to keep
 * alive instead of two.
 *
 * The console adapter is the default. Push needs a signed app on a real device
 * to test end to end, which does not exist yet (M7), and a logged payload is
 * more honest than a silent no-op.
 */

export type PushMessage = {
  token: string;
  title: string;
  body: string;
  /** Deep-link path, handled by the app's router. Not an absolute URL. */
  link: string;
};

export type PushResult = {
  ok: boolean;
  /** True when the provider says this token is dead and should be revoked. */
  unregistered: boolean;
  error?: string;
};

export interface Pusher {
  readonly name: string;
  send(message: PushMessage): Promise<PushResult>;
}

class ConsolePusher implements Pusher {
  readonly name = 'console';
  async send(message: PushMessage): Promise<PushResult> {
    console.log(
      JSON.stringify({
        push: 'would_send',
        // Never the whole token: it is a credential for somebody's device.
        token: `${message.token.slice(0, 8)}…`,
        title: message.title,
        link: message.link,
      }),
    );
    return { ok: true, unregistered: false };
  }
}

/**
 * FCM HTTP v1.
 *
 * Authenticated with a short-lived OAuth token exchanged from a service
 * account JWT. The token is cached until shortly before it expires — minting
 * one per notification would triple the latency of a fan-out and hammer
 * Google's token endpoint for no reason.
 */
class FcmPusher implements Pusher {
  readonly name = 'fcm';
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly env: Env) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;

    const key = await importPKCS8(this.env.FCM_PRIVATE_KEY.replace(/\\n/g, '\n'), 'RS256');
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(this.env.FCM_CLIENT_EMAIL)
      .setSubject(this.env.FCM_CLIENT_EMAIL)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!res.ok) {
      throw new Error(`Could not get an FCM access token (${res.status})`);
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  async send(message: PushMessage): Promise<PushResult> {
    try {
      const accessToken = await this.accessToken();
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${this.env.FCM_PROJECT_ID}/messages:send`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: message.token,
              notification: { title: message.title, body: message.body },
              // The link travels as data as well, because a notification
              // tapped while the app is in the foreground never reaches the
              // system tray and has to be routed by the app itself.
              data: { link: message.link },
              android: { priority: 'normal', notification: { click_action: 'FLUTTER_NOTIFICATION_CLICK' } },
              apns: {
                headers: { 'apns-priority': '5' },
                payload: { aps: { sound: 'default', 'content-available': 1 } },
              },
            },
          }),
        },
      );

      if (res.ok) return { ok: true, unregistered: false };

      const detail = (await res.json().catch(() => null)) as { error?: { status?: string } } | null;
      const status = detail?.error?.status;
      // UNREGISTERED and INVALID_ARGUMENT on a token mean the app was
      // uninstalled or the token rotated. Retrying forever would be pointless;
      // the caller revokes it instead.
      const unregistered = status === 'UNREGISTERED' || status === 'NOT_FOUND' || res.status === 404;
      return { ok: false, unregistered, error: status ?? `${res.status} ${res.statusText}` };
    } catch (error) {
      return { ok: false, unregistered: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export function createPusher(env: Env): Pusher {
  if (env.PUSH_PROVIDER === 'fcm' && env.FCM_PROJECT_ID && env.FCM_PRIVATE_KEY) return new FcmPusher(env);
  return new ConsolePusher();
}

/**
 * Whether a notification may buzz a phone right now.
 *
 * Quiet hours wrap midnight far more often than not (22:00 → 08:00), so the
 * comparison has to handle a window that crosses the day boundary — treating
 * it as a simple range silently disables quiet hours for everyone who set a
 * sensible one.
 */
export function withinQuietHours(nowMinutes: number, from: string, to: string): boolean {
  const parse = (value: string) => {
    const [h, m] = value.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const start = parse(from);
  const end = parse(to);
  return start <= end ? nowMinutes >= start && nowMinutes < end : nowMinutes >= start || nowMinutes < end;
}
