import { describe, expect, test } from 'bun:test';
import { youtubeId } from '../services/api/src/lib/video-provider.ts';

/**
 * Link parsing, because the author pastes whatever the browser gave them.
 *
 * The shapes below are all real: the address bar, the Share button, the mobile
 * app, an embed snippet copied from elsewhere. Asking somebody to extract an
 * 11-character id by hand is the kind of small friction that ends with the
 * wrong video attached to a lesson.
 */
describe('youtubeId', () => {
  test.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?t=42', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share', 'dQw4w9WgXcQ'],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ', 'dQw4w9WgXcQ'],
  ])('reads %s', (input, expected) => {
    expect(youtubeId(input)).toBe(expected);
  });

  test.each([
    ['https://vimeo.com/12345'],
    ['not a url'],
    [''],
    ['https://youtube.com/watch?v=too-short'],
  ])('refuses %s', (input) => {
    expect(youtubeId(input)).toBeNull();
  });

  // The host check is the security-relevant half: a link that merely *looks*
  // like YouTube must not be accepted, or an author could be tricked into
  // embedding an attacker's page in a lesson.
  test('refuses a lookalike host carrying a valid-looking id', () => {
    expect(youtubeId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(youtubeId('https://notyoutube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(youtubeId('https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ')).toBeNull();
  });
});
