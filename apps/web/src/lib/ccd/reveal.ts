import {
  DEPTH_LEVELS,
  DEPTH_PHONE_QUERY,
  type DepthLevel,
  depthRank,
  isDepthLevel,
  resolveAuto,
} from './depth';

/** The level a scope shows right now, turning "auto" into what this screen width means. */
export function currentLevel(scope: HTMLElement, isPhone: boolean): DepthLevel {
  const set = scope.getAttribute('data-depth');
  return isDepthLevel(set) ? set : resolveAuto(isPhone);
}

/**
 * The lowest level at which an element is visible: the deepest level named by it or by any
 * block around it, up to the scope. An element in no gated block is visible at Glance.
 */
export function levelContaining(element: HTMLElement, scope: HTMLElement): DepthLevel {
  let need = 0;
  for (let node: HTMLElement | null = element; node && node !== scope; node = node.parentElement) {
    const level = node.getAttribute('data-level');
    if (isDepthLevel(level)) need = Math.max(need, depthRank(level));
  }
  return DEPTH_LEVELS[need] ?? 'glance';
}

/**
 * Make sure a link target is on screen: if it sits in a block the current level hides, raise
 * the level to the lowest one that shows it. Returns the new level when it changed, so the
 * caller can update the switch and its status line; a saved choice is never overwritten.
 */
export function raiseToShow(
  target: HTMLElement,
  scope: HTMLElement,
  isPhone: boolean,
  options: { readonly asLinkTarget?: boolean } = {},
): DepthLevel | null {
  if (!scope.contains(target)) return null;
  const needed = options.asLinkTarget
    ? levelForLink(target, scope)
    : levelContaining(target, scope);
  if (depthRank(needed) <= depthRank(currentLevel(scope, isPhone))) return null;
  scope.setAttribute('data-depth', needed);
  return needed;
}

/**
 * The level a link to this element opens. Usually the level that shows it, but a target can ask
 * for more with `data-reveal`: a case row visible at Glance whose link should open the whole
 * case says `data-reveal="everything"`. Only links use this; a form sent inside the row keeps
 * the level the person chose.
 */
export function levelForLink(target: HTMLElement, scope: HTMLElement): DepthLevel {
  const shown = levelContaining(target, scope);
  const asked = target.getAttribute('data-reveal');
  return isDepthLevel(asked) && depthRank(asked) > depthRank(shown) ? asked : shown;
}

/** Scroll a revealed target into view and move keyboard focus to it. */
export function focusTarget(target: HTMLElement): void {
  if (!target.matches('a[href], button, input, select, textarea, summary, [tabindex]')) {
    target.setAttribute('tabindex', '-1');
  }
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'start' });
}

export function isPhoneNow(): boolean {
  return window.matchMedia(DEPTH_PHONE_QUERY).matches;
}
