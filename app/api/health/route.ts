import { NextResponse } from 'next/server';
import {
  isProviderConfigured,
  modelChain,
  modelName,
  pingProvider,
  ProviderError,
} from '@/lib/provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reports whether the server can reach the AI provider.
 * Returns only status information -- never the key itself.
 */
export async function GET(request: Request) {
  // Reaching the provider costs a real model call, so it happens only when
  // asked for. A hosting platform polling this path as its liveness check
  // would otherwise spend the whole daily allowance on an idle site: at one
  // probe every thirty seconds that is thousands of calls a day with nobody
  // using it. The interface asks for the deep check once, on load.
  const deep = new URL(request.url).searchParams.get('deep') === '1';

  if (!deep) {
    return NextResponse.json(
      { configured: isProviderConfigured(), reachable: null, message: 'Server is up.' },
      { status: 200 },
    );
  }

  if (!isProviderConfigured()) {
    return NextResponse.json(
      {
        configured: false,
        reachable: false,
        message:
          'No API key found. Add GEMINI_API_KEY or GROQ_API_KEY to .env.local, then restart ' +
          'the dev server.',
      },
      { status: 200 },
    );
  }

  try {
    const result = await pingProvider();
    return NextResponse.json({
      configured: true,
      reachable: true,
      model: result.model,
      latencyMs: result.latencyMs,
      message: 'Provider reachable.',
    });
  } catch (err) {
    const provider = err instanceof ProviderError ? err : null;
    return NextResponse.json(
      {
        configured: true,
        reachable: false,
        model: modelChain()[0]?.model ?? modelName(),
        code: provider?.code ?? 'upstream',
        message: provider?.message ?? 'Provider call failed.',
      },
      { status: 200 },
    );
  }
}
