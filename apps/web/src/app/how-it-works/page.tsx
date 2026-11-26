import type { ReactElement } from 'react';
import { HowClosing, HowHero, HowRows, WordsBand } from '../../components/public-how/how-sections';
import { ScenesRuntime } from '../../components/public-site/scenes-runtime';
import { trustCatalog } from '../../i18n/trust';
import { getPageLanguage, getServerT, primeLocale } from '../../lib/i18n-server';
import { localizedMetadata } from '../../lib/localized-metadata';
import './how-it-works.css';

export const generateMetadata = localizedMetadata({ title: 'How It Works' });

/**
 * The How It Works page (R2 rebuild): a dark opening with the four steps, four rows that each show
 * the step on a phone or a sheet, a light band on exact words, and a dark closing. The figures are
 * made up and say so. Readiness is completeness, never approval.
 */
export default async function HowItWorksPage(): Promise<ReactElement> {
  await primeLocale();
  const pageLang = getPageLanguage();
  const t = getServerT(trustCatalog);
  return (
    <>
      <ScenesRuntime />
      <HowHero pageLang={pageLang} />
      <HowRows pageLang={pageLang} />
      <WordsBand pageLang={pageLang} />
      <HowClosing
        pageLang={pageLang}
        start={t.node('trust.publicTrustStory.startWithYourOwnProfile')}
      />
    </>
  );
}
