import { AgencyBrandScope, AgencyMark } from '../app/app/agency/[orgId]/org-branding-header';
import { agencyBrand } from '../lib/agency-brand';

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
  const brand = agencyBrand({ name, accentColor, logoUrl });
  return (
    <AgencyBrandScope brand={brand} className="invite-brand">
      <AgencyMark brand={brand} size="md" />
      <p className="invite-brand-text">
        <strong>{brand.name}</strong>
        <span>Powered by VisaStack</span>
      </p>
    </AgencyBrandScope>
  );
}
