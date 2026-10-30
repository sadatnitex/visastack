import { aiFeatureOffSentence } from '@visastack/core/ai-features';
import {
  type OrganizationAiSetting,
  getOrganizationAiSetting,
  getOrganizationBrandingForDisplay,
} from '@visastack/services';
import type { Metadata } from 'next';
import {
  AGENCY_AI_ADMINS_ONLY,
  AGENCY_AI_NOT_YET,
  AGENCY_AI_SETTING_TITLE,
} from '../../../../../lib/agency-ai';
import {
  capabilityUnavailableMessage,
  getPlatformCapabilities,
} from '../../../../../lib/capabilities';
import { withSession } from '../../../../../lib/session';
import { AgencyAiSettingForm } from '../agency-ai-setting-form';
import { BrandingForm } from '../branding-form';
import { loadOrgAccess } from '../console-data';
import { RequireDifferentReviewerToggle } from '../require-different-reviewer-toggle';

export const metadata: Metadata = { title: 'Agency Settings' };

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
    const aiSetting = await getOrganizationAiSetting(db, { organizationId: orgId, accountId });
    const ai = aiSetting.ok ? aiSetting.value : null;
    if (!access.admin) return { admin: false as const, ai };
    const branding = await getOrganizationBrandingForDisplay(db, orgId);
    return { admin: true as const, org: access.org, branding, ai };
  });
  if (!data) return null;

  if (!data.admin) {
    return (
      <>
        <article className="card u-mb-150">
          <p className="card-body">
            Settings are limited to this organization's owners and admins.
          </p>
        </article>
        {data.ai ? <AgencyAiCard organizationId={orgId} name={null} ai={data.ai} /> : null}
      </>
    );
  }

  return (
    <>
      {data.ai ? <AgencyAiCard organizationId={orgId} name={data.org.name} ai={data.ai} /> : null}

      <article className="card u-mb-150">
        <p className="card-kicker">Settings</p>
        <h2 className="card-title">Review Policy</h2>
        <div className="row">
          <span className="row-key" style={{ maxWidth: '32rem' }}>
            Require a Different Reviewer
            <span className="muted" style={{ display: 'block', fontSize: 'var(--text-small)' }}>
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
          Your logo, your agency name and one accent colour. They show across this workspace and on
          the invitations you send. "Powered by VisaStack" always stays beside them, and your
          branding never appears in another agency's workspace.
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
        <h2 className="card-title">Bulk Export</h2>
        <p className="card-body u-mb-125">
          Download the profiles of every traveller who granted this organization an accepted export
          grant. Each traveller is re-checked by the policy engine at export time.
        </p>
        {capabilities.bulkExport === 'available' ? (
          <a
            href={`/app/agency/${orgId}/export?purpose=agency_review`}
            className="btn btn-primary"
            download
          >
            Download Bulk Export
          </a>
        ) : (
          <>
            <button type="button" className="btn btn-primary" disabled>
              Download Bulk Export
            </button>
            <p className="muted" style={{ fontSize: 'var(--text-small)', marginTop: '0.6rem' }}>
              {capabilityUnavailableMessage('bulkExport')}
            </p>
          </>
        )}
      </article>
    </>
  );
}

/**
 * "AI Connections for This Agency" (S22, ADR 0021 S22 amendment). Owners and admins turn it on or
 * off; everyone else reads where it stands. It stays visible, with a calm note, while Agency AI
 * Tools is off or the update that stores it has not run.
 */
function AgencyAiCard({
  organizationId,
  name,
  ai,
}: {
  readonly organizationId: string;
  /** The agency's name for an owner or admin, who may change it; null for anyone else. */
  readonly name: string | null;
  readonly ai: OrganizationAiSetting;
}) {
  return (
    <article className="card u-mb-150" aria-labelledby="agency-ai-title">
      <p className="card-kicker">AI Tools</p>
      <h2 className="card-title" id="agency-ai-title">
        {AGENCY_AI_SETTING_TITLE}
      </h2>
      <p className="card-body">
        When this is on, an owner or admin can connect an AI app, such as ChatGPT or Claude, that
        reads only what each traveller allowed this agency’s AI tools to read. Off by default.
      </p>
      {!ai.available ? (
        <p className="muted">{AGENCY_AI_NOT_YET}</p>
      ) : (
        <>
          <div className="row">
            <span className="row-key">Status</span>
            <span>{ai.enabled ? 'On' : 'Off'}</span>
          </div>
          {ai.feature.available ? null : (
            <p className="notice notice-warn">
              {aiFeatureOffSentence('ai_agency_tools', ai.feature.reason)} Connected apps read
              nothing until it works again.
            </p>
          )}
          {ai.canChange && name !== null ? (
            <>
              <AgencyAiSettingForm
                organizationId={organizationId}
                organizationName={name}
                enabled={ai.enabled}
              />
              <p className="card-body u-mt-100">
                <a
                  className="btn btn-secondary"
                  href={`/app/agency/${organizationId}/ai-connections`}
                >
                  Manage AI Connections
                </a>
              </p>
            </>
          ) : (
            <p className="muted">{AGENCY_AI_ADMINS_ONLY}</p>
          )}
        </>
      )}
    </article>
  );
}
