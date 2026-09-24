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

/** Brand colours, used only when the icon is shown in colour. */
const BRAND = {
  linkedin: '#0A66C2',
  x: '#000000',
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

    // --- Formats with no platform: drawn marks -----------------------------

    case 'exec_summary':
      // A document with a highlighted first line: the finding leads.
      return (
        <svg viewBox="0 0 24 24" className={common} aria-hidden="true" role="img">
          <path
            fill="currentColor"
            d="M5 2h9l5 5v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1m8.5 1.75V7.5H17z"
            opacity="0.25"
          />
          <path
            fill="currentColor"
            d="M7 10.5h6.5a.75.75 0 0 1 0 1.5H7a.75.75 0 0 1 0-1.5m0 3.5h10a.75.75 0 0 1 0 1.5H7a.75.75 0 0 1 0-1.5m0 3.5h10a.75.75 0 0 1 0 1.5H7a.75.75 0 0 1 0-1.5"
          />
        </svg>
      );

    case 'advisory':
      // A shield: a formal notice carrying a caution.
      return (
        <svg viewBox="0 0 24 24" className={common} aria-hidden="true" role="img">
          <path fill="currentColor" d="M12 1.5 3.5 5v6.6c0 5.2 3.6 10 8.5 11.4 4.9-1.4 8.5-6.2 8.5-11.4V5z" opacity="0.25" />
          <path
            fill="currentColor"
            d="M12 7a1 1 0 0 1 1 1v4.5a1 1 0 1 1-2 0V8a1 1 0 0 1 1-1m0 8.5a1.15 1.15 0 1 1 0 2.3 1.15 1.15 0 0 1 0-2.3"
          />
        </svg>
      );

    case 'presentation':
      // A screen on a stand.
      return (
        <svg viewBox="0 0 24 24" className={common} aria-hidden="true" role="img">
          <path fill="currentColor" d="M2.5 3h19a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-19a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1" opacity="0.25" />
          <path
            fill="currentColor"
            d="M11 15h2v2.9l3.4 3a1 1 0 1 1-1.3 1.5L12 19.7l-3.1 2.7a1 1 0 0 1-1.3-1.5l3.4-3zM6 8.5a.9.9 0 0 1 .9.9v2.2a.9.9 0 1 1-1.8 0V9.4a.9.9 0 0 1 .9-.9m4-3a.9.9 0 0 1 .9.9v5.2a.9.9 0 1 1-1.8 0V6.4a.9.9 0 0 1 .9-.9m4 1.6a.9.9 0 0 1 .9.9v3.6a.9.9 0 1 1-1.8 0V8a.9.9 0 0 1 .9-.9"
          />
        </svg>
      );

    case 'infographic':
      // Bars of differing height: figures made visual.
      return (
        <svg viewBox="0 0 24 24" className={common} aria-hidden="true" role="img">
          <path fill="currentColor" d="M3 2h18a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1" opacity="0.18" />
          <path
            fill="currentColor"
            d="M6.5 13a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0v-4a1 1 0 0 1 1-1m5-7a1 1 0 0 1 1 1v11a1 1 0 1 1-2 0V7a1 1 0 0 1 1-1m5 4a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0v-7a1 1 0 0 1 1-1"
          />
        </svg>
      );

    case 'video_package':
      // A clapperboard: a production package, not a finished film.
      return (
        <svg viewBox="0 0 24 24" className={common} aria-hidden="true" role="img">
          <path fill="currentColor" d="M2 9h20v11a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 20z" opacity="0.25" />
          <path
            fill="currentColor"
            d="M3.2 2.9 21 5.6a1.2 1.2 0 0 1 1 1.4L21.8 9H2.2l-.2-1.3A1.2 1.2 0 0 1 3 6.4zM10 12.6l5 2.9-5 2.9z"
          />
        </svg>
      );
  }
}
