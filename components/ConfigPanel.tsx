'use client';

/**
 * Generation configuration: format selection and the communication brief.
 *
 * Defaults are chosen so the operator can generate immediately; every control
 * is optional refinement rather than required setup.
 */

import { useState } from 'react';
import { Badge, Button, Field, Panel, Select, Spinner, cx } from './ui';
import { FORMAT_DESCRIPTIONS, FORMAT_IDS, FORMAT_LABELS } from '@/lib/types';
import type { FormatId, GenerationBrief } from '@/lib/types';

const AUDIENCES = [
  'General public',
  'Leadership',
  'Government officials',
  'Employees',
  'Technical professionals',
  'Researchers',
  'Students',
];
const OBJECTIVES = [
  'Inform',
  'Explain',
  'Educate',
  'Warn',
  'Recommend action',
  'Raise awareness',
  'Promote',
  'Support a decision',
];
const TONES = [
  'Professional',
  'Neutral',
  'Accessible',
  'Simple',
  'Technical',
  'Educational',
  'Persuasive',
  'Formal',
];
const DETAILS = ['Brief', 'Standard', 'Detailed'];
const LANGUAGES = ['English', 'Hindi', 'Bengali', 'Marathi', 'Tamil', 'Telugu'];

export function ConfigPanel({
  brief,
  onBriefChange,
  onToggleFormat,
  onGenerate,
  generating,
  canGenerate,
  disabledReason,
}: {
  brief: GenerationBrief;
  onBriefChange: (patch: Partial<GenerationBrief>) => void;
  onToggleFormat: (format: FormatId) => void;
  onGenerate: () => void;
  generating: boolean;
  canGenerate: boolean;
  disabledReason: string | null;
}) {
  const [advanced, setAdvanced] = useState(false);

  return (
    <Panel
      title="Configure"
      actions={<Badge tone="neutral">{brief.formats.length} selected</Badge>}
      bodyClassName="space-y-4 p-4"
    >
      {/* --- Formats ------------------------------------------------------ */}
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-[var(--color-ink-muted)]">
          Output formats
        </legend>
        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {FORMAT_IDS.map((format) => {
            const selected = brief.formats.includes(format);
            return (
              <label
                key={format}
                className={cx(
                  'flex cursor-pointer items-start gap-2 rounded-md border p-2 transition-colors',
                  selected
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                    : 'border-[var(--color-rule)] bg-[var(--color-surface)] hover:border-[var(--color-rule-strong)]',
                )}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggleFormat(format)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-accent)]"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-[var(--color-ink)]">
                    {FORMAT_LABELS[format]}
                  </span>
                  <span className="block text-[10px] leading-snug text-[var(--color-ink-faint)]">
                    {FORMAT_DESCRIPTIONS[format]}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* --- Brief -------------------------------------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Field label="Audience" htmlFor="audience">
          <Select
            id="audience"
            value={brief.audience}
            onChange={(e) => onBriefChange({ audience: e.target.value as GenerationBrief['audience'] })}
          >
            {AUDIENCES.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </Select>
        </Field>

        <Field label="Objective" htmlFor="objective">
          <Select
            id="objective"
            value={brief.objective}
            onChange={(e) => onBriefChange({ objective: e.target.value as GenerationBrief['objective'] })}
          >
            {OBJECTIVES.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </Select>
        </Field>

        <Field label="Tone" htmlFor="tone">
          <Select
            id="tone"
            value={brief.tone}
            onChange={(e) => onBriefChange({ tone: e.target.value as GenerationBrief['tone'] })}
          >
            {TONES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>

        <Field
          label="Language"
          htmlFor="language"
          hint="Non-English output is generated but has not been quality-checked."
        >
          <Select
            id="language"
            value={brief.language}
            onChange={(e) => onBriefChange({ language: e.target.value })}
          >
            {LANGUAGES.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </Select>
        </Field>

        <Field label="Detail" htmlFor="detail">
          <Select
            id="detail"
            value={brief.detail}
            onChange={(e) => onBriefChange({ detail: e.target.value as GenerationBrief['detail'] })}
          >
            {DETAILS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </Select>
        </Field>
      </div>

      {/* --- Advanced ----------------------------------------------------- */}
      <div>
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          aria-expanded={advanced}
          className="text-xs font-medium text-[var(--color-accent)] hover:underline"
        >
          {advanced ? '− Hide' : '+ Show'} advanced options
        </button>

        {advanced && (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Field label="Required messages" htmlFor="required">
              <textarea
                id="required"
                rows={2}
                value={brief.requiredMessages ?? ''}
                onChange={(e) => onBriefChange({ requiredMessages: e.target.value })}
                placeholder="Points that must appear"
                className="w-full resize-none rounded-md border border-[var(--color-rule-strong)] p-2 text-xs outline-none focus:border-[var(--color-accent)]"
              />
            </Field>
            <Field label="Call to action" htmlFor="cta">
              <textarea
                id="cta"
                rows={2}
                value={brief.callToAction ?? ''}
                onChange={(e) => onBriefChange({ callToAction: e.target.value })}
                placeholder="What should the reader do?"
                className="w-full resize-none rounded-md border border-[var(--color-rule-strong)] p-2 text-xs outline-none focus:border-[var(--color-accent)]"
              />
            </Field>
            <Field label="Terms to preserve" htmlFor="preserve">
              <textarea
                id="preserve"
                rows={2}
                value={brief.preserveTerms ?? ''}
                onChange={(e) => onBriefChange({ preserveTerms: e.target.value })}
                placeholder="Names or terminology to keep exactly"
                className="w-full resize-none rounded-md border border-[var(--color-rule-strong)] p-2 text-xs outline-none focus:border-[var(--color-accent)]"
              />
            </Field>
            <Field label="Claims to avoid" htmlFor="avoid">
              <textarea
                id="avoid"
                rows={2}
                value={brief.avoidClaims ?? ''}
                onChange={(e) => onBriefChange({ avoidClaims: e.target.value })}
                placeholder="Anything that must not be stated"
                className="w-full resize-none rounded-md border border-[var(--color-rule-strong)] p-2 text-xs outline-none focus:border-[var(--color-accent)]"
              />
            </Field>
          </div>
        )}
      </div>

      {/* --- Action ------------------------------------------------------- */}
      <div className="flex items-center justify-between gap-3 border-t border-[var(--color-rule)] pt-3">
        <p className="text-[11px] leading-snug text-[var(--color-ink-faint)]">
          {disabledReason ??
            `Generates ${brief.formats.length} format${brief.formats.length === 1 ? '' : 's'} ` +
              (brief.mode === 'creative'
                ? 'from your prompt. No source means no evidence and no verified claims.'
                : 'from the same source and fact ledger.')}
        </p>
        <Button variant="primary" onClick={onGenerate} disabled={!canGenerate || generating}>
          {generating ? (
            <>
              <Spinner /> Generating…
            </>
          ) : (
            'Generate'
          )}
        </Button>
      </div>
    </Panel>
  );
}
