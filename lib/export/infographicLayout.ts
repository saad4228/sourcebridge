/**
 * Infographic layout resolution, shared by the renderer and the validator.
 *
 * Kept free of rendering code so both sides agree on which block is actually
 * drawn — otherwise validation would report defects in a region no one sees.
 */

import type { Infographic } from '../schemas';

export type InfographicLayout = 'stats' | 'chart' | 'comparison' | 'qualitative';

/**
 * Decide the layout actually drawn.
 *
 * The model's choice is a request: a chart without a usable series, or a stats
 * layout with no figures, falls back rather than leaving an empty centrepiece.
 * The qualitative layout is the honest floor — it needs nothing but words.
 */
export function resolveInfographicLayout(content: Infographic): InfographicLayout {
  const requested = content.layout ?? 'stats';
  const hasStats = (content.statistics?.length ?? 0) > 0;

  if (requested === 'chart') {
    const chart = content.chart;
    const usable =
      chart !== undefined &&
      chart.kind !== 'none' &&
      chart.values.length >= 2 &&
      chart.categories.length === chart.values.length &&
      // A donut of negatives cannot be drawn as shares of a whole.
      (chart.kind !== 'donut' || chart.values.every((v) => v >= 0));
    if (usable) return 'chart';
    return hasStats ? 'stats' : 'qualitative';
  }

  if (requested === 'comparison') {
    const c = content.comparison;
    const usable =
      c !== undefined &&
      (c.leftValue.trim().length > 0 || c.leftPoints.length > 0) &&
      (c.rightValue.trim().length > 0 || c.rightPoints.length > 0);
    if (usable) return 'comparison';
    return hasStats ? 'stats' : 'qualitative';
  }

  if (requested === 'stats') return hasStats ? 'stats' : 'qualitative';
  return 'qualitative';
}
