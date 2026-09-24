# SourceBridge — Architecture

SIH 2026 · Problem statement 26154 · Maximum two pages

---

## Page 1 — Goals, components and structure

### Goal

Organisations rewrite the same information repeatedly for different audiences and channels. Doing it
by hand is slow, and the versions drift: a figure gets rounded, a caveat gets dropped, a
recommendation appears that the source never made.

SourceBridge transforms one source into several communication artefacts that share a single factual
foundation, and makes the link between each claim and its supporting passage inspectable.

### Design principles

1. **Understand the source once.** Extraction and fact analysis run once per source; every format
   reuses the result. No repeated parsing, no per-format drift.
2. **Source material is data, not instructions.** Uploaded text is fenced and explicitly marked as
   data. Directives embedded in a document are never treated as commands.
3. **The model writes; the application renders.** Structured content comes from the model. Slides,
   SVG and packages are produced by deterministic code, so output cannot be broken — or hijacked —
   by an unexpected response.
4. **Partial success is normal.** One format per request. A failure affects one artefact.
5. **Human control is the product.** Everything is editable, every claim is traceable, and every
   limitation is stated rather than hidden.

### Component diagram

```
┌──────────────────────────────────────────────────────────────────┐
│ Browser — Next.js workspace (React, TypeScript, Tailwind)        │
│                                                                  │
│  SourcePanel      ConfigPanel      OutputPanel    EvidenceDrawer │
│  (input, pages)   (brief,formats)  (7 previews)   (passages)     │
│                                                                  │
│  Workspace state: source · ledger · brief · artifacts            │
│  Generated content and operator edits held in SEPARATE fields    │
└───────────────────────────────┬──────────────────────────────────┘
                                │  fetch (JSON / multipart)
┌───────────────────────────────▼──────────────────────────────────┐
│ Next.js server routes (Node runtime)                             │
│                                                                  │
│  /api/extract   validate · PDF text · reflow · segment by ID     │
│  /api/analyze   shared fact ledger · strip invented evidence IDs │
│  /api/generate  one format · schema validate · repair · checks   │
│  /api/export    deterministic renderers — NO model call          │
│  /api/sample    bundled sample, extracted server-side            │
│  /api/health    provider reachability, never reveals the key     │
│                                                                  │
│  lib/provider.ts — the ONLY place the API key is read            │
└───────────────────────────────┬──────────────────────────────────┘
                                │  HTTPS, server-side credentials
                     ┌──────────▼──────────┐
                     │  Google Gemini API  │
                     └─────────────────────┘
```

### Stack and rationale

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 16 + React 19 + TypeScript | One deployable unit; server routes keep the key off the client |
| Styling | Tailwind CSS 4 | Consistent spacing and colour without a separate design system |
| PDF text | `unpdf` | Returns **per-page** text, which the evidence model depends on; verified on Node 24 before adoption |
| Provider | Gemini via `@google/genai` | Free tier needs no billing; a fallback model chain absorbs free-tier `503` spikes |
| Schemas | Zod 4 | One definition drives both the provider's structured-output schema and server-side validation |
| PPTX | `PptxGenJS` | Maintained, Node-compatible; output verified by inspecting OOXML parts |
| Infographic | Hand-written SVG templates | Deterministic, escapable, and identical in preview and download |
| Persistence | None | Not justified at prototype scope; the UI says so rather than implying otherwise |

A separate Python backend, PostgreSQL, Redis, a queue and a vector database were all considered and
rejected: none is justified by the actual requirements at this scope, and each would consume time
that the interaction quality needed.

---

## Page 2 — Data flow, evidence, validation, limitations

### Data flow

1. **Ingest.** Size and type are validated. Oversized input is **rejected with an explanation**, never
   silently truncated. A PDF with no text layer anywhere is reported as scanned and unsupported;
   individual blank pages produce a warning naming those pages.
2. **Reflow and segment.** PDF extraction returns one line per *rendered* line, so a paragraph
   arrives in fragments. Lines that clearly continue the previous one are rejoined (hyphenated word
   splits included) while genuine breaks and headings are preserved — this improves both the preview
   and what the model reads. Text is then split into passage-sized segments on heading boundaries and
   a length target, each with a stable ID (`src-<base36>-p<page>-<n>`). A line carrying several
   figures is treated as tabular data, not a heading, which keeps a results table whole as one
   evidence unit.
3. **Analyse.** One call produces the **fact ledger**: topic, claims with figures, units, dates and
   caveats, named entities, actions explicitly present in the source, and information the source does
   *not* contain. Evidence IDs that do not match a real segment are removed, and the removal is
   reported in the ledger's warnings rather than hidden.
