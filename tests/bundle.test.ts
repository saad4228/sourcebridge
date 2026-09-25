import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { renderBundle } from '@/lib/export/bundle';
import { canonical, sha256Hex, verifyAuditChain } from '@/lib/audit';
import type { Infographic, LinkedInPost, Presentation } from '@/lib/schemas';
import type { GenerationBrief } from '@/lib/types';

const deck: Presentation = {
  title: 'Pilot results',
  subtitle: '',
  slides: [
    {
      title: 'Consumption fell 18.0%',
      layout: 'bullets',
      mainMessage: 'The pilot reduced household water use.',
      bullets: ['250 households took part'],
      speakerNotes: 'Pilot population only.',
      visualType: 'chart',
      evidence: ['src-1-p1-1'],
    },
  ],
};

const post: LinkedInPost = {
  hook: 'A pilot cut water use.',
  body: 'Consumption fell by 18.0% across 250 households.',
  keyTakeaway: 'Small interventions add up.',
  callToAction: '',
  hashtags: ['WaterConservation'],
  evidence: ['src-1-p1-1'],
};

const infographic: Infographic = {
  headline: 'A pilot cut household water use',
  subheadline: '',
  layout: 'stats',
  keyMessages: [{ label: 'Lower demand', detail: 'Use fell across four wards.', evidence: [] }],
  statistics: [{ value: '18.0', unit: '%', caption: 'Fall in household use', evidence: [] }],
  sourceFooter: 'Pilot report',
  altText: 'Household water use fell 18.0%.',
};

const brief: GenerationBrief = {
  mode: 'grounded',
  audience: 'General public',
  objective: 'Inform',
  tone: 'Accessible',
  language: 'English',
  detail: 'Standard',
  formats: ['presentation', 'linkedin', 'infographic'],
};

describe('bundle export', () => {
  it('writes Markdown for every format plus the richer files', async () => {
    const { bytes, skipped } = await renderBundle(
      [
        { format: 'presentation', content: deck },
        { format: 'linkedin', content: post },
        { format: 'infographic', content: infographic },
      ],
      'report.pdf',
      brief,
    );

    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);

    expect(skipped).toEqual([]);
    for (const file of [
      'README.md',
      'presentation.md',
      'presentation.pptx',
      'linkedin-post.md',
      'infographic.md',
      'infographic.svg',
    ]) {
      expect(names).toContain(file);
    }
  });

  it('produces a nested .pptx that is valid OOXML', async () => {
    const { bytes } = await renderBundle([{ format: 'presentation', content: deck }], 'report.pdf');
    const zip = await JSZip.loadAsync(bytes);
    const inner = await JSZip.loadAsync(await zip.file('presentation.pptx')!.async('uint8array'));

    expect(Object.keys(inner.files)).toContain('ppt/presentation.xml');
  });

  it('skips an artefact whose content no longer matches its schema, and says so', async () => {
    const { bytes, skipped } = await renderBundle(
      [
        { format: 'presentation', content: deck },
        // Missing required fields: this must be reported, not silently dropped.
        { format: 'linkedin', content: { hook: 'only a hook' } },
      ],
      'report.pdf',
    );

    expect(skipped).toHaveLength(1);
    expect(skipped[0].format).toBe('linkedin');

    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).not.toContain('linkedin-post.md');

    const readme = await zip.file('README.md')!.async('string');
    expect(readme).toContain('Not included');
    expect(readme).toContain('LinkedIn post');
  });

  it('carries the review warning and states the mode', async () => {
    const { bytes } = await renderBundle([{ format: 'linkedin', content: post }], null, {
      ...brief,
      mode: 'creative',
    });

    const zip = await JSZip.loadAsync(bytes);
    const readme = await zip.file('README.md')!.async('string');

    expect(readme).toMatch(/requires human review/i);
    expect(readme).toMatch(/creative draft mode/i);
    expect(readme).toMatch(/nothing here is source-verified/i);
  });

  it('exports the edited content, not the generated original', async () => {
    const edited: LinkedInPost = { ...post, hook: 'Operator rewrote this hook' };
    const { bytes } = await renderBundle([{ format: 'linkedin', content: edited }], 'report.pdf');

    const zip = await JSZip.loadAsync(bytes);
    const markdown = await zip.file('linkedin-post.md')!.async('string');

    expect(markdown).toContain('Operator rewrote this hook');
    expect(markdown).not.toContain('A pilot cut water use.');
  });
});

describe('provenance record', () => {
  const provenance = {
    source: { title: 'incident.pdf', kind: 'pdf', text: '37 systems were affected.' },
    ledger: { facts: [{ claim: '37 systems affected' }] },
  };

  it('ships a chain that verifies', async () => {
    const { bytes } = await renderBundle(
      [
        { format: 'presentation', content: deck },
        { format: 'linkedin', content: post },
      ],
      'incident.pdf',
      brief,
      provenance,
    );
    const zip = await JSZip.loadAsync(bytes);
    const record = JSON.parse(await zip.file('provenance.json')!.async('string'));

    expect(await verifyAuditChain(record.entries)).toEqual({ ok: true });
    // Source, ledger, then one entry per artefact actually written.
    expect(record.entries.map((e: { kind: string }) => e.kind)).toEqual([
      'source',
      'ledger',
      'artifact',
      'artifact',
    ]);
  });

  it('detects a swapped artefact after export', async () => {
    const { bytes } = await renderBundle(
      [{ format: 'linkedin', content: post }],
      'incident.pdf',
      brief,
      provenance,
    );
    const zip = await JSZip.loadAsync(bytes);
    const record = JSON.parse(await zip.file('provenance.json')!.async('string'));

    // Someone edits the artefact and recomputes only its own content hash.
    record.entries[2].contentHash = await sha256Hex(canonical({ body: 'doctored' }));

    expect((await verifyAuditChain(record.entries)).ok).toBe(false);
  });

  it('records only the artefacts that were actually included', async () => {
    // A format whose renderer failed must not appear in the record, or the
    // chain would describe a bundle the recipient does not have.
    const { bytes, skipped } = await renderBundle(
      [
        { format: 'linkedin', content: post },
        { format: 'presentation', content: { nonsense: true } },
      ],
      'incident.pdf',
      brief,
      provenance,
    );
    const zip = await JSZip.loadAsync(bytes);
    const record = JSON.parse(await zip.file('provenance.json')!.async('string'));

    expect(skipped).toHaveLength(1);
    expect(record.entries.filter((e: { kind: string }) => e.kind === 'artifact')).toHaveLength(1);
  });

  it('states plainly what the record is not', async () => {
    const { bytes } = await renderBundle([{ format: 'linkedin', content: post }], null, brief);
    const zip = await JSZip.loadAsync(bytes);

    const text = await zip.file('provenance.txt')!.async('string');
    expect(text).toContain('not a blockchain');

    const readme = await zip.file('README.md')!.async('string');
    expect(readme).toContain('hash chain, not a blockchain');
  });
});
