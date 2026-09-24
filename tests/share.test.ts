import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { linkedinPostText, shareToLinkedIn, shareToX, xThreadText } from '@/lib/client/share';
import type { LinkedInPost, XThread } from '@/lib/schemas';

const post: LinkedInPost = {
  hook: 'A rainwater pilot cut household water use.',
  body: 'Consumption fell by 18% across 250 households over three months.',
  keyTakeaway: 'Small interventions add up.',
  callToAction: 'Read the full report.',
  hashtags: ['WaterConservation', '#Riverside'],
  evidence: ['src-1-p1-1'],
};

const single: XThread = {
  isThread: false,
  posts: [{ text: 'Household water use fell 18% across 250 homes in a three-month pilot.', evidence: [] }],
  callToAction: '',
};

const thread: XThread = {
  isThread: true,
  posts: [
    { text: 'A rainwater pilot cut household water use by 18%.', evidence: [] },
    { text: 'But: pilot population only, and rainfall was 23% above average.', evidence: [] },
  ],
  callToAction: '',
};

let written: string[];
let opened: string[];

beforeEach(() => {
  written = [];
  opened = [];
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: async (text: string) => {
        written.push(text);
      },
    },
  });
  vi.stubGlobal('window', {
    open: (url: string) => {
      opened.push(url);
      return {};
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('post text', () => {
  it('assembles the LinkedIn post as it should be published', () => {
    const text = linkedinPostText(post);

    expect(text).toContain('A rainwater pilot cut household water use.');
    expect(text).toContain('18% across 250 households');
    expect(text).toContain('Read the full report.');
    // Hashtags are normalised to exactly one leading hash.
    expect(text).toContain('#WaterConservation #Riverside');
    expect(text).not.toContain('##');
    // No run of blank lines that would look wrong when pasted.
    expect(text).not.toMatch(/\n{3}/);
  });

  it('numbers a thread but leaves a single post alone', () => {
    expect(xThreadText(single)).toBe(single.posts[0].text);

    const text = xThreadText(thread);
    expect(text).toContain('1/2');
    expect(text).toContain('2/2');
  });
});

describe('sharing to X', () => {
  it('opens the composer with the post already filled in', async () => {
    const outcome = await shareToX(single);

    expect(outcome.ok).toBe(true);
    expect(outcome).toMatchObject({ mode: 'prefilled' });
    expect(opened).toHaveLength(1);
    expect(opened[0]).toContain('x.com/intent/post');
    // The text survives URL encoding intact.
    expect(decodeURIComponent(opened[0])).toContain(single.posts[0].text);
  });

  it('copies the whole thread, since only the first post can be prefilled', async () => {
    const outcome = await shareToX(thread);

    expect(decodeURIComponent(opened[0])).toContain(thread.posts[0].text);
    expect(written[0]).toContain('2/2');
    expect(outcome.ok && outcome.message).toMatch(/post 1 of 2/i);
  });

  it('warns when the prefilled post is over the limit rather than silently truncating', async () => {
    const outcome = await shareToX({
      ...single,
      posts: [{ text: 'x'.repeat(320), evidence: [] }],
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.message).toMatch(/over the 280/i);
  });

  it('reports a blocked pop-up instead of failing silently', async () => {
    vi.stubGlobal('window', { open: () => null });
    const outcome = await shareToX(single);

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/pop-ups/i);
  });

  it('refuses an empty post', async () => {
    const outcome = await shareToX({ ...single, posts: [{ text: '   ', evidence: [] }] });
    expect(outcome.ok).toBe(false);
  });
});

describe('sharing to LinkedIn', () => {
  it('copies the post and opens the composer, because prefill is not possible', async () => {
    const outcome = await shareToLinkedIn(post);

    expect(outcome.ok).toBe(true);
    // Reported as copied, not prefilled: the distinction is the honest bit.
    expect(outcome).toMatchObject({ mode: 'copied' });
    expect(written[0]).toContain('18% across 250 households');
    expect(opened[0]).toContain('linkedin.com');
  });

  it('still opens the composer when the clipboard is unavailable, and says so', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: async () => {
          throw new Error('denied');
        },
      },
    });

    const outcome = await shareToLinkedIn(post);
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.message).toMatch(/could not be copied/i);
  });

  it('reports a blocked pop-up', async () => {
    vi.stubGlobal('window', { open: () => null });
    const outcome = await shareToLinkedIn(post);

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/pop-ups/i);
  });
});
