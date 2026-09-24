/**
 * Slide layout resolution, shared by the PPTX renderer and the browser preview.
 *
 * Kept free of any rendering library so the preview can import it without
 * pulling PptxGenJS into the client bundle. Both sides must call this, or the
 * preview and the downloaded deck could disagree about how a slide looks.
 */

import type { Presentation } from '../schemas';

export type Slide = Presentation['slides'][number];

export type SlideLayout = 'bullets' | 'statement' | 'stat' | 'comparison' | 'chart' | 'section';

/**
 * Decide the layout actually drawn.
 *
 * The model's choice is a request, not an instruction: if it asks for a chart
 * without a usable series, or a stat without a figure, fall back rather than
 * render an empty region.
 */
export function resolveLayout(slide: Slide): SlideLayout {
  const requested = slide.layout ?? 'bullets';
  const hasBullets = (slide.bullets?.length ?? 0) > 0;

  if (requested === 'chart') {
    const chart = slide.chart;
    const usable =
      chart !== undefined &&
      chart.kind !== 'none' &&
      chart.values.length >= 2 &&
      chart.categories.length === chart.values.length;
    return usable ? 'chart' : hasBullets ? 'bullets' : 'statement';
  }

  if (requested === 'stat') {
    return slide.keyStat?.value?.trim() ? 'stat' : hasBullets ? 'bullets' : 'statement';
  }

  if (requested === 'comparison') {
    const c = slide.comparison;
    const usable = c !== undefined && c.leftPoints.length > 0 && c.rightPoints.length > 0;
    return usable ? 'comparison' : hasBullets ? 'bullets' : 'statement';
  }

  if (requested === 'bullets' && !hasBullets) return 'statement';
  return requested;
}
