'use client';

import { useEffect, useRef, useState } from 'react';
import { componentsCatalog } from '../i18n/components';
import {
  DEPTH_COOKIE,
  DEPTH_COOKIE_MAX_AGE,
  DEPTH_COOKIE_PATH,
  DEPTH_LEVELS,
  type DepthChoice,
  type DepthFamily,
  type DepthLevel,
  isDepthLevel,
  parseDepthCookie,
  resolveAuto,
  serializeDepthCookie,
} from '../lib/ccd/depth';
import { currentLevel, focusTarget, raiseToShow } from '../lib/ccd/reveal';
import { useT } from './i18n-provider';

export interface DepthSwitchCopy {
  readonly group: string;
  readonly levels: Readonly<Record<DepthLevel, string>>;
  /** One calm sentence per level, saying what that level shows on this screen. */
  readonly summaries: Readonly<Record<DepthLevel, string>>;
  /** Spoken after a change, with {level} replaced by the level's name. */
  readonly status: string;
  /** The name of the small control that opens the sentence about the chosen level. */
  readonly info?: string;
}

/** How long after a form is sent its block is kept on screen while the page refreshes. */
const KEEP_SENT_IN_VIEW_MS = 60_000;

function readSaved(): Partial<Record<DepthFamily, DepthLevel>> {
  const match = document.cookie.split('; ').find((part) => part.startsWith(`${DEPTH_COOKIE}=`));
  return parseDepthCookie(match?.slice(DEPTH_COOKIE.length + 1));
}

