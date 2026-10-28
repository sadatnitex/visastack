import type { DepthLevel } from '../lib/ccd/depth';

export { DepthScope } from './depth-scope';

/**
 * Calm Core With Depths, server side (ADR 0023). A screen wraps its content in one scope and
 * marks each block with the shallowest level it shows at. Everything is always in the page;
 * the stylesheet hides the blocks past the chosen level, so nothing is removed, typed values
 * survive a change of level, and a script-less visitor sees all of it.
 */
/** The attribute that puts a block at a level: `<section {...atLevel('browse')}>`. */
export function atLevel(level: DepthLevel): { readonly 'data-level': DepthLevel } {
  return { 'data-level': level };
}
