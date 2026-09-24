'use client';

/**
 * Evidence inspection.
 *
 * Shows the stored source passage behind a reference. The text displayed is the
 * text held in the source, not a re-summary, so what the operator reads is what
 * the model received. References that do not resolve are reported as invalid
 * rather than hidden.
 */

import { useEffect, useRef } from 'react';
import { Badge, Button, Callout } from './ui';
import { resolveEvidence } from '@/lib/extract';
import type { Source } from '@/lib/types';

export function EvidenceDrawer({
  ids,
  source,
  onClose,
  onHighlight,
}: {
  ids: string[] | null;
  source: Source | null;
  onClose: () => void;
  onHighlight: (segmentId: string) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Close on Escape, and move focus into the drawer when it opens.
  useEffect(() => {
    if (!ids) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ids, onClose]);

  if (!ids || !source) return null;

  const { found, missing } = resolveEvidence(source, ids);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Supporting source passages">
      <button
        type="button"
        aria-label="Close evidence panel"
        onClick={onClose}
        className="absolute inset-0 bg-black/20"
      />

      <aside className="relative flex h-full w-full max-w-md flex-col border-l border-[var(--color-rule)] bg-[var(--color-surface)] shadow-xl">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-rule)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-ink)]">Supporting passages</h2>
            <p className="text-[11px] text-[var(--color-ink-faint)]">
              From {source.title}
            </p>
          </div>
          <Button ref={closeRef} size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </header>

        <div className="sb-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {found.length === 0 && missing.length === 0 && (
            <p className="text-sm text-[var(--color-ink-faint)]">
              No source passages were cited for this content.
            </p>
          )}

          {found.map((segment) => (
            <article
              key={segment.id}
              className="rounded-lg border border-[var(--color-rule)] bg-[var(--color-surface-sunken)] p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {segment.page !== null && <Badge tone="accent">Page {segment.page}</Badge>}
                  <span className="font-mono text-[10px] text-[var(--color-ink-faint)]">{segment.id}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onHighlight(segment.id);
                    onClose();
                  }}
                  className="rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
                >
                  Show in source
                </button>
              </div>
              {segment.heading && (
                <p className="mb-1 text-xs font-semibold text-[var(--color-ink)]">{segment.heading}</p>
              )}
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-ink)]">
                {segment.text}
              </p>
            </article>
          ))}

          {missing.length > 0 && (
            <Callout tone="error" title="Unresolved references">
              {missing.length} reference{missing.length > 1 ? 's' : ''} did not match any passage in
              this source and cannot be shown: {missing.join(', ')}.
            </Callout>
          )}
        </div>

        <footer className="shrink-0 border-t border-[var(--color-rule)] px-4 py-2.5">
          <p className="text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
            Evidence links show where content was drawn from. They are a review aid, not proof that
            the content interprets the source correctly.
          </p>
        </footer>
      </aside>
    </div>
  );
}
