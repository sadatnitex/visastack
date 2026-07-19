/**
 * Nominal ("branded") types.
 *
 * Identifiers in VisaStack are not interchangeable strings — an `ApplicantId`
 * must never be passed where a `WorkspaceId` is expected. Branding enforces
 * that distinction at compile time with zero runtime cost.
 */

declare const brand: unique symbol;

export type Brand<T, TBrand extends string> = T & {
  readonly [brand]: TBrand;
};

export type ApplicantId = Brand<string, 'ApplicantId'>;
export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type AgencyId = Brand<string, 'AgencyId'>;
export type PackId = Brand<string, 'PackId'>;
export type DocumentId = Brand<string, 'DocumentId'>;
