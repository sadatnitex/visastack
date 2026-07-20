/**
 * Liveness probe (PRD §6; docs/operations/runbook.md).
 *
 * Reports only that the process is up. It never touches the database or any
 * dependency, so it stays green during a dependency outage — that distinction
 * (live vs. ready) is what lets orchestration restart a hung process without
 * flapping on transient DB blips. Readiness lives at `/api/health/ready`.
 */

export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json({ status: 'live' });
}
