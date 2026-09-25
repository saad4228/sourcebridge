'use client';

/**
 * Pre-source landing view.
 *
 * Before a source exists there is nothing to put in a workspace, so the page
 * explains the idea and offers the two ways in. Claims here are limited to what
 * the application actually does.
 */

import { useRef, useState } from 'react';
import { Button, Spinner, cx } from './ui';
import { FormatIcon } from './FormatIcon';
import { LIMITS } from '@/lib/extract';
import { FORMAT_DESCRIPTIONS, FORMAT_IDS, FORMAT_LABELS } from '@/lib/types';

export function Landing({
  busy,
  onExtractText,
  onExtractPdf,
  onLoadSample,
  onExtractUrl,
  onStartCreative,
}: {
  busy: boolean;
  onExtractText: (text: string) => void;
  onExtractPdf: (file: File) => void;
  onLoadSample: (type: 'report' | 'image') => void;
  onExtractUrl: (url: string) => void;
  onStartCreative: (prompt: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [dragging, setDragging] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [creative, setCreative] = useState('');
  const [showCreative, setShowCreative] = useState(false);
  const [url, setUrl] = useState('');
  const [showUrl, setShowUrl] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const tooLong = draft.length > LIMITS.maxChars;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">
      {/* --- Hero --------------------------------------------------------- */}
      <section className="text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Content transformation workspace
        </p>
        <h1 className="mx-auto mt-3 max-w-3xl text-balance text-3xl font-semibold leading-tight tracking-tight text-[var(--color-ink)] sm:text-4xl">
          Turn one source into a coordinated communication package
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-pretty text-[15px] leading-relaxed text-[var(--color-ink-muted)]">
          SourceBridge reads your document once, builds a shared ledger of its facts, figures and
          caveats, then writes every format from that same foundation — so the numbers and the
          qualifications stay consistent across all of them.
        </p>
      </section>

      {/* --- Input -------------------------------------------------------- */}
      <section className="mt-9">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) onExtractPdf(file);
          }}
          onClick={(e) => {
            if (busy) return;
            // The zone holds its own buttons and inputs. A click that landed on
            // one of those is that control's click, not the zone's, and opening
            // the file picker as well would fight whatever the operator meant.
            if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) return;
            fileInput.current?.click();
          }}
          className={cx(
            'rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
            // Deliberately not role="button" with a tabIndex: a button may not
            // contain other buttons, and this one holds several. The "Choose a
            // file" button below stays the keyboard and screen-reader path;
            // clicking the zone is a mouse shortcut on top of it.
            !busy && 'cursor-pointer',
            dragging
              ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
              : 'border-[var(--color-rule-strong)] bg-[var(--color-surface)] hover:border-[var(--color-accent)]',
          )}
        >
          {busy ? (
            <span className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-ink-muted)]">
              <Spinner /> Extracting source text…
            </span>
          ) : (
            <>
              <svg
                width="30"
                height="30"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mx-auto mb-3 text-[var(--color-ink-faint)]"
                aria-hidden="true"
              >
                <path d="M12 16V4m0 0L8 8m4-4l4 4" />
                <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
              <p className="text-base font-semibold text-[var(--color-ink)]">
                Click to choose a file, drop one here, or start from the sample
              </p>
              <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-[var(--color-ink-faint)]">
                Text-based PDF up to {LIMITS.maxPdfBytes / 1024 / 1024} MB, or an image (PNG, JPEG, WebP) up to{' '}
                {LIMITS.maxImageBytes / 1024 / 1024} MB, or a short video up to {LIMITS.maxVideoBytes / 1024 / 1024} MB. Images and video are
                read by an AI model, so check the transcription before relying on it. Scanned PDFs are not supported.
              </p>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <Button variant="primary" onClick={() => onLoadSample('report')}>
                  Try the sample incident report
                </Button>
                <Button variant="secondary" onClick={() => onLoadSample('image')}>
                  Try a news image
                </Button>
                <Button variant="secondary" onClick={() => fileInput.current?.click()}>
                  Choose a file
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowUrl((v) => !v);
                    setShowPaste(false);
                    setShowCreative(false);
                  }}
                >
                  {showUrl ? 'Hide link box' : 'Paste a link'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowPaste((v) => !v);
                    setShowUrl(false);
                    setShowCreative(false);
                  }}
                >
                  {showPaste ? 'Hide paste box' : 'Paste text instead'}
                </Button>
              </div>

              <input
                ref={fileInput}
                type="file"
                accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onExtractPdf(file);
                  e.target.value = '';
                }}
              />
            </>
          )}
        </div>

        {showUrl && !busy && (
          <div className="mt-3 rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] p-4">
            <label htmlFor="landing-url" className="text-xs font-medium text-[var(--color-ink-muted)]">
              Article URL
            </label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <input
                id="landing-url"
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && url.trim()) onExtractUrl(url.trim());
                }}
                placeholder="https://example.com/news/article"
                className="min-w-0 flex-1 rounded-md border border-[var(--color-rule-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
              />
              <Button
                variant="primary"
                disabled={!/^https?:\/\/\S+$/i.test(url.trim())}
                onClick={() => onExtractUrl(url.trim())}
              >
                Fetch page
              </Button>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
              The page is fetched by the server and its article text extracted. Pages behind a login,
              or that need JavaScript to render, will not work — paste the text instead.
            </p>
          </div>
        )}

        {showPaste && !busy && (
          <div className="mt-3 rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] p-4">
            <label htmlFor="landing-text" className="text-xs font-medium text-[var(--color-ink-muted)]">
              Paste source text
            </label>
            <textarea
              id="landing-text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={7}
              autoFocus
              placeholder="Paste a report, advisory, article or announcement…"
              className="sb-scroll mt-1.5 w-full resize-y rounded-md border border-[var(--color-rule-strong)] bg-[var(--color-surface)] p-3 text-sm leading-relaxed outline-none focus:border-[var(--color-accent)]"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <span
                className={cx(
                  'text-[11px]',
                  tooLong ? 'font-medium text-[var(--color-danger)]' : 'text-[var(--color-ink-faint)]',
                )}
              >
                {draft.length.toLocaleString()} / {LIMITS.maxChars.toLocaleString()} characters
              </span>
              <Button
                variant="primary"
                size="sm"
                disabled={draft.trim().length === 0 || tooLong}
                onClick={() => onExtractText(draft)}
              >
                Use this text
              </Button>
            </div>
          </div>
        )}

        {/* --- Creative draft mode ---------------------------------------- */}
        {!busy && (
          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={() => {
                setShowCreative((v) => !v);
                setShowPaste(false);
              }}
              aria-expanded={showCreative}
              className="text-xs font-medium text-[var(--color-accent)] hover:underline"
            >
              {showCreative ? '− Hide' : 'No document?'} Draft from a prompt instead
            </button>
          </div>
        )}

        {showCreative && !busy && (
          <div className="mt-3 rounded-xl border border-[var(--color-warn-border)] bg-[var(--color-warn-soft)] p-4">
            <label htmlFor="creative-prompt" className="text-xs font-medium text-[var(--color-ink)]">
              Describe what you need
            </label>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-warn)]">
              Creative draft mode has no source document, so nothing it produces is source-verified
              and it cites no evidence. It will not invent statistics or citations to fill the gap.
            </p>
            <textarea
              id="creative-prompt"
              value={creative}
              onChange={(e) => setCreative(e.target.value)}
              rows={4}
              placeholder="A public advisory on staying safe during a service outage…"
              className="mt-2 w-full resize-y rounded-md border border-[var(--color-rule-strong)] bg-[var(--color-surface)] p-3 text-sm leading-relaxed outline-none focus:border-[var(--color-accent)]"
            />
            <div className="mt-2 flex justify-end">
              <Button
                variant="primary"
                size="sm"
                disabled={creative.trim().length < 10}
                onClick={() => onStartCreative(creative)}
              >
                Start drafting
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* --- How it works ------------------------------------------------- */}
      <section className="mt-12">
        <h2 className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-faint)]">
          How it works
        </h2>
        <ol className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            {
              step: '01',
              title: 'Read the source once',
              body: 'Text and page numbers are extracted, then split into passages with stable IDs.',
            },
            {
              step: '02',
              title: 'Build a shared fact ledger',
              body: 'Claims, figures with units, dates and caveats — each linked to the passage it came from.',
            },
            {
              step: '03',
              title: 'Write every format from it',
              body: 'Each output draws on the same ledger, so figures and qualifications do not drift apart.',
            },
          ].map((item) => (
            <li
              key={item.step}
              className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] p-4"
            >
              <span className="font-mono text-[11px] font-semibold text-[var(--color-accent)]">
                {item.step}
              </span>
              <h3 className="mt-1.5 text-sm font-semibold text-[var(--color-ink)]">{item.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-muted)]">{item.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* --- Formats ------------------------------------------------------ */}
      <section className="mt-10">
        <h2 className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-faint)]">
          Seven output formats
        </h2>
        <ul className="mt-5 flex flex-wrap justify-center gap-2">
          {FORMAT_IDS.map((format) => (
            <li
              key={format}
              className="flex w-full items-start gap-2.5 rounded-lg border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2.5 sm:w-[calc(50%-0.25rem)] lg:w-[calc(33.333%-0.5rem)]"
            >
              <FormatIcon
                format={format}
                className="mt-0.5 h-5 w-5 text-[var(--color-accent)]"
              />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-[var(--color-ink)]">
                  {FORMAT_LABELS[format]}
                </p>
                <p className="text-[11px] leading-snug text-[var(--color-ink-faint)]">
                  {FORMAT_DESCRIPTIONS[format]}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* --- Honest scope -------------------------------------------------- */}
      <section className="mx-auto mt-10 max-w-3xl rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface-sunken)] px-5 py-4">
        <h2 className="text-xs font-semibold text-[var(--color-ink)]">What this prototype does not do</h2>
        <ul className="mt-2 grid gap-1.5 text-[11px] leading-relaxed text-[var(--color-ink-muted)] sm:grid-cols-2">
          <li>• Images and video are AI transcriptions; scanned PDFs are still rejected.</li>
          <li>• Video frames are drawn by this app, never by an image model.</li>
          <li>• Checks are structural; they do not verify that content is true.</li>
          <li>• Nothing is saved — work is lost on refresh, so download it.</li>
        </ul>
        <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
          Source content is sent to the configured AI provider for processing. Every generated
          artefact needs human review before publication.
        </p>
      </section>
    </div>
  );
}
