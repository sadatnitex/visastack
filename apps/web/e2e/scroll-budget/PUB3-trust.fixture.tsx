import type { PublicTrustRoute } from '@visastack/services';
import pub3 from '../../src/components/public-pub3-story.css?inline';
import pubScenes from '../../src/components/public-site/public-scenes.css?inline';
import pubSite from '../../src/components/public-site/public-site.css?inline';
import { TrustCatalogSection } from '../../src/components/public-trust-routes';
import { PublicTrustStory } from '../../src/components/public-trust-story';

/**
 * WP-PUB3 page-length fixture: the real Privacy and Trust page as it renders with data, with no
 * database. The story and the route section are the same components the page renders, and the
 * routes are 156 made-up ones, so the list shows 12 and a Show More link, like the live page.
 */
function route(n: number): PublicTrustRoute {
  return {
    packKey: `route-${n}`,
    packName: `Route Number ${String(n).padStart(3, '0')}`,
    jurisdiction: 'United Kingdom',
    route: 'Visit',
    purpose: 'Tourism',
    routeDescription:
      'Short tourist stays for visitors who plan to travel for leisure, to see family or friends, or to attend a short event.',
    version: 1,
    effectiveDate: null,
    nextReviewDate: null,
    officialFee: null,
    officialChannelName: null,
    officialChannelUrl: null,
    officialReportingUrl: null,
    officialSources: [],
  } as unknown as PublicTrustRoute;
}

const ROUTES = Array.from({ length: 156 }, (_, n) => route(n));

export default function Pub3TrustFixture() {
  return (
    <>
      <PublicTrustStory />
      <TrustCatalogSection routes={ROUTES} params={{}} />
      {/* The page's own stylesheets, last so the first thing in the page is visible content. */}
      <style>{`${pubSite}\n${pubScenes}\n${pub3}`}</style>
    </>
  );
}
