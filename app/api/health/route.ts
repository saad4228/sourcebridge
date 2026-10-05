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
 * How long a deep check's answer stands for every visitor.
 *
 * The interface asks for the deep check once on load, which is one real model
 * call per page view. That is affordable for one operator and ruinous for a
 * demo: ten people opening the site and refreshing a few times spent dozens of
 * generations before anyone had generated anything, against an allowance
 * measured in tens per day.
 *
 * Whether the provider is reachable is a fact about the server, not about the
 * visitor, so one answer serves everyone. Kept short enough that a key fixed
 * in a dashboard shows up quickly without a redeploy.
 */
function cacheMs(): number {
  const configured = Number(process.env.HEALTH_CACHE_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : 5 * 60_000;
}

let cached: { at: number; body: Record<string, unknown> } | null = null;

/** Visible to tests, which must not inherit another case's answer. */
export function resetHealthCache(): void {
  cached = null;
}

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

  // One answer serves every visitor: reachability is a fact about the server.
  if (cached && Date.now() - cached.at < cacheMs()) {
    return NextResponse.json(
      { ...cached.body, cached: true, checkedMsAgo: Date.now() - cached.at },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let body: Record<string, unknown>;
  try {
    const result = await pingProvider();
    body = {
      configured: true,
      reachable: true,
      model: result.model,
      latencyMs: result.latencyMs,
      message: 'Provider reachable.',
    };
  } catch (err) {
    const provider = err instanceof ProviderError ? err : null;
    body = {
      configured: true,
      reachable: false,
      model: modelChain()[0]?.model ?? modelName(),
      code: provider?.code ?? 'upstream',
      message: provider?.message ?? 'Provider call failed.',
    };
  }

  // A failure is cached too, and deliberately: a spent allowance does not
  // recover in the next few minutes, and re-probing it once per visitor was
  // spending the very thing that had run out.
  cached = { at: Date.now(), body };
  return NextResponse.json(body, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
