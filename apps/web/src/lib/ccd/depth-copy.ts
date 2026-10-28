import type { DepthSwitchCopy } from '../../components/depth-switch';
import { depthWord } from './depth-words';

/** The words every depth switch shares, plus this screen's three sentences. */
export function depthCopy(summaries: DepthSwitchCopy['summaries']): DepthSwitchCopy {
  return {
    group: depthWord('depth.group'),
    levels: {
      glance: depthWord('depth.glance'),
      browse: depthWord('depth.browse'),
      everything: depthWord('depth.everything'),
    },
    summaries,
    status: depthWord('depth.status'),
  };
}

/** "a", "a and b", "a, b and c": for sentences that name only what this screen really has. */
export function joinParts(parts: readonly string[], locale: string): string {
  return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(parts);
}
