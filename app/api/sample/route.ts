import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ExtractionError, extractFromImageText, extractFromPdf } from '@/lib/extract';
import { ProviderError, isVisionConfigured, transcribeImage } from '@/lib/provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SAMPLES = {
  report: 'cyber-incident-report.pdf',
  image: 'news-clipping.png',
} as const;

type SampleId = keyof typeof SAMPLES;

/**
 * Loads a bundled sample and returns it already extracted.
 *
 * Files are read and parsed on the server rather than fetched as bytes by the
 * browser: some endpoint-security software silently blocks binary responses
 * from localhost, which would break the sample with no visible cause. Sending
 * JSON avoids that entirely and saves a round trip.
 */
export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get('type');
  const id: SampleId = requested === 'image' ? 'image' : 'report';
  const filename = SAMPLES[id];

  try {
    const bytes = await readFile(path.join(process.cwd(), 'samples', filename));

    if (id === 'image') {
      if (!isVisionConfigured()) {
        throw new ExtractionError(
          'Reading the image sample needs a Gemini key specifically, and none is configured. ' +
            'Try the PDF sample instead.',
          'invalid_input',
        );
      }
      const transcript = await transcribeImage(bytes.toString('base64'), 'image/png');
      const { source } = extractFromImageText(transcript.text, filename, transcript.model);
      return NextResponse.json({ source });
    }

    const { source } = await extractFromPdf(new Uint8Array(bytes), filename);
    return NextResponse.json({ source });
  } catch (err) {
    if (err instanceof ExtractionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof ProviderError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error('[sample] failed to load', err);
    return NextResponse.json(
      {
        error:
          'The bundled sample could not be loaded. Upload your own file or paste text instead.',
      },
      { status: 500 },
    );
  }
}
