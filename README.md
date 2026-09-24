# SourceBridge

**One source. Multiple formats. Traceable facts.**

SourceBridge turns a single source document into a coordinated communication package. It reads the
source once, builds a shared ledger of its facts, figures and caveats, then writes every output
format from that same foundation — so the numbers and the qualifications stay consistent across all
of them, and every claim links back to the passage it came from.

Built for SIH 2026, problem statement 26154.

---

## What is implemented

| Capability | Status |
| --- | --- |
| Paste text as a source | Implemented |
| Upload a text-based PDF, with page numbers | Implemented |
| Upload an image (PNG/JPEG/WebP), read by a vision model | Implemented |
| Upload a short video (MP4/WebM/MOV), transcribed by the model | Implemented |
| Fetch an article by URL, with SSRF protection | Implemented |
| Indic script support in .pptx and .svg exports | Implemented |
| Scanned / image-only PDF detection | Implemented — reported as unsupported, no OCR |
| Paragraph reflow (rejoins lines a PDF broke mid-sentence) | Implemented |
| Source preview with page navigation and stable passage IDs | Implemented |
| Shared fact ledger with per-fact evidence links | Implemented |
| Seven output formats, each with its own schema and preview | Implemented |
| Creative draft mode (no source, from a prompt) | Implemented |
| Inline editing of any generated artefact | Implemented |
| Copy as plain text; copy individual X posts | Implemented |
| Evidence inspection (click a reference, read the passage) | Implemented |
| Per-format regeneration and retry after failure | Implemented |
| Structural validation (invalid references, drifted figures, overflow) | Implemented |
| Markdown / text export for all seven formats | Implemented |
| `.pptx` export with speaker notes | Implemented |
| Six slide layouts, including native editable PowerPoint charts | Implemented |
| `.svg` infographic export | Implemented |
| Four infographic layouts (stats, chart, comparison, qualitative) | Implemented |
| Video package `.zip` (script, storyboard, narration, SRT) | Implemented |
| "Download all" — every completed format in one archive | Implemented |
| Automatic model fallback when the provider is overloaded | Implemented |
| Light / dark theme with a header toggle | Implemented |

### The seven formats

Executive summary · LinkedIn post · X post or thread · Advisory · Presentation · Infographic ·
Video production package.

Each has a real generator, its own output schema, and a preview shaped like the thing it becomes.
None is a placeholder.

---

## What is NOT implemented

Stated plainly, because the interface is not allowed to imply otherwise:

- **No OCR for PDFs.** Scanned PDFs are rejected with a clear message. Images *are* supported, but
  they are read by a vision model — a transcription, not a literal extraction — and every
  image-sourced document carries a warning saying so.
- **No rendered video.** The video output is a production package (script, storyboard, narration,
  subtitles). No MP4, no audio. Subtitle timings are **estimates** derived from narration length and
  are labelled as such inside the exported file.
- **No fact verification.** Validation is structural: it checks that evidence IDs resolve, that
  figures in the output also appear in the source, and that content fits its layout. It does **not**
  check whether the content is true or correctly interpreted.
- **No persistence.** Work lives in the browser tab and is lost on refresh. The app warns before you
  leave. Download anything you want to keep.
- **No accounts, collaboration, or approval workflow.**
- **No DOCX ingestion.**
- **Multilingual output is generated but not quality-checked.** Non-English selections work, and the
  exporters declare fonts covering Devanagari, Bengali, Tamil and Telugu. Rendering still depends on
  the machine opening the file having such a font installed (Windows ships Nirmala UI). No claim is
  made about translation quality.
- **No confidence scores or usage metrics** — any number shown would be invented.

---

## Prerequisites

- **Node.js 20 or newer.** Developed and tested on Node 24.18.0 / npm 11.16.0.
- **A Google Gemini API key.** The free tier is sufficient — no billing setup required. Get one at
  <https://aistudio.google.com/apikey>.

## Installation

```bash
npm install
cp .env.example .env.local
```

Then edit `.env.local` and add your key:

```
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-flash-lite-latest
```

`.env.local` is gitignored. **The key is read only on the server** and is never sent to the browser.

> **Data handling:** source content you provide is sent to Google's Gemini API for processing. This
> is not local-only processing. Do not upload material you are not permitted to share with a
> third-party service.

### About model names

Gemini model availability changes over time. If you see *"no longer available to new users"*, set
`GEMINI_MODEL` to a current model name.

Free-tier capacity also fluctuates — a model can return `503 high demand` for a minute and be fine
the next. SourceBridge handles this automatically by rotating through a fallback chain
(`GEMINI_FALLBACK_MODELS`, default `gemini-3.1-flash-lite,gemini-3.5-flash-lite,gemini-3.6-flash`)
before giving up. The header badge shows which model actually answered.

### Free-tier daily quota

