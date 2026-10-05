# SourceBridge — production image.
#
# The Node runtime is required: PDF extraction (unpdf) and PPTX generation
# (pptxgenjs) are not edge-compatible.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No API key is needed to build; it is read at request time.
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Bind on every interface: a platform routes to the container, not to loopback.
ENV HOSTNAME=0.0.0.0

# Debian rather than Alpine, for one reason: eSpeak NG. Narration used to come
# only from the cloud, which meters speech per project per model per DAY -- so
# a single six-scene video could spend the whole free allowance and the site
# had roughly one video a day in it however many people visited. A local engine
# removes that ceiling entirely, and the Debian packages for it are the ones
# that work without hunting for musl builds.
#
# ffmpeg is what makes this image worth building rather than deploying
# serverless, and it now does double duty: every speech engine's output is
# normalised through it to one PCM format.
#
# The fonts are not optional either, and their absence was the most damaging of
# the three: the previous base image shipped NO fonts at all, and resvg draws
# text only with a font it can find. With none, it does not warn or substitute
# -- it draws no glyphs. Renders completed, played correctly, and showed
# narration over blank slides, because the one thing that reports nothing is a
# video that looks fine to the encoder.
#
# fonts-noto-core covers Latin; the Indic package covers the Devanagari,
# Bengali, Tamil and Telugu the exporters claim to support, which were equally
# blank.
#
# The two checks at the end fail the build rather than ship an image that
# renders blank slides, or one that stops rendering the moment the daily
# cloud-speech allowance runs out.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg \
      espeak-ng \
      fonts-noto-core \
      fonts-indic \
      fontconfig \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f \
 && fc-list | grep -qi noto \
 && espeak-ng --version

# A better local voice, installed separately because it must never fail the
# build. eSpeak's own synthesis is formant-based and sounds like a machine from
# the nineties; MBROLA voices are diphone recordings of a real speaker driven
# by the same engine -- markedly more natural, the same negligible CPU cost,
# and free. The packages have moved between Debian components over the years,
# so a failure here is tolerated: the application tries the better voice, finds
# it missing, and uses the plain one for the rest of the process.
RUN apt-get update \
 && (apt-get install -y --no-install-recommends mbrola mbrola-en1 \
     || echo 'MBROLA unavailable; falling back to the plain eSpeak voice.') \
 && rm -rf /var/lib/apt/lists/*

# Render video frames at 1280 rather than 1920 by default.
#
# Memory, not time, is what limits a render in a container. Measured against a
# 512 MB instance: one, two and three scenes rasterised at 1920 succeeded in 78
# to 149 seconds, and four scenes died after 54 -- failing sooner than the
# longer runs that worked, which is a crash and not a timeout. A typical
# package is five to seven scenes, so the full-HD default was the one setting
# guaranteed to fail on a small host.
#
# The scene cards are authored in a 1920x1080 space and rasterised to whatever
# width is asked for, so this changes resolution and nothing about the design.
# Override it where the instance has room:
#
#   docker run -e VIDEO_RENDER_WIDTH=1920 ...
ENV VIDEO_RENDER_WIDTH=1280

RUN groupadd -r app && useradd -r -g app app

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
# Read at runtime by /api/sample.
COPY --from=builder /app/samples ./samples

USER app
EXPOSE 3000

# Keys are supplied at run time and never baked into the image. .dockerignore
# excludes .env* for exactly that reason, so a stray local file cannot be
# copied into a layer.
#
#   docker run -e GROQ_API_KEY=... -e GEMINI_API_KEY=... -p 3000:3000 sourcebridge
#
# Either key alone works: Groq covers text, Gemini adds vision and the better
# narration voice. Video still renders with NO key for speech at all, because
# eSpeak NG is installed above and has no quota -- set VIDEO_TTS_ENGINE=local
# to skip the cloud voice entirely, which is also faster.
#
# For a neural local voice instead, mount a Piper model and point at it:
#
#   docker run -v /voices:/voices -e PIPER_VOICE=/voices/en_GB-alba-medium.onnx ...
CMD ["npm", "run", "start"]
