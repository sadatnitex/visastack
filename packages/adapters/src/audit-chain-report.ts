import { checkRecentAuditChain } from '@visastack/services';

type AuditDb = Parameters<typeof checkRecentAuditChain>[0];

/**
 * Checks the audit trail's hash chain and reports the result in plain lines. Returns the exit
 * code the `verify:audit-chain` script should end with: 0 when every link and hash is intact,
 * 1 when a link is broken or a hash no longer recomputes. Split out of the script so the exit
 * codes can be tested against a throwaway database.
 */
export async function runAuditChainVerification(
  db: AuditDb,
  limit: number,
  write: (line: string) => void,
): Promise<0 | 1> {
  const check = await checkRecentAuditChain(db, limit);
  write(`checked ${check.checked} audit event(s)`);
  if (check.firstBrokenLinkSeq !== null) {
    write(`BROKEN: event ${check.firstBrokenLinkSeq} does not link to the one before it`);
  }
  if (check.hashMismatches > 0) {
    write(`${check.hashMismatches} event(s) do not recompute to their stored hash`);
  }
  if (check.firstBrokenLinkSeq !== null || check.hashMismatches > 0) return 1;
  write('audit chain intact');
  return 0;
}