4. **Generate.** One request per selected format, at most two concurrently. Each receives the same
   source, the same ledger and the same brief, plus format-specific instructions. A presentation is
   designed as slides; it is not a summary cut into bullets.
5. **Validate.** Structural checks run server-side (below).
6. **Review and edit.** Edits are stored separately from generated content. Regeneration warns before
   replacing an edit.
7. **Export.** Pure renderers, no model call. An export therefore cannot fail because of the provider,
   and always renders the operator's current version.

### Deterministic layout

The model chooses **which** layout suits each slide and each infographic; the application decides
what that layout looks like and draws it. `lib/export/slideLayout.ts` and
`lib/export/infographicLayout.ts` hold that decision, shared by the exporter, the browser preview
and the validator, so none of the three can disagree about what is on the page.

A requested layout the content cannot support is refused rather than drawn empty: a chart with one
value, a donut of negative values, a headline figure with no figure. Each falls back to a layout
the content does support, ending at the qualitative one, which needs nothing but words.

Charts are native PowerPoint chart parts and hand-drawn SVG, built from values the model supplies
as data. Those values are checked against the source exactly like prose figures — an invented
number is caught whether it was written in a sentence or plotted on an axis.

### Evidence handling

Every factual element carries an `evidence` array of segment IDs. The system message lists the valid
IDs for the current source and forbids inventing them. On return, IDs are checked against the real
segment set:

- Valid IDs become clickable references that open the **stored source text** — not a re-summary.
- Invalid IDs are reported as an error-severity finding and excluded from the evidence panel.
- In creative mode there is no source, so citations are forbidden outright and any that appear are
  discarded with a warning.

Evidence links show *where content came from*. They are a review aid. They do not establish that the
content interprets the source correctly, and the interface says so.

### Validation

| Check | Severity | Note |
| --- | --- | --- |
| Evidence ID does not resolve | error | Excluded from the panel |
| Grounded artefact cites nothing | warning | |
| Figure absent from the source | warning | Normalised so `18%` matches `18.0%`; structural numbers such as scene durations and slide indices are excluded |
| Text likely to overflow the export layout | warning | Thresholds match the real renderer |
| X post over the character limit | warning | Counts labelled approximate |
| Infographic with no statistics | info | Expected — a qualitative layout is used rather than invented figures |
| Video package | info | Timings labelled estimates |

Malformed model output triggers **one** repair attempt with the validation errors fed back. A second
failure marks that format failed and retryable; other formats are untouched.

Transport failures are handled separately from schema failures. Free-tier capacity fluctuates, so a
`503 high demand` response rotates to the next model in the fallback chain rather than simply
waiting; permanent failures (rejected key, retired model name) fail immediately instead of retrying.
The result reports which model actually answered, and the header badge shows it.

### Security and data handling

- The API key is read only inside `lib/provider.ts`, which is `server-only`. It never reaches the
  browser and is never placed in browser storage.
- Source text is fenced as data and the model is instructed to ignore directives within it. This
  boundary is covered by tests using deliberately hostile source text.
- No model-generated HTML or SVG is rendered. The infographic preview is our own renderer's output,
  with every text value XML-escaped.
- Source content is sent to Google's Gemini API. The README states this plainly; no claim of
  local-only processing is made.

### Limitations

No OCR. No rendered video or audio. No factual verification. No persistence, accounts or
collaboration. Multilingual output is generated but not quality-assured. Input is bounded rather than
chunked; oversized documents are rejected with an explanation instead of partially processed.

### Deployment

`npm run build` produces a standard Next.js server application (Node runtime required for PDF and
PPTX generation; these routes are not edge-compatible). A `Dockerfile` is included, and the app
deploys as-is to any Node host with `GEMINI_API_KEY` supplied as a server-side environment variable.
`samples/` is read at runtime by `/api/sample` and is declared in `outputFileTracingIncludes` so it
survives traced deployments. Generation latency is provider-bound; concurrency is capped at two
in-flight requests to respect free-tier rate limits.

One field note worth recording: endpoint-security software on Windows was observed silently
returning `204 No Content` for **binary** GET responses from localhost, which broke loading the
sample PDF over HTTP with no visible cause. `/api/sample` therefore reads and extracts the file
server-side and returns JSON, so no binary crosses to the browser. POST responses — including every
export — were unaffected.

### Roadmap

OCR and DOCX ingestion · section-level regeneration with locked sections · source-change impact
tracking (detect changed facts, mark affected sections stale, regenerate only those) · tested
Indian-language support with glossaries and numeric fidelity · durable projects with version history
and reviewer approval · template-based rendered video with captions aligned to real audio.
