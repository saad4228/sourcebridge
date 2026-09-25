'use client';

/**
 * The SourceBridge workspace.
 *
 * Holds all working state. The prototype has no database, so this state lives
 * only in the browser tab and is lost on refresh -- the header says so plainly
 * rather than implying persistence.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { SourcePanel } from './SourcePanel';
import { Landing } from './Landing';
import { ConfigPanel } from './ConfigPanel';
import { OutputPanel } from './OutputPanel';
import { FactLedgerPanel } from './FactLedgerPanel';
import { EvidenceDrawer } from './EvidenceDrawer';
import { ThemeToggle } from './ThemeToggle';
import { BRAND_MARK, BRAND_MARK_RATIO } from './brandMark';
import { Badge, Button, Callout, Panel, Spinner, cx } from './ui';
import {
  analyzeSource,
  checkHealth,
  downloadExport,
  extractPdf,
  extractText,
  extractUrl,
  generateArtifact,
  loadSample,
  runBounded,
  type ExportKind,
  type HealthStatus,
} from '@/lib/client/api';
import { initialState, progressOf, reducer } from '@/lib/client/state';
import { FORMAT_LABELS } from '@/lib/types';
import type { FormatId, Source } from '@/lib/types';

/** Concurrent generation requests. Kept low to respect provider rate limits. */
const GENERATION_CONCURRENCY = 2;

