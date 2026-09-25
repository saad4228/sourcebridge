/**
 * Request-body schemas for the API routes.
 *
 * The prototype holds working state in the browser, so the client sends the
 * source, ledger and brief with each request. They are validated on arrival:
 * the server trusts nothing it is handed.
 */

import { z } from 'zod';
import { DECK_THEME_NAMES } from './export/deckTheme';
import { FORMAT_IDS } from './types';

export const sourceWireSchema = z.object({
  id: z.string(),
  kind: z.enum(['text', 'pdf', 'image', 'video', 'url', 'prompt']),
  title: z.string(),
  text: z.string(),
  pageCount: z.number().nullable(),
  segments: z.array(
    z.object({
      id: z.string(),
      sourceId: z.string(),
      page: z.number().nullable(),
      text: z.string(),
      heading: z.string().optional(),
    }),
  ),
  warnings: z.array(z.string()),
  charCount: z.number(),
  extractedAt: z.string(),
});

export const ledgerWireSchema = z.object({
  topic: z.string(),
  facts: z.array(
    z.object({
      id: z.string(),
      claim: z.string(),
      evidence: z.array(z.string()),
      numbers: z.array(
        z.object({
          value: z.string(),
          unit: z.string().optional(),
          context: z.string(),
        }),
      ),
      dates: z.array(z.string()),
      caveats: z.array(z.string()),
    }),
  ),
  entities: z.array(z.string()),
  sourceActions: z.array(z.string()),
  missingInformation: z.array(z.string()),
  caveats: z.array(z.string()),
  warnings: z.array(z.string()),
});

export const briefWireSchema = z.object({
  mode: z.enum(['grounded', 'creative']),
  audience: z.string(),
  objective: z.string(),
  tone: z.string(),
  language: z.string(),
  detail: z.string(),
  formats: z.array(z.enum(FORMAT_IDS)),
  deckTheme: z.enum(DECK_THEME_NAMES).optional(),
  requiredMessages: z.string().optional(),
  callToAction: z.string().optional(),
  preserveTerms: z.string().optional(),
  avoidClaims: z.string().optional(),
});
