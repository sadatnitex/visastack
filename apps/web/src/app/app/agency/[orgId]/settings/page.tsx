import { getOrganizationBrandingForDisplay } from '@visastack/services';
import type { Metadata } from 'next';
import {
  capabilityUnavailableMessage,
  getPlatformCapabilities,
} from '../../../../../lib/capabilities';
import { withSession } from '../../../../../lib/session';
import { createStorage } from '../../../../../lib/storage';
import { BrandingForm } from '../branding-form';
import { loadOrgAccess } from '../console-data';
import { RequireDifferentReviewerToggle } from '../require-different-reviewer-toggle';

export const metadata: Metadata = { title: 'Agency settings' };

export const dynamic = 'force-dynamic';

/**
 * Settings: the review policy, the organization's branding, and the bulk export
 * (Commercial V1 Part 9 UX-01). Administrator work: anyone else gets a plain
 * explanation.
 */
export default async function AgencySettingsPage({
  params,
}: {
  readonly params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const capabilities = getPlatformCapabilities();

  const data = await withSession(async ({ db, accountId }) => {
    const access = await loadOrgAccess(db, accountId, orgId);
    if (!access?.member) return null;
    if (!access.admin) return { admin: false as const };
    const branding = await getOrganizationBrandingForDisplay(db, createStorage(db), orgId);
    return { admin: true as const, org: access.org, branding };
  });
  if (!data) return null;

  if (!data.admin) {
    return (
      <article className="card">
        <p className="card-body">Settings are limited to this organization's owners and admins.</p>
      </article>
    );
  }

  return (
    <>
      <article className="card u-mb-150">
        <p className="card-kicker">Settings</p>
        <h2 className="card-title">Review policy</h2>
        <div className="row">
          <span className="row-key" style={{ maxWidth: '32rem' }}>
            Require a different reviewer
            <span className="muted" style={{ display: 'block', fontSize: '0.8rem' }}>
              When on, whoever raised an evidence request cannot also accept it or ask for a
              replacement; a different team member must. Off by default.
            </span>
          </span>
          <RequireDifferentReviewerToggle
            organizationId={orgId}
            required={data.org.requireDifferentReviewer}
          />
        </div>
      </article>

      <article className="card u-mb-150">
        <p className="card-kicker">Settings</p>
        <h2 className="card-title">Branding</h2>
        <p className="card-body u-mb-125">
          Approved logo, agency name, and one accessible accent color -- shown on this console and
          on invitations. "Powered by VisaStack" always stays alongside it, and this organization's
          branding never appears in another organization's workspace.
        </p>
        <BrandingForm
          organizationId={orgId}
          name={data.org.name}
          accentColor={data.org.accentColor}
          logoUrl={data.branding?.logoUrl ?? null}
        />
      </article>

      <article className="card">
        <p className="card-kicker">Export</p>
        <h2 className="card-title">Bulk export</h2>
        <p className="card-body u-mb-125">
          Download the profiles of every applicant who granted this organization an accepted export
          grant. Each applicant is re-checked by the policy engine at export time.
        </p>
        {capabilities.bulkExport === 'available' ? (
          <a
            href={`/app/agency/${orgId}/export?purpose=agency_review`}
            className="btn btn-primary"
            download
          >
            Download bulk export
          </a>
        ) : (
          <>
            <button type="button" className="btn btn-primary" disabled>
              Download bulk export
            </button>
            <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.6rem' }}>
              {capabilityUnavailableMessage('bulkExport')}
            </p>
          </>
        )}
      </article>
    </>
  );
}
