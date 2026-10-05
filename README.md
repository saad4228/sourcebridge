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

Open <http://localhost:3000>, then press **Try the sample incident report**. No upload needed — a
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
- **Groq only** → all seven formats generate, but image and video *sources* are refused. Video
  *rendering* still works: narration falls back to a local engine that needs no key.

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

**A font is required too.** Frames are drawn by resvg, which renders text only with a font it can
find — and when it cannot find one it does not warn or substitute, it draws no glyphs, giving blank
slides with narration over them. Desktop machines have fonts already; a minimal container does not,
which is why the Docker image installs the Noto families. The renderer refuses with an explanation
rather than producing a silent blank video.

### Narration has no daily limit

Speech used to be the one hard ceiling here. The provider meters it **per project, per model, per
day** — the refusal names the quota as `GenerateRequestsPerDayPerProjectPerModel-FreeTier` — and
every scene costs one request, so a single six-scene video could spend the whole free allowance.
Adding keys from the same Google project does not help, because the count is against the project.
A public demo had roughly one video a day in it, however many people visited.

So narration is not tied to one provider. Any engine that turns a line into audio can serve it, and
the local ones have no quota at all:

| Engine | Quota | Quality | Needs |
| --- | --- | --- | --- |
| Gemini | per project, per model, per day | best | `GEMINI_API_KEY` |
| Piper | none | close to Gemini | a voice model (`PIPER_VOICE`) |
| eSpeak NG + MBROLA | none | diphone, noticeably more natural | `mbrola-en1` — in the Docker image |
| eSpeak NG alone | none | synthetic but clear | `espeak-ng` — in the Docker image |

**To get more of the good voice, add more keys.** The allowance is per *project*, so a second key
on the same Google project buys nothing while a key from another account is a separate allowance
entirely. `GEMINI_API_KEYS` takes a comma-separated list and the chain walks every combination of
key and model before falling back — six teammates with one free key each is six times the narration.

The default is `auto`: the cloud voice while it lasts, then a local one. **Running out changes the
voice rather than ending the render**, which is the same rule the text chain already follows. Set
`VIDEO_TTS_ENGINE=local` to skip the cloud entirely — no quota, and faster, since nothing waits on a
network. Each render reports which engine spoke it.

A public URL has no accounts, so one visitor can also be limited to
`VIDEO_RENDERS_PER_HOUR` renders (3 by default; `0` turns it off, which is reasonable once speech is
local and the only cost is CPU).

Speaking the scenes is essentially the whole render: on six scenes, 33s to speak them against under
2s to draw every frame and under 1s to encode. Scenes are therefore spoken four at a time
(`VIDEO_TTS_CONCURRENCY`) and the frames are drawn while the provider is still talking, which
measured 37.7s → 20.1s on a four-scene package. The floor is one speech call, so a longer package
costs little more than a short one.

The interface reports which scene it is on. Narration already spoken is reused, so retrying a render
that failed part-way costs no further speech quota. Afterwards the subtitles are offered as a
separate `.srt` — unlike the ones in the video package, their timings are measured against the audio
that was actually produced.

