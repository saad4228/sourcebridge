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
RUN apk add --no-cache ffmpeg

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
