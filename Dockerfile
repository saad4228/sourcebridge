# SourceBridge — production image.
#
# The Node runtime is required: PDF extraction (unpdf) and PPTX generation
# (pptxgenjs) are not edge-compatible.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No API key is needed to build; it is read at request time.
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Bind on every interface: a platform routes to the container, not to loopback.
ENV HOSTNAME=0.0.0.0

# ffmpeg is what makes this image worth building rather than deploying
# serverless. Without it the MP4 export is unavailable -- the application
# detects that and offers the video package instead, but the feature is gone.
#
# The fonts are not optional either, and their absence was far more damaging
# than a missing ffmpeg: this base image ships NO fonts at all, and resvg draws
# text only with a font it can find. With none, it does not warn or substitute
# -- it draws no glyphs. Renders completed, played correctly, and showed
# narration over blank slides, because the one thing that reports nothing is a
# video that looks fine to the encoder.
#
# font-noto covers Latin; the Devanagari, Bengali, Tamil and Telugu packages
# cover the scripts the exporters claim to support, which were equally blank.
RUN apk add --no-cache \
      ffmpeg \
      font-noto \
      font-noto-devanagari \
      font-noto-bengali \
      font-noto-tamil \
      font-noto-telugu \
      fontconfig \
 && fc-cache -f \
 # Fail the build rather than ship an image that renders blank slides again.
 && fc-list | grep -qi noto

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

RUN addgroup -S app && adduser -S app -G app

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
# Either key alone works: Groq covers text, Gemini adds vision and narration.
CMD ["npm", "run", "start"]
