import { NextResponse } from 'next/server';
import {
  ExtractionError,
  IMAGE_TYPES,
  LIMITS,
  VIDEO_TYPES,
  extractFromArticle,
  extractFromImageText,
  extractFromPdf,
  extractFromText,
  extractFromVideoText,
} from '@/lib/extract';
import { ProviderError, isVisionConfigured, transcribeMedia } from '@/lib/provider';
import { UrlFetchError, fetchArticle } from '@/lib/fetchUrl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Validates and extracts a source.
 *
 * Accepts a multipart upload (text-based PDF, image or short video), or JSON
 * carrying `{ url }` or `{ text, title }`. Extraction happens once; the result
 * is held in client state and reused for every format.
 *
 * Images and video are read by the provider's model — a transcription, not a
 * literal extraction — so those paths need an API key and attach a warning.
 */
export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') ?? '';

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');

      if (!(file instanceof File)) {
        throw new ExtractionError('No file was received.', 'invalid_input');
      }

      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const isImage =
        (IMAGE_TYPES as readonly string[]).includes(file.type) ||
        /\.(png|jpe?g|webp|heic)$/i.test(file.name);
      const isVideo =
        (VIDEO_TYPES as readonly string[]).includes(file.type) ||
        /\.(mp4|webm|mov|mpeg|mpg)$/i.test(file.name);

      if (isPdf) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { source } = await extractFromPdf(bytes, file.name);
        return NextResponse.json({ source });
      }

      if (isImage || isVideo) {
        const kind = isVideo ? 'video' : 'image';
        const limit = isVideo ? LIMITS.maxVideoBytes : LIMITS.maxImageBytes;

        if (!isVisionConfigured()) {
          throw new ExtractionError(
            `Reading ${isVideo ? 'a video' : 'an image'} needs a Gemini key specifically, and none ` +
              `is configured. Add GEMINI_API_KEY to .env.local, or paste the text instead.`,
            'invalid_input',
          );
        }
        if (file.size > limit) {
          throw new ExtractionError(
            `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the ` +
              `${limit / 1024 / 1024} MB ${kind} limit.` +
              (isVideo ? ' Use a shorter clip.' : ''),
            'too_large',
          );
        }

        const allowed = isVideo ? VIDEO_TYPES : IMAGE_TYPES;
        const mimeType = (allowed as readonly string[]).includes(file.type)
          ? file.type
          : isVideo
            ? 'video/mp4'
            : 'image/png';

        const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');
        const transcript = await transcribeMedia(base64, mimeType, kind);

        const { source } = isVideo
          ? extractFromVideoText(transcript.text, file.name, transcript.model)
          : extractFromImageText(transcript.text, file.name, transcript.model);

        return NextResponse.json({ source });
      }

      throw new ExtractionError(
        `${file.name} is not a supported file. SourceBridge accepts text-based PDFs, images ` +
          `(PNG, JPEG, WebP), short videos (MP4, WebM, MOV), article URLs and pasted text. ` +
          `DOCX is not implemented.`,
        'invalid_input',
      );
    }

    const body = (await request.json()) as { text?: string; title?: string; url?: string };

    if (body.url?.trim()) {
      const article = await fetchArticle(body.url.trim());
      const { source } = extractFromArticle(article.text, article.title, article.warnings);
      return NextResponse.json({ source });
    }

    const { source } = extractFromText(body.text ?? '', body.title);
    return NextResponse.json({ source });
  } catch (err) {
    if (err instanceof ExtractionError) {
      return NextResponse.json(
        { error: err.message, kind: err.kind, limits: LIMITS },
        { status: 400 },
      );
    }
    if (err instanceof UrlFetchError) {
      return NextResponse.json({ error: err.message, kind: err.kind }, { status: 400 });
    }
    if (err instanceof ProviderError) {
      // Reading media can fail on the provider rather than on the file.
      return NextResponse.json({ error: err.message, kind: 'provider' }, { status: 502 });
    }
    // Never surface a raw stack trace to the operator.
    console.error('[extract] unexpected failure', err);
    return NextResponse.json(
      { error: 'The source could not be processed. Try again, or paste the text instead.' },
      { status: 500 },
    );
  }
}
