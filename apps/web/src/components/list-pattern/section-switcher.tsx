'use client';

import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import type { DepthLevel } from '../../lib/ccd/depth';
import { atLevel } from '../depth';

export interface SwitcherSection {
  /** Stable key; the tab and panel ids come from it. */
  readonly key: string;
  /** The tab's name, Title Case. */
  readonly title: string;
  /** A quiet count or status beside the name. */
  readonly pill?: ReactNode;
  /** The depth the section shows at (its tab and its panel carry it). */
  readonly level: DepthLevel;
  readonly content: ReactNode;
}

/**
 * Several sections of one place behind one row of tabs, one section showing at a time, none until
 * a tab (or a link to something inside a section) asks for it, so the row stays short. Every
 * section is in the page the server sends, so nothing waits for a request and a link to anything
 * inside a section (`#work`) opens that section. Without script the tabs are not drawn and every
 * section is shown one under the other. Depth still decides which tabs exist: a section that does
 * not show at the chosen depth has no tab and no panel.
 */
export function SwitcherTabs({
  label,
  sections,
  initial,
}: {
  /** The accessible name of the row of tabs. */
  readonly label: string;
  readonly sections: readonly SwitcherSection[];
  /** The section that starts chosen, when one is asked for (a list that was expanded). */
  readonly initial?: string | undefined;
}) {
  const keys = sections.map((s) => s.key);
  const [ready, setReady] = useState(false);
  const [chosen, setChosen] = useState<string | null>(initial ?? null);
  const root = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => setReady(true), []);

  // Once the tabs are drawn (not before: a hidden row of tabs has no drawn tab), keep the chosen
  // section one that is drawn: when depth hides it, nothing is chosen until a tab is.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keys is derived from sections
  useEffect(() => {
    if (!ready) return;
    const settle = () =>
      setChosen((current) => {
        const index = current ? keys.indexOf(current) : -1;
        const tab = index >= 0 ? tabs.current[index] : null;
        return tab && tab.getClientRects().length > 0 ? current : null;
      });
    settle();
    const scope = root.current?.closest('[data-depth-scope]');
    if (!scope) return;
    const watcher = new MutationObserver(settle);
    watcher.observe(scope, { attributes: true, attributeFilter: ['data-depth'] });
    return () => watcher.disconnect();
  }, [ready, sections]);

  // A link to anything inside a section opens that section.
  useEffect(() => {
    const open = (id: string) => {
      const target = id ? document.getElementById(id) : null;
      const panel = target?.closest<HTMLElement>('[data-switcher-panel]');
      const key = panel?.getAttribute('data-switcher-panel');
      if (key && panel && root.current?.contains(panel)) setChosen(key);
    };
    const fromHash = () => {
      try {
        open(decodeURIComponent(window.location.hash.slice(1)));
      } catch {
        // A malformed address names nothing.
      }
    };
    const onClick = (event: MouseEvent) => {
      const href = (event.target as Element | null)?.closest('a[href^="#"]')?.getAttribute('href');
      if (href) open(href.slice(1));
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('hashchange', fromHash);
      document.removeEventListener('click', onClick);
    };
  }, []);

  const move = (event: KeyboardEvent, from: number) => {
    const drawn = tabs.current
      .map((tab, index) => (tab && tab.getClientRects().length > 0 ? index : -1))
      .filter((index) => index >= 0);
    const at = drawn.indexOf(from);
    const to =
      event.key === 'ArrowRight'
        ? drawn[(at + 1) % drawn.length]
        : event.key === 'ArrowLeft'
          ? drawn[(at - 1 + drawn.length) % drawn.length]
          : event.key === 'Home'
            ? drawn[0]
            : event.key === 'End'
              ? drawn[drawn.length - 1]
              : undefined;
    if (to === undefined) return;
    event.preventDefault();
    const key = keys[to];
    if (key) setChosen(key);
    tabs.current[to]?.focus();
  };

  return (
    <div className="sw-root" data-pattern="section-switcher" ref={root}>
      <div className="sw-tabs" role="tablist" aria-label={label} hidden={!ready}>
        {sections.map((section, index) => (
          <button
            key={section.key}
            ref={(el) => {
              tabs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`sw-tab-${section.key}`}
            aria-selected={chosen === section.key}
            aria-controls={`sw-panel-${section.key}`}
            tabIndex={chosen === null || chosen === section.key ? 0 : -1}
            className="sw-tab"
            onClick={() => setChosen(section.key)}
            onKeyDown={(event) => move(event, index)}
            {...atLevel(section.level)}
          >
            <span className="sw-tab-name">{section.title}</span>
            {section.pill}
          </button>
        ))}
      </div>
      {sections.map((section) => (
        <section
          key={section.key}
          id={`sw-panel-${section.key}`}
          className="sw-panel"
          role={ready ? 'tabpanel' : undefined}
          aria-labelledby={ready ? `sw-tab-${section.key}` : undefined}
          aria-label={ready ? undefined : section.title}
          data-switcher-panel={section.key}
          hidden={ready && chosen !== section.key}
          {...atLevel(section.level)}
        >
          {section.content}
        </section>
      ))}
    </div>
  );
}
