import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildAnalysisPrompt } from '@/lib/prompts';
import { factLedgerSchema } from '@/lib/schemas';
import { ProviderError, generateJson, isProviderConfigured } from '@/lib/provider';
import { sourceWireSchema } from '@/lib/wire';
import type { FactLedger, Source } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const requestSchema = z.object({
  source: sourceWireSchema,
  context: z.string().optional(),
});

/**
 * Produces the shared fact ledger. This runs once per source; every format then
 * generates from the same ledger, which is what keeps figures consistent across
 * outputs.
 */
export async function POST(request: Request) {
  if (!isProviderConfigured()) {
    return NextResponse.json(
      {
        error:
          'No AI provider key is configured. Add GEMINI_API_KEY to .env.local and restart the dev server.',
        code: 'not_configured',
      },
      { status: 503 },
    );
  }

  let source: Source;
  let context: string | undefined;
  try {
    const body = requestSchema.parse(await request.json());
    source = body.source as Source;
    context = body.context;
  } catch {
    return NextResponse.json({ error: 'Malformed analysis request.' }, { status: 400 });
  }

  const { system, prompt } = buildAnalysisPrompt(source, context);

  try {
    const result = await generateJson({
      system,
      prompt,
      schema: factLedgerSchema,
      temperature: 0.2,
      maxOutputTokens: 8192,
    });

    // Drop references the model invented, and say so rather than hiding it.
    const validIds = new Set(source.segments.map((s) => s.id));
    const warnings = [...result.data.warnings];
    let droppedCount = 0;

    const facts = result.data.facts.map((fact) => {
      const kept = fact.evidence.filter((id) => validIds.has(id));
      droppedCount += fact.evidence.length - kept.length;
      return { ...fact, evidence: kept };
    });

    if (droppedCount > 0) {
      warnings.push(
        `${droppedCount} evidence reference${droppedCount > 1 ? 's' : ''} produced during analysis ` +
          `did not match a real passage and ${droppedCount > 1 ? 'were' : 'was'} removed.`,
      );
    }
    if (result.repaired) {
      warnings.push('The first analysis response was malformed and had to be repaired.');
    }

    const ledger: FactLedger = {
      topic: result.data.topic,
      facts,
      entities: result.data.entities,
      sourceActions: result.data.sourceActions,
      missingInformation: result.data.missingInformation,
      caveats: result.data.caveats,
      warnings,
    };

    return NextResponse.json({ ledger, latencyMs: result.latencyMs });
  } catch (err) {
    const provider = err instanceof ProviderError ? err : null;
    console.error('[analyze] failed', provider?.code ?? err);
    return NextResponse.json(
      {
        error: provider?.message ?? 'Source analysis failed.',
        code: provider?.code ?? 'upstream',
        retryable: provider?.retryable ?? true,
      },
      { status: 502 },
    );
  }
}
