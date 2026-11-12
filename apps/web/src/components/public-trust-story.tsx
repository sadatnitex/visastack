import Link from 'next/link';
import { trustCatalog } from '../i18n/trust';
import { getServerT } from '../lib/i18n-server';
import { Icon } from './icons';

/** Public explanation and a labelled illustration, never private sharing records. */
export function PublicTrustStory() {
  const t = getServerT(trustCatalog);
  return (
    <section className="trust-story land-wrap" aria-labelledby="trust-story-title">
      <div className="trust-hero">
        <div>
          <div className="eyebrow">{t.node('trust.publicTrustStory.theTrustModel')}</div>
          <h1 id="trust-story-title">
            Your documents.
            <em>Your decisions.</em>
          </h1>
          <p>{t.node('trust.publicTrustStory.yourPassportAndPersonalRecordsBelong')}</p>
          <a href="/app" className="btn btn-primary">
            <Icon name="plus" size={17} />
            {t.node('trust.publicTrustStory.startWithYourOwnProfile')}
          </a>
        </div>
        <aside
          className="trust-control"
          aria-label={t('trust.publicTrustStory.exampleOfSharingPermissions')}
        >
          <p className="trust-example-label">
            {t.node('trust.publicTrustStory.illustrationWithMadeUpDetails')}
          </p>
          <div className="trust-window-head">
            <h2>{t.node('trust.publicTrustStory.sharingPermissions')}</h2>
            <span className="trust-control-chip">{t.node('trust.publicTrustStory.youChoose')}</span>
          </div>
          <div className="trust-person">
            <span className="trust-avatar">
              <Icon name="user" size={20} />
            </span>
            <div>
              <b>{t.node('trust.publicTrustStory.exampleTraveller')}</b>
              <small>{t.node('trust.publicTrustStory.ownerOfThisExampleFile')}</small>
            </div>
            <span className="trust-control-chip">
              {t.node('trust.publicTrustStory.yourRecords')}
            </span>
          </div>
          <div className="trust-divider" />
          <div className="trust-person">
            <span className="trust-avatar">
              <Icon name="building" size={20} />
            </span>
            <div>
              <b>{t.node('trust.publicTrustStory.exampleAgency')}</b>
              <small>{t.node('trust.publicTrustStory.selectedItemsForALimitedTime')}</small>
            </div>
          </div>
          <div className="trust-selection">
            <span>
              <Icon name="check" size={15} />
              {t.node('trust.publicTrustStory.passportSummary')}
            </span>
            <span>
              <Icon name="check" size={15} />
              {t.node('trust.publicTrustStory.confirmedItinerary')}
            </span>
            <span>
              <Icon name="lock" size={15} />
              {t.node('trust.publicTrustStory.originalFilesStayProtected')}
            </span>
          </div>
          <p className="trust-revoke">
            {t.node('trust.publicTrustStory.reviewPauseOrEndFutureAccess')}
          </p>
        </aside>
      </div>
      <div className="trust-principles">
        <article className="card">
          <span className="trust-feature-icon">
            <Icon name="shield" size={24} />
          </span>
          <h2 className="card-title">{t.node('trust.publicTrustStory.privateByDesign')}</h2>
          <p className="card-body">
            {t.node('trust.publicTrustStory.yourRecordsBelongToYouChoose')}
          </p>
        </article>
        <article className="card">
          <span className="trust-feature-icon">
            <Icon name="eye" size={24} />
          </span>
          <h2 className="card-title">{t.node('trust.publicTrustStory.knowWhoCanSeeWhat')}</h2>
          <p className="card-body">
            {t.node('trust.publicTrustStory.accessStartsAfterAcceptanceYouCan')}
          </p>
        </article>
        <article className="card">
          <span className="trust-feature-icon">
            <Icon name="clipboard" size={24} />
          </span>
          <h2 className="card-title">{t.node('trust.publicTrustStory.aHistoryYouCanReview')}</h2>
          <p className="card-body">
            {t.node('trust.publicTrustStory.changesAreRecordedAsNewVersions')}
          </p>
        </article>
        <article className="card">
          <span className="trust-feature-icon">
            <Icon name="check" size={24} />
          </span>
          <h2 className="card-title">{t.node('trust.publicTrustStory.aiSuggestsYouDecide')}</h2>
          <p className="card-body">
            {t.node('trust.publicTrustStory.aSuggestionStaysSeparateFromA')}
          </p>
        </article>
      </div>
      <div className="trust-bottom">
        <span>{t.node('trust.publicTrustStory.clearBoundariesHumanControlNoApproval')}</span>
        <Link href="/privacy">
          {t.node('trust.publicTrustStory.viewPrivacyDetails')} <Icon name="arrow" size={16} />
        </Link>
      </div>
    </section>
  );
}