Gemini caps free-tier requests **per model, per day** — `gemini-3.6-flash` allows 20/day. One
seven-format run costs about eight requests (one analysis plus one per format), so a single model
gives roughly two runs a day. The fallback chain spreads load across several models, each with its
own allowance. If generation starts failing with a 429 mentioning `PerDay` or `FreeTier`, the
allowance has reset in 24 hours or another model is needed — it is not a transient spike.

## Running locally

```bash
npm run dev
```

Open <http://localhost:3000>, then press **Try the sample report**.

The header shows live provider status. <http://localhost:3000/api/health> reports whether the key is
configured and reachable without revealing it.

**After changing `.env.local`, restart the dev server** — Next.js reads environment variables at
startup.

## Commands

```bash
npm run dev         # development server
npm run build       # production build
npm run start       # production server (after build)
npm test            # 127 tests, no API key required
npm run typecheck   # TypeScript, no emit
npm run lint        # ESLint
npm run smoke       # live end-to-end check against a running server (uses your API key)
npm run build:deck  # regenerate the technical presentation via SourceBridge's own exporter
node scripts/theme-check.mjs <dir>          # capture both themes in a browser
node scripts/render-deck.mjs <out.pptx>     # export a deck covering every slide layout
node scripts/render-infographics.mjs <dir>  # render all four infographic layouts
powershell -File scripts/pptx-to-png.ps1 <in.pptx> <dir>   # open a .pptx in PowerPoint, export PNGs
```

---

## Sample workflow

1. Press **Try the sample report** — a synthetic rainwater-harvesting pilot report from
   [`samples/`](samples/).
2. Review the extracted pages. Each passage shows its stable ID.
3. The **shared fact ledger** builds automatically: claims, figures with units, dates and caveats.
4. Choose an audience (for example *General public*), an objective and a tone.
5. Select formats and press **Generate**. Each format is a separate request, so results appear as
   they finish and one failure never removes another format's result.
6. Click any **source** chip to read the supporting passage, then *Show in source* to jump to it.
7. Press **Edit** and change something. Edits are stored separately from the generated content.
8. Download the `.pptx`, the `.svg`, or the video `.zip` — or press **Download all** for every
   completed format in one archive. **Downloads contain your edits.**

### Themes

The header carries a light/dark toggle. It follows your system preference until you pick a theme,
then remembers that choice per browser; double-click the button to go back to following the system.
An inline script applies the stored theme before first paint, so there is no flash of the wrong
palette on reload.

Two things deliberately stay light in both themes, because they preview light documents: the slide
cards (which preview a white `.pptx`) and the infographic (which renders the actual exported SVG).

### Creative draft mode

No document? On the landing page choose **Draft from a prompt instead**. SourceBridge will draft the
same formats from your prompt alone — but with no source there is nothing to cite, so it produces no
evidence references, marks every output *not source-verified*, and will not invent statistics or
citations to fill the gap.

---

## Testing

```bash
npm test
```

127 tests run without an API key:

- **Extraction** — page metadata, segment ID uniqueness, figures and caveats surviving extraction,
  results tables kept whole, paragraph reflow, oversized input rejected rather than truncated,
  scanned PDFs reported as unsupported.
- **Validation** — invalid evidence IDs flagged, drifted figures caught (`34%` when the source says
  `18.0%`), formatting-equivalent figures *not* flagged (`18%` matches `18.0%`; a bare `18` matches
  `18.0%` when the unit lives in a sibling field), structural numbers such as scene durations
  ignored, overflow risks detected.
- **Layouts** — each slide and infographic layout is drawn from the data it claims to show, and a
  layout the content cannot support (a chart with one value, a donut of negatives, a stat with no
  figure) falls back rather than drawing an empty region. Plotted values are validated against the
  source like any other figure.
- **Exports** — the `.pptx` is opened as a zip and its OOXML parts inspected (slide order, speaker
  notes, figures preserved, overlong text trimmed, edits present); SVG is checked for
  well-formedness and XML escaping; the video package is checked for every promised file and for its
  estimate labels.
- **SSRF screening** — loopback, RFC1918, carrier-grade NAT, multicast, IPv6 link-local and
  IPv4-mapped bypasses (`::ffff:127.0.0.1`) are all blocked; the cloud metadata endpoint
  (`169.254.169.254`) has its own test. Unparseable addresses fail closed.
- **Fonts** — script detection, Indic font stacks in SVG, and `typeface="Nirmala UI"` present in
  the PPTX run properties.
- **Media sources** — image and video transcripts always carry a warning naming the model; video
  frame duplicates are collapsed without removing genuinely repeated lines.
- **Prompt boundary** — hostile source text (`IGNORE ALL PREVIOUS INSTRUCTIONS`) is verified to sit
  inside the data fence, and the system message to instruct the model to treat it as data.
- **Workspace state** — a failed format never removes a completed one, a failed retry keeps the
  previous result, edits are stored separately from generated content, and a new source invalidates
  the ledger and every artefact derived from it.
