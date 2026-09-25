/**
 * Meaning-drift detection.
 *
 * The numeric check catches a figure that changed. This catches something the
 * numeric check cannot see: a figure that stayed the same while the certainty
 * around it did not. "Preliminary analysis indicates approximately 68%" and
 * "68% were restored" carry the same number and a different claim, and the
 * second one is the kind of sentence that gets someone in trouble.
 *
 * Two checks, deliberately different in confidence:
 *
 * - Escalation: the cited passage hedges ("some", "may") and the output states
 *   the strong form ("all", "will"). This is reported as an error, because the
 *   pairing is specific and a false positive is unlikely.
 * - Dropped qualifier: the cited passage carries a qualifier family that the
 *   output does not. Reported as a warning, because a shorter format may
 *   legitimately paraphrase rather than drop. The reviewer is shown the source
 *   wording and decides.
 *
 * Everything here is deterministic string work. No model is asked whether the
 * meaning changed, because a model's opinion on that could not be checked.
 */

import type { Source, ValidationFinding } from './types';

/**
 * Qualifier families, matched by family rather than by exact word.
 *
 * A faithful rewrite may turn "preliminary" into "initial" or "approximately"
 * into "around". That is not drift, so only losing the whole family counts.
 */
const HEDGE_FAMILIES: { name: string; label: string; terms: string[] }[] = [
  {
    name: 'provisional',
    label: 'provisional finding',
    terms: ['preliminary', 'provisional', 'initial', 'interim', 'early', 'draft', 'to date'],
  },
  {
    name: 'approximate',
    label: 'approximate figure',
    terms: ['approximately', 'approximate', 'about', 'around', 'roughly', 'estimated', 'estimate', 'circa', 'nearly', 'almost', 'in excess of', 'at least'],
  },
  {
    name: 'possible',
    label: 'possibility, not certainty',
    terms: ['may', 'might', 'could', 'possibly', 'potentially', 'appears', 'suggests', 'indicates', 'assessed as', 'believed', 'likely', 'apparent'],
  },
  {
    name: 'partial',
    label: 'partial scope',
    terms: ['some', 'several', 'a number of', 'certain', 'partly', 'partially', 'in part', 'a portion'],
  },
  {
    name: 'unverified',
    label: 'not independently verified',
    terms: ['unconfirmed', 'unverified', 'not been independently', 'not independently', 'alleged', 'self-reporting', 'self-reported', 'has not been audited', 'not been audited', 'reportedly'],
  },
];

/**
 * Weak-to-strong pairs. Both sides must appear on the same cited claim for the
 * escalation to be reported, which is what keeps this check precise.
 */
const ESCALATIONS: { weak: string[]; strong: string[]; note: string }[] = [
  {
    weak: ['some', 'several', 'a number of', 'certain', 'part of', 'partly', 'partially'],
    strong: ['all', 'every', 'entire', 'all of', 'each', 'universally', 'across the board'],
    note: 'partial scope stated as total',
  },
  {
    weak: ['may', 'might', 'could', 'possibly', 'potentially'],
    strong: ['will', 'must', 'certainly', 'definitely', 'is guaranteed'],
    note: 'possibility stated as certainty',
  },
  {
    weak: ['preliminary', 'provisional', 'initial', 'interim'],
    strong: ['final', 'confirmed', 'conclusive', 'definitive', 'established'],
    note: 'provisional finding stated as settled',
  },
  {
    weak: ['unconfirmed', 'unverified', 'alleged', 'suspected'],
    strong: ['confirmed', 'verified', 'proven', 'established', 'attributed to'],
    note: 'unverified claim stated as confirmed',
  },
  {
    weak: ['approximately', 'about', 'around', 'roughly', 'estimated'],
    strong: ['exactly', 'precisely'],
    note: 'approximate figure stated as exact',
  },
];

/** Whole-word (or whole-phrase) match, so "may" does not match "maybe". */
function contains(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i').test(haystack);
}

