'use client';

/**
 * Generated artefacts: tabs, previews, editing, retry and downloads.
 *
 * A failed format is shown as failed next to the formats that succeeded, and
 * can be retried on its own. Downloads always render the edited content when an
 * edit exists.
 */

import { useRef, useState } from 'react';
import { Badge, Button, Callout, EmptyState, Panel, Spinner, cx } from './ui';
import { ArtifactPreview } from './previews';
import { FormatIcon } from './FormatIcon';
import { worstSeverity } from '@/lib/validate';
import { renderMarkdown } from '@/lib/export/markdown';
import { activeContent } from '@/lib/types';
import { FORMAT_LABELS } from '@/lib/types';
import type { Artifact, FormatId, GenerationBrief, ValidationFinding } from '@/lib/types';
import type { ExportKind } from '@/lib/client/api';

/** Downloads offered per format. Text/Markdown is always available. */
const EXPORTS: Record<FormatId, { kind: ExportKind; label: string; primary?: boolean }[]> = {
  exec_summary: [{ kind: 'markdown', label: 'Markdown', primary: true }, { kind: 'text', label: 'Text' }],
  linkedin: [{ kind: 'text', label: 'Text', primary: true }, { kind: 'markdown', label: 'Markdown' }],
  x_thread: [{ kind: 'text', label: 'Text', primary: true }, { kind: 'markdown', label: 'Markdown' }],
  advisory: [{ kind: 'markdown', label: 'Markdown', primary: true }, { kind: 'text', label: 'Text' }],
  presentation: [
    { kind: 'pptx', label: 'Download .pptx', primary: true },
    { kind: 'markdown', label: 'Markdown' },
  ],
  infographic: [
    { kind: 'svg', label: 'Download .svg', primary: true },
    { kind: 'markdown', label: 'Markdown' },
  ],
  video_package: [
    { kind: 'mp4', label: 'Render video (.mp4)', primary: true },
    { kind: 'zip', label: 'Package (.zip)' },
    { kind: 'markdown', label: 'Markdown' },
  ],
};

function StatusDot({ status }: { status: Artifact['status'] }) {
  const style =
    status === 'complete'
      ? 'bg-[var(--color-accent)]'
      : status === 'failed'
        ? 'bg-[var(--color-danger)]'
        : status === 'generating'
          ? 'bg-[var(--color-info)] sb-pulse'
          : 'bg-[var(--color-rule-strong)]';
  return <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', style)} aria-hidden="true" />;
}

function FindingsList({ findings }: { findings: ValidationFinding[] }) {
  if (findings.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {findings.map((finding, i) => (
        <Callout key={i} tone={finding.severity}>
          {finding.message}
        </Callout>
      ))}
      <p className="text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
        These are structural checks only. They do not verify that the content is factually correct.
      </p>
    </div>
  );
}

