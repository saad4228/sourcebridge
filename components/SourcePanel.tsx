'use client';

/**
 * Source input and preview.
 *
 * The extracted text is shown exactly as it was extracted, with page labels, so
 * the operator can see what the model actually received.
 */

import { useMemo, useState } from 'react';
import { Badge, Button, Callout, EmptyState, Panel, cx } from './ui';
import type { FactLedger, Source } from '@/lib/types';

export function SourcePanel({
  source,
  ledger,
  context,
  onContextChange,
  onReset,
  highlightSegmentId,
}: {
  source: Source;
  ledger: FactLedger | null;
  context: string;
  onContextChange: (value: string) => void;
  onReset: () => void;
  highlightSegmentId: string | null;
}) {
  const [page, setPage] = useState(1);

  const pages = useMemo(() => {
    if (!source) return [];
    if (source.pageCount === null) return [{ page: null, segments: source.segments }];
    return Array.from({ length: source.pageCount }, (_, i) => ({
      page: i + 1,
      segments: source.segments.filter((s) => s.page === i + 1),
    }));
  }, [source]);

  const current = pages[Math.min(page, pages.length) - 1] ?? pages[0];

  // --- Loaded state --------------------------------------------------------
  return (
    <Panel
      title={
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-[var(--color-ink)]" title={source.title}>
            {source.title}
          </h2>
          <p className="text-[11px] text-[var(--color-ink-faint)]">
            {source.pageCount ? `${source.pageCount} pages · ` : ''}
            {source.charCount.toLocaleString()} characters · {source.segments.length} passages
          </p>
        </div>
      }
      actions={
        <Button size="sm" variant="ghost" onClick={onReset}>
          Replace
        </Button>
      }
      className="lg:h-[calc(100vh-80px)]"
      bodyClassName="flex min-h-0 flex-col"
    >
      {source.warnings.length > 0 && (
        <div className="shrink-0 space-y-1.5 border-b border-[var(--color-rule)] p-3">
          {source.warnings.map((warning, i) => (
            <Callout key={i} tone="warning" title="Extraction warning">
              {warning}
            </Callout>
          ))}
        </div>
      )}

      {source.pageCount !== null && source.pageCount > 1 && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-rule)] px-3 py-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ← Prev
          </Button>
          <span className="text-xs text-[var(--color-ink-muted)]">
            Page {Math.min(page, pages.length)} of {pages.length}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={page >= pages.length}
            onClick={() => setPage((p) => Math.min(pages.length, p + 1))}
          >
            Next →
          </Button>
        </div>
      )}

      <div className="sb-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {current?.segments.length ? (
          <div className="space-y-2.5">
            {current.segments.map((segment) => (
              <div
                key={segment.id}
                id={`segment-${segment.id}`}
                className={cx(
                  'rounded-md border px-3 py-2 transition-colors',
                  highlightSegmentId === segment.id
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                    : 'border-transparent bg-[var(--color-surface-sunken)]',
                )}
              >
                <p className="mb-1 font-mono text-[10px] text-[var(--color-ink-faint)]">{segment.id}</p>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-ink)]">
                  {segment.text}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No text on this page"
            description="This page appears to be scanned or image-only. Its content is not included."
          />
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--color-rule)] p-3">
        <label htmlFor="context" className="text-xs font-medium text-[var(--color-ink-muted)]">
          Additional context <span className="font-normal text-[var(--color-ink-faint)]">(optional)</span>
        </label>
        <textarea
          id="context"
          value={context}
          onChange={(e) => onContextChange(e.target.value)}
          rows={2}
          placeholder="Background the document does not contain…"
          className="mt-1 w-full resize-none rounded-md border border-[var(--color-rule-strong)] bg-[var(--color-surface)] p-2 text-xs outline-none focus:border-[var(--color-accent)]"
        />
        {ledger && (
          <div className="mt-2 flex items-center gap-1.5">
            <Badge tone="accent">{ledger.facts.length} facts extracted</Badge>
            {ledger.caveats.length > 0 && <Badge tone="warning">{ledger.caveats.length} caveats</Badge>}
          </div>
        )}
      </div>
    </Panel>
  );
}
