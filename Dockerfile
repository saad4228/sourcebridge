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

RUN addgroup -S app && adduser -S app -G app

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
# Read at runtime by /api/sample.
COPY --from=builder /app/samples ./samples

USER app
EXPOSE 3000

# GEMINI_API_KEY must be supplied at run time, never baked into the image:
#   docker run -e GEMINI_API_KEY=... -p 3000:3000 sourcebridge
CMD ["npm", "run", "start"]
