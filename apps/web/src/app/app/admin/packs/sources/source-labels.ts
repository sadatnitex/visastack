/**
 * How the Official Sources page names each kind of authority. A plain module on purpose: the
 * server page and the client forms both read it, and a constant exported from a client file is
 * not readable on the server (it arrives as a reference, so the labels rendered blank).
 */
export const AUTHORITY_TIER_LABELS = {
  GOVERNMENT: 'Government',
  CONSULATE: 'Consulate or Embassy',
  OFFICIAL_APPLICATION: 'Official Application Site',
  AUTHORIZED_VAC: 'Authorized Visa Centre',
} as const;