export function Workspace() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [evidenceIds, setEvidenceIds] = useState<string[] | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Keep the latest state reachable inside async generation loops, which read
  // it after awaits rather than closing over the render-time value.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    void checkHealth().then(setHealth);
  }, []);

  // Warn before leaving while unsaved artefacts exist. Nothing is persisted.
  useEffect(() => {
    const hasWork = Object.values(state.artifacts).some((a) => a?.status === 'complete');
    if (!hasWork) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state.artifacts]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  // --- Source ------------------------------------------------------------
  const runAnalysis = useCallback(async (source: Source, context: string) => {
    dispatch({ type: 'analyze_start' });
    const result = await analyzeSource(source, context);
    if (result.ok) dispatch({ type: 'analyze_success', ledger: result.data });
    else dispatch({ type: 'analyze_failure', error: result.error });
  }, []);

  const handleExtractPdf = useCallback(
    async (file: File) => {
      dispatch({ type: 'extract_start' });
      const result = await extractPdf(file);
      if (!result.ok) {
        dispatch({ type: 'extract_failure', error: result.error });
        return;
      }
      dispatch({ type: 'extract_success', source: result.data });
      await runAnalysis(result.data, '');
    },
    [runAnalysis],
  );

  const handleExtractText = useCallback(
    async (text: string) => {
      dispatch({ type: 'extract_start' });
      const result = await extractText(text);
      if (!result.ok) {
        dispatch({ type: 'extract_failure', error: result.error });
        return;
      }
      dispatch({ type: 'extract_success', source: result.data });
      await runAnalysis(result.data, '');
    },
    [runAnalysis],
  );

  const handleExtractUrl = useCallback(
    async (url: string) => {
      dispatch({ type: 'extract_start' });
      const result = await extractUrl(url);
      if (!result.ok) {
        dispatch({ type: 'extract_failure', error: result.error });
        return;
      }
      dispatch({ type: 'extract_success', source: result.data });
      await runAnalysis(result.data, '');
    },
    [runAnalysis],
  );

  const handleLoadSample = useCallback(async (type: 'report' | 'image' = 'report') => {
    dispatch({ type: 'extract_start' });
    const result = await loadSample(type);
    if (!result.ok) {
      dispatch({ type: 'extract_failure', error: result.error });
      return;
    }
    dispatch({ type: 'extract_success', source: result.data });
    await runAnalysis(result.data, '');
  }, [runAnalysis]);

  // --- Generation --------------------------------------------------------
  const generateFormats = useCallback(async (formats: FormatId[]) => {
    if (formats.length === 0) return;
    dispatch({ type: 'generate_start', formats });

    await runBounded(formats, GENERATION_CONCURRENCY, async (format) => {
      dispatch({ type: 'artifact_start', format });
      const { source, ledger, brief, creativePrompt } = stateRef.current;

      const result = await generateArtifact({
        format,
        brief,
        source: brief.mode === 'creative' ? null : source,
        ledger: brief.mode === 'creative' ? null : ledger,
        creativePrompt,
      });

      if (result.ok) {
        dispatch({
          type: 'artifact_success',
          format,
          content: result.data.content,
          findings: result.data.findings,
          generatedAt: result.data.generatedAt,
        });
      } else {
        dispatch({ type: 'artifact_failure', format, error: result.error });
      }
    });

    dispatch({ type: 'generate_finished' });
  }, []);

  const handleRegenerate = useCallback(
    (format: FormatId) => {
      const artifact = stateRef.current.artifacts[format];
      if (artifact?.edited) {
        const confirmed = window.confirm(
          `Regenerating the ${FORMAT_LABELS[format].toLowerCase()} will replace your edits. Continue?`,
        );
        if (!confirmed) return;
      }
      void generateFormats([format]);
    },
    [generateFormats],
  );

  // --- Export ------------------------------------------------------------
  const handleExport = useCallback(
    async (format: FormatId, kind: ExportKind, content: unknown) => {
      const key = `${format}:${kind}`;
      setExporting(key);
      const result = await downloadExport({
        format,
        kind,
        content,
        sourceTitle: stateRef.current.source?.title ?? null,
        brief: stateRef.current.brief,
      });
      setExporting(null);
      setToast(result.ok ? `Downloaded ${result.data}` : result.error);
    },
    [],
  );

  /** Every completed artefact in one archive, rendered from the current edits. */
  const handleExportAll = useCallback(async () => {
    const { artifacts, brief, source, ledger } = stateRef.current;
    const items = brief.formats
      .map((format) => artifacts[format])
      .filter((a): a is NonNullable<typeof a> => a?.status === 'complete')
      .map((a) => ({ format: a.format, content: a.edited ?? a.content }));

    if (items.length === 0) return;

    setExporting('bundle');
    const result = await downloadExport({
      kind: 'bundle',
      items,
      sourceTitle: source?.title ?? null,
      brief,
      // Sealed into the archive's hash chain, so a recipient can check the
      // outputs against the source they were actually derived from.
      provenance: {
        source: source ? { title: source.title, kind: source.kind, text: source.text } : null,
        ledger: brief.mode === 'creative' ? undefined : (ledger ?? undefined),
      },
    });
    setExporting(null);
    setToast(result.ok ? `Downloaded ${result.data}` : result.error);
  }, []);

  /** Return to the start, confirming first if completed work would be lost. */
  const handleGoHome = useCallback(() => {
    const { artifacts, source, creativePrompt } = stateRef.current;
    const hasWork = Object.values(artifacts).some((a) => a?.status === 'complete');
    if (!source && !creativePrompt.trim()) return;
    if (hasWork) {
      const confirmed = window.confirm(
        'Start again? Generated artefacts are held in this tab only and will be lost. ' +
          'Download anything you want to keep first.',
      );
      if (!confirmed) return;
    }
    dispatch({ type: 'reset' });
  }, []);

  // --- Derived -----------------------------------------------------------
  const progress = useMemo(
    () => progressOf(state, state.brief.formats),
    [state],
  );

  const generating = state.stage === 'generating';
  const analyzing = state.stage === 'analyzing';
  /** Creative draft mode: a prompt with no source, so nothing is source-verified. */
  const inCreative = state.brief.mode === 'creative' && state.creativePrompt.trim().length > 0;

  const disabledReason = inCreative
    ? state.brief.formats.length === 0
      ? 'Select at least one output format.'
      : health && !health.reachable
        ? health.message
        : null
    : !state.source
      ? 'Add a source to begin.'
      : !state.ledger
        ? analyzing
          ? 'Analysing the source…'
          : 'The source has not been analysed yet.'
        : state.brief.formats.length === 0
          ? 'Select at least one output format.'
          : health && !health.reachable
            ? health.message
            : null;

  const canGenerate =
    (inCreative || Boolean(state.source && state.ledger)) && state.brief.formats.length > 0;

  const handleHighlight = useCallback((segmentId: string) => {
    setHighlightId(segmentId);
    // Scroll the passage into view in the source panel.
    requestAnimationFrame(() => {
      document.getElementById(`segment-${segmentId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      {/* --- Header ------------------------------------------------------- */}
      <header className="sticky top-0 z-30 border-b border-[var(--color-rule)] bg-[var(--color-surface)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-2.5">
          {/* The brand returns to the start, confirming first if work would be lost. */}
          <button
            type="button"
            onClick={handleGoHome}
            aria-label="SourceBridge — return to the start"
            className="flex items-center gap-2.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-[var(--color-surface-sunken)]"
          >
            {/* An inlined data URI, sized by height so the width follows the
                artwork's own proportions and the mark is never stretched.
                There is no request here for next/image to optimise. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={BRAND_MARK}
              alt=""
              height={40}
              width={Math.round(40 * BRAND_MARK_RATIO)}
              className="h-10 w-auto"
            />
            <span>
              <span className="block text-lg font-semibold leading-tight tracking-tight text-[var(--color-ink)]">
                SourceBridge
              </span>
              <span className="block text-[11px] leading-tight text-[var(--color-ink-faint)]">
                One source. Multiple formats. Traceable facts.
              </span>
            </span>
          </button>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            {health && (
              <Badge tone={health.reachable ? 'accent' : health.configured ? 'error' : 'warning'}>
                {health.reachable
                  ? `Provider ready${health.model ? ` · ${health.model}` : ''}`
                  : health.configured
                    ? 'Provider unreachable'
                    : 'No API key configured'}
              </Badge>
            )}
            {state.source && (
              <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'reset' })}>
                New transformation
              </Button>
            )}
          </div>
        </div>

        {generating && (
          <div className="border-t border-[var(--color-rule)] bg-[var(--color-surface-sunken)] px-4 py-1.5">
            <div className="mx-auto flex max-w-[1600px] items-center gap-2 text-[11px] text-[var(--color-ink-muted)]">
              <Spinner />
              <span>
                {progress.complete} of {progress.total} formats complete
                {progress.failed > 0 && ` · ${progress.failed} failed`}
              </span>
            </div>
          </div>
        )}
      </header>

      {/* --- Provider notice ---------------------------------------------- */}
      {health && !health.reachable && (
        <div className="mx-auto w-full max-w-[1600px] px-4 pt-3">
          <Callout tone={health.configured ? 'error' : 'warning'} title="AI provider not available">
            {health.message} Source extraction and every export still work without it; only fact
            extraction and generation require the provider.
          </Callout>
        </div>
      )}

      {state.error && (
        <div className="mx-auto w-full max-w-[1600px] px-4 pt-3">
          <Callout tone="error" title="Something went wrong">
            <div className="flex items-start justify-between gap-3">
              <span>{state.error}</span>
              <button
                type="button"
                onClick={() => dispatch({ type: 'dismiss_error' })}
                className="shrink-0 font-medium underline"
              >
                Dismiss
              </button>
            </div>
          </Callout>
        </div>
      )}

      {/* --- Body --------------------------------------------------------- */}
      {!state.source && !inCreative ? (
        <main className="flex-1">
          <Landing
            busy={state.stage === 'extracting'}
            onExtractText={(text) => void handleExtractText(text)}
            onExtractPdf={(file) => void handleExtractPdf(file)}
            onExtractUrl={(url) => void handleExtractUrl(url)}
            onLoadSample={(type) => void handleLoadSample(type)}
            onStartCreative={(prompt) => dispatch({ type: 'start_creative', prompt })}
          />
        </main>
      ) : inCreative ? (
        <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-4">
          <h1 className="sr-only">SourceBridge workspace: creative draft</h1>
          <Callout tone="warning" title="Creative draft mode">
            There is no source document, so nothing generated here is source-verified and no evidence
            is cited. Check every claim before use.
          </Callout>

          <Panel
            title="Your prompt"
            actions={
              <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'reset' })}>
                Start over
              </Button>
            }
          >
            <textarea
              aria-label="Creative prompt"
              value={state.creativePrompt}
              onChange={(e) => dispatch({ type: 'set_creative_prompt', prompt: e.target.value })}
              rows={3}
              className="w-full resize-y rounded-md border border-[var(--color-rule-strong)] bg-[var(--color-surface)] p-2.5 text-sm leading-relaxed outline-none focus:border-[var(--color-accent)]"
            />
          </Panel>

          <ConfigPanel
            brief={state.brief}
            onBriefChange={(patch) => dispatch({ type: 'set_brief', patch })}
            onToggleFormat={(format) => dispatch({ type: 'toggle_format', format })}
            onGenerate={() => void generateFormats(state.brief.formats)}
            generating={generating}
            canGenerate={canGenerate}
            disabledReason={disabledReason}
          />

          <OutputPanel
            formats={state.brief.formats}
            artifacts={state.artifacts}
            brief={state.brief}
            onEdit={(format, content) => dispatch({ type: 'edit_artifact', format, content })}
            onRevert={(format) => dispatch({ type: 'revert_edits', format })}
            onRegenerate={handleRegenerate}
            onEvidence={setEvidenceIds}
            onExport={(format, kind, content) => void handleExport(format, kind, content)}
            onExportAll={() => void handleExportAll()}
            exporting={exporting}
          />
        </main>
      ) : state.source ? (
        <main className="mx-auto grid w-full max-w-[1600px] flex-1 items-start gap-4 p-4 lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
          {/*
            The workspace replaces the landing page, which carried the only h1.
            Without this the whole view starts at h2, so assistive technology
            has no top-level heading to announce or navigate to. Visually
            hidden because the header already names the product on screen.
          */}
          <h1 className="sr-only">SourceBridge workspace: {state.source.title}</h1>
          <div className="lg:sticky lg:top-[64px] lg:max-h-[calc(100vh-80px)] lg:overflow-hidden">
            <SourcePanel
              source={state.source}
              ledger={state.ledger}
              context={state.context}
              onContextChange={(context) => dispatch({ type: 'set_context', context })}
              onReset={() => dispatch({ type: 'reset' })}
              highlightSegmentId={highlightId}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <ConfigPanel
              brief={state.brief}
              onBriefChange={(patch) => dispatch({ type: 'set_brief', patch })}
              onToggleFormat={(format) => dispatch({ type: 'toggle_format', format })}
              onGenerate={() => void generateFormats(state.brief.formats)}
              generating={generating}
              canGenerate={canGenerate}
              disabledReason={disabledReason}
            />

            {(analyzing || state.ledger) && (
              <FactLedgerPanel ledger={state.ledger} analyzing={analyzing} onEvidence={setEvidenceIds} />
            )}

            <OutputPanel
              formats={state.brief.formats}
              artifacts={state.artifacts}
              brief={state.brief}
              onEdit={(format, content) => dispatch({ type: 'edit_artifact', format, content })}
              onRevert={(format) => dispatch({ type: 'revert_edits', format })}
              onRegenerate={handleRegenerate}
              onEvidence={setEvidenceIds}
              onExport={(format, kind, content) => void handleExport(format, kind, content)}
              onExportAll={() => void handleExportAll()}
              exporting={exporting}
            />
          </div>
        </main>
      ) : null}

      {/* --- Overlays ----------------------------------------------------- */}
      <EvidenceDrawer
        ids={evidenceIds}
        source={state.source}
        onClose={() => setEvidenceIds(null)}
        onHighlight={handleHighlight}
      />

      {toast && (
        <div
          role="status"
          className={cx(
            'fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border px-3 py-2 text-xs shadow-lg',
            'border-[var(--color-rule)] bg-[var(--color-surface)] text-[var(--color-ink)]',
          )}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
