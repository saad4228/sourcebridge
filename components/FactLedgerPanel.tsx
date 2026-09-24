'use client';

/**
 * The shared fact ledger.
 *
 * Every selected format generates from this same ledger, which is what keeps
 * figures consistent across outputs. The ledger itself can be wrong, so the
 * original source passages remain reachable from every fact.
 */

import { Badge, Callout, Panel, Spinner, cx } from './ui';
import type { FactLedger } from '@/lib/types';

const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]';

export function FactLedgerPanel({
  ledger,
  analyzing,
  onEvidence,
}: {
  ledger: FactLedger | null;
  analyzing: boolean;
  onEvidence: (ids: string[]) => void;
}) {
  if (analyzing) {
    return (
      <Panel title="Shared fact ledger">
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--color-ink-muted)]">
          <Spinner /> Extracting facts, figures and caveats…
        </div>
      </Panel>
    );
  }

  if (!ledger) return null;

  return (
    <Panel
      title="Shared fact ledger"
      actions={<Badge tone="accent">{ledger.facts.length} facts</Badge>}
      bodyClassName="space-y-4 p-4"
    >
      <div>
        <p className={SECTION_LABEL}>Topic</p>
        <p className="mt-0.5 text-sm text-[var(--color-ink)]">{ledger.topic}</p>
      </div>

      {ledger.warnings.length > 0 && (
        <div className="space-y-1.5">
          {ledger.warnings.map((warning, i) => (
            <Callout key={i} tone="warning">
              {warning}
            </Callout>
          ))}
        </div>
      )}

      <div>
        <p className={cx(SECTION_LABEL, 'mb-1.5')}>Facts</p>
        <ul className="space-y-2">
          {ledger.facts.map((fact) => (
            <li
              key={fact.id}
              className="rounded-md border border-[var(--color-rule)] bg-[var(--color-surface-sunken)] p-2.5"
            >
              <p className="text-xs leading-relaxed text-[var(--color-ink)]">{fact.claim}</p>

              {(fact.numbers.length > 0 || fact.dates.length > 0) && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {fact.numbers.map((n, i) => (
                    <span
                      key={`n${i}`}
                      className="rounded bg-[var(--color-accent-soft)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-accent)]"
                      title={n.context}
                    >
                      {n.value}
                      {n.unit ? ` ${n.unit}` : ''}
                    </span>
                  ))}
                  {fact.dates.map((d, i) => (
                    <span
                      key={`d${i}`}
                      className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] text-[var(--color-ink-muted)]"
                    >
                      {d}
                    </span>
                  ))}
                </div>
              )}

              {fact.caveats.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {fact.caveats.map((caveat, i) => (
                    <li key={i} className="text-[11px] leading-snug text-[var(--color-warn)]">
                      ⚠ {caveat}
                    </li>
                  ))}
                </ul>
              )}

              {fact.evidence.length > 0 && (
                <button
                  type="button"
                  onClick={() => onEvidence(fact.evidence)}
                  className="mt-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
                >
                  View {fact.evidence.length} supporting passage
                  {fact.evidence.length > 1 ? 's' : ''}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {ledger.caveats.length > 0 && (
        <div>
          <p className={cx(SECTION_LABEL, 'mb-1')}>Document-level caveats</p>
          <ul className="list-disc space-y-1 pl-4">
            {ledger.caveats.map((caveat, i) => (
              <li key={i} className="text-xs leading-relaxed text-[var(--color-ink-muted)]">
                {caveat}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-[var(--color-ink-faint)]">
            These are carried into every generated format.
          </p>
        </div>
      )}

      {ledger.missingInformation.length > 0 && (
        <div>
          <p className={cx(SECTION_LABEL, 'mb-1')}>Not present in the source</p>
          <ul className="list-disc space-y-1 pl-4">
            {ledger.missingInformation.map((item, i) => (
              <li key={i} className="text-xs leading-relaxed text-[var(--color-ink-muted)]">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
