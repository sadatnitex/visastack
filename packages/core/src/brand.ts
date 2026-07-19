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

export type AccountId = Brand<string, 'AccountId'>;
export type ApplicantId = Brand<string, 'ApplicantId'>;
export type AgencyId = Brand<string, 'AgencyId'>;
export type MissionId = Brand<string, 'MissionId'>;
export type PackId = Brand<string, 'PackId'>;
export type DocumentId = Brand<string, 'DocumentId'>;
export type GrantId = Brand<string, 'GrantId'>;
