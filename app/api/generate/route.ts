import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildGenerationPrompt } from '@/lib/prompts';
import { FORMAT_SCHEMAS } from '@/lib/schemas';
import type { ArtifactContent } from '@/lib/schemas';
import { ProviderError, generateJson, isProviderConfigured } from '@/lib/provider';
import { validateArtifact } from '@/lib/validate';
import { briefWireSchema, ledgerWireSchema, sourceWireSchema } from '@/lib/wire';
import { FORMAT_IDS } from '@/lib/types';
import type { FactLedger, GenerationBrief, Source } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const requestSchema = z.object({
  format: z.enum(FORMAT_IDS),
  brief: briefWireSchema,
  source: sourceWireSchema.nullable(),
  ledger: ledgerWireSchema.nullable(),
  creativePrompt: z.string().optional(),
});

/**
 * Generates exactly one format. The client issues one request per selected
 * format with bounded concurrency, so a failure affects only that artefact and
 * can be retried on its own.
 */
export async function POST(request: Request) {
  if (!isProviderConfigured()) {
    return NextResponse.json(
      {
        error:
          'No AI provider key is configured. Add GEMINI_API_KEY to .env.local and restart the dev server.',
        code: 'not_configured',
        retryable: false,
      },
      { status: 503 },
    );
  }

  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Malformed generation request.' }, { status: 400 });
  }

  const brief = body.brief as GenerationBrief;
  const source = body.source as Source | null;
  const ledger = body.ledger as FactLedger | null;
  const grounded = brief.mode === 'grounded' && Boolean(source && ledger);

  const { system, prompt } = buildGenerationPrompt({
    format: body.format,
    brief,
    source,
    ledger,
    creativePrompt: body.creativePrompt,
  });

  try {
    const result = await generateJson({
      system,
      prompt,
      // Indexed by a runtime key, so the static type collapses to a union.
      // The schema selected at runtime is the correct one for this format.
      schema: FORMAT_SCHEMAS[body.format] as z.ZodType<ArtifactContent>,
      // Slightly more latitude for the social formats, which need a voice.
      temperature: body.format === 'linkedin' || body.format === 'x_thread' ? 0.7 : 0.4,
      maxOutputTokens: 8192,
    });

    const findings = validateArtifact({
      format: body.format,
      content: result.data,
      source,
      grounded,
    });

    if (result.repaired) {
      findings.push({
        type: 'repaired_output',
        severity: 'info',
        message: 'The first response was malformed and was regenerated against the schema.',
      });
    }

    return NextResponse.json({
      format: body.format,
      content: result.data,
      findings,
      latencyMs: result.latencyMs,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const provider = err instanceof ProviderError ? err : null;
    console.error(`[generate:${body.format}] failed`, provider?.code ?? err);
    return NextResponse.json(
      {
        format: body.format,
        error: provider?.message ?? 'Generation failed for this format.',
        code: provider?.code ?? 'upstream',
        retryable: provider?.retryable ?? true,
      },
      { status: 502 },
    );
  }
}
