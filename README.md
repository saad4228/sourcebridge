# SourceBridge

**One source. Multiple formats. Traceable facts.**

SourceBridge turns a single source document into a coordinated communication package. It reads the
source once, builds a shared ledger of its facts, figures and caveats, then writes every output
format from that same foundation — so the numbers and the qualifications stay consistent across all
of them, and every claim links back to the passage it came from.

Built for **SIH 2026, problem statement 26154** (Theme: Blockchain & Cybersecurity) by **Team BYTE ME**.

---

## Quick start

```bash
git clone https://github.com/saad4228/sourcebridge.git
cd sourcebridge
npm install
cp .env.example .env.local     # then add at least one API key — see below
npm run dev
```

Open <http://localhost:3000> and press **Try the sample incident report**. No upload needed — a
bundled synthetic report is included.

### You need at least one key

Both free tiers are enough. No billing setup required.

| Key | Get it | What it powers |
| --- | --- | --- |
| `GROQ_API_KEY` | [console.groq.com/keys](https://console.groq.com/keys) | Text generation — tried first, answers in about a second |
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Reading images and video, plus video narration |

Put them in `.env.local`:

```
GROQ_API_KEY=your-key-here
GEMINI_API_KEY=your-key-here
```

- **Both keys** → fastest, all features.
- **Gemini only** → everything works, more slowly.
- **Groq only** → all seven formats generate, but image and video sources are refused.

`.env.local` is gitignored. **Keys are read only on the server** and never reach the browser.

> **Data handling:** source content you provide is sent to Groq and/or Google for processing. This
> is not local-only processing. Do not upload material you are not permitted to share with a
> third-party service.

### Optional: ffmpeg, for rendered video

Only the `.mp4` export needs it. Everything else works without it, and the app says so rather than
failing silently.

```bash
winget install Gyan.FFmpeg        # Windows
brew install ffmpeg               # macOS
sudo apt install ffmpeg           # Debian/Ubuntu
```

If ffmpeg lives somewhere unusual, set `FFMPEG_PATH` to the binary.

**Requires Node.js 20+.** Developed on Node 24.18.0 / npm 11.16.0.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on :3000 |
| `npm run build` / `npm start` | Production build and serve |
| `npm test` | **247 tests**, no API key required |
| `npm run test:watch` | Tests in watch mode |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run smoke <outDir> <file.pdf>` | Live end-to-end check against a running server (uses your key) |
| `node scripts/architecture-pdf.mjs` | Render `docs/ARCHITECTURE.md` to PDF and check the page limit |

---

## The seven formats

Executive summary · LinkedIn post · X post or thread · Advisory · Presentation · Infographic ·
Video production package.

Each has a real generator, its own output schema, and a preview shaped like the thing it becomes.
None is a placeholder.

## What makes it more than a wrapper

**One analysis, seven consumers.** Extraction and fact analysis run *once*. Every format reads the
same ledger, so the figures and caveats cannot drift between them. Asking a chatbot seven times
produces seven independent answers; this removes the independence.

**The model never draws a figure.** It returns structured JSON against a Zod schema. Slides, SVG and
every video frame are drawn by application code, so a model cannot render `486 Gbps` wrongly — it is
never asked to render anything. Exports make no model call at all.

**Qualifiers are checked, not assumed.** A numeric check catches a figure that changed. It is blind
to a figure that stayed while the certainty around it did not. Meaning-drift detection reports a
dropped *"preliminary"* as a warning and an escalated *"some"* → *"all"* as an error.

Full detail in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** (two pages).

---

## Sample workflow

1. Press **Try the sample incident report** — a synthetic preliminary cyber-incident assessment from
   [`samples/`](samples/), rebuildable with `node scripts/build-sample-report.mjs`. Its hedged
   wording is deliberate: it is what meaning-drift detection is demonstrated against.
2. Review the extracted pages. Each passage shows its stable ID.
3. The **shared fact ledger** builds automatically: claims, figures with units, dates and caveats.
4. Choose an audience, objective, tone, language and detail level. These are instructions, not
   labels — two outputs from the same source under different settings read differently.
5. Select formats and **Generate**. Each runs independently, so one failure does not lose the rest.
6. Click any evidence chip to read the source passage behind a claim.
7. Edit anything inline, then download. Exports always use your edited version.

---

## Models and quota

Text generation walks one chain across two providers: the Groq models first, then the Gemini ones.
Groq leads because it answers in about a second where the Gemini free tier took tens of seconds, and
because its allowance is entirely separate — a spent Gemini quota no longer stops the application.
Reading images and video, and speaking narration, stay on Gemini, which is the only one of the two
that does either.

Any OpenAI-compatible endpoint can replace Groq — OpenRouter, Cerebras and GitHub Models all speak
the same shape. Point `GROQ_BASE_URL` and `GROQ_MODELS` at one; no code changes.

### Why these models

The chain order is measured, not assumed. Every candidate was run against the real advisory schema
with a hedged source and scored on the three things that matter here: does it satisfy the schema,
does it carry every figure through unchanged, and does it keep the source's qualifiers.

| Model | Latency | Figures kept | Qualifiers kept |
| --- | --- | --- | --- |
| `openai/gpt-oss-120b` | 1.8s | 4/4 | 7/7 |
| `openai/gpt-oss-20b` | 0.6s | 4/4 | 7/7 |
| `gemini-flash-lite-latest` | 1.9s | 4/4 | 7/7 |
| `gemini-3.8-flash` | 7.1s | 4/4 | 7/7 |
| `gemini-3.5-flash` | 17.4s | 4/4 | 7/7 |
| `qwen/qwen3.8-27b` | 1.4s | **2/4** | 5/7 |
| `gemma-4-26b-a4b-it` | **180s** | — | — (invalid JSON) |

Two results changed the defaults. Qwen reproduced only half the source figures in two of three runs,
so it is out of the chain: losing a figure is the one failure this project exists to prevent. Gemma
took three minutes and returned unparseable content, so it moved to last — it stays only because it
draws on a separate allowance and keeps the app alive once the Gemini quotas are spent.

Gemini **Pro** is not available on a free key; both Pro endpoints answer with a billing error. On
this task every flash model scored identically anyway — the work is transformation under a schema,
not reasoning, so a larger model buys nothing.

### When capacity runs out

Free-tier capacity fluctuates, so four rules apply:

- **Every call runs under a deadline** (`GEMINI_TIMEOUT_MS`, 45s). One model was measured taking 261
  seconds to answer a trivial prompt; a hang stalls everything behind it.
- **A refusing model enters a process-wide cooldown**, rather than being rediscovered by each of the
  seven formats in turn.
- **A short, stated rate limit is waited out.** When the fast provider says "try again in 8 seconds",
  doing so beats falling through to one that takes minutes.
- **A request too large for a model rotates immediately.** If a model's whole per-minute allowance is
  smaller than the request, retrying can never succeed.

Gemini meters **per model, per day**; Groq meters **tokens per minute** and clears in seconds. Using
both is why one exhausted provider does not stop the application.

---

## Testing

```bash
npm test          # 247 tests, no API key required
```

Covering extraction, schema validation, evidence resolution, meaning drift, the provenance chain,
prompt-injection boundaries, SSRF screening and every renderer.

Exports are checked further by inspecting the produced OOXML and SVG, and by probing rendered video
for valid H.264/AAC streams.

```bash
npm run dev                                        # in one terminal
npm run smoke ./out samples/cyber-incident-report.pdf   # in another
```

The smoke test runs the real pipeline end to end and reports per-format timings, figure fidelity
across formats, evidence validity and every validation finding.

### Still needs a person

Translation quality for non-English output, whether a generated recommendation is *appropriate*, and
whether the source itself is trustworthy. The application does not claim any of these.

---

## Deployment

A single Next.js container. Supply the keys as server-side environment variables — never bake them
into an image.

```bash
docker build -t sourcebridge .
docker run -e GROQ_API_KEY=... -e GEMINI_API_KEY=... -p 3000:3000 sourcebridge
```

On a serverless host everything works except the rendered `.mp4`, which needs ffmpeg on the host. The
application detects its absence and offers the video package instead.

---

## Honest scope

Stated because the interface is not permitted to imply otherwise:

- **No fact verification.** Validation is structural: evidence IDs resolve, figures appear in the
  source, qualifiers survive, content fits its layout. It does **not** check whether content is true.
- **The provenance record is a hash chain, not a blockchain.** It establishes integrity and ordering
  over the source, ledger and artefacts. It does not prove the source document was authentic, and
  nothing is anchored to an external ledger.
- **Meaning-drift detection is lexical, not semantic.** It compares qualifiers in a cited passage
  against the output citing it. It does not understand the claim.
- **No OCR.** Scanned PDFs are refused with a clear message. Images *are* supported, read by a vision
  model — a transcription, not a literal extraction — and labelled as such.
- **No generative imagery or video.** Frames are drawn by application code, deliberately: a
  generative model cannot be trusted to render a figure, and in a video the viewer cannot check it.
- **No persistence, accounts or approval workflow.** Work lives in the browser tab and is lost on
  refresh. The app warns before you leave.
- **Multilingual output is generated but not quality-checked.** Exporters declare fonts covering
  Devanagari, Bengali, Tamil and Telugu; rendering still depends on the viewing machine having one.
- **No confidence scores or usage metrics** — any number shown would be invented.

---

## Project layout

```
app/api/        extract · analyze · generate · export · sample · health
lib/            provider · prompts · schemas · validate · meaningDrift · audit
lib/export/     pptx · svg · video · bundle · deckTheme   (deterministic renderers)
components/     Landing · Workspace · SourcePanel · ConfigPanel · OutputPanel
samples/        synthetic source documents
scripts/        smoke test, renderers, PDF builder
tests/          247 tests
docs/           ARCHITECTURE.md (2 pages) + PDF
```

Sample documents in `samples/` are synthetic and were generated for this project. The incident, the
organisations and every figure they describe are fictional.

## Third-party licences

Next.js, React (MIT) · Tailwind CSS (MIT) · Zod (MIT) · unpdf (MIT) · PptxGenJS (MIT) ·
@resvg/resvg-js (MPL-2.0) · JSZip (MIT/GPLv3) · @mozilla/readability (Apache-2.0) ·
@google/genai (Apache-2.0) · linkedom (ISC) · playwright-core (Apache-2.0, dev only).
