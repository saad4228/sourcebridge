import { describe, expect, it } from 'vitest';
import { ExtractionError, extractFromArticle, extractFromImageText, extractFromVideoText } from '@/lib/extract';

describe('image sources', () => {
  const transcript = [
    'Rainwater Harvesting Pilot',
    '250 households participated across four wards.',
    'Average consumption fell by 18.0%.',
  ].join('\n');

  it('always warns that the text is a model transcription', () => {
    const { source } = extractFromImageText(transcript, 'clipping.png', 'gemini-flash-lite-latest');

    expect(source.kind).toBe('image');
    expect(source.warnings[0]).toMatch(/vision model/i);
    // The model name is named so the operator knows what read it.
    expect(source.warnings[0]).toContain('gemini-flash-lite-latest');
    expect(source.warnings[0]).toMatch(/may have been misread/i);
  });

  it('surfaces unreadable regions rather than hiding them', () => {
    const { source } = extractFromImageText(
      `${transcript}\nCost was [unreadable] rupees.`,
      'clipping.png',
      'm',
    );
    expect(source.warnings.some((w) => /unreadable/i.test(w))).toBe(true);
  });

  it('rejects an image with no readable content', () => {
    expect(() => extractFromImageText('  ', 'photo.png', 'm')).toThrow(ExtractionError);
    expect(() => extractFromImageText('abc', 'photo.png', 'm')).toThrow(/No readable text/i);
  });

  it('preserves figures exactly', () => {
    const { source } = extractFromImageText(transcript, 'clipping.png', 'm');
    expect(source.text).toContain('18.0%');
    expect(source.text).toContain('250 households');
  });
});

describe('video sources', () => {
  it('collapses lines repeated across sampled frames', () => {
    const transcript = [
      'Bhoomi-1 Mission Brief',
      'Orbit altitude: 705 km',
      'Orbit altitude: 705 km',
      'Orbit altitude: 705 km',
      'Cost: Rs 1,240 crore',
      'Cost: Rs 1,240 crore',
    ].join('\n');

    const { source } = extractFromVideoText(transcript, 'clip.mp4', 'm');
    const lines = source.text.split('\n');

    expect(lines).toEqual([
      'Bhoomi-1 Mission Brief',
      'Orbit altitude: 705 km',
      'Cost: Rs 1,240 crore',
    ]);
  });

  it('keeps a repeated line that is not adjacent', () => {
    // A phrase genuinely said twice, with something between, must survive.
    const transcript = ['We begin.', 'Cost: Rs 1,240 crore', 'A different line.', 'We begin.'].join('\n');
    const { source } = extractFromVideoText(transcript, 'clip.mp4', 'm');

    expect(source.text.match(/We begin\./g)).toHaveLength(2);
  });

  it('warns that the transcript is AI-produced and frame-sampled', () => {
    const { source } = extractFromVideoText('Narration line one.\nNarration line two.', 'clip.mp4', 'gm');

    expect(source.kind).toBe('video');
    expect(source.warnings[0]).toMatch(/transcribed from a video by an AI model/i);
    expect(source.warnings[0]).toMatch(/samples frames/i);
  });

  it('flags unclear passages', () => {
    const { source } = extractFromVideoText('The cost was [unclear] crore.\nSecond line here.', 'c.mp4', 'm');
    expect(source.warnings.some((w) => /unclear/i.test(w))).toBe(true);
  });

  it('rejects a video with no speech or on-screen text', () => {
    expect(() => extractFromVideoText('', 'clip.mp4', 'm')).toThrow(/No speech or on-screen text/i);
  });
});

describe('article sources', () => {
  const article = [
    'Satellite launched',
    'India launched the Bhoomi-1 satellite on 12 March 2026 at a cost of Rs 1,240 crore.',
    'It orbits at 705 km and will operate for 7 years according to the agency.',
  ].join('\n');

  it('carries the fetch warnings through to the source', () => {
    const { source } = extractFromArticle(article, 'Satellite launched', [
      'Extracted from a web page. Site layouts vary.',
    ]);

    expect(source.kind).toBe('url');
    expect(source.title).toBe('Satellite launched');
    expect(source.warnings[0]).toMatch(/web page/i);
  });

  it('segments the article and preserves figures', () => {
    const { source } = extractFromArticle(article, 'Satellite launched', []);

    expect(source.segments.length).toBeGreaterThan(0);
    expect(source.text).toContain('Rs 1,240 crore');
    expect(source.text).toContain('705 km');
  });

  it('rejects a page larger than the character limit', () => {
    expect(() => extractFromArticle('word '.repeat(60_000), 'Huge', [])).toThrow(/character limit/i);
  });
});
