'use client';

import { type CSSProperties, type ReactNode, useState } from 'react';
import type { AgencyBrand } from '../../../../lib/agency-brand';

/**
 * How an agency shows itself on screen (Commercial V1 COM-04). The pieces are small and shared so the
 * workspace header, the settings preview and an invitation all look the same, and so documents an agency
 * produces later can reuse the same brand values (`lib/agency-brand.ts`). "Powered by VisaStack" always
 * shows beside the agency's own brand and is never something branding can hide or override.
 */

type Variables = CSSProperties & Record<`--${string}`, string>;

/** The agency's colours as CSS variables for everything inside, so the stylesheet decides how they are used. */
export function AgencyBrandScope({
  brand,
  className,
  children,
}: {
  readonly brand: AgencyBrand;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const variables: Variables | undefined = brand.accent
    ? {
        '--agency-accent': brand.accent,
        '--agency-on-accent': brand.onAccent,
        ...(brand.tint ? { '--agency-tint': brand.tint } : {}),
      }
    : undefined;
  return (
    <div className={className} style={variables}>
      {children}
    </div>
  );
}

/**
 * The agency's mark: its logo on a clean tile, or its initials on its accent when there is no logo, or when
 * the logo cannot be loaded. A logo that fails never shows as a broken picture.
 */
export function AgencyMark({
  brand,
  size = 'md',
}: {
  readonly brand: AgencyBrand;
  readonly size?: 'sm' | 'md' | 'lg';
}) {
  const [failed, setFailed] = useState(false);
  const showLogo = brand.logoUrl !== null && !failed;
  return (
    <span className={`agency-mark agency-mark-${size}`} data-kind={showLogo ? 'logo' : 'letters'}>
      {showLogo ? (
        <img
          className="agency-mark-image"
          src={brand.logoUrl ?? undefined}
          alt={`${brand.name} logo`}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="agency-mark-letters" aria-hidden="true">
          {brand.initials}
        </span>
      )}
    </span>
  );
}
