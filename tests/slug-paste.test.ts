import { describe, expect, test } from 'bun:test';

/**
 * The address field on the new-course form, and the one paste it has to survive.
 *
 * Somebody pasted a YouTube link into the field labelled "URL" and the form
 * went dead with no explanation. The first fix normalised the paste with
 * `slugify`, which turned it into `https-www-youtube-com-watch-v-gmsq0199bw0`
 * — a string that passes the slug rule. The form went green and would have
 * created a course living at that address, which is a worse failure than the
 * one it replaced: nothing on screen says anything is wrong.
 *
 * So the field now recognises a pasted link and refuses it rather than
 * laundering it into a valid-looking address.
 */

const looksLikeUrl = (v: string) => /^[a-z]+:\/\//i.test(v) || /^(www\.|[\w-]+\.[a-z]{2,})/i.test(v);

describe('a pasted link is not an address', () => {
  test.each([
    'https://www.youtube.com/watch?v=GmsQ0199BW0',
    'http://youtu.be/GmsQ0199BW0',
    'www.youtube.com/watch?v=GmsQ0199BW0',
    'youtube.com/watch?v=GmsQ0199BW0',
    'drive.google.com/file/d/abc/view',
    'https://vimeo.com/12345',
  ])('rejects %s', (v) => {
    expect(looksLikeUrl(v)).toBe(true);
  });

  test.each([
    'lighting-for-indian-weddings',
    'week-one',
    'mission-1-crore',
    'test',
    'a-b-c',
    // A title that has not been slugified yet still is not a URL.
    'Lighting for Indian weddings',
  ])('accepts %s', (v) => {
    expect(looksLikeUrl(v)).toBe(false);
  });
});
