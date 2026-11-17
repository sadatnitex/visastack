import { motionAllowed } from './motion';

type TransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

/**
 * Runs a same-page change inside a view transition when the browser has them and the person
 * allows motion; otherwise runs it straight away. The change always runs exactly once.
 */
export function withViewTransition(change: () => void): void {
  if (typeof document === 'undefined' || !motionAllowed()) {
    change();
    return;
  }
  const start = (document as TransitionDocument).startViewTransition;
  if (typeof start !== 'function') {
    change();
    return;
  }
  let ran = false;
  const once = () => {
    if (ran) return;
    ran = true;
    change();
  };
  try {
    start.call(document, once);
  } catch {
    once();
  }
}
