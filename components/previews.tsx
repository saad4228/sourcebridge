'use client';

/**
 * Format-specific previews.
 *
 * Each format gets a preview shaped like the thing it becomes: a social card, a
 * formal document, slide cards, the real infographic. A presentation is never
 * shown as a summary in bullets.
 */

import { useMemo, useState } from 'react';
import { EditableList, EditableText, setIn } from './editable';
import { Badge, cx } from './ui';
import { renderInfographicSvg } from '@/lib/export/svg';
import { resolveLayout, type Slide, type SlideLayout } from '@/lib/export/slideLayout';
import { resolveInfographicLayout } from '@/lib/export/infographicLayout';
import { FormatIcon } from './FormatIcon';
import { shareToLinkedIn, shareToX, type ShareOutcome } from '@/lib/client/share';
import { X_POST_CHAR_LIMIT } from '@/lib/schemas';
import type {
  Advisory,
  ExecSummary,
  Infographic,
  LinkedInPost,
  Presentation,
  VideoPackage,
  XThread,
} from '@/lib/schemas';
import type { FormatId } from '@/lib/types';

export interface PreviewProps<T = unknown> {
  content: T;
  editing: boolean;
  onChange: (next: T) => void;
  onEvidence: (ids: string[]) => void;
}

/** A clickable reference that opens the supporting passage. */
function EvidenceChip({ ids, onEvidence }: { ids: string[]; onEvidence: (ids: string[]) => void }) {
  if (!ids?.length) return null;
  return (
    <button
      type="button"
      onClick={() => onEvidence(ids)}
      className={cx(
        'inline-flex items-center gap-1 rounded border border-[var(--color-accent-border)]',
        'bg-[var(--color-accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-accent)]',
        'hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-contrast)] transition-colors',
      )}
      title="Show the supporting source passage"
    >
      <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M4 2h6l4 4v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm5 1v3h3L9 3z" />
      </svg>
      {ids.length} source{ids.length > 1 ? 's' : ''}
    </button>
  );
}

const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]';
const PROSE = 'text-sm leading-relaxed text-[var(--color-ink)]';

// ---------------------------------------------------------------------------
// Executive summary
// ---------------------------------------------------------------------------

