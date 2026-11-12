import { GUEST_CONSENT_TEXT, GUEST_RETENTION_DAYS } from '@visastack/services';
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { collectCatalog } from '../../i18n/collect';
import { agencyBrand } from '../../lib/agency-brand';
import { getServerT, primeLocale } from '../../lib/i18n-server';
import { pdfUploadsAccepted } from '../../lib/upload-preflight';
import { AgencyBrandScope, AgencyMark } from '../app/agency/[orgId]/org-branding-header';
import { GuestChecklist, suggestedOnlyIds } from './checklist';
import { Fold } from './fold';
import { GuestFileList, GuestSentHistory } from './guest-desk-files';
import { SubmitDocumentsForm } from './guest-files';
import { LeaveForm, RetentionForm, SendCodeForm, VerifyCodeForm } from './guest-forms';
import { GuestBar, GuestProgress, fileTally, mandatoryStanding } from './guest-progress';
import { GuestUploader } from './guest-uploader';
import {
  COLLECT_COOKIE,
  type CollectPage as CollectPageState,
  SIGN_IN_TO_RESPOND_HREF,
  collectSwitchOn,
  loadCollectPage,
  loadGuestUploads,
} from './load';

export const metadata: Metadata = {
  title: 'Document Request',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export const dynamic = 'force-dynamic';

type Params = {
  readonly busy?: string | string[];
  readonly step?: string | string[];
  readonly sent?: string | string[];
  readonly left?: string | string[];
};

/**
 * The Document Collection Desk an agency's request link opens (UMPE P6, P8). Its identity belongs
 * to the agency, and only an agency VisaStack has reviewed is named; a restrained Powered by
 * VisaStack mark stays beside it. Before the guest proves the email the agency has for them, it
 * never shows the person, the route, the checklist or whether anyone has an account. After, it
 * shows exactly the checklist the agency issued, and the guest's retention choice.
 */
export default async function CollectPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Params>;
}) {
  await primeLocale();
  const t = getServerT(collectCatalog);
  if (!collectSwitchOn()) notFound();
  const params = (await searchParams) ?? {};
  const page: CollectPageState =
    params.busy === '1'
      ? { state: 'busy' }
      : await loadCollectPage(await headers(), (await cookies()).get(COLLECT_COOKIE)?.value);

  if (page.state === 'busy') {
    return (
      <Shell>
        <h1 className="page-title">{t.node('collect.collectPage.pleaseTryAgainLater')}</h1>
        <p>{t.node('collect.collectPage.tooManyLinksWereOpenedFrom')}</p>
      </Shell>
    );
  }
  if (page.state === 'closed') {
    return (
      <Shell>
        {params.left === '1' ? (
          <>
            <h1 className="page-title">{t.node('collect.collectPage.youHaveLeftThisRequest')}</h1>
            <p>{t.node('collect.collectPage.toComeBackOpenTheLink')}</p>
          </>
        ) : (
          <>
            <h1 className="page-title">{t.node('collect.collectAccountPage.thisLinkIsNotOpen')}</h1>
            <p>{t.node('collect.collectPage.theLinkMayHaveExpiredOr')}</p>
          </>
        )}
      </Shell>
    );
  }

  const { desk } = page;
  const agency = desk.agency;
  const brand = agency
    ? agencyBrand({
        name: agency.name,
        accentColor: agency.accentColor,
        logoUrl: agency.hasLogo ? '/collect/logo' : null,
      })
    : null;
  const agencyName = brand?.name ?? null;
  const header = (title: string) =>
    brand ? (
      <AgencyBrandScope brand={brand} className="collect-agency">
        <AgencyMark brand={brand} size="lg" />
        <div>
          <p className="collect-agency-name">{brand.name}</p>
          <h1 className="page-title">{title}</h1>
        </div>
      </AgencyBrandScope>
    ) : (
      <h1 className="page-title">{title}</h1>
    );

  if (desk.stage === 'verified') {
    const uploads = desk.intact
      ? await loadGuestUploads((await cookies()).get(COLLECT_COOKIE)?.value, desk.items)
      : null;
    const files = uploads?.files ?? [];
    const ready =
      files.some((f) => f.status === 'ready' && f.itemId !== null) &&
      !files.some((f) => f.status === 'checking');
    const trust = `Nothing reaches ${agencyName ?? 'the agency'} until you choose Submit Documents. Without an account, no VisaStack profile is made for you: your files go only to this request.`;
    const retention = (
      <Fold
        title={`How Long ${agencyName ?? 'The Agency'} May Keep Your Files`}
        status={desk.retentionDays === null ? 'Not Chosen Yet' : `${desk.retentionDays} Days`}
        open={desk.retentionDays === null}
      >
        <RetentionForm
          agencyName={agencyName}
          value={desk.retentionDays}
          periods={GUEST_RETENTION_DAYS}
        />
      </Fold>
    );
    const standing = uploads
      ? mandatoryStanding(
          desk.items,
          uploads.stillMissing,
          suggestedOnlyIds(desk.items, files, uploads.stillMissing),
        )
      : null;
    const tally = fileTally(files);
    return (
      <Shell wide>
        {header('Your Document Checklist')}
        <p>
          {agencyName ?? 'The agency'} asked for these documents. This is the exact list they
          issued.
        </p>
        <Branded brand={brand}>
          {standing && desk.intact ? (
            <GuestProgress
              standing={standing}
              agencyName={agencyName}
              blocker={
                files.some((f) => f.status === 'checking')
                  ? 'checking'
                  : desk.retentionDays === null
                    ? 'retention'
                    : null
              }
            />
          ) : null}
          <div className={uploads ? 'collect-layout' : undefined}>
            <div className="collect-main">
              {desk.intact ? (
                <GuestChecklist
                  items={desk.items}
                  progress={uploads ? { files, stillMissing: uploads.stillMissing } : undefined}
                />
              ) : (
                <p className="collect-notice" role="note">
                  {t.node('collect.collectPage.thisChecklistCannotBeShownRight')}
                </p>
              )}
              {uploads ? <GuestSentHistory desk={uploads} /> : null}
              {uploads ? null : retention}
            </div>
            {uploads ? (
              <aside
                className="collect-rail"
                aria-label={t('collect.collectPage.addAndSendYourFiles')}
              >
                <GuestUploader pdfAccepted={pdfUploadsAccepted()} />
                <GuestFileList desk={uploads} items={desk.items} />
                <section id="guest-submit" className="collect-send">
                  {retention}
                  <SubmitDocumentsForm
                    agencyName={agencyName}
                    consentText={GUEST_CONSENT_TEXT}
                    ready={ready && desk.retentionDays !== null}
                    again={uploads.submissions.length > 0}
                  />
                  <p className="muted u-fs-085">{trust}</p>
                </section>
              </aside>
            ) : null}
          </div>
        </Branded>
        {uploads ? null : <p className="muted u-fs-085">{trust}</p>}
        <div className="collect-leave">
          <LeaveForm />
        </div>
        {uploads && standing ? (
          <GuestBar
            placed={tally.placed}
            left={standing.total - standing.done}
            total={standing.total}
            needsLook={tally.needsLook}
          />
        ) : null}
      </Shell>
    );
  }

  const guestStep = params.step === 'guest';
  return (
    <Shell>
      {header(
        agencyName ? `${agencyName} Asked You for Documents` : 'An Agency Asked You for Documents',
      )}
      {!guestStep ? (
        <>
          <p>{t.node('collect.collectPage.thisPrivateLinkComesFromAn')}</p>
          <div className="collect-choices">
            <Link className="btn btn-primary" href={SIGN_IN_TO_RESPOND_HREF}>
              {t.node('collect.collectPage.signInToRespond')}
            </Link>
            <Link className="btn btn-secondary" href="/collect?step=guest">
              {t.node('collect.collectPage.continueWithoutAnAccount')}
            </Link>
          </div>
          <p className="muted u-fs-085">
            {t.node('collect.collectPage.withoutAnAccountNoVisastackProfile')}
          </p>
        </>
      ) : !desk.guestAvailable || desk.guestSpent ? (
        <>
          <h2 className="collect-step-title">
            {t.node('collect.collectPage.continueWithoutAnAccount')}
          </h2>
          <p>
            {desk.guestSpent
              ? `This link can no longer be opened without an account. Ask ${agencyName ?? 'the agency'} for a new link, or sign in to respond.`
              : `This link was not sent to an email address, so it cannot be opened without an account. Ask ${agencyName ?? 'the agency'} to email the request to you, or sign in to respond.`}
          </p>
          <Link className="btn btn-secondary" href="/collect">
            {t.node('collect.collectPage.back')}
          </Link>
        </>
      ) : (
        <>
          <h2 className="collect-step-title">
            {t.node('collect.collectPage.continueWithoutAnAccount')}
          </h2>
          {desk.codePending ? (
            <>
              <output className="collect-notice">
                {params.sent === '1'
                  ? t.node('collect.collectPage.weSentASixDigitCode')
                  : t.node('collect.collectPage.aCodeWasSentToThe')}
              </output>
              <VerifyCodeForm />
              <p className="muted u-fs-085">
                {t.node('collect.collectPage.noEmailCheckYourSpamFolder')}
              </p>
              <SendCodeForm again />
            </>
          ) : (
            <>
              <p>{t.node('collect.collectPage.toSeeTheChecklistConfirmIt')}</p>
              <SendCodeForm />
            </>
          )}
          <Link className="collect-back" href="/collect">
            {t.node('collect.collectPage.back')}
          </Link>
        </>
      )}
    </Shell>
  );
}

/** The agency's accent and tint reach everything inside; with no named agency the product's own apply. */
function Branded({
  brand,
  children,
}: {
  readonly brand: ReturnType<typeof agencyBrand> | null;
  readonly children: React.ReactNode;
}) {
  return brand ? (
    <AgencyBrandScope brand={brand} className="collect-branded">
      {children}
    </AgencyBrandScope>
  ) : (
    <div className="collect-branded">{children}</div>
  );
}

function Shell({
  children,
  wide = false,
}: {
  readonly children: React.ReactNode;
  readonly wide?: boolean;
}) {
  const t = getServerT(collectCatalog);
  return (
    <section className="section container collect-page">
      <article className={`card collect-card${wide ? ' collect-card-wide' : ''}`}>
        <div className="card-body">
          {children}
          <p className="muted u-fs-085 collect-attribution">
            {t.node('collect.collectPage.ifYouWereNotExpectingThis')}
          </p>
        </div>
      </article>
    </section>
  );
}
