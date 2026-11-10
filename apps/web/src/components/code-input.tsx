'use client';

import { useEffect, useState } from 'react';

/**
 * A short numeric code typed into one box per digit, the way WhatsApp or a bank asks for the code
 * it sent. Underneath it is ONE real input: one label, one value under one field name, the phone's
 * one-time-code suggestion, a numeric keypad, and paste of the whole code at once. The boxes are
 * only drawn over it (and hidden from screen readers), so nothing about how the form is sent,
 * checked or limited changes. Before the page is running, or without scripts, it is the plain input.
 *
 * Spaces and dashes are dropped, so "123 456" pasted from an app or a message becomes `123456`.
 * No length cap sits on the input itself, because a browser would cut a pasted "123 456" to six
 * characters before the spaces could be removed.
 */
export function digitsOnly(text: string, length: number): string {
  return text.replace(/\D/g, '').slice(0, length);
}

export function CodeInput({
  id,
  name,
  length = 6,
  pattern,
  required = true,
  ...aria
}: {
  readonly id: string;
  readonly name: string;
  /** How many digits the code has. */
  readonly length?: number;
  /** The browser's own format check. Defaults to exactly `length` digits. */
  readonly pattern?: string;
  readonly required?: boolean;
  readonly 'aria-invalid'?: true;
  readonly 'aria-describedby'?: string;
}) {
  const [value, setValue] = useState('');
  const [drawn, setDrawn] = useState(false);
  const [focused, setFocused] = useState(false);
  // Boxes are drawn only once the page is running; until then the input shows its own text.
  useEffect(() => setDrawn(true), []);
  const active = Math.min(value.length, length - 1);
  return (
    <div
      className="code-boxes"
      data-drawn={drawn ? 'true' : 'false'}
      data-focused={focused ? 'true' : 'false'}
    >
      <input
        id={id}
        name={name}
        type="text"
        className="input code-boxes-input"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern={pattern ?? `[0-9]{${length}}`}
        spellCheck={false}
        required={required}
        value={value}
        onChange={(event) => setValue(digitsOnly(event.target.value, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...aria}
      />
      <span className="code-boxes-cells" aria-hidden="true">
        {Array.from({ length }, (_, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: the boxes are fixed positions
            key={index}
            className="code-box"
            data-active={focused && index === active ? 'true' : undefined}
          >
            {value[index] ?? ''}
          </span>
        ))}
      </span>
    </div>
  );
}
