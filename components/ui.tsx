'use client';

/** Shared presentational primitives, so controls stay consistent across panels. */

import type { ButtonHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes } from 'react';
import type { FindingSeverity } from '@/lib/types';

export function cx(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  /** React 19 passes ref as a normal prop to function components. */
  ref?: Ref<HTMLButtonElement>;
}

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-accent)] text-[var(--color-accent-contrast)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-rule-strong)] disabled:text-[var(--color-ink-faint)]',
  secondary:
    'bg-[var(--color-surface)] text-[var(--color-ink)] border border-[var(--color-rule-strong)] hover:bg-[var(--color-surface-sunken)] disabled:text-[var(--color-ink-faint)]',
  ghost:
    'bg-transparent text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]',
  danger:
    'bg-[var(--color-surface)] text-[var(--color-danger)] border border-[var(--color-danger-border)] hover:bg-[var(--color-danger-soft)]',
};

export function Button({ variant = 'secondary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors',
        'disabled:cursor-not-allowed',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
        BUTTON_STYLES[variant],
        className,
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cx(
        'flex min-h-0 flex-col rounded-lg border border-[var(--color-rule)] bg-[var(--color-surface)]',
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-rule)] px-4 py-2.5">
          {typeof title === 'string' ? (
            <h2 className="text-sm font-semibold text-[var(--color-ink)]">{title}</h2>
          ) : (
            title
          )}
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cx('min-h-0 flex-1', bodyClassName ?? 'p-4')}>{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-[var(--color-ink-muted)]">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] leading-snug text-[var(--color-ink-faint)]">{hint}</p>}
    </div>
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cx(
        'w-full rounded-md border border-[var(--color-rule-strong)] bg-[var(--color-surface)]',
        'px-2.5 py-1.5 text-sm text-[var(--color-ink)]',
        'disabled:bg-[var(--color-surface-sunken)] disabled:text-[var(--color-ink-faint)]',
        className,
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Badges and findings
// ---------------------------------------------------------------------------

const SEVERITY_STYLES: Record<FindingSeverity, string> = {
  error:
    'bg-[var(--color-danger-soft)] text-[var(--color-danger)] border-[var(--color-danger-border)]',
  warning: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)] border-[var(--color-warn-border)]',
  info: 'bg-[var(--color-info-soft)] text-[var(--color-info)] border-[var(--color-info-border)]',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: FindingSeverity | 'neutral' | 'accent';
  className?: string;
}) {
  const style =
    tone === 'neutral'
      ? 'bg-[var(--color-surface-sunken)] text-[var(--color-ink-muted)] border-[var(--color-rule)]'
      : tone === 'accent'
        ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-[var(--color-accent-border)]'
        : SEVERITY_STYLES[tone];

  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        style,
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Callout({
  tone,
  title,
  children,
}: {
  tone: FindingSeverity;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx('rounded-md border px-3 py-2 text-xs leading-relaxed', SEVERITY_STYLES[tone])}>
      {title && <p className="mb-0.5 font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <p className="text-sm font-medium text-[var(--color-ink)]">{title}</p>
      <p className="max-w-sm text-xs leading-relaxed text-[var(--color-ink-faint)]">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cx('animate-spin', className)}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
