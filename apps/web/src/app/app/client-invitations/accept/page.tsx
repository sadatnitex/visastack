import {
  getConsents,
  getOrganizationBrandingForDisplay,
  listApplicants,
  previewClientInvitation,
} from '@visastack/services';
import type { Metadata } from 'next';
import { withSession } from '../../../../lib/session';
import { createStorage } from '../../../../lib/storage';
import { AcceptClientInvitationForm } from './accept-form';
import { ConsentGate } from './consent-gate';

export const metadata: Metadata = {
  title: 'Invitation from an agency',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const dynamic = 'force-dynamic';

/** What each default grant action actually lets the agency do, in plain language: shown before the traveller commits to anything. */
const GRANT_ACTION_LABELS: Readonly<Record<string, string>> = {
  VIEW_METADATA: 'View your profile information',
  PREVIEW: 'Preview your documents',
  COMMENT: 'Comment on your case',
  PROPOSE_EDIT: 'Propose edits to your profile (you approve each one before it applies)',
  MANAGE: 'Manage your case: assign their staff, request evidence from you, add case notes',
};

/**
 * Accept an agency's client invitation (Commercial V1 Part 4 §6, IAM-03).
 * Deliberately a preview-then-confirm page, not auto-accept-on-visit: a GET
 * request must never spend the one-time token as a side effect of
 * rendering, so `previewClientInvitation` never consumes it, only the
 * explicit form submission in `AcceptClientInvitationForm` does. The
 * traveller sees exactly what scope they'd be granting and to whom, picks
 * which of their own applicant profiles it attaches to, and must hold both
 * CORE_PROCESSING and SHARING consent before the accept form even appears
 * (`acceptClientInvitation` refuses without them anyway; this surfaces that
 * requirement up front instead of as a late failure).
 */
export default async function AcceptClientInvitationPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <section className="section container">
        <article className="card">
          <p className="card-body">This invitation link is missing its token.</p>
        </article>
      </section>
    );
  }

  const data = await withSession(async ({ db, accountId }) => {
    const preview = await previewClientInvitation(db, token);
    if (!preview.ok) return { preview, consents: null, applicants: [], branding: undefined };
    const [consents, applicants, branding] = await Promise.all([
      getConsents(db, accountId),
      listApplicants(db, accountId),
      getOrganizationBrandingForDisplay(db, createStorage(db), preview.value.organizationId),
    ]);
    return { preview, consents, applicants, branding };
  });

  const coreGranted = data.consents?.CORE_PROCESSING === true;
  const sharingGranted = data.consents?.SHARING === true;

  return (
    <section className="section container">
      <div className="u-mb-150">
        <span className="eyebrow">Invitation</span>
        <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
          Work with an agency
        </h1>
      </div>
      <article className="card">
        {!data.preview.ok ? (
          <p className="card-body">
            {data.preview.error.code === 'not_found'
              ? 'This invitation link is not valid.'
              : data.preview.error.message}
          </p>
        ) : (
          <>
            {data.branding?.logoUrl || data.branding?.accentColor ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  marginBottom: '0.75rem',
                }}
              >
                {data.branding.logoUrl ? (
                  <img
                    src={data.branding.logoUrl}
                    alt={`${data.preview.value.organizationName} logo`}
                    style={{
                      height: '2.5rem',
                      width: '2.5rem',
                      objectFit: 'contain',
                      borderRadius: '0.25rem',
                      border: '1px solid var(--border, #ddd)',
                    }}
                  />
                ) : null}
                {data.branding.accentColor ? (
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'inline-block',
                      height: '0.6rem',
                      width: '2rem',
                      borderRadius: '999px',
                      backgroundColor: data.branding.accentColor,
                    }}
                  />
                ) : null}
              </div>
            ) : null}
            <p className="card-body">
              <strong>{data.preview.value.organizationName}</strong> wants to work with you on{' '}
              <strong>{data.preview.value.requestedRoute ?? data.preview.value.displayName}</strong>
              .
            </p>
            <p className="muted" style={{ fontSize: '0.75rem', marginTop: '-0.75rem' }}>
              Powered by VisaStack
            </p>
            <p className="card-body" style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
              If you accept, they will be able to:
            </p>
            <ul style={{ margin: '0 0 1.25rem', paddingLeft: '1.25rem' }}>
              {data.preview.value.grantActions.map((action) => (
                <li key={action} className="muted u-fs-090">
                  {GRANT_ACTION_LABELS[action] ?? action}
                </li>
              ))}
            </ul>

            {!coreGranted || !sharingGranted ? (
              <>
                <p className="card-body">Turn these on before accepting (both are required):</p>
                <ConsentGate core={coreGranted} sharing={sharingGranted} />
              </>
            ) : (
              <AcceptClientInvitationForm
                token={token}
                applicants={data.applicants.map((a) => ({ id: a.id, displayName: a.displayName }))}
              />
            )}
          </>
        )}
      </article>
    </section>
  );
}
