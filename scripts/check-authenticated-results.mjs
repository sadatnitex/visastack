import { readFileSync } from 'node:fs';
export function requireExecutedJourneys(report) {
  const stats = report.stats;
  if (
    !stats ||
    !(stats.expected > 0) ||
    stats.unexpected !== 0 ||
    stats.skipped !== 0 ||
    stats.flaky !== 0
  )
    throw new Error(
      'BLOCKED: every configured authenticated check must execute and pass, with zero skipped or retried failures.',
    );
  return stats.expected;
}
if (process.argv[2]) {
  try {
    const count = requireExecutedJourneys(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    console.info(
      `${count} authenticated checks executed without skips. Full visual and lifecycle acceptance still requires review.`,
    );
  } catch {
    console.error('BLOCKED: authenticated execution evidence is incomplete or failed.');
    process.exitCode = 1;
  }
}
