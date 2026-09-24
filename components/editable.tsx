'use client';

/**
 * Inline editing primitives.
 *
 * Previews render the artefact as it will be exported. In edit mode the same
 * fields become text inputs in place, so the operator never edits a different
 * representation from the one they reviewed.
 */

import { useEffect, useRef } from 'react';
import { cx } from './ui';

/** Immutable set-by-path. Used so an edit never mutates generated content. */
export function setIn<T>(target: T, path: (string | number)[], value: unknown): T {
  if (path.length === 0) return value as T;
  const [key, ...rest] = path;

  if (Array.isArray(target)) {
    const copy = [...target];
    const index = Number(key);
    copy[index] = setIn(copy[index], rest, value);
    return copy as unknown as T;
  }

  const source = (target ?? {}) as Record<string, unknown>;
  return { ...source, [key]: setIn(source[key as string], rest, value) } as T;
}

export function getIn(target: unknown, path: (string | number)[]): unknown {
  return path.reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return (acc as Record<string, unknown>)[key as string];
  }, target);
}

function Autosize({
  value,
  onChange,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow the field to fit its content so no text is hidden while editing.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      aria-label={ariaLabel}
      value={value}
      rows={1}
      onChange={(event) => onChange(event.target.value)}
      className={cx(
        'w-full resize-none rounded border border-dashed border-[var(--color-accent-border)]',
        'bg-[var(--color-accent-soft)] px-1.5 py-1 outline-none',
        'focus:border-solid focus:border-[var(--color-accent)]',
        className,
      )}
    />
  );
}

/**
 * Renders `value` as text, or as an editable field when `editing` is true.
 * `as` keeps the surrounding typography intact in read mode.
 */
export function EditableText({
  value,
  editing,
  onChange,
  label,
  className,
  placeholder,
  as: Tag = 'p',
}: {
  value: string;
  editing: boolean;
  onChange: (next: string) => void;
  label: string;
  className?: string;
  placeholder?: string;
  as?: 'p' | 'span' | 'h1' | 'h2' | 'h3' | 'li' | 'div';
}) {
  if (editing) {
    return <Autosize value={value} onChange={onChange} className={className} ariaLabel={label} />;
  }
  if (!value?.trim() && placeholder) {
    return <Tag className={cx(className, 'text-[var(--color-ink-faint)] italic')}>{placeholder}</Tag>;
  }
  return <Tag className={className}>{value}</Tag>;
}

/** An editable list of plain strings, with add and remove in edit mode. */
export function EditableList({
  items,
  editing,
  onChange,
  label,
  itemClassName,
  listClassName,
}: {
  items: string[];
  editing: boolean;
  onChange: (next: string[]) => void;
  label: string;
  itemClassName?: string;
  listClassName?: string;
}) {
  if (!editing) {
    return (
      <ul className={listClassName}>
        {items.map((item, i) => (
          <li key={i} className={itemClassName}>
            {item}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <Autosize
            value={item}
            ariaLabel={`${label} ${i + 1}`}
            onChange={(next) => onChange(items.map((v, j) => (j === i ? next : v)))}
            className="text-sm"
          />
          <button
            type="button"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            aria-label={`Remove ${label} ${i + 1}`}
            className="mt-1 shrink-0 rounded px-1.5 py-0.5 text-xs text-[var(--color-ink-faint)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ''])}
        className="self-start rounded px-1.5 py-0.5 text-xs font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
      >
        + Add {label.toLowerCase()}
      </button>
    </div>
  );
}
