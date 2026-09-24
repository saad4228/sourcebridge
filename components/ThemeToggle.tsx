'use client';

/**
 * Light / dark theme control.
 *
 * Three states rather than two: "system" follows the OS until the operator
 * makes a choice, and that choice is remembered per browser. The stored value
 * is applied by an inline script before first paint (see app/layout.tsx), so
 * this component only keeps the button in step with it.
 *
 * The preference lives outside React (localStorage plus a media query), so it
 * is read through useSyncExternalStore rather than copied into state by an
 * effect. That keeps the server and client renders consistent and means an OS
 * theme change is picked up while the page is open.
 */

import { useSyncExternalStore } from 'react';
import { cx } from './ui';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'sourcebridge-theme';
/** Fired after this tab changes the theme; `storage` only fires in other tabs. */
const CHANGE_EVENT = 'sourcebridge-theme-change';

function readStored(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark') return raw;
  } catch {
    // Private browsing can block storage; fall back to following the system.
  }
  return 'system';
}

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  media?.addEventListener('change', onChange);
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    media?.removeEventListener('change', onChange);
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** Snapshot is a plain string so React can compare it cheaply. */
function getSnapshot(): string {
  const stored = readStored();
  const dark =
    stored === 'dark' ||
    (stored === 'system' && (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false));
  return `${stored}:${dark ? 'dark' : 'light'}`;
}

/** The server cannot know the preference; assume the default palette. */
function getServerSnapshot(): string {
  return 'system:light';
}

export function ThemeToggle() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [stored, resolved] = snapshot.split(':') as [Theme, 'light' | 'dark'];
  const next: Theme = resolved === 'dark' ? 'light' : 'dark';

  const choose = (theme: Theme) => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);

    try {
      if (theme === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Not persisting is acceptable; the current page still switches.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  return (
    <button
      type="button"
      onClick={() => choose(next)}
      onDoubleClick={() => choose('system')}
      aria-label={`Switch to ${next} theme`}
      title={
        stored === 'system'
          ? `Following your system theme (${resolved}). Click for ${next}.`
          : `${resolved === 'dark' ? 'Dark' : 'Light'} theme. Click for ${next}, double-click to follow your system.`
      }
      className={cx(
        'inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors',
        'border-[var(--color-rule)] text-[var(--color-ink-muted)]',
        'hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]',
      )}
    >
      {resolved === 'dark' ? (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </svg>
      ) : (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}
