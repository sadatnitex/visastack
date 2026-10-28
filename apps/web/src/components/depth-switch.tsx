'use client';

import { useEffect, useRef, useState } from 'react';
import {
  DEPTH_COOKIE,
  DEPTH_COOKIE_MAX_AGE,
  DEPTH_COOKIE_PATH,
  DEPTH_LEVELS,
  DEPTH_PHONE_QUERY,
  type DepthChoice,
  type DepthFamily,
  type DepthLevel,
  isDepthLevel,
  parseDepthCookie,
  resolveAuto,
  serializeDepthCookie,
} from '../lib/ccd/depth';
import { currentLevel, focusTarget, raiseToShow } from '../lib/ccd/reveal';

export interface DepthSwitchCopy {
  readonly group: string;
  readonly levels: Readonly<Record<DepthLevel, string>>;
  /** One calm sentence per level, saying what that level shows on this screen. */
  readonly summaries: Readonly<Record<DepthLevel, string>>;
  /** Spoken after a change, with {level} replaced by the level's name. */
  readonly status: string;
}

function readSaved(): Partial<Record<DepthFamily, DepthLevel>> {
  const match = document.cookie.split('; ').find((part) => part.startsWith(`${DEPTH_COOKIE}=`));
  return parseDepthCookie(match?.slice(DEPTH_COOKIE.length + 1));
}

/** The address's anchor, or null when it is empty or not valid text (a stray percent sign). */
function readHashId(): string | null {
  const raw = window.location.hash.slice(1);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

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
}: {
  readonly family: DepthFamily;
  readonly initial: DepthChoice;
  readonly copy: DepthSwitchCopy;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [choice, setChoice] = useState<DepthChoice>(initial);
  const [phone, setPhone] = useState<boolean | null>(null);
  const [status, setStatus] = useState('');

  // The words can be a new object after a server refresh; the one-time link handling below
  // must not run again for that, so it reads them through a ref.
  const words = useRef(copy);
  words.current = copy;
  const announce = (level: DepthLevel) =>
    setStatus(words.current.status.replace('{level}', words.current.levels[level]));

  useEffect(() => {
    const query = window.matchMedia(DEPTH_PHONE_QUERY);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // Links from emails and notifications (?depth=) and in-page anchors (#evidence): never land
  // on content a hidden level is hiding.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once; announce reads a ref
  useEffect(() => {
    const scope = root.current?.closest<HTMLElement>('[data-depth-scope]');
    if (!scope) return;
    const isPhone = () => window.matchMedia(DEPTH_PHONE_QUERY).matches;
    const wanted = new URLSearchParams(window.location.search).get('depth');
    if (isDepthLevel(wanted) && wanted !== currentLevel(scope, isPhone())) {
      scope.setAttribute('data-depth', wanted);
      setChoice(wanted);
      announce(wanted);
    }
    let frame = 0;
    const reveal = () => {
      const id = readHashId();
      const target = id ? document.getElementById(id) : null;
      if (!target) return;
      const raised = raiseToShow(target, scope, isPhone());
      if (!raised) return; // already on screen: the browser's own scroll to the anchor is enough
      setChoice(raised);
      announce(raised);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => focusTarget(target));
    };
    reveal();
    window.addEventListener('hashchange', reveal);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', reveal);
    };
  }, []);

  const shown: DepthLevel | null =
    choice !== 'auto' ? choice : phone === null ? null : resolveAuto(phone);

  const choose = (level: DepthLevel) => {
    const scope = root.current?.closest<HTMLElement>('[data-depth-scope]');
    scope?.setAttribute('data-depth', level);
    setChoice(level);
    save(family, level);
    announce(level);
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
            aria-pressed={shown === null ? undefined : shown === level}
            onClick={() => choose(level)}
          >
            {copy.levels[level]}
          </button>
        ))}
      </fieldset>
      {DEPTH_LEVELS.map((level) => (
        <p key={level} className="depth-note" data-for={level}>
          {copy.summaries[level]}
        </p>
      ))}
      <output className="sr-only">{status}</output>
    </div>
  );
}
