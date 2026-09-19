import { describe, expect, test } from 'bun:test';
import { activityEmail, digestEmail } from '../services/worker/src/delivery/email.ts';
import { timingSafeEqual } from '../services/api/src/lib/video-provider.ts';

/**
 * Email rendering and webhook signature verification.
 *
 * These two carry real consequences and give no feedback when wrong: a broken
 * template reaches members before anyone notices, and a signature check that
 * accepts anything hands out memberships to whoever posts to the webhook. Both
 * are pure functions, so both are cheap to pin down here.
 */

describe('digest email', () => {
  const stats = { minutes: 145, xp: 320, lessons: 4 };

  test('renders hours and minutes, not raw minutes', () => {
    const email = digestEmail('Aditya Kulkarni', stats, 'https://app.example.com');
    expect(email.text).toContain('2h 25m');
    expect(email.html).toContain('2h 25m');
  });

  test('uses the first name only', () => {
    const email = digestEmail('Aditya Kulkarni', stats, 'https://app.example.com');
    expect(email.html).toContain('Aditya');
    expect(email.html).not.toContain('Kulkarni');
  });

  // A text/plain part materially improves deliverability, and a template that
  // quietly loses it is a template that lands in spam.
  test('always has both parts', () => {
    const email = digestEmail('Test', stats, 'https://app.example.com');
    expect(email.html.length).toBeGreaterThan(200);
    expect(email.text.length).toBeGreaterThan(20);
  });

  test('links point at the configured app, not a hardcoded host', () => {
    const email = digestEmail('Test', stats, 'https://custom.example.in');
    expect(email.text).toContain('https://custom.example.in');
    expect(email.html).toContain('https://custom.example.in');
  });

  test('under an hour reads as minutes alone', () => {
    const email = digestEmail('Test', { minutes: 42, xp: 10, lessons: 1 }, 'https://a.test');
    expect(email.text).toContain('42m');
    expect(email.text).not.toContain('0h');
  });
});

describe('activity email', () => {
  // Member-written text reaches these templates. An unescaped `<script>` in a
  // comment body would be a stored XSS delivered by us, to an inbox.
  test('escapes member-supplied text', () => {
    const email = activityEmail(
      'Someone replied',
      '<script>alert(1)</script> nice shot',
      '/community',
      'https://a.test',
    );
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  test('escapes the subject line too', () => {
    const email = activityEmail('<img src=x onerror=1>', 'body', '/x', 'https://a.test');
    expect(email.html).not.toContain('<img src=x');
  });

  test('builds an absolute link from the in-app path', () => {
    const email = activityEmail('t', 'b', '/community?post=abc', 'https://a.test');
    expect(email.text).toContain('https://a.test/community?post=abc');
  });
});

/** The exact scheme Razorpay uses: HMAC-SHA256 of the raw body, hex digest. */
async function razorpaySignature(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('razorpay webhook signature', () => {
  const secret = 'whsec_test_1234567890';
  const body = JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_abc', order_id: 'order_xyz', amount: 1499900 } } },
  });

  test('a genuine signature verifies', async () => {
    const sig = await razorpaySignature(secret, body);
    expect(timingSafeEqual(sig, await razorpaySignature(secret, body))).toBe(true);
  });

  test('a different secret does not', async () => {
    const mine = await razorpaySignature(secret, body);
    const theirs = await razorpaySignature('whsec_wrong', body);
    expect(timingSafeEqual(mine, theirs)).toBe(false);
  });

  // This is the one that matters: the signature covers the *raw* body, so an
  // attacker editing the amount after signing must not verify.
  test('a tampered amount does not', async () => {
    const original = await razorpaySignature(secret, body);
    const tampered = body.replace('1499900', '100');
    expect(timingSafeEqual(original, await razorpaySignature(secret, tampered))).toBe(false);
  });

  test('re-serialising the body breaks the signature', async () => {
    // Why the handler reads c.req.text() and never c.req.json(): JSON.parse
    // then JSON.stringify produces a different string, and a handler that
    // verified against *that* would reject every genuine delivery.
    const reserialised = JSON.stringify(JSON.parse(body));
    const spaced = JSON.stringify(JSON.parse(body), null, 2);
    expect(reserialised).toBe(body);
    expect(await razorpaySignature(secret, spaced)).not.toBe(await razorpaySignature(secret, body));
  });

  test('an empty signature never verifies', async () => {
    expect(timingSafeEqual(await razorpaySignature(secret, body), '')).toBe(false);
  });
});
