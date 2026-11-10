'use client';

import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import type { DepthLevel } from '../../lib/ccd/depth';
import { focusTarget } from '../../lib/ccd/reveal';
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
  const keyList = keys.join('|');
  const [ready, setReady] = useState(false);
  const [chosen, setChosen] = useState<string | null>(initial ?? null);
  // The section asked for by the address, a link or a click: kept even while depth hides its tab,
  // and chosen as soon as depth shows it.
  const wanted = useRef<string | null>(initial ?? null);
  // The first drawn tab is the one tab stop while nothing is chosen.
  const [first, setFirst] = useState<string | null>(null);
  // A link's target inside a panel, to scroll to once its panel is shown.
  const pending = useRef<HTMLElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => setReady(true), []);

  // Once the tabs are drawn (not before: a hidden row of tabs has no drawn tab), choose the wanted
  // section whenever its tab is drawn, else keep the chosen one while it is, else none.
  useEffect(() => {
    if (!ready) return;
    const names = keyList.split('|');
    const drawn = (key: string | null) => {
      const tab = key ? tabs.current[names.indexOf(key)] : null;
      return Boolean(tab && tab.getClientRects().length > 0);
    };
    const settle = () => {
      setFirst(names.find((key) => drawn(key)) ?? null);
      setChosen((current) =>
        drawn(wanted.current) ? wanted.current : drawn(current) ? current : null,
      );
    };
    settle();
    const scope = root.current?.closest('[data-depth-scope]');
    if (!scope) return;
    const watcher = new MutationObserver(settle);
    watcher.observe(scope, { attributes: true, attributeFilter: ['data-depth'] });
    return () => watcher.disconnect();
  }, [ready, keyList]);

  // A link to anything inside a section opens that section and then goes to the target.
  useEffect(() => {
    const open = (id: string) => {
      const target = id ? document.getElementById(id) : null;
      const panel = target?.closest<HTMLElement>('[data-switcher-panel]');
      const key = panel?.getAttribute('data-switcher-panel');
      if (key && target && panel && root.current?.contains(panel)) {
        wanted.current = key;
        pending.current = target;
        setChosen(key);
      }
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

  // Once the section is showing, scroll to the target the link named and put focus on it.
  useEffect(() => {
    const target = pending.current;
    if (!target || chosen === null) return;
    const panel = target.closest<HTMLElement>('[data-switcher-panel]');
    if (
      panel?.getAttribute('data-switcher-panel') !== chosen ||
      target.getClientRects().length === 0
    )
      return;
    pending.current = null;
    focusTarget(target);
  }, [chosen]);

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
    if (key) {
      wanted.current = key;
      setChosen(key);
    }
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
            tabIndex={(chosen ?? first) === section.key ? 0 : -1}
            className="sw-tab"
            onClick={() => {
              wanted.current = section.key;
              setChosen(section.key);
            }}
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
