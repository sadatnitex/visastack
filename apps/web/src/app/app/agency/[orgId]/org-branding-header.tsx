/**
 * Presentational-only rendering of an organization's branding (Commercial V1
 * COM-04): its logo, if set, and a small accent-colored mark. "Powered by
 * VisaStack" always renders alongside it -- never something branding can
 * hide or override. Renders nothing extra when no branding has been set
 * yet, beyond the attribution line itself.
 */
export function OrgBrandingHeader({
  branding,
}: {
  readonly branding:
    | { readonly accentColor: string | null; readonly logoUrl: string | null }
    | undefined;
}) {
  if (!branding) return null;
  const { accentColor, logoUrl } = branding;
  if (!accentColor && !logoUrl) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
      {logoUrl ? (
        <img
          src={logoUrl}
          alt="Organization logo"
          style={{
            height: '2rem',
            width: '2rem',
            objectFit: 'contain',
            borderRadius: '0.25rem',
            border: '1px solid var(--border, #ddd)',
          }}
        />
      ) : null}
      {accentColor ? (
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            height: '0.6rem',
            width: '2rem',
            borderRadius: '999px',
            backgroundColor: accentColor,
          }}
        />
      ) : null}
      <span className="muted" style={{ fontSize: '0.75rem' }}>
        Powered by VisaStack
      </span>
    </div>
  );
}
