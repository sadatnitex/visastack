import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import {
  HowClosing,
  type HowCopy,
  HowHero,
  HowRows,
  WordsBand,
} from '../../components/public-how/how-sections';
import { ScenesRuntime } from '../../components/public-site/scenes-runtime';
import { publicHowCatalog } from '../../i18n/public-how';
import { getPageLanguage, getServerT, primeLocale } from '../../lib/i18n-server';
import './how-it-works.css';

export const metadata: Metadata = { title: 'How It Works' };

/**
 * The How It Works page (R2 rebuild): a dark opening with the four steps, four rows that each show
 * the step on a phone or a sheet, a light band on exact words, and a dark closing. The figures are
 * made up and say so. Readiness is completeness, never approval.
 */
export default async function HowItWorksPage(): Promise<ReactElement> {
  await primeLocale();
  const pageLang = getPageLanguage();
  const t = getServerT(publicHowCatalog);
  const n = t.node;
  const copy: HowCopy = {
    titleLead: n('publicHow.hero.titleLead'),
    titleEnd: n('publicHow.hero.titleEnd'),
    lead: n('publicHow.hero.lead'),
    add: n('publicHow.step.add'),
    check: n('publicHow.step.check'),
    prepare: n('publicHow.step.prepare'),
    share: n('publicHow.step.share'),
    addBody: n('publicHow.step.addBody'),
    checkBody: n('publicHow.step.checkBody'),
    prepareBody: n('publicHow.step.prepareBody'),
    shareBody: n('publicHow.step.shareBody'),
    wordsLead: n('publicHow.words.titleLead'),
    wordsEnd: n('publicHow.words.titleEnd'),
    wordsHint: n('publicHow.words.hint'),
    words: [
      {
        key: 'received',
        word: n('publicHow.words.received'),
        not: n('publicHow.words.receivedNot'),
        means: n('publicHow.words.receivedMeans'),
      },
      {
        key: 'suggested',
        word: n('publicHow.words.suggested'),
        not: n('publicHow.words.suggestedNot'),
        means: n('publicHow.words.suggestedMeans'),
      },
      {
        key: 'saved',
        word: n('publicHow.words.saved'),
        not: n('publicHow.words.savedNot'),
        means: n('publicHow.words.savedMeans'),
      },
      {
        key: 'ready',
        word: n('publicHow.words.ready'),
        not: n('publicHow.words.readyNot'),
        means: n('publicHow.words.readyMeans'),
      },
    ],
    closingTitle: n('publicHow.closing.title'),
    closingSub: n('publicHow.closing.sub'),
    start: n('publicHow.closing.start'),
    privacy: n('publicHow.closing.privacy'),
  };
  return (
    <>
      <ScenesRuntime />
      <HowHero copy={copy} />
      <HowRows copy={copy} pageLang={pageLang} />
      <WordsBand copy={copy} />
      <HowClosing copy={copy} />
    </>
  );
}
