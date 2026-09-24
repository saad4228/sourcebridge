'use client';

/**
 * Icons for the seven output formats.
 *
 * LinkedIn and X use their own wordmarks, because those outputs are destined
 * for those platforms and a generic glyph would be less informative. They are
 * drawn as paths rather than fetched, so the app makes no third-party request
 * and works offline. The remaining five have no platform, so they get purpose
 * drawn marks in the interface accent.
 *
 * The LinkedIn and X marks are trademarks of their respective owners and are
 * used here only to identify the destination of the generated content.
 */

import type { FormatId } from '@/lib/types';
import { cx } from './ui';

/**
 * Brand colours, used only when the icon is shown in colour.
 *
 * The five formats with no platform borrow the colour of the application their
 * export opens in, so the row reads as a set of real destinations rather than a
 * row of accent-coloured glyphs.
 */
const BRAND = {
  linkedin: '#0A66C2',
  x: '#000000',
  /** PowerPoint, which opens the .pptx export. */
  powerpoint: '#C43E1C',
  /** Word, the closest match for a written document. */
  word: '#185ABD',
  /** Acrobat red, the convention for a formal notice. */
  advisory: '#B30B00',
  /** Excel green, the convention for charts and figures. */
  chart: '#107C41',
  /** Media red, the convention for video. */
  video: '#FF0000',
} as const;

export function FormatIcon({
  format,
  className,
  brandColour = true,
}: {
  format: FormatId;
  className?: string;
  /** False renders every mark in the current text colour, for dense rows. */
  brandColour?: boolean;
}) {
  const common = cx('shrink-0', className);

  switch (format) {
    case 'linkedin':
      return (
        <svg viewBox="0 0 24 24" className={common} aria-hidden="true" role="img">
          <path
            fill={brandColour ? BRAND.linkedin : 'currentColor'}
            d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46zM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13M7.12 20.45H3.55V9h3.57zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.22.79 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.73V1.73C24 .77 23.2 0 22.22 0"
          />
        </svg>
      );

    case 'x_thread':
      return (
        <svg viewBox="0 0 24 24" className={common} aria-hidden="true" role="img">
          <path
            fill={brandColour ? BRAND.x : 'currentColor'}
            d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.24 6.93zm-1.29 19.5h2.04L6.49 3.24H4.3z"
          />
        </svg>
      );

    // --- Formats with no single platform -----------------------------------
    // Drawn in the style and colour of the application each export opens in, so
    // the set reads consistently beside the LinkedIn and X marks.

    case 'exec_summary': {
      // A document page, in Word blue: the export is a written brief.
      const fill = brandColour ? BRAND.word : 'currentColor';
      return (
        <svg viewBox="0 0 24 24" className={common} aria-hidden="true" role="img">
          <path fill={fill} d="M14 2H5.5A1.5 1.5 0 0 0 4 3.5v17A1.5 1.5 0 0 0 5.5 22h13a1.5 1.5 0 0 0 1.5-1.5V8z" opacity="0.28" />
          <path fill={fill} d="M14 2l6 6h-4.5A1.5 1.5 0 0 1 14 6.5z" />
          <path
            fill={fill}
            d="M7.6 11h1.3l.9 4.1.9-4.1h1.2l.9 4.1.9-4.1h1.3l-1.5 6.2h-1.3l-.9-3.9-.9 3.9H9.1z"
          />
        </svg>
      );
    }

    case 'advisory': {
      // A notice sheet with a warning mark, in the red used for advisories.
      const fill = brandColour ? BRAND.advisory : 'currentColor';
      return (
        <svg viewBox="0 0 24 24" className={common} aria-hidden="true" role="img">
          <path fill={fill} d="M14 2H5.5A1.5 1.5 0 0 0 4 3.5v17A1.5 1.5 0 0 0 5.5 22h13a1.5 1.5 0 0 0 1.5-1.5V8z" opacity="0.28" />
          <path fill={fill} d="M14 2l6 6h-4.5A1.5 1.5 0 0 1 14 6.5z" />
          <path
            fill={fill}
            d="M12 10.4a.95.95 0 0 1 .95.95v3.4a.95.95 0 1 1-1.9 0v-3.4a.95.95 0 0 1 .95-.95m0 6.1a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2"
          />
        </svg>
      );
    }

    case 'presentation': {
      // A slide on a stand, in PowerPoint orange-red.
      const fill = brandColour ? BRAND.powerpoint : 'currentColor';
      return (
        <svg viewBox="0 0 24 24" className={common} aria-hidden="true" role="img">
          <rect x="2" y="3" width="20" height="13" rx="1.5" fill={fill} opacity="0.28" />
          <path fill={fill} d="M11 16h2v2.6l3.5 2.6a1 1 0 0 1-1.2 1.6L12 20.4l-3.3 2.4a1 1 0 0 1-1.2-1.6L11 18.6z" />
          <path
            fill={fill}
            d="M8.6 5.8h3a2.7 2.7 0 0 1 0 5.4h-1.4v2.2H8.6zm1.6 1.5v2.4h1.3a1.2 1.2 0 0 0 0-2.4z"
          />
        </svg>
      );
    }

    case 'infographic': {
      // A chart sheet, in the green conventionally used for figures.
      const fill = brandColour ? BRAND.chart : 'currentColor';
      return (
        <svg viewBox="0 0 24 24" className={common} aria-hidden="true" role="img">
          <rect x="2.5" y="2.5" width="19" height="19" rx="2" fill={fill} opacity="0.24" />
          <path
            fill={fill}
            d="M6.9 13.2a1 1 0 0 1 1 1v3.3a1 1 0 1 1-2 0v-3.3a1 1 0 0 1 1-1m4.4-7.1a1 1 0 0 1 1 1v10.4a1 1 0 1 1-2 0V7.1a1 1 0 0 1 1-1m4.4 4a1 1 0 0 1 1 1v6.4a1 1 0 1 1-2 0v-6.4a1 1 0 0 1 1-1"
          />
        </svg>
      );
    }

    case 'video_package': {
      // A play button, the universal mark for video.
      const fill = brandColour ? BRAND.video : 'currentColor';
      return (
        <svg viewBox="0 0 24 24" className={common} aria-hidden="true" role="img">
          <rect x="1.5" y="4" width="21" height="16" rx="4" fill={fill} opacity={brandColour ? 1 : 0.28} />
          <path fill={brandColour ? '#ffffff' : 'currentColor'} d="M10 8.4l6 3.6-6 3.6z" />
        </svg>
      );
    }
  }
}