/** An anchor's name, or null when it is empty or not valid text (a stray percent sign). */
function decodeHash(raw: string): string | null {
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

const readHashId = () => decodeHash(window.location.hash.slice(1));

function save(family: DepthFamily, level: DepthLevel): void {
  const value = serializeDepthCookie({ ...readSaved(), [family]: level });
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${DEPTH_COOKIE}=${value}; Path=${DEPTH_COOKIE_PATH}; Max-Age=${DEPTH_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

/**
 * The same three-way switch in the same place on every signed-in screen. It changes one
 * attribute on the screen's scope (no re-render of the page, no layout shift), remembers the
 * choice in a first-party cookie, and reveals a link target that a hidden level was hiding.
 */
export function DepthSwitch({
  family,
  initial,
  copy,
  notesBehindInfo = false,
}: {
  readonly family: DepthFamily;
  readonly initial: DepthChoice;
  readonly copy: DepthSwitchCopy;
  /**
   * Keeps the one sentence about the chosen level out of the screen's first view: it sits behind
   * a small control beside the switch and opens on a tap. For screens held to a word budget
   * (Owner, 5 Nov 2026: no page should have more than 30 words).
   */
  readonly notesBehindInfo?: boolean;
}) {
  const t = useT(componentsCatalog);
  const root = useRef<HTMLDivElement>(null);
  const [choice, setChoice] = useState<DepthChoice>(initial);
  const [status, setStatus] = useState('');

  // The words can be a new object after a server refresh; the one-time link handling below
  // must not run again for that, so it reads them through a ref.
  const words = useRef(copy);
  words.current = copy;
  const announce = (level: DepthLevel) =>
    setStatus(words.current.status.replace('{level}', words.current.levels[level]));
  // The one way the buttons and the spoken status follow a new level, from any cause.
  const lastLevel = useRef<DepthChoice>(initial);
  // The blocks around the form the person last sent, nearest first, and when they sent it.
  const sent = useRef<{ readonly ids: readonly string[]; readonly at: number } | null>(null);
  const show = (level: DepthLevel) => {
    if (lastLevel.current === level) return;
    lastLevel.current = level;
    setChoice(level);
    announce(level);
  };

  // Another part of the page may raise the level (a filter tile, a link): keep the buttons and
  // the spoken status in step with what is on screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once; announce reads a ref
  useEffect(() => {
    const scope = root.current?.closest<HTMLElement>('[data-depth-scope]');
    if (!scope) return;
    const observer = new MutationObserver(() => {
      const value = scope.getAttribute('data-depth');
      if (!isDepthLevel(value)) return;
      show(value);
    });
    observer.observe(scope, { attributes: true, attributeFilter: ['data-depth'] });
    return () => observer.disconnect();
  }, []);

  // A sent form refreshes the page with new data, and that data can move the block the person
  // just used to a deeper level (an answered request, the first share). Keep that block on
  // screen so they see what happened; choosing a level on the switch ends this.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once; show reads refs
  useEffect(() => {
    const scope = root.current?.closest<HTMLElement>('[data-depth-scope]');
    if (!scope) return;
    const onSubmit = (event: Event) => {
      const ids: string[] = [];
      for (
        let node = event.target instanceof Element ? event.target : null;
        node && node !== scope;
        node = node.parentElement
      ) {
        if (node.id) ids.push(node.id);
      }
      sent.current = ids.length > 0 ? { ids, at: Date.now() } : null;
    };
    const keepInView = () => {
      const last = sent.current;
      if (!last) return;
      if (Date.now() - last.at > KEEP_SENT_IN_VIEW_MS) {
        sent.current = null;
        return;
      }
      const target = last.ids
        .map((id) => document.getElementById(id))
        .find((element): element is HTMLElement => element !== null && scope.contains(element));
      if (!target) return;
      const raised = raiseToShow(target, scope);
      if (raised) show(raised);
    };
    const observer = new MutationObserver(keepInView);
    observer.observe(scope, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-level'],
    });
    scope.addEventListener('submit', onSubmit, true);
    return () => {
      observer.disconnect();
      scope.removeEventListener('submit', onSubmit, true);
    };
  }, []);

  // Links from emails and notifications (?depth=) and in-page anchors (#evidence): never land
  // on content a hidden level is hiding.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once; announce reads a ref
  useEffect(() => {
    const scope = root.current?.closest<HTMLElement>('[data-depth-scope]');
    if (!scope) return;
    const wanted = new URLSearchParams(window.location.search).get('depth');
    if (isDepthLevel(wanted) && wanted !== currentLevel(scope)) {
      scope.setAttribute('data-depth', wanted);
      show(wanted);
    }
    let frame = 0;
    const revealId = (id: string | null) => {
      const target = id ? document.getElementById(id) : null;
      if (!target) return;
      const raised = raiseToShow(target, scope, { asLinkTarget: true });
      if (!raised) return; // already on screen: the browser's own scroll to the anchor is enough
      show(raised);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => focusTarget(target));
    };
    const reveal = () => revealId(readHashId());
    // A click on a link to the same anchor again does not change the address, and a link to this
    // page written as a full path (search results) moves through the router, so no hashchange
    // fires for either: the click itself raises the level before the browser scrolls.
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href*="#"]');
      const href = link?.getAttribute('href');
      if (!href) return;
      let to: URL;
      try {
        to = new URL(href, window.location.href);
      } catch {
        return; // an address the browser cannot read either: leave it to the browser
      }
      if (to.origin !== window.location.origin || to.pathname !== window.location.pathname) return;
      revealId(decodeHash(to.hash.slice(1)));
    };
    reveal();
    window.addEventListener('hashchange', reveal);
    document.addEventListener('click', onClick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', reveal);
      document.removeEventListener('click', onClick);
    };
  }, []);

  const shown: DepthLevel = choice !== 'auto' ? choice : resolveAuto();

  const choose = (level: DepthLevel) => {
    sent.current = null;
    const scope = root.current?.closest<HTMLElement>('[data-depth-scope]');
    scope?.setAttribute('data-depth', level);
    save(family, level);
    show(level);
  };

  return (
    <div className="depth-switch" ref={root}>
      <fieldset className="depth-segs">
        <legend className="sr-only">{copy.group}</legend>
        {DEPTH_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            className="depth-seg"
            data-for={level}
            aria-pressed={shown === level}
            onClick={() => choose(level)}
          >
            {copy.levels[level]}
          </button>
        ))}
      </fieldset>
      {notesBehindInfo ? (
        <details
          className="depth-info"
          onKeyDown={(event) => {
            // Escape closes the note and puts focus back on the round control.
            if (event.key === 'Escape' && event.currentTarget.open) {
              event.currentTarget.open = false;
              event.currentTarget.querySelector('summary')?.focus();
            }
          }}
        >
          <summary className="depth-info-toggle" aria-label={copy.info ?? copy.group}>
            <span aria-hidden="true">{t.node('components.depthSwitch.i')}</span>
          </summary>
          {DEPTH_LEVELS.map((level) => (
            <p key={level} className="depth-note" data-for={level}>
              {copy.summaries[level]}
            </p>
          ))}
        </details>
      ) : (
        DEPTH_LEVELS.map((level) => (
          <p key={level} className="depth-note" data-for={level}>
            {copy.summaries[level]}
          </p>
        ))
      )}
      <output className="sr-only">{status}</output>
    </div>
  );
}