- **Bundle export** — every format written, a nested `.pptx` that is valid OOXML, edits carried into
  the archive, and an artefact whose content no longer validates is reported in the README rather
  than silently dropped.

### Live check

```bash
npm run dev        # in one terminal
npm run smoke      # in another
```

Runs the real pipeline against the sample and reports per-format latency, evidence validity, figure
fidelity and any validation findings. This consumes API quota.

### What was observed

On one run of the sample report (a measurement, not a benchmark):

- All 7 formats generated successfully from one 3-page source.
- 49 evidence references produced; **0 failed to resolve** to a real passage.
- The pilot-population caveat carried into **all 7** outputs.

### Manual checks that still need a person

- Open the exported `.pptx` in PowerPoint and confirm nothing is clipped.
- Confirm the cited passages genuinely support the claims that cite them.
- Confirm essential caveats survived into the outputs that needed them.

---

## Deployment

The app is a standard Next.js server application. The **Node runtime is required** — PDF extraction
and PPTX generation are not edge-compatible.

Supply `GEMINI_API_KEY` as a server-side environment variable wherever you deploy. Never bake it
into an image or commit it.

### Docker

```bash
docker build -t sourcebridge .
docker run -e GEMINI_API_KEY=your-key -p 3000:3000 sourcebridge
```

### Node host / Vercel

```bash
npm run build
npm run start
```

`samples/` is read at runtime by `/api/sample`; `next.config.ts` declares it via
`outputFileTracingIncludes` so it survives traced deployments.

Generation latency is provider-bound. Concurrency is capped at two in-flight requests to respect
free-tier rate limits.

---

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The five-slide technical presentation is at
[`docs/SourceBridge-technical-presentation.pptx`](docs/SourceBridge-technical-presentation.pptx) —
generated by SourceBridge's own PPTX exporter.

```
Browser workspace (React state; no database)
        │
        ▼
POST /api/extract   validate → extract text → reflow → segment with stable IDs
        │
        ▼
POST /api/analyze   shared fact ledger; invented evidence IDs stripped
        │
        ▼
POST /api/generate  one request per format, bounded concurrency
        │           schema validation + repair retry + structural checks
        ▼
Editable previews (generated content and edits stored separately)
        │
        ▼
POST /api/export    deterministic renderers — no model call
```

### Key design decisions

- **Source documents are data, never instructions.** Source text is fenced and the model is told
  explicitly to ignore directives inside it. Covered by tests.
- **Deterministic rendering.** The model produces structured content; application code renders
  slides, SVG and packages. No model-generated markup is ever executed.
- **One format per request.** Partial success is structural, not incidental.
- **Generated content and edits are separate fields.** Regeneration warns before replacing edits.
- **Exports never call the model.** An export cannot fail because of the provider, and always
  renders the operator's current version.

---

## Project layout

```
app/
  api/            extract · analyze · generate · export · sample · health
  page.tsx        the workspace
components/       Landing, Workspace, panels, seven previews, evidence drawer, UI primitives
lib/
  types.ts        data contracts
  extract.ts      PDF/text extraction, reflow and segmentation
  schemas.ts      Zod schemas: fact ledger + one per format
  prompts.ts      prompt construction and the injection boundary
  provider.ts     server-only Gemini access, model fallback, repair retry
  validate.ts     structural checks
  export/         pptx · svg · markdown · videoPackage renderers
  client/         browser API helpers and workspace state
samples/          synthetic test documents
scripts/          smoke test, deck builder, screenshot driver
tests/            127 tests
```

---

## Third-party licences

| Package | Purpose | Licence |
| --- | --- | --- |
| [Next.js](https://nextjs.org) | Framework | MIT |
| [React](https://react.dev) | UI | MIT |
| [Tailwind CSS](https://tailwindcss.com) | Styling | MIT |
| [unpdf](https://github.com/unjs/unpdf) | PDF text extraction | MIT |
| [PptxGenJS](https://gitbrent.github.io/PptxGenJS/) | PPTX generation | MIT |
| [JSZip](https://stuk.github.io/jszip/) | Video package zip | MIT or GPLv3 |
| [Zod](https://zod.dev) | Schema validation | MIT |
| [@google/genai](https://github.com/googleapis/js-genai) | Gemini API client | Apache-2.0 |
| [Vitest](https://vitest.dev) | Tests | MIT |
| [playwright-core](https://playwright.dev) | Screenshot script (dev only) | Apache-2.0 |

Sample documents in `samples/` are synthetic and were generated for this project. The
rainwater-harvesting pilot they describe is fictional.

---

## Honest scope

SourceBridge does not promise that AI generates everything perfectly. It promises a workflow where
one source becomes a coordinated communication package, with **visible evidence** and **human
control** at every step. Every generated artefact requires review before publication.