**Requires Node.js 20+.** Developed on Node 24.18.0 / npm 11.16.0.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on :3000 |
| `npm run build` / `npm start` | Production build and serve |
| `npm test` | **379 tests**, no API key required |
| `npm run test:watch` | Tests in watch mode |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run smoke <outDir> <file.pdf>` | Live end-to-end check against a running server (uses your key) |
| `node scripts/md-to-pdf.mjs <in.md> [out.pdf]` | Render a doc to A4 PDF; add `--max-pages=N` to enforce a limit |

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
npm test          # 379 tests, no API key required
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

A single Next.js container. The image installs **ffmpeg**, which is the reason to deploy it as a
container rather than serverless: without ffmpeg the MP4 export is unavailable, and the application
says so and offers the video package instead.

```bash
docker build -t sourcebridge .
docker run -e GROQ_API_KEY=... -e GEMINI_API_KEY=... -p 3000:3000 sourcebridge
```

**Keys are supplied at run time and never baked into the image.** `.dockerignore` excludes `.env*`
so a local key file cannot be copied into a layer. On a host, set them as environment variables in
the dashboard — not in a committed file.

The image renders video frames at 1280 rather than full HD, because memory is what limits a render
in a container: measured on a 512 MB instance, three scenes at 1920 succeeded and four crashed,
while a typical package is five to seven. Set `VIDEO_RENDER_WIDTH=1920` where the instance has room
— the frames are drawn in a 1920×1080 space either way, so this changes resolution and nothing
about the design.

### Choosing a host

| Host | MP4 export | Notes |
| --- | --- | --- |
| **Render**, **Railway**, **Fly.io** | ✅ | Deploy from the Dockerfile; free tiers sleep when idle |
| **A VPS** | ✅ | Full control; you manage TLS and restarts |
| **Vercel** | ❌ | Everything else works; no ffmpeg on the platform |

Set `PORT` if the host requires a specific one — the image reads it, and binds `0.0.0.0` already.

### Setting it up for a crowd

A demo where several people use the site at once fails differently from one person using it a lot.
Four settings decide whether it holds up, and all four are free:

| Set this | Why |
| --- | --- |
| `GROQ_API_KEY` | **The one that matters most.** Groq meters per *minute* and resets constantly; Gemini meters per *day*. Ten people generating all seven formats is ~80 calls — comfortable on Groq, fatal on Gemini alone. The chain tries Groq first, but only if the key is on the server. |
| `GEMINI_API_KEYS` | Extra keys from other Google accounts. The only way to get more of the good voice: the allowance is per project, so a teammate's key is a separate one. |
| `VIDEO_RENDERS_PER_HOUR` | Per visitor, so one person cannot take everyone's capacity. Raise or disable it once speech is local. |
| `VIDEO_RENDER_CONCURRENCY` | How many render *at once*. Several together exhaust a small instance and the platform kills the container, which fails every request in flight. |

**Free tiers sleep after about fifteen minutes idle**, and the next visitor then waits 30–60s for a
cold start — which is indistinguishable from a broken site, and is what the first person opening
your link would see. [`.github/workflows/keep-warm.yml`](.github/workflows/keep-warm.yml) pings the
site every ten minutes to prevent it; set the repository variable `SITE_URL` to switch it on. It
deliberately calls `/api/health` and not `?deep=1`, because the deep check costs a model call.

> **A public URL exposes your quota.** There are no accounts, so anyone with the link can generate
> and spend your free-tier allowance. Rendering is limited per visitor and overall; text generation
> is not. For a demo, keep the URL unlisted rather than indexed.

---

## Honest scope

Stated because the interface is not permitted to imply otherwise:

- **No fact verification.** Validation is structural: evidence IDs resolve, figures appear in the
  source, qualifiers survive, content fits its layout. It does **not** check whether content is true.
- **The provenance record is a hash chain, not a blockchain.** It establishes integrity and ordering
  over the source, ledger and artefacts. It does not prove the source document was authentic, and
  nothing is anchored to an external ledger. Every archive ships `verify.mjs`, so a recipient can
  check the chain with `node verify.mjs` and no installation — a claim nobody can check is not
  evidence of anything.
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
tests/          379 tests
docs/           ARCHITECTURE.md (2 pages) + PDF
```

Sample documents in `samples/` are synthetic and were generated for this project. The incident, the
organisations and every figure they describe are fictional.

## Third-party licences

Next.js, React (MIT) · Tailwind CSS (MIT) · Zod (MIT) · unpdf (MIT) · PptxGenJS (MIT) ·
@resvg/resvg-js (MPL-2.0) · JSZip (MIT/GPLv3) · @mozilla/readability (Apache-2.0) ·
@google/genai (Apache-2.0) · linkedom (ISC) · playwright-core (Apache-2.0, dev only).
