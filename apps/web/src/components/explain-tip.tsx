'use client';

import type { ReactNode } from 'react';
import { useExplainTip } from '../lib/use-explain-tip';

export interface ExplainTipProps {
  /**
   * The name of what the picture stands for, in Title Case. It is the button's name. Words in
   * another language than the page come marked (`t.node`), so they are read in their own voice.
   */
  readonly label: ReactNode;
  /** One plain sentence that says what it means. Shown when someone points, focuses or taps. */
  readonly text: ReactNode;
  /** What a person sees: an icon, a small picture or a symbol. Hidden from screen readers. */
  readonly children: ReactNode;
  /** An extra class for the page's own spacing. */
  readonly className?: string | undefined;
}

/**
 * Explain popup: a picture that explains itself. Point at it, focus it or tap it and its name and
 * one plain sentence appear beside it; Escape, a press elsewhere or moving on closes it. It replaces
 * the plain `title=` hint, which a touch screen and a keyboard never show.
 *
 * The trigger is a real button at least 44 px square whose accessible name is the label, and the
 * sentence is linked to it with `aria-describedby` (the sentence alone, so the name is not read twice), so a screen reader hears both without opening
 * anything. Before the script loads the label is still there for assistive technology as the
 * button's own text. Flat: a solid surface and a border, no shadow; the popup only fades and
 * slides on the shared motion speeds, and not at all under reduced motion.
 */
export function ExplainTip({ label, text, children, className }: ExplainTipProps) {
  const { open, fit, popupId, wrapRef, triggerRef, popupRef, wrapProps, triggerProps } =
    useExplainTip();
  // The page's own ids are what a page outline lists. These two exist only to link the button to
  // its sentence, so they keep React's generated form (leading "_R_") and drop the readable prefix.
  const domId = popupId.replace(/^explain-/, '');
  return (
    <span
      ref={wrapRef}
      className={`explain-tip${className ? ` ${className}` : ''}`}
      data-open={open ? 'true' : undefined}
      data-placement={fit?.placement}
      data-align={fit?.align}
      {...wrapProps}
    >
      <button
        ref={triggerRef}
        type="button"
        className="explain-tip-trigger"
        aria-describedby={`${domId}-text`}
        {...triggerProps}
      >
        <span className="explain-tip-picture" aria-hidden="true">
          {children}
        </span>
        <span className="sr-only">{label}</span>
      </button>
      <span ref={popupRef} id={domId} role="tooltip" className="explain-tip-popup" hidden={!open}>
        <span className="explain-tip-title">{label}</span>
        <span className="explain-tip-text" id={`${domId}-text`}>
          {text}
        </span>
      </span>
    </span>
  );
}