function ExecSummaryPreview({ content, editing, onChange, onEvidence }: PreviewProps<ExecSummary>) {
  const set = (path: (string | number)[], value: unknown) => onChange(setIn(content, path, value));

  return (
    <article className="mx-auto max-w-2xl space-y-5 px-1">
      <EditableText
        as="h1"
        label="Title"
        value={content.title}
        editing={editing}
        onChange={(v) => set(['title'], v)}
        className="text-xl font-semibold tracking-tight text-[var(--color-ink)]"
      />

      <section className="rounded-lg border-l-2 border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-4 py-3">
        <p className={SECTION_LABEL}>Main finding</p>
        <EditableText
          label="Main finding"
          value={content.mainFinding}
          editing={editing}
          onChange={(v) => set(['mainFinding'], v)}
          className="mt-1 text-sm font-medium leading-relaxed text-[var(--color-ink)]"
        />
      </section>

      <section>
        <p className={SECTION_LABEL}>Why it matters</p>
        <EditableText
          label="Why it matters"
          value={content.whyItMatters}
          editing={editing}
          onChange={(v) => set(['whyItMatters'], v)}
          className={cx('mt-1', PROSE)}
        />
      </section>

      {content.keyEvidence?.length > 0 && (
        <section>
          <p className={SECTION_LABEL}>Key evidence</p>
          <ul className="mt-1.5 space-y-2">
            {content.keyEvidence.map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--color-accent)]" />
                <div className="flex-1">
                  <EditableText
                    label={`Evidence point ${i + 1}`}
                    value={item.point}
                    editing={editing}
                    onChange={(v) => set(['keyEvidence', i, 'point'], v)}
                    className={PROSE}
                  />
                  <div className="mt-1">
                    <EvidenceChip ids={item.evidence} onEvidence={onEvidence} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {content.implications?.length > 0 && (
        <section>
          <p className={SECTION_LABEL}>Implications</p>
          <div className="mt-1.5">
            <EditableList
              items={content.implications}
              editing={editing}
              label="Implication"
              onChange={(v) => set(['implications'], v)}
              listClassName="list-disc space-y-1 pl-5"
              itemClassName={PROSE}
            />
          </div>
        </section>
      )}

      {content.actions?.length > 0 && (
        <section>
          <p className={SECTION_LABEL}>Actions</p>
          <ul className="mt-1.5 space-y-2">
            {content.actions.map((action, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--color-accent)]" />
                <div className="flex-1">
                  <EditableText
                    label={`Action ${i + 1}`}
                    value={action.action}
                    editing={editing}
                    onChange={(v) => set(['actions', i, 'action'], v)}
                    className={PROSE}
                  />
                  {!action.fromSource && (
                    <span className="mt-1 inline-block text-[11px] text-[var(--color-warn)]">
                      Suggested — not stated in the source
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {content.uncertainties?.length > 0 && (
        <section className="rounded-lg border border-[var(--color-warn-border)] bg-[var(--color-warn-soft)] px-4 py-3">
          <p className={cx(SECTION_LABEL, 'text-[var(--color-warn)]')}>Uncertainties</p>
          <div className="mt-1.5 text-[var(--color-ink)]">
            <EditableList
              items={content.uncertainties}
              editing={editing}
              label="Uncertainty"
              onChange={(v) => set(['uncertainties'], v)}
              listClassName="list-disc space-y-1 pl-5"
              itemClassName="text-sm leading-relaxed"
            />
          </div>
        </section>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// LinkedIn
// ---------------------------------------------------------------------------

function LinkedInPreview({ content, editing, onChange, onEvidence }: PreviewProps<LinkedInPost>) {
  const set = (path: (string | number)[], value: unknown) => onChange(setIn(content, path, value));
  const charCount = `${content.hook}\n\n${content.body}\n\n${content.keyTakeaway}`.length;

  return (
    <div className="mx-auto max-w-xl">
      <article className="rounded-lg border border-[var(--color-rule)] bg-[var(--color-surface)] shadow-sm">
        <header className="flex items-center gap-2.5 px-4 pt-4">
          <div className="h-10 w-10 rounded-full bg-[var(--color-rule)]" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--color-ink)]">Your name</p>
            <p className="text-[11px] text-[var(--color-ink-faint)]">
              Your headline · Preview only
            </p>
          </div>
        </header>

        <div className="space-y-3 px-4 py-3">
          <EditableText
            label="Hook"
            value={content.hook}
            editing={editing}
            onChange={(v) => set(['hook'], v)}
            className="text-sm font-medium leading-relaxed text-[var(--color-ink)]"
          />
          <EditableText
            label="Body"
            value={content.body}
            editing={editing}
            onChange={(v) => set(['body'], v)}
            className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-ink)]"
          />
          <EditableText
            label="Key takeaway"
            value={content.keyTakeaway}
            editing={editing}
            onChange={(v) => set(['keyTakeaway'], v)}
            className="text-sm font-medium leading-relaxed text-[var(--color-ink)]"
          />
          {(content.callToAction?.trim() || editing) && (
            <EditableText
              label="Call to action"
              value={content.callToAction}
              editing={editing}
              onChange={(v) => set(['callToAction'], v)}
              placeholder="No call to action"
              className="text-sm leading-relaxed text-[var(--color-ink)]"
            />
          )}
          {content.hashtags?.length > 0 && (
            <p className="text-sm text-[var(--color-accent)]">
              {content.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}
            </p>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-rule)] px-4 py-2">
          <EvidenceChip ids={content.evidence} onEvidence={onEvidence} />
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--color-ink-faint)]">
              {charCount.toLocaleString()} characters
            </span>
            <PostButton
              label="Post on LinkedIn"
              format="linkedin"
              onShare={() => shareToLinkedIn(content)}
            />
          </div>
        </footer>
      </article>
      <p className="mt-2 text-center text-[11px] text-[var(--color-ink-faint)]">
        LinkedIn does not allow a link to prefill its composer, so the post is copied to your
        clipboard and the composer opened — paste once and publish.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// X thread
// ---------------------------------------------------------------------------

/** Copies one post. Individual-post copy is how threads are actually published. */
function CopyPostButton({ text, index }: { text: string; index: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy post ${index + 1}`}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
      className="rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-accent)]"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function XThreadPreview({ content, editing, onChange, onEvidence }: PreviewProps<XThread>) {
  const set = (path: (string | number)[], value: unknown) => onChange(setIn(content, path, value));

  return (
    <div className="mx-auto max-w-lg space-y-3">
      {content.posts.map((post, i) => {
        const over = post.text.length > X_POST_CHAR_LIMIT;
        return (
          <article
            key={i}
            className="relative rounded-lg border border-[var(--color-rule)] bg-[var(--color-surface)] p-4 shadow-sm"
          >
            {content.posts.length > 1 && i < content.posts.length - 1 && (
              <span
                className="absolute left-[30px] top-[52px] h-[calc(100%-40px)] w-px bg-[var(--color-rule)]"
                aria-hidden="true"
              />
            )}
            <div className="flex gap-2.5">
              <div className="h-9 w-9 shrink-0 rounded-full bg-[var(--color-rule)]" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-sm font-semibold text-[var(--color-ink)]">Your name</span>
                  <span className="text-[11px] text-[var(--color-ink-faint)]">@handle</span>
                  {content.posts.length > 1 && (
                    <span className="ml-auto text-[11px] text-[var(--color-ink-faint)]">
                      {i + 1}/{content.posts.length}
                    </span>
                  )}
                </div>
                <div className="mt-1">
                  <EditableText
                    label={`Post ${i + 1}`}
                    value={post.text}
                    editing={editing}
                    onChange={(v) => set(['posts', i, 'text'], v)}
                    className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-ink)]"
                  />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <EvidenceChip ids={post.evidence} onEvidence={onEvidence} />
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cx(
                        'text-[11px]',
                        over ? 'font-medium text-[var(--color-danger)]' : 'text-[var(--color-ink-faint)]',
                      )}
                    >
                      {post.text.length}/{X_POST_CHAR_LIMIT}
                    </span>
                    <CopyPostButton text={post.text} index={i} />
                  </div>
                </div>
              </div>
            </div>
          </article>
        );
      })}
      <div className="flex justify-center">
        {/*
          One button, not two. X and Twitter are the same service: twitter.com
          redirects to x.com and both intent URLs open the same composer, so a
          second button would send the operator to exactly the same place. The
          old name is kept in the label because that is still what many people
          call it.
        */}
        <PostButton
          label="Post on X (Twitter)"
          format="x_thread"
          onShare={() => shareToX(content)}
        />
      </div>
      <p className="text-center text-[11px] text-[var(--color-ink-faint)]">
        {content.posts.length > 1
          ? 'X fills in the first post only; the full thread is copied so you can add the replies.'
          : 'X opens with your post filled in.'}{' '}
        Character counts are approximate — the platform counts links and emoji differently.
      </p>
    </div>
  );
}

/**
 * Hands a finished post to its platform.
 *
 * What actually happens differs by platform, so the result message says which:
 * X arrives prefilled, LinkedIn arrives copied and ready to paste.
 */
function PostButton({
  label,
  format,
  onShare,
}: {
  label: string;
  format: 'linkedin' | 'x_thread';
  onShare: () => Promise<ShareOutcome>;
}) {
  const [status, setStatus] = useState<ShareOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <span className="relative inline-flex flex-col items-end">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setStatus(await onShare());
          } finally {
            setBusy(false);
          }
        }}
        className={cx(
          'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
          'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]',
          'hover:bg-[var(--color-accent-hover)] disabled:opacity-60',
        )}
      >
        <FormatIcon format={format} className="h-3.5 w-3.5" brandColour={false} />
        {label}
      </button>
      {status && (
        <span
          role="status"
          className={cx(
            'mt-1 max-w-xs text-right text-[11px] leading-snug',
            status.ok ? 'text-[var(--color-ink-faint)]' : 'text-[var(--color-danger)]',
          )}
        >
          {status.message}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Advisory
// ---------------------------------------------------------------------------

function AdvisoryPreview({ content, editing, onChange, onEvidence }: PreviewProps<Advisory>) {
  const set = (path: (string | number)[], value: unknown) => onChange(setIn(content, path, value));

  return (
    <article className="mx-auto max-w-2xl bg-[var(--color-surface)]">
      <header className="border-b-2 border-[var(--color-ink)] pb-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-ink-faint)]">
          Advisory
        </p>
        <EditableText
          as="h1"
          label="Title"
          value={content.title}
          editing={editing}
          onChange={(v) => set(['title'], v)}
          className="mt-1 text-xl font-semibold tracking-tight text-[var(--color-ink)]"
        />
        {/* Severity and affected parties appear only when the source states them. */}
        {content.severity && content.severity !== 'Not stated' && (
          <div className="mt-2">
            <Badge
              tone={
                content.severity === 'Critical' || content.severity === 'High'
                  ? 'error'
                  : content.severity === 'Medium'
                    ? 'warning'
                    : 'info'
              }
            >
              Severity: {content.severity}
            </Badge>
          </div>
        )}
        {content.affected?.length > 0 && (
          <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">
            <span className="font-medium">Affected:</span> {content.affected.join(', ')}
          </p>
        )}
        <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">
          <span className="font-medium">Audience:</span>{' '}
          {editing ? (
            <EditableText
              as="span"
              label="Audience"
              value={content.audience}
              editing
              onChange={(v) => set(['audience'], v)}
              className="text-xs"
            />
          ) : (
            content.audience
          )}
        </p>
      </header>

      <div className="space-y-4 pt-4">
        <section>
          <p className={SECTION_LABEL}>Background</p>
          <EditableText
            label="Background"
            value={content.background}
            editing={editing}
            onChange={(v) => set(['background'], v)}
            className={cx('mt-1', PROSE)}
          />
        </section>

        <section>
          <p className={SECTION_LABEL}>Impact</p>
          <EditableText
            label="Impact"
            value={content.impact}
            editing={editing}
            onChange={(v) => set(['impact'], v)}
            className={cx('mt-1', PROSE)}
          />
        </section>

        {content.recommendedActions?.length > 0 && (
          <section>
            <p className={SECTION_LABEL}>Recommended actions</p>
            <ol className="mt-1.5 space-y-2">
              {content.recommendedActions.map((action, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-ink)] text-[11px] font-semibold text-[var(--color-ink-contrast)]">
                    {i + 1}
                  </span>
                  <div className="flex-1">
                    <EditableText
                      label={`Action ${i + 1}`}
                      value={action.action}
                      editing={editing}
                      onChange={(v) => set(['recommendedActions', i, 'action'], v)}
                      className={PROSE}
                    />
                    {!action.fromSource && (
                      <span className="mt-0.5 inline-block text-[11px] text-[var(--color-warn)]">
                        Suggested — not stated in the source
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {content.caveats?.length > 0 && (
          <section className="rounded border border-[var(--color-warn-border)] bg-[var(--color-warn-soft)] px-4 py-3">
            <p className={cx(SECTION_LABEL, 'text-[var(--color-warn)]')}>Caveats</p>
            <div className="mt-1.5">
              <EditableList
                items={content.caveats}
                editing={editing}
                label="Caveat"
                onChange={(v) => set(['caveats'], v)}
                listClassName="list-disc space-y-1 pl-5"
                itemClassName="text-sm leading-relaxed text-[var(--color-ink)]"
              />
            </div>
          </section>
        )}

        {content.references?.length > 0 && (
          <section className="border-t border-[var(--color-rule)] pt-3">
            <p className={SECTION_LABEL}>References</p>
            <ul className="mt-1.5 space-y-1.5">
              {content.references.map((ref, i) => (
                <li key={i} className="flex items-center gap-2">
                  <EditableText
                    as="span"
                    label={`Reference ${i + 1}`}
                    value={ref.label}
                    editing={editing}
                    onChange={(v) => set(['references', i, 'label'], v)}
                    className="text-xs text-[var(--color-ink-muted)]"
                  />
                  <EvidenceChip ids={ref.evidence} onEvidence={onEvidence} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function PresentationPreview({ content, editing, onChange, onEvidence }: PreviewProps<Presentation>) {
  const set = (path: (string | number)[], value: unknown) => onChange(setIn(content, path, value));

  return (
    <div className="space-y-4">
      <div className="text-center">
        <EditableText
          as="h2"
          label="Deck title"
          value={content.title}
          editing={editing}
          onChange={(v) => set(['title'], v)}
          className="text-lg font-semibold text-[var(--color-ink)]"
        />
        <p className="text-xs text-[var(--color-ink-faint)]">{content.slides.length} content slides</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {content.slides.map((slide, i) => {
          const layout = resolveLayout(slide);
          return (
            <figure key={i} className="space-y-1.5">
              <SlideCard
                slide={slide}
                layout={layout}
                index={i}
                editing={editing}
                set={set}
              />
              <figcaption className="flex items-start justify-between gap-2 px-0.5">
                <p className="flex-1 text-[11px] leading-snug text-[var(--color-ink-faint)]">
                  <span className="font-medium text-[var(--color-ink-muted)]">
                    {LAYOUT_LABELS[layout]} ·
                  </span>{' '}
                  {slide.speakerNotes || 'No speaker notes'}
                </p>
                <EvidenceChip ids={slide.evidence} onEvidence={onEvidence} />
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}

const LAYOUT_LABELS: Record<SlideLayout, string> = {
  bullets: 'Bullets',
  statement: 'Statement',
  stat: 'Headline figure',
  comparison: 'Comparison',
  chart: 'Chart',
  section: 'Section divider',
};

/** Palette shared with the PPTX renderer, so the preview and the file agree. */
const SLIDE_ACCENT = '#0f766e';
const CHART_COLORS = ['#0f766e', '#2dd4bf', '#5eead4', '#99f6e4', '#134e4a', '#14b8a6'];

const PAPER_INK = 'text-[var(--color-paper-ink)]';
const PAPER_MUTED = 'text-[var(--color-paper-muted)]';
const PAPER_FAINT = 'text-[var(--color-paper-faint)]';

/**
 * One 16:9 slide, drawn in the layout the exporter will use. Colours are the
 * fixed "paper" tokens: this previews a white .pptx, so it must not follow the
 * interface theme.
 */
function SlideCard({
  slide,
  layout,
  index,
  editing,
  set,
}: {
  slide: Slide;
  layout: SlideLayout;
  index: number;
  editing: boolean;
  set: (path: (string | number)[], value: unknown) => void;
}) {
  if (layout === 'section') {
    return (
      <div
        className="flex aspect-video flex-col justify-center overflow-hidden rounded-lg p-5 shadow-sm"
        style={{ background: SLIDE_ACCENT }}
      >
        <EditableText
          label={`Slide ${index + 1} title`}
          value={slide.title}
          editing={editing}
          onChange={(v) => set(['slides', index, 'title'], v)}
          className="text-base font-bold leading-tight text-white"
        />
        {slide.mainMessage?.trim() && (
          <p className="mt-1.5 text-[11px] leading-snug text-[#ccfbf1]">{slide.mainMessage}</p>
        )}
      </div>
    );
  }

  return (
    <div className="aspect-video overflow-hidden rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper)] p-4 shadow-sm">
      <div className="flex h-full flex-col">
        <EditableText
          label={`Slide ${index + 1} title`}
          value={slide.title}
          editing={editing}
          onChange={(v) => set(['slides', index, 'title'], v)}
          className={cx('text-[13px] font-semibold leading-tight', PAPER_INK)}
        />
        <span className="mt-1.5 block h-0.5 w-8 shrink-0" style={{ background: SLIDE_ACCENT }} />

        <div className="mt-2 min-h-0 flex-1 overflow-hidden">
          <SlideBody slide={slide} layout={layout} index={index} editing={editing} set={set} />
        </div>

        <div className="flex shrink-0 items-center justify-between pt-1">
          {slide.visualType !== 'none' ? (
            <span className={cx('text-[9px] italic', PAPER_FAINT)}>
              Suggested visual: {slide.visualType}
            </span>
          ) : (
            <span />
          )}
          <span className={cx('text-[9px]', PAPER_FAINT)}>{index + 1}</span>
        </div>
      </div>
    </div>
  );
}

function SlideBody({
  slide,
  layout,
  index,
  editing,
  set,
}: {
  slide: Slide;
  layout: SlideLayout;
  index: number;
  editing: boolean;
  set: (path: (string | number)[], value: unknown) => void;
}) {
  const message = (
    <EditableText
      label={`Slide ${index + 1} main message`}
      value={slide.mainMessage}
      editing={editing}
      onChange={(v) => set(['slides', index, 'mainMessage'], v)}
      className={cx('text-[11px] leading-snug', PAPER_INK)}
    />
  );

  switch (layout) {
    case 'statement':
      return (
        <EditableText
          label={`Slide ${index + 1} statement`}
          value={slide.mainMessage}
          editing={editing}
          onChange={(v) => set(['slides', index, 'mainMessage'], v)}
          className={cx('text-sm leading-snug', PAPER_INK)}
        />
      );

    case 'stat': {
      // resolveLayout only returns 'stat' when a figure is present.
      const stat = slide.keyStat!;
      return (
        <div className="grid h-full grid-cols-2 items-center gap-3">
          <div className="text-center">
            <p className="text-2xl font-bold leading-none" style={{ color: SLIDE_ACCENT }}>
              {stat.value}
              {stat.unit}
            </p>
            <p className={cx('mt-1 text-[9px] leading-tight', PAPER_MUTED)}>{stat.caption}</p>
          </div>
          <div>{message}</div>
        </div>
      );
    }

    case 'comparison': {
      const c = slide.comparison!;
      const sides = [
        { label: c.leftLabel, points: c.leftPoints },
        { label: c.rightLabel, points: c.rightPoints },
      ];
      return (
        <div className="grid h-full grid-cols-2 gap-2">
          {sides.map((side, j) => (
            <div key={j} className="rounded border border-[#e5e7eb] bg-[#e6f4f2] p-1.5">
              <p className="text-[10px] font-semibold" style={{ color: SLIDE_ACCENT }}>
                {side.label}
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {side.points.slice(0, 4).map((point, k) => (
                  <li key={k} className={cx('text-[9px] leading-tight', PAPER_INK)}>
                    • {point}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      );
    }

    case 'chart':
      return (
        <div className="grid h-full grid-cols-[3fr_2fr] items-stretch gap-3">
          <MiniChart chart={slide.chart!} />
          <div className="self-center">{message}</div>
        </div>
      );

    default:
      return (
        <ul className="space-y-1">
          {slide.bullets?.map((bullet, j) => (
            <li key={j} className="flex gap-1.5">
              <span className="mt-1.5 h-0.5 w-0.5 shrink-0 rounded-full bg-[var(--color-paper-muted)]" />
              <EditableText
                as="span"
                label={`Slide ${index + 1} bullet ${j + 1}`}
                value={bullet}
                editing={editing}
                onChange={(v) => set(['slides', index, 'bullets', j], v)}
                className={cx('text-[10px] leading-snug', PAPER_MUTED)}
              />
            </li>
          ))}
        </ul>
      );
  }
}

/**
 * A small drawing of the chart the export will contain, from the same values.
 * PowerPoint draws the real, editable chart; this is only the preview.
 */
function MiniChart({ chart }: { chart: NonNullable<Slide['chart']> }) {
  const values = chart.values;
  const max = Math.max(...values.map((v) => Math.abs(v)), 1);

  if (chart.kind === 'pie') {
    const total = values.reduce((sum, v) => sum + Math.max(v, 0), 0) || 1;
    // Each segment ends where the running share of the total reaches it.
    const ends = values.map(
      (_, i) => (values.slice(0, i + 1).reduce((sum, v) => sum + Math.max(v, 0), 0) / total) * 360,
    );
    const stops = values.map(
      (_, i) => `${CHART_COLORS[i % CHART_COLORS.length]} ${i === 0 ? 0 : ends[i - 1]}deg ${ends[i]}deg`,
    );
    return (
      <div className="flex h-full items-center gap-2">
        <div
          className="aspect-square h-full max-h-20 rounded-full"
          style={{ background: `conic-gradient(${stops.join(', ')})` }}
          role="img"
          aria-label={`Pie chart of ${chart.seriesName}`}
        />
        <ul className="min-w-0 space-y-0.5">
          {chart.categories.map((category, i) => (
            <li key={i} className={cx('flex items-center gap-1 text-[8px]', PAPER_MUTED)}>
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-sm"
                style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
              />
              <span className="truncate">{category}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (chart.kind === 'line') {
    const points = values
      .map((v, i) => {
        const x = values.length === 1 ? 50 : (i / (values.length - 1)) * 100;
        const y = 90 - (Math.max(v, 0) / max) * 80;
        return `${x},${y}`;
      })
      .join(' ');
    return (
      <div className="flex h-full flex-col">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="min-h-0 flex-1" role="img" aria-label={`Line chart of ${chart.seriesName}`}>
          <polyline points={points} fill="none" stroke={SLIDE_ACCENT} strokeWidth="3" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="flex justify-between">
          {chart.categories.map((category, i) => (
            <span key={i} className={cx('truncate text-[8px]', PAPER_FAINT)}>
              {category}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-end gap-1" role="img" aria-label={`Bar chart of ${chart.seriesName}`}>
      {values.map((value, i) => (
        <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
          <span className={cx('text-[8px] font-semibold', PAPER_INK)}>{value}</span>
          <div
            className="w-full rounded-t-sm"
            style={{
              height: `${Math.max((Math.abs(value) / max) * 70, 4)}%`,
              background: CHART_COLORS[0],
            }}
          />
          <span className={cx('mt-0.5 w-full truncate text-center text-[8px]', PAPER_FAINT)}>
            {chart.categories[i]}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Infographic
// ---------------------------------------------------------------------------

function InfographicPreview({ content, editing, onChange, onEvidence }: PreviewProps<Infographic>) {
  const set = (path: (string | number)[], value: unknown) => onChange(setIn(content, path, value));

  // The preview is the exported file: same deterministic renderer, same output.
  // The SVG is built by our own code with all text XML-escaped; no model markup
  // is ever rendered.
  const infographicLayout = resolveInfographicLayout(content);

  const svg = useMemo(() => {
    try {
      return renderInfographicSvg(content);
    } catch {
      return null;
    }
  }, [content]);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <div>
        {svg ? (
          <div
            className="overflow-hidden rounded-lg border border-[var(--color-rule)] shadow-sm [&>svg]:h-auto [&>svg]:w-full"
            /* Our own renderer's output, fully escaped. */
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <p className="text-xs text-[var(--color-danger)]">This infographic could not be rendered.</p>
        )}
        <p className="mt-1.5 text-center text-[11px] text-[var(--color-ink-faint)]">
          Exactly what the SVG download contains
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <p className={SECTION_LABEL}>Headline</p>
          <EditableText
            label="Headline"
            value={content.headline}
            editing={editing}
            onChange={(v) => set(['headline'], v)}
            className="mt-1 text-sm font-semibold text-[var(--color-ink)]"
          />
        </div>

        {/* Shows whichever block the renderer actually drew, so the panel and
            the image never describe different things. */}
        {infographicLayout === 'stats' && (
          <div>
            <p className={SECTION_LABEL}>Statistics</p>
            <ul className="mt-1.5 space-y-2">
              {content.statistics.map((stat, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="font-mono text-sm font-semibold text-[var(--color-accent)]">
                    {stat.value}
                    {stat.unit}
                  </span>
                  <EditableText
                    as="span"
                    label={`Statistic ${i + 1} caption`}
                    value={stat.caption}
                    editing={editing}
                    onChange={(v) => set(['statistics', i, 'caption'], v)}
                    className="flex-1 text-xs text-[var(--color-ink-muted)]"
                  />
                  <EvidenceChip ids={stat.evidence} onEvidence={onEvidence} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {infographicLayout === 'chart' && content.chart && (
          <div>
            <p className={SECTION_LABEL}>
              {content.chart.kind === 'donut' ? 'Donut chart' : 'Bar chart'} · {content.chart.seriesName}
            </p>
            <ul className="mt-1.5 space-y-1">
              {content.chart.categories.map((category, i) => (
                <li key={i} className="flex items-baseline gap-2 text-xs">
                  <span className="font-mono font-semibold text-[var(--color-accent)]">
                    {content.chart!.values[i]}
                  </span>
                  <span className="flex-1 text-[var(--color-ink-muted)]">{category}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-[var(--color-ink-faint)]">
              Plotted from the source. These values are checked against it like any other figure.
            </p>
          </div>
        )}

        {infographicLayout === 'comparison' && content.comparison && (
          <div>
            <p className={SECTION_LABEL}>Comparison</p>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {[
                { label: content.comparison.leftLabel, value: content.comparison.leftValue, points: content.comparison.leftPoints },
                { label: content.comparison.rightLabel, value: content.comparison.rightValue, points: content.comparison.rightPoints },
              ].map((side, i) => (
                <div key={i} className="rounded border border-[var(--color-rule)] p-2">
                  <p className="text-[11px] font-semibold text-[var(--color-ink-muted)]">{side.label}</p>
                  {side.value && (
                    <p className="font-mono text-sm font-semibold text-[var(--color-accent)]">{side.value}</p>
                  )}
                  <ul className="mt-1 space-y-0.5">
                    {side.points.map((point, j) => (
                      <li key={j} className="text-[11px] leading-snug text-[var(--color-ink-muted)]">
                        • {point}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {infographicLayout === 'qualitative' && (
          <p className="rounded border border-[var(--color-info-border)] bg-[var(--color-info-soft)] px-3 py-2 text-xs text-[var(--color-info)]">
            The source contained no usable figures, so a qualitative layout is used. No numbers were
            invented to fill the template.
          </p>
        )}

        <div>
          <p className={SECTION_LABEL}>Key messages</p>
          <ul className="mt-1.5 space-y-2">
            {content.keyMessages.map((message, i) => (
              <li key={i}>
                <div className="flex items-baseline gap-2">
                  <EditableText
                    as="span"
                    label={`Message ${i + 1} label`}
                    value={message.label}
                    editing={editing}
                    onChange={(v) => set(['keyMessages', i, 'label'], v)}
                    className="text-xs font-semibold text-[var(--color-ink)]"
                  />
                  <EvidenceChip ids={message.evidence} onEvidence={onEvidence} />
                </div>
                <EditableText
                  label={`Message ${i + 1} detail`}
                  value={message.detail}
                  editing={editing}
                  onChange={(v) => set(['keyMessages', i, 'detail'], v)}
                  className="text-xs leading-relaxed text-[var(--color-ink-muted)]"
                />
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className={SECTION_LABEL}>Accessible description</p>
          <EditableText
            label="Alt text"
            value={content.altText}
            editing={editing}
            onChange={(v) => set(['altText'], v)}
            className="mt-1 text-xs leading-relaxed text-[var(--color-ink-muted)]"
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Video package
// ---------------------------------------------------------------------------

function VideoPackagePreview({ content, editing, onChange, onEvidence }: PreviewProps<VideoPackage>) {
  const set = (path: (string | number)[], value: unknown) => onChange(setIn(content, path, value));
  const total = content.scenes.reduce((sum, s) => sum + (s.estimatedSeconds || 0), 0);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-rule)] pb-3">
        <div>
          <EditableText
            as="h2"
            label="Video title"
            value={content.title}
            editing={editing}
            onChange={(v) => set(['title'], v)}
            className="text-base font-semibold text-[var(--color-ink)]"
          />
          <p className="text-xs text-[var(--color-ink-faint)]">{content.objective}</p>
        </div>
        <Badge tone="info">~{Math.round(total)}s estimated runtime</Badge>
      </header>

      <div className="space-y-3">
        {content.scenes.map((scene, i) => (
          <article
            key={i}
            className="grid gap-3 rounded-lg border border-[var(--color-rule)] bg-[var(--color-surface)] p-3 sm:grid-cols-[132px_minmax(0,1fr)]"
          >
            {/* Storyboard frame: a placeholder, since no imagery is generated. */}
            <div className="flex aspect-video flex-col items-center justify-center rounded border border-dashed border-[var(--color-rule-strong)] bg-[var(--color-surface-sunken)] p-2 text-center">
              <span className="text-[10px] font-semibold text-[var(--color-ink-faint)]">
                SCENE {scene.index}
              </span>
              <span className="mt-0.5 text-[9px] leading-tight text-[var(--color-ink-faint)]">
                Visual not generated
              </span>
            </div>

            <div className="min-w-0 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <EditableText
                  as="span"
                  label={`Scene ${scene.index} heading`}
                  value={scene.heading}
                  editing={editing}
                  onChange={(v) => set(['scenes', i, 'heading'], v)}
                  className="text-sm font-semibold text-[var(--color-ink)]"
                />
                <span className="shrink-0 text-[11px] text-[var(--color-ink-faint)]">
                  ~{scene.estimatedSeconds}s
                </span>
              </div>

              <div>
                <p className={SECTION_LABEL}>Narration</p>
                <EditableText
                  label={`Scene ${scene.index} narration`}
                  value={scene.narration}
                  editing={editing}
                  onChange={(v) => set(['scenes', i, 'narration'], v)}
                  className="mt-0.5 text-xs leading-relaxed text-[var(--color-ink)]"
                />
              </div>

              {(scene.onScreenText?.trim() || editing) && (
                <div>
                  <p className={SECTION_LABEL}>On-screen text</p>
                  <EditableText
                    label={`Scene ${scene.index} on-screen text`}
                    value={scene.onScreenText}
                    editing={editing}
                    onChange={(v) => set(['scenes', i, 'onScreenText'], v)}
                    placeholder="None"
                    className="mt-0.5 text-xs text-[var(--color-ink-muted)]"
                  />
                </div>
              )}

              <div className="flex items-end justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className={SECTION_LABEL}>Visual recommendation</p>
                  <EditableText
                    label={`Scene ${scene.index} visual`}
                    value={scene.visualRecommendation}
                    editing={editing}
                    onChange={(v) => set(['scenes', i, 'visualRecommendation'], v)}
                    className="mt-0.5 text-xs italic text-[var(--color-ink-faint)]"
                  />
                </div>
                <EvidenceChip ids={scene.evidence} onEvidence={onEvidence} />
              </div>
            </div>
          </article>
        ))}
      </div>

      <p className="rounded border border-[var(--color-info-border)] bg-[var(--color-info-soft)] px-3 py-2 text-[11px] leading-relaxed text-[var(--color-info)]">
        This is a production package, not a rendered video. Scene durations and subtitle timings are
        estimates from narration length; no audio was generated. The download contains the script,
        storyboard, narration, subtitles and visual direction.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const PREVIEWS: Record<FormatId, (props: PreviewProps<never>) => React.ReactElement> = {
  exec_summary: ExecSummaryPreview as never,
  linkedin: LinkedInPreview as never,
  x_thread: XThreadPreview as never,
  advisory: AdvisoryPreview as never,
  presentation: PresentationPreview as never,
  infographic: InfographicPreview as never,
  video_package: VideoPackagePreview as never,
};

export function ArtifactPreview({
  format,
  content,
  editing,
  onChange,
  onEvidence,
}: {
  format: FormatId;
  content: unknown;
  editing: boolean;
  onChange: (next: unknown) => void;
  onEvidence: (ids: string[]) => void;
}) {
  const Component = PREVIEWS[format];
  return (
    <Component
      content={content as never}
      editing={editing}
      onChange={onChange as never}
      onEvidence={onEvidence}
    />
  );
}