/** A block of output text together with the source passages it cites. */
export interface CitedClaim {
  text: string;
  evidence: string[];
  path: string;
}

/**
 * Walk the artefact for objects that carry both text and an evidence array.
 *
 * That pairing is what makes the comparison possible: it identifies which
 * output wording is claiming to rest on which source passage.
 */
export function collectCitedClaims(node: unknown, path: string[] = []): CitedClaim[] {
  if (Array.isArray(node)) {
    return node.flatMap((item, i) => collectCitedClaims(item, [...path, String(i)]));
  }
  if (!node || typeof node !== 'object') return [];

  const record = node as Record<string, unknown>;
  const out: CitedClaim[] = [];

  const evidence = Array.isArray(record.evidence)
    ? record.evidence.filter((e): e is string => typeof e === 'string')
    : [];

  if (evidence.length > 0) {
    // Only this object's own strings: a nested cited block states its own
    // claim and is collected separately, on its own evidence.
    const text = Object.entries(record)
      .filter(([key, value]) => typeof value === 'string' && key !== 'evidence')
      .map(([, value]) => value as string)
      .join(' ')
      .trim();
    if (text) out.push({ text, evidence, path: path.join('.') || '(root)' });
  }

  for (const [key, value] of Object.entries(record)) {
    if (key === 'evidence') continue;
    if (value && typeof value === 'object') out.push(...collectCitedClaims(value, [...path, key]));
  }
  return out;
}

export interface DriftOptions {
  content: unknown;
  source: Source;
  /** Cap on reported findings, so one bad run cannot flood the panel. */
  limit?: number;
}

/**
 * Compare each cited claim against the passage it cites.
 *
 * Returns review signals, never a verdict: a finding means the qualifier in
 * the source is not visible in the output, not that the output is wrong.
 */
export function detectMeaningDrift(options: DriftOptions): ValidationFinding[] {
  const { content, source, limit = 4 } = options;
  const byId = new Map(source.segments.map((s) => [s.id, s.text]));
  const findings: ValidationFinding[] = [];

  const escalations: ValidationFinding[] = [];
  const drops: ValidationFinding[] = [];
  const seenDrop = new Set<string>();

  for (const claim of collectCitedClaims(content)) {
    const cited = claim.evidence
      .map((id) => byId.get(id))
      .filter((t): t is string => typeof t === 'string')
      .join(' ');
    if (!cited) continue;

    const output = claim.text;

    // --- Escalation: weak in the source, strong in the output --------------
    for (const rule of ESCALATIONS) {
      const weak = rule.weak.find((t) => contains(cited, t));
      const strong = rule.strong.find((t) => contains(output, t));
      // The output must not still carry the weak form: "some may be final"
      // keeps its hedge and is not an escalation.
      if (weak && strong && !rule.weak.some((t) => contains(output, t))) {
        escalations.push({
          type: 'meaning_drift',
          severity: 'error',
          message:
            `Possible meaning drift (${rule.note}): the cited passage says "${weak}" but this ` +
            `artefact says "${strong}". Check the claim still matches the source.`,
          field: claim.path,
          refs: claim.evidence,
        });
      }
    }

    // --- Dropped qualifier -------------------------------------------------
    for (const family of HEDGE_FAMILIES) {
      const inSource = family.terms.find((t) => contains(cited, t));
      if (!inSource) continue;
      if (family.terms.some((t) => contains(output, t))) continue;
      if (seenDrop.has(family.name)) continue;
      seenDrop.add(family.name);

      drops.push({
        type: 'qualifier_dropped',
        severity: 'warning',
        message:
          `The cited passage qualifies this as ${family.label} ("${inSource}"), and that ` +
          `qualifier does not appear in this artefact. Confirm it still applies before publishing.`,
        field: claim.path,
        refs: claim.evidence,
      });
    }
  }

  // Escalations first: they are the specific, high-confidence finding.
  findings.push(...escalations.slice(0, limit));
  findings.push(...drops.slice(0, limit));
  return findings;
}
