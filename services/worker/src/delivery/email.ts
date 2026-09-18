import type { Env } from '../env.ts';

/**
 * Sending email, behind one interface.
 *
 * Two implementations: Resend, and a console one that logs what it would have
 * sent. The console adapter is the default and is not a placeholder — sending
 * from a domain without SPF, DKIM and DMARC is how a club's address ends up on
 * a blocklist on its first campaign, permanently. Until those records exist,
 * logging is the correct behaviour, and `EMAIL_PROVIDER` is what changes it.
 */

export type Email = {
  to: string;
  subject: string;
  /** Both, always. A text/plain part materially improves deliverability. */
  html: string;
  text: string;
};

export interface Mailer {
  readonly name: string;
  send(email: Email): Promise<{ id: string }>;
}

class ConsoleMailer implements Mailer {
  readonly name = 'console';
  async send(email: Email) {
    console.log(
      JSON.stringify({
        mail: 'would_send',
        to: redact(email.to),
        subject: email.subject,
        chars: email.text.length,
      }),
    );
    return { id: `console-${crypto.randomUUID()}` };
  }
}

class ResendMailer implements Mailer {
  readonly name = 'resend';
  constructor(private readonly env: Env) {}

  async send(email: Email) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.env.EMAIL_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.env.EMAIL_FROM,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(this.env.EMAIL_REPLY_TO ? { reply_to: this.env.EMAIL_REPLY_TO } : {}),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      // Thrown, not swallowed: the caller records the failure against the
      // notification so it is visible rather than silently undelivered.
      throw new Error(`Resend rejected the message (${res.status}): ${detail.slice(0, 200)}`);
    }
    const body = (await res.json()) as { id: string };
    return { id: body.id };
  }
}

export function createMailer(env: Env): Mailer {
  if (env.EMAIL_PROVIDER === 'resend' && env.EMAIL_API_KEY) return new ResendMailer(env);
  return new ConsoleMailer();
}

/** Logs are read by people; a full address in one is a small data leak. */
function redact(address: string): string {
  const [name, domain] = address.split('@');
  if (!domain) return '***';
  return `${name?.slice(0, 2) ?? ''}***@${domain}`;
}

/* ── Templates ─────────────────────────────────────────────────────────────
   Plain, inline-styled HTML. Mail clients in 2026 still have the CSS support
   of a browser from 2005, so there is no framework here on purpose. */

const shell = (title: string, body: string, appUrl: string) => `
<!doctype html>
<html><body style="margin:0;padding:24px;background:#edeff7;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#2e2e38">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:28px">
    <div style="font-size:11px;letter-spacing:.14em;color:#8a8a99;text-transform:uppercase">Eternal Bonds</div>
    <h1 style="font-size:19px;font-weight:600;margin:14px 0 16px">${escapeHtml(title)}</h1>
    ${body}
    <div style="margin-top:26px;padding-top:16px;border-top:1px solid #f0f0f4;font-size:11px;color:#a8a8b8">
      You are receiving this because you are a member.
      <a href="${appUrl}/account" style="color:#e1588f">Change what you get emailed</a>.
    </div>
  </div>
</body></html>`;

export function digestEmail(
  name: string,
  stats: { minutes: number; xp: number; lessons: number },
  appUrl: string,
): Email {
  const hours = Math.floor(stats.minutes / 60);
  const rest = stats.minutes % 60;
  const spent = hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;

  const html = shell(
    `Your week, ${escapeHtml(name.split(' ')[0] ?? 'there')}`,
    `<p style="font-size:14px;line-height:1.6;margin:0 0 14px">
       You spent <strong>${spent}</strong> learning this week and earned <strong>${stats.xp} XP</strong>${
         stats.lessons > 0 ? `, finishing <strong>${stats.lessons}</strong> lesson${stats.lessons === 1 ? '' : 's'}` : ''
       }.</p>
     <p style="margin:0 0 20px"><a href="${appUrl}" style="display:inline-block;background:#f48fb1;color:#fff;text-decoration:none;font-size:13px;padding:10px 20px;border-radius:999px">Pick up where you left off</a></p>`,
    appUrl,
  );

  const text = `Your week at Eternal Bonds\n\n${spent} learning, ${stats.xp} XP${
    stats.lessons > 0 ? `, ${stats.lessons} lesson(s) finished` : ''
  }.\n\nPick up where you left off: ${appUrl}\n`;

  return { to: '', subject: `Your week: ${spent} and ${stats.xp} XP`, html, text };
}

export function activityEmail(title: string, body: string, link: string, appUrl: string): Email {
  const url = `${appUrl}${link}`;
  return {
    to: '',
    subject: title,
    html: shell(
      title,
      `<p style="font-size:14px;line-height:1.6;margin:0 0 18px">${escapeHtml(body)}</p>
       <p style="margin:0"><a href="${url}" style="display:inline-block;background:#f48fb1;color:#fff;text-decoration:none;font-size:13px;padding:10px 20px;border-radius:999px">Open it</a></p>`,
      appUrl,
    ),
    text: `${title}\n\n${body}\n\n${url}\n`,
  };
}

/** Member-supplied text reaches these templates; it has to be escaped. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
