import type { DepthSwitchCopy } from '../../components/depth-switch';
import { depthWord } from './depth-words';

/** The screens whose three sentences are plain words in depth-words.ts. */
export type DepthCopyScreen =
  | 'home'
  | 'traveller'
  | 'documents'
  | 'profile'
  | 'expiry'
  | 'cases'
  | 'case'
  | 'evidence'
  | 'sharing'
  | 'notifications'
  | 'privacy';

/** The shared words plus one screen's three sentences, by the screen's name. */
export function depthCopyFor(screen: DepthCopyScreen): DepthSwitchCopy {
  return depthCopy({
    glance: depthWord(`depth.${screen}.glance`),
    browse: depthWord(`depth.${screen}.browse`),
    everything: depthWord(`depth.${screen}.everything`),
  });
}

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