export function OutputPanel({
  formats,
  artifacts,
  brief,
  onEdit,
  onRevert,
  onRegenerate,
  onEvidence,
  onExport,
  onExportAll,
  exporting,
}: {
  formats: FormatId[];
  artifacts: Partial<Record<FormatId, Artifact>>;
  brief: GenerationBrief;
  onEdit: (format: FormatId, content: unknown) => void;
  onRevert: (format: FormatId) => void;
  onRegenerate: (format: FormatId) => void;
  onEvidence: (ids: string[]) => void;
  onExport: (format: FormatId, kind: ExportKind, content: unknown) => void;
  onExportAll: () => void;
  exporting: string | null;
}) {
  const [active, setActive] = useState<FormatId | null>(null);
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const tracked = formats.filter((f) => artifacts[f]);
  const current = active && artifacts[active] ? active : (tracked[0] ?? null);

  if (tracked.length === 0) {
    return (
      <Panel title="Outputs" className="min-h-[200px]">
        <EmptyState
          title="No artefacts yet"
          description="Choose your formats and select Generate. Each format is produced separately, so results appear as they finish."
        />
      </Panel>
    );
  }

  const completeCount = tracked.filter((f) => artifacts[f]?.status === 'complete').length;
  const artifact = current ? artifacts[current] : null;
  const content = artifact ? activeContent(artifact) : null;
  const isEditing = current ? Boolean(editing[current]) : false;
  const hasEdits = Boolean(artifact?.edited);

  return (
    <Panel
      title="Outputs"
      actions={
        artifact?.status === 'complete' && content ? (
          <>
            {completeCount > 1 && (
              <Button
                size="sm"
                variant="secondary"
                disabled={exporting === 'bundle'}
                onClick={onExportAll}
                title="Download every completed format in one archive"
              >
                {exporting === 'bundle' ? <Spinner /> : null}
                Download all ({completeCount})
              </Button>
            )}
            {hasEdits && (
              <Button size="sm" variant="ghost" onClick={() => current && onRevert(current)}>
                Revert edits
              </Button>
            )}
            <Button
              size="sm"
              variant={isEditing ? 'primary' : 'secondary'}
              onClick={() => current && setEditing((e) => ({ ...e, [current]: !e[current] }))}
            >
              {isEditing ? 'Done editing' : 'Edit'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => current && onRegenerate(current)}
              title={hasEdits ? 'Your edits will be replaced' : undefined}
            >
              Regenerate
            </Button>
          </>
        ) : null
      }
      bodyClassName="flex min-h-0 flex-col p-0"
    >
      {/* --- Tabs --------------------------------------------------------- */}
      <div
        role="tablist"
        aria-label="Generated formats"
        className="sb-scroll flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--color-rule)] px-3 pt-2"
      >
        {tracked.map((format) => {
          const item = artifacts[format]!;
          const severity = worstSeverity(item.findings);
          const selected = format === current;
          return (
            <button
              key={format}
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              ref={(el) => {
                tabRefs.current[format] = el;
              }}
              onKeyDown={(event) => {
                // Arrow keys move between tabs, as expected of a tablist.
                const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                if (delta === 0) return;
                event.preventDefault();
                const index = tracked.indexOf(format);
                const next = tracked[(index + delta + tracked.length) % tracked.length];
                setActive(next);
                tabRefs.current[next]?.focus();
              }}
              onClick={() => setActive(format)}
              className={cx(
                'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-md border-b-2 px-2.5 py-1.5 text-xs font-medium transition-colors',
                selected
                  ? 'border-[var(--color-accent)] text-[var(--color-ink)]'
                  : 'border-transparent text-[var(--color-ink-faint)] hover:text-[var(--color-ink-muted)]',
              )}
            >
              <StatusDot status={item.status} />
              <FormatIcon format={format} className="h-3.5 w-3.5" brandColour={false} />
              {FORMAT_LABELS[format]}
              {item.edited !== null && <span title="Edited" className="text-[var(--color-accent)]">•</span>}
              {severity === 'error' && <span className="text-[var(--color-danger)]">!</span>}
            </button>
          );
        })}
      </div>

      {/* --- Body --------------------------------------------------------- */}
      <div className="sb-scroll min-h-0 flex-1 overflow-y-auto">
        {!artifact ? null : artifact.status === 'generating' || artifact.status === 'pending' ? (
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2">
            <span className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
              {artifact.status === 'generating' ? (
                <>
                  <Spinner /> Generating {FORMAT_LABELS[artifact.format].toLowerCase()}…
                </>
              ) : (
                'Queued'
              )}
            </span>
            <p className="text-xs text-[var(--color-ink-faint)]">
              Other formats continue independently.
            </p>
          </div>
        ) : artifact.status === 'failed' ? (
          <div className="space-y-3 p-4">
            <Callout tone="error" title={`${FORMAT_LABELS[artifact.format]} failed`}>
              {artifact.error ?? 'This format could not be generated.'}
            </Callout>
            <div className="flex items-center gap-2">
              <Button variant="primary" size="sm" onClick={() => onRegenerate(artifact.format)}>
                Retry this format
              </Button>
              <span className="text-[11px] text-[var(--color-ink-faint)]">
                Other formats are unaffected.
              </span>
            </div>
            {artifact.content !== null && (
              <Callout tone="info">
                A previous version of this artefact is still available and was not discarded.
              </Callout>
            )}
          </div>
        ) : content ? (
          <div className="space-y-4 p-4">
            {artifact.findings.length > 0 && <FindingsList findings={artifact.findings} />}

            {hasEdits && (
              <div className="flex items-center gap-2">
                <Badge tone="accent">Edited</Badge>
                <span className="text-[11px] text-[var(--color-ink-faint)]">
                  Downloads use your edited version.
                </span>
              </div>
            )}

            <ArtifactPreview
              format={artifact.format}
              content={content}
              editing={isEditing}
              onChange={(next) => onEdit(artifact.format, next)}
              onEvidence={onEvidence}
            />
          </div>
        ) : null}
      </div>

      {/* --- Downloads ---------------------------------------------------- */}
      {artifact?.status === 'complete' && content !== null && (
        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--color-rule)] px-4 py-2.5">
          <span className="text-[11px] font-medium text-[var(--color-ink-muted)]">Download:</span>
          {EXPORTS[artifact.format].map((option) => {
            const busy = exporting === `${artifact.format}:${option.kind}`;
            return (
              <Button
                key={option.kind}
                size="sm"
                variant={option.primary ? 'primary' : 'secondary'}
                disabled={busy}
                onClick={() => onExport(artifact.format, option.kind, content)}
              >
                {busy ? <Spinner /> : null}
                {option.label}
              </Button>
            );
          })}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(renderMarkdown(artifact.format, content))
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
            }}
          >
            {copied ? 'Copied' : 'Copy text'}
          </Button>
          {brief.mode === 'creative' && (
            <span className="ml-auto text-[11px] text-[var(--color-warn)]">
              Creative draft — not source-verified
            </span>
          )}
        </footer>
      )}
    </Panel>
  );
}
