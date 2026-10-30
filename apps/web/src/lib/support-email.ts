/**
 * The watched support inbox, when one is set up (`SUPPORT_EMAIL`), or null. Nothing invents an
 * address. Read per request, so setting it needs no rebuild. One helper for the Help page and the
 * footer of the billing documents (S30).
 */
const SUPPORT_EMAIL_VAR = 'SUPPORT_EMAIL';

export function supportEmail(
  readEnv: (name: string) => string | undefined = (name) => process.env[name],
): string | null {
  const address = readEnv(SUPPORT_EMAIL_VAR)?.trim();
  return address && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(address) ? address : null;
}
