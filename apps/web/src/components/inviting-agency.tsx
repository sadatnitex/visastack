import { AgencyBrandScope, AgencyMark } from '../app/app/agency/[orgId]/org-branding-header';
import { invitationCatalog } from '../i18n/invitation';
import { agencyBrand } from '../lib/agency-brand';
import { getServerT } from '../lib/i18n-server';

/**
 * The inviting agency as a traveller sees it on an invitation: its mark, its name and the fixed
 * "Powered by VisaStack". One component for the signed-in acceptance page and the public page that
 * comes before it, so both show an agency the same way.
 */
export function InvitingAgency({
  name,
  accentColor,
  logoUrl,
}: {
  readonly name: string;
  readonly accentColor: string | null;
  readonly logoUrl: string | null;
}) {
  const t = getServerT(invitationCatalog);
  const brand = agencyBrand({ name, accentColor, logoUrl });
  return (
    <AgencyBrandScope brand={brand} className="invite-brand">
      <AgencyMark brand={brand} size="md" />
      <p className="invite-brand-text">
        <strong>{brand.name}</strong>
        <span>{t.node('invitation.invitingAgency.poweredByVisastack')}</span>
      </p>
    </AgencyBrandScope>
  );
}
